import { randomUUID } from "node:crypto";
import { Buffer } from "node:buffer";
import {
  canonicalHostedJobJson,
  hostedJobSha256,
} from "./canonical.js";
import { HostedJobError } from "./errors.js";
import {
  HOSTED_JOB_CONTRACT_VERSION,
  HOSTED_JOB_MAX_LEASE_MS,
  HOSTED_JOB_MAX_PAYLOAD_BYTES,
  HOSTED_JOB_MIN_LEASE_MS,
  HOSTED_JOB_OPERATIONS,
  type HostedJobCompletion,
  type HostedJobControllerOptions,
  type HostedJobCreateRequest,
  type HostedJobCreateResult,
  type HostedJobFailureInput,
  type HostedJobLeaseRequest,
  type HostedJobOperation,
  type HostedJobRecord,
  type HostedJobStore,
} from "./types.js";
import {
  validateHostedJobCreateRequest,
  validateHostedJobOutputReceipts,
} from "./validation.js";

const WORKER_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const TERMINAL = new Set(["succeeded", "failed", "cancelled"] as const);
const OPERATION_SET = new Set<HostedJobOperation>(HOSTED_JOB_OPERATIONS);

function iso(date: Date): string {
  return date.toISOString();
}

function addMs(date: Date, milliseconds: number): string {
  return new Date(date.getTime() + milliseconds).toISOString();
}

function defaultJobId(): string {
  const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  return `vjob_${timestamp}_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

function freezeRecord(record: HostedJobRecord): HostedJobRecord {
  return Object.freeze(record);
}

function nextRecord(
  current: HostedJobRecord,
  patch: Partial<HostedJobRecord>,
  now: Date,
): HostedJobRecord {
  return freezeRecord({
    ...current,
    ...patch,
    version: current.version + 1,
    updatedAt: iso(now),
  });
}

function validateWorker(workerId: string, leaseMs: number): void {
  if (!WORKER_ID.test(workerId)) {
    throw new HostedJobError(
      "HOSTED_JOB_REQUEST_INVALID",
      "workerId must be a portable 1 to 128 character identifier.",
      { status: 422, details: { workerId } },
    );
  }
  if (
    !Number.isSafeInteger(leaseMs) ||
    leaseMs < HOSTED_JOB_MIN_LEASE_MS ||
    leaseMs > HOSTED_JOB_MAX_LEASE_MS
  ) {
    throw new HostedJobError(
      "HOSTED_JOB_REQUEST_INVALID",
      `leaseMs must be an integer from ${HOSTED_JOB_MIN_LEASE_MS} to ${HOSTED_JOB_MAX_LEASE_MS}.`,
      { status: 422, details: { leaseMs } },
    );
  }
}

function normaliseOperations(
  operations: readonly HostedJobOperation[] | undefined,
): ReadonlySet<HostedJobOperation> {
  if (operations === undefined) return new Set(HOSTED_JOB_OPERATIONS);
  if (!Array.isArray(operations) || operations.length === 0) {
    throw new HostedJobError(
      "HOSTED_JOB_REQUEST_INVALID",
      "operations must contain at least one supported operation.",
      { status: 422 },
    );
  }
  const selected = new Set<HostedJobOperation>();
  for (const operation of operations) {
    if (!OPERATION_SET.has(operation)) {
      throw new HostedJobError(
        "HOSTED_JOB_REQUEST_INVALID",
        "operations contains an unsupported operation.",
        { status: 422, details: { operation } },
      );
    }
    selected.add(operation);
  }
  return selected;
}

function assertLease(
  record: HostedJobRecord,
  leaseToken: string,
  now: Date,
): void {
  if (!record.lease || record.lease.token !== leaseToken) {
    throw new HostedJobError(
      "HOSTED_JOB_LEASE_INVALID",
      "The hosted job lease token is missing or does not match.",
      { status: 409, details: { jobId: record.id } },
    );
  }
  if (Date.parse(record.lease.expiresAt) <= now.getTime()) {
    throw new HostedJobError(
      "HOSTED_JOB_LEASE_EXPIRED",
      "The hosted job lease has expired.",
      { status: 409, retryable: true, details: { jobId: record.id } },
    );
  }
}

function normaliseFailure(
  input: HostedJobFailureInput,
  now: Date,
) {
  if (!input.code.trim() || input.code.length > 160) {
    throw new HostedJobError(
      "HOSTED_JOB_REQUEST_INVALID",
      "failure.code must contain 1 to 160 characters.",
      { status: 422 },
    );
  }
  if (!input.message.trim() || input.message.length > 2_000) {
    throw new HostedJobError(
      "HOSTED_JOB_REQUEST_INVALID",
      "failure.message must contain 1 to 2000 characters.",
      { status: 422 },
    );
  }
  const details = input.details ?? {};
  const detailsJson = canonicalHostedJobJson(details);
  if (Buffer.byteLength(detailsJson, "utf8") > HOSTED_JOB_MAX_PAYLOAD_BYTES) {
    throw new HostedJobError(
      "HOSTED_JOB_REQUEST_INVALID",
      "failure.details exceeds the hosted job JSON limit.",
      { status: 422 },
    );
  }
  return Object.freeze({
    code: input.code.trim(),
    message: input.message.trim(),
    retryable: input.retryable,
    details: Object.keys(details).length > 0 ? Object.freeze({ ...details }) : null,
    occurredAt: iso(now),
  });
}

export class HostedJobController {
  readonly #store: HostedJobStore;
  readonly #now: () => Date;
  readonly #createId: () => string;
  readonly #createLeaseToken: () => string;
  readonly #casAttempts: number;

  constructor(store: HostedJobStore, options: HostedJobControllerOptions = {}) {
    this.#store = store;
    this.#now = options.now ?? (() => new Date());
    this.#createId = options.createId ?? defaultJobId;
    this.#createLeaseToken = options.createLeaseToken ?? randomUUID;
    this.#casAttempts = options.compareAndSwapAttempts ?? 16;
  }

  async create(request: HostedJobCreateRequest | unknown): Promise<HostedJobCreateResult> {
    const normalised = validateHostedJobCreateRequest(request);
    const now = this.#now();
    const requestSha256 = hostedJobSha256(normalised);
    const record = freezeRecord({
      contractVersion: HOSTED_JOB_CONTRACT_VERSION,
      id: this.#createId(),
      version: 1,
      workspaceId: normalised.workspaceId,
      idempotencyKey: normalised.idempotencyKey,
      requestSha256,
      operation: normalised.operation,
      payload: normalised.payload,
      priority: normalised.priority,
      status: "queued",
      attempts: 0,
      maxAttempts: normalised.maxAttempts,
      createdAt: iso(now),
      updatedAt: iso(now),
      startedAt: null,
      finishedAt: null,
      lease: null,
      cancellation: null,
      result: null,
      failure: null,
    });
    const retained = await this.#store.create(record);
    if (!retained.created && retained.record.requestSha256 !== requestSha256) {
      throw new HostedJobError(
        "HOSTED_JOB_IDEMPOTENCY_CONFLICT",
        "The idempotency key is already bound to a different hosted job request.",
        {
          status: 409,
          details: {
            workspaceId: normalised.workspaceId,
            idempotencyKey: normalised.idempotencyKey,
            existingJobId: retained.record.id,
          },
        },
      );
    }
    return Object.freeze({ record: retained.record, reused: !retained.created });
  }

  async get(jobId: string): Promise<HostedJobRecord> {
    const record = await this.#store.get(jobId);
    if (!record) {
      throw new HostedJobError(
        "HOSTED_JOB_NOT_FOUND",
        "The hosted job does not exist.",
        { status: 404, details: { jobId } },
      );
    }
    return record;
  }

  async #mutate(
    jobId: string,
    update: (current: HostedJobRecord, now: Date) => HostedJobRecord,
  ): Promise<HostedJobRecord> {
    for (let attempt = 0; attempt < this.#casAttempts; attempt += 1) {
      const current = await this.get(jobId);
      const next = update(current, this.#now());
      if (next === current) return current;
      if (next.id !== current.id || next.version !== current.version + 1) {
        throw new HostedJobError(
          "HOSTED_JOB_TRANSITION_INVALID",
          "The hosted job transition produced an invalid version.",
          { status: 500, details: { jobId } },
        );
      }
      if (await this.#store.compareAndSwap(jobId, current.version, next)) return next;
    }
    throw new HostedJobError(
      "HOSTED_JOB_CONCURRENCY_CONFLICT",
      "The hosted job changed too many times while applying the transition.",
      { status: 409, retryable: true, details: { jobId } },
    );
  }

  async requestCancellation(
    jobId: string,
    options: Readonly<{ requestedBy?: string; reason?: string }> = {},
  ): Promise<HostedJobRecord> {
    return this.#mutate(jobId, (current, now) => {
      if (TERMINAL.has(current.status as "succeeded" | "failed" | "cancelled")) return current;
      if (current.status === "cancel-requested") return current;
      const reason = options.reason?.trim() || null;
      if (reason && reason.length > 500) {
        throw new HostedJobError(
          "HOSTED_JOB_REQUEST_INVALID",
          "Cancellation reasons cannot exceed 500 characters.",
          { status: 422 },
        );
      }
      const cancellation = Object.freeze({
        requestedAt: iso(now),
        requestedBy: options.requestedBy?.trim() || null,
        reason,
      });
      if (current.status === "queued") {
        return nextRecord(current, {
          status: "cancelled",
          cancellation,
          finishedAt: iso(now),
        }, now);
      }
      return nextRecord(current, {
        status: "cancel-requested",
        cancellation,
      }, now);
    });
  }

  async reclaimExpiredLeases(): Promise<number> {
    const now = this.#now();
    const candidates = (await this.#store.list()).filter((record) =>
      record.lease !== null &&
      (record.status === "leased" || record.status === "running" || record.status === "cancel-requested") &&
      Date.parse(record.lease.expiresAt) <= now.getTime()
    );
    let reclaimed = 0;
    for (const candidate of candidates) {
      try {
        const changed = await this.#mutate(candidate.id, (current, transitionNow) => {
          if (!current.lease || Date.parse(current.lease.expiresAt) > transitionNow.getTime()) return current;
          if (current.status === "cancel-requested") {
            return nextRecord(current, {
              status: "cancelled",
              lease: null,
              finishedAt: iso(transitionNow),
            }, transitionNow);
          }
          const failure = Object.freeze({
            code: "HOSTED_JOB_LEASE_EXPIRED",
            message: "The worker lease expired before a terminal state was committed.",
            retryable: current.attempts < current.maxAttempts,
            details: null,
            occurredAt: iso(transitionNow),
          });
          return current.attempts < current.maxAttempts
            ? nextRecord(current, {
                status: "queued",
                lease: null,
                failure,
                finishedAt: null,
              }, transitionNow)
            : nextRecord(current, {
                status: "failed",
                lease: null,
                failure,
                finishedAt: iso(transitionNow),
              }, transitionNow);
        });
        if (changed.version > candidate.version) reclaimed += 1;
      } catch (error) {
        if (!(error instanceof HostedJobError) || error.code !== "HOSTED_JOB_NOT_FOUND") throw error;
      }
    }
    return reclaimed;
  }

  async acquireLease(request: HostedJobLeaseRequest): Promise<HostedJobRecord | null> {
    validateWorker(request.workerId, request.leaseMs);
    const operations = normaliseOperations(request.operations);
    await this.reclaimExpiredLeases();
    const candidates = (await this.#store.list())
      .filter((record) =>
        record.status === "queued" &&
        record.cancellation === null &&
        record.attempts < record.maxAttempts &&
        operations.has(record.operation)
      )
      .sort((left, right) =>
        right.priority - left.priority ||
        left.createdAt.localeCompare(right.createdAt) ||
        left.id.localeCompare(right.id)
      );

    for (const candidate of candidates) {
      for (let attempt = 0; attempt < this.#casAttempts; attempt += 1) {
        const current = await this.#store.get(candidate.id);
        if (!current || current.status !== "queued" || current.cancellation !== null) break;
        const now = this.#now();
        const token = this.#createLeaseToken();
        const next = nextRecord(current, {
          status: "leased",
          attempts: current.attempts + 1,
          lease: Object.freeze({
            workerId: request.workerId,
            token,
            acquiredAt: iso(now),
            heartbeatAt: iso(now),
            expiresAt: addMs(now, request.leaseMs),
          }),
          failure: null,
          finishedAt: null,
        }, now);
        if (await this.#store.compareAndSwap(current.id, current.version, next)) return next;
      }
    }
    return null;
  }

  async start(jobId: string, leaseToken: string): Promise<HostedJobRecord> {
    return this.#mutate(jobId, (current, now) => {
      assertLease(current, leaseToken, now);
      if (current.status === "cancel-requested") {
        throw new HostedJobError(
          "HOSTED_JOB_CANCELLATION_REQUESTED",
          "The hosted job cannot start because cancellation was requested.",
          { status: 409, details: { jobId } },
        );
      }
      if (current.status !== "leased") {
        throw new HostedJobError(
          "HOSTED_JOB_TRANSITION_INVALID",
          "Only a leased hosted job can enter running state.",
          { status: 409, details: { jobId, status: current.status } },
        );
      }
      return nextRecord(current, {
        status: "running",
        startedAt: current.startedAt ?? iso(now),
      }, now);
    });
  }

  async heartbeat(
    jobId: string,
    leaseToken: string,
    leaseMs: number,
  ): Promise<HostedJobRecord> {
    validateWorker("worker", leaseMs);
    return this.#mutate(jobId, (current, now) => {
      assertLease(current, leaseToken, now);
      if (
        current.status !== "leased" &&
        current.status !== "running" &&
        current.status !== "cancel-requested"
      ) {
        throw new HostedJobError(
          "HOSTED_JOB_TRANSITION_INVALID",
          "Only an active leased job can renew its heartbeat.",
          { status: 409, details: { jobId, status: current.status } },
        );
      }
      return nextRecord(current, {
        lease: Object.freeze({
          ...current.lease!,
          heartbeatAt: iso(now),
          expiresAt: addMs(now, leaseMs),
        }),
      }, now);
    });
  }

  async succeed(
  jobId: string,
  leaseToken: string,
  completion: HostedJobCompletion = {},
): Promise<HostedJobRecord> {
  const outputs = validateHostedJobOutputReceipts(completion.outputs);
  const evidence = completion.evidence ?? {};
  const evidenceJson = canonicalHostedJobJson(evidence);
  if (Buffer.byteLength(evidenceJson, "utf8") > HOSTED_JOB_MAX_PAYLOAD_BYTES) {
    throw new HostedJobError(
      "HOSTED_JOB_REQUEST_INVALID",
      "completion.evidence exceeds the hosted job JSON limit.",
      { status: 422 },
    );
  }
  return this.#mutate(jobId, (current, now) => {
    assertLease(current, leaseToken, now);
    if (current.status === "cancel-requested" && outputs.length === 0) {
      throw new HostedJobError(
        "HOSTED_JOB_CANCELLATION_REQUESTED",
        "The hosted job cannot succeed after cancellation was requested unless immutable output receipts already exist.",
        { status: 409, details: { jobId } },
      );
    }
    if (current.status !== "running" && current.status !== "cancel-requested") {
      throw new HostedJobError(
        "HOSTED_JOB_TRANSITION_INVALID",
        "Only a running or cancellation-raced hosted job can succeed.",
        { status: 409, details: { jobId, status: current.status } },
      );
    }
    const cancellationRaced = current.status === "cancel-requested";
    return nextRecord(current, {
      status: "succeeded",
      lease: null,
      result: Object.freeze({
        outputs,
        evidence: Object.freeze({
          ...evidence,
          ...(cancellationRaced
            ? { cancellationRaceResolution: "committed-success-retained" }
            : {}),
        }),
        completedAt: iso(now),
      }),
      failure: null,
      finishedAt: iso(now),
    }, now);
  });
}

async fail(
    jobId: string,
    leaseToken: string,
    input: HostedJobFailureInput,
  ): Promise<HostedJobRecord> {
    return this.#mutate(jobId, (current, now) => {
      assertLease(current, leaseToken, now);
      if (
        current.status !== "leased" &&
        current.status !== "running" &&
        current.status !== "cancel-requested"
      ) {
        throw new HostedJobError(
          "HOSTED_JOB_TRANSITION_INVALID",
          "Only an active leased job can report failure.",
          { status: 409, details: { jobId, status: current.status } },
        );
      }
      if (current.status === "cancel-requested") {
        return nextRecord(current, {
          status: "cancelled",
          lease: null,
          finishedAt: iso(now),
        }, now);
      }
      const failure = normaliseFailure(input, now);
      return failure.retryable && current.attempts < current.maxAttempts
        ? nextRecord(current, {
            status: "queued",
            lease: null,
            failure,
            finishedAt: null,
          }, now)
        : nextRecord(current, {
            status: "failed",
            lease: null,
            failure,
            finishedAt: iso(now),
          }, now);
    });
  }

  async acknowledgeCancellation(
    jobId: string,
    leaseToken: string,
  ): Promise<HostedJobRecord> {
    return this.#mutate(jobId, (current, now) => {
      assertLease(current, leaseToken, now);
      if (current.status !== "cancel-requested") {
        throw new HostedJobError(
          "HOSTED_JOB_TRANSITION_INVALID",
          "Cancellation can be acknowledged only after it was requested.",
          { status: 409, details: { jobId, status: current.status } },
        );
      }
      return nextRecord(current, {
        status: "cancelled",
        lease: null,
        finishedAt: iso(now),
      }, now);
    });
  }
}
