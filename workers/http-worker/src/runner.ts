import { setTimeout as delay } from "node:timers/promises";
import type {
  HostedJobFailureInput,
  HostedJobOperation,
  HostedJobRecord,
} from "@evavo/job-control";
import {
  VectorWorkerClientError,
  type VectorWorkerClient,
  type VectorWorkerCompleteInput,
  type VectorWorkerRecordResponse,
} from "@evavo/worker-client";
import {
  VECTOR_WORKER_SUPPORTED_OPERATIONS,
  VectorWorkerError,
  type VectorWorkerExecutor,
  type WorkerExecutionResult,
} from "@evavo/worker-engine";
import type {
  VectorWorkerLeaseResponse,
  VectorWorkerProtocolOperation,
  VectorWorkerProtocolRecord,
} from "@evavo/worker-protocol";
import {
  HttpWorkerError,
  httpWorkerFailure,
} from "./errors.js";

export const HTTP_WORKER_CONTRACT_VERSION = "1.0" as const;
export const DEFAULT_HTTP_WORKER_LEASE_MS = 60_000;
export const DEFAULT_HTTP_WORKER_HEARTBEAT_MS = 15_000;
export const DEFAULT_HTTP_WORKER_POLL_MS = 1_000;
export const DEFAULT_HTTP_WORKER_COMPLETION_ATTEMPTS = 3;
export const DEFAULT_HTTP_WORKER_COMPLETION_RETRY_MS = 500;

export type HttpWorkerConfig = Readonly<{
  workerId: string;
  leaseMs?: number;
  heartbeatMs?: number;
  pollMs?: number;
  operations?: readonly VectorWorkerProtocolOperation[];
  completionAttempts?: number;
  completionRetryMs?: number;
}>;

export type HttpWorkOutcome =
  | "idle"
  | "succeeded"
  | "queued"
  | "failed"
  | "cancelled"
  | "control-uncertain";

export type HttpWorkResult = Readonly<{
  contractVersion: typeof HTTP_WORKER_CONTRACT_VERSION;
  workerId: string;
  outcome: HttpWorkOutcome;
  record: VectorWorkerProtocolRecord | null;
  completionAttempts: number;
  error: Readonly<{
    code: string;
    message: string;
    retryable: boolean;
    details: Readonly<Record<string, unknown>> | null;
  }> | null;
}>;

export type HttpWorkerLoopOptions = Readonly<{
  signal?: AbortSignal;
  maxJobs?: number;
  idleExitMs?: number;
  onResult?: (result: HttpWorkResult) => void | Promise<void>;
}>;

export type HttpWorkerLoopSummary = Readonly<{
  contractVersion: typeof HTTP_WORKER_CONTRACT_VERSION;
  workerId: string;
  processed: number;
  succeeded: number;
  queued: number;
  failed: number;
  cancelled: number;
  controlUncertain: number;
  stoppedBy: "signal" | "max-jobs" | "idle-timeout";
}>;

const WORKER_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const COMPLETION_REPLAY_SAFE_ERRORS = new Set([
  "VECTOR_WORKER_CLIENT_TIMEOUT",
  "VECTOR_WORKER_CLIENT_NETWORK_FAILED",
  "VECTOR_WORKER_CLIENT_RESPONSE_INVALID",
]);

function boundedInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  field: string,
): number {
  const resolved = value ?? fallback;
  if (
    !Number.isSafeInteger(resolved) ||
    resolved < minimum ||
    resolved > maximum
  ) {
    throw new HttpWorkerError(
      "HTTP_WORKER_CONFIG_INVALID",
      `${field} must be an integer from ${minimum} to ${maximum}.`,
      { details: { field, value: resolved, minimum, maximum } },
    );
  }
  return resolved;
}

function validateConfig(config: HttpWorkerConfig): Readonly<{
  workerId: string;
  leaseMs: number;
  heartbeatMs: number;
  pollMs: number;
  operations: readonly VectorWorkerProtocolOperation[];
  completionAttempts: number;
  completionRetryMs: number;
}> {
  if (!WORKER_ID.test(config.workerId)) {
    throw new HttpWorkerError(
      "HTTP_WORKER_CONFIG_INVALID",
      "workerId must be a portable 1 to 128 character identifier.",
      { details: { workerId: config.workerId } },
    );
  }
  const leaseMs = boundedInteger(
    config.leaseMs,
    DEFAULT_HTTP_WORKER_LEASE_MS,
    5_000,
    15 * 60 * 1_000,
    "leaseMs",
  );
  const heartbeatMs = boundedInteger(
    config.heartbeatMs,
    DEFAULT_HTTP_WORKER_HEARTBEAT_MS,
    1_000,
    Math.max(1_000, Math.floor(leaseMs / 2) - 1),
    "heartbeatMs",
  );
  if (heartbeatMs >= leaseMs / 2) {
    throw new HttpWorkerError(
      "HTTP_WORKER_CONFIG_INVALID",
      "heartbeatMs must remain less than half the lease duration.",
      { details: { heartbeatMs, leaseMs } },
    );
  }
  const pollMs = boundedInteger(
    config.pollMs,
    DEFAULT_HTTP_WORKER_POLL_MS,
    100,
    60_000,
    "pollMs",
  );
  const completionAttempts = boundedInteger(
    config.completionAttempts,
    DEFAULT_HTTP_WORKER_COMPLETION_ATTEMPTS,
    1,
    10,
    "completionAttempts",
  );
  const completionRetryMs = boundedInteger(
    config.completionRetryMs,
    DEFAULT_HTTP_WORKER_COMPLETION_RETRY_MS,
    100,
    30_000,
    "completionRetryMs",
  );
  const requested = config.operations ??
    (VECTOR_WORKER_SUPPORTED_OPERATIONS as readonly VectorWorkerProtocolOperation[]);
  if (!Array.isArray(requested) || requested.length < 1) {
    throw new HttpWorkerError(
      "HTTP_WORKER_CONFIG_INVALID",
      "At least one worker operation must be selected.",
    );
  }
  const supported = new Set<string>(VECTOR_WORKER_SUPPORTED_OPERATIONS);
  const operations = [...new Set(requested)];
  for (const operation of operations) {
    if (!supported.has(operation)) {
      throw new HttpWorkerError(
        "HTTP_WORKER_CONFIG_INVALID",
        "The HTTP worker cannot advertise an unsupported operation.",
        { details: { operation } },
      );
    }
  }
  return Object.freeze({
    workerId: config.workerId,
    leaseMs,
    heartbeatMs,
    pollMs,
    operations: Object.freeze(operations),
    completionAttempts,
    completionRetryMs,
  });
}

function executionRecord(
  record: VectorWorkerProtocolRecord,
  leaseToken: string,
): HostedJobRecord {
  if (!record.lease) {
    throw new HttpWorkerError(
      "HTTP_WORKER_LEASE_INVALID",
      "The worker control response does not contain an active lease.",
      { retryable: true, details: { jobId: record.id, status: record.status } },
    );
  }
  return Object.freeze({
    ...record,
    operation: record.operation as HostedJobOperation,
    lease: Object.freeze({
      workerId: record.lease.workerId,
      token: leaseToken,
      acquiredAt: record.lease.acquiredAt,
      heartbeatAt: record.lease.heartbeatAt,
      expiresAt: record.lease.expiresAt,
    }),
  }) as HostedJobRecord;
}

function terminalOutcome(record: VectorWorkerProtocolRecord): HttpWorkOutcome {
  if (record.status === "succeeded") return "succeeded";
  if (record.status === "cancelled") return "cancelled";
  if (record.status === "failed") return "failed";
  if (record.status === "queued") return "queued";
  return "control-uncertain";
}

function result(
  workerId: string,
  outcome: HttpWorkOutcome,
  record: VectorWorkerProtocolRecord | null,
  completionAttempts: number,
  error: ReturnType<typeof httpWorkerFailure> | null,
): HttpWorkResult {
  return Object.freeze({
    contractVersion: HTTP_WORKER_CONTRACT_VERSION,
    workerId,
    outcome,
    record,
    completionAttempts,
    error,
  });
}

type HeartbeatState = Readonly<{
  cancellationRequested: boolean;
  failure: ReturnType<typeof httpWorkerFailure> | null;
}>;

async function heartbeatMonitor(
  client: VectorWorkerClient,
  lease: VectorWorkerLeaseResponse,
  leaseMs: number,
  heartbeatMs: number,
  executionAbort: AbortController,
  stopSignal: AbortSignal,
): Promise<HeartbeatState> {
  for (;;) {
    try {
      await delay(heartbeatMs, undefined, { signal: stopSignal });
    } catch (error) {
      if (stopSignal.aborted) {
        return Object.freeze({ cancellationRequested: false, failure: null });
      }
      const failure = httpWorkerFailure(error);
      executionAbort.abort(error);
      return Object.freeze({ cancellationRequested: false, failure });
    }
    if (stopSignal.aborted) {
      return Object.freeze({ cancellationRequested: false, failure: null });
    }
    try {
      const heartbeat = await client.heartbeat(
        lease.record.id,
        lease.leaseToken,
        leaseMs,
        { signal: stopSignal },
      );
      if (heartbeat.cancellationRequested) {
        const cancellation = new HttpWorkerError(
          "HTTP_WORKER_CANCELLED",
          "The worker control plane requested cancellation.",
          {
            retryable: false,
            details: { jobId: lease.record.id },
          },
        );
        executionAbort.abort(cancellation);
        return Object.freeze({
          cancellationRequested: true,
          failure: httpWorkerFailure(cancellation),
        });
      }
    } catch (error) {
      if (stopSignal.aborted) {
        return Object.freeze({ cancellationRequested: false, failure: null });
      }
      const failure = httpWorkerFailure(error);
      executionAbort.abort(error);
      return Object.freeze({ cancellationRequested: false, failure });
    }
  }
}

function completionInput(
  leaseToken: string,
  completion: WorkerExecutionResult,
): VectorWorkerCompleteInput {
  return Object.freeze({
    leaseToken,
    outputs: completion.outputs,
    evidence: completion.evidence,
  });
}

function safeToReplayCompletion(error: unknown): boolean {
  return error instanceof VectorWorkerClientError &&
    COMPLETION_REPLAY_SAFE_ERRORS.has(error.code);
}

async function completeWithReplay(
  client: VectorWorkerClient,
  jobId: string,
  completion: VectorWorkerCompleteInput,
  attempts: number,
  retryMs: number,
  signal?: AbortSignal,
): Promise<Readonly<{
  response: VectorWorkerRecordResponse;
  attempts: number;
}>> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return Object.freeze({
        response: await client.complete(jobId, completion, { signal }),
        attempts: attempt,
      });
    } catch (error) {
      lastError = error;
      if (
        attempt >= attempts ||
        signal?.aborted ||
        !safeToReplayCompletion(error)
      ) {
        break;
      }
      await delay(retryMs, undefined, { signal });
    }
  }
  const failure = httpWorkerFailure(lastError);
  throw new HttpWorkerError(
    "HTTP_WORKER_COMPLETION_UNCERTAIN",
    "Immutable outputs committed, but the worker could not confirm the receipt-backed completion transition.",
    {
      retryable: true,
      details: {
        jobId,
        completionAttempts: attempts,
        lastErrorCode: failure.code,
        lastErrorMessage: failure.message,
      },
      cause: lastError,
    },
  );
}

export class HttpVectorWorker {
  readonly #client: VectorWorkerClient;
  readonly #executor: VectorWorkerExecutor;
  readonly #config: ReturnType<typeof validateConfig>;

  constructor(
    client: VectorWorkerClient,
    executor: VectorWorkerExecutor,
    config: HttpWorkerConfig,
  ) {
    this.#client = client;
    this.#executor = executor;
    this.#config = validateConfig(config);
  }

  get capabilities(): Readonly<Record<string, unknown>> {
    return Object.freeze({
      contractVersion: HTTP_WORKER_CONTRACT_VERSION,
      workerId: this.#config.workerId,
      execution: "http-coordinated-shared-object-store",
      operations: this.#config.operations,
      leaseMs: this.#config.leaseMs,
      heartbeatMs: this.#config.heartbeatMs,
      pollMs: this.#config.pollMs,
      completionAttempts: this.#config.completionAttempts,
      completionRetryMs: this.#config.completionRetryMs,
      receiptBackedCompletionReplay: true,
      persistentJobRecords: true,
      sharedImmutableObjectStoreRequired: true,
      objectTransferAvailable: false,
      queueDeliveryAvailable: false,
      managedRemoteExecutionAvailable: false,
      generatedBodiesInControlResponses: false,
      approval: "human-review-required",
    });
  }

  async runOne(signal?: AbortSignal): Promise<HttpWorkResult> {
    if (signal?.aborted) {
      throw new HttpWorkerError(
        "HTTP_WORKER_CANCELLED",
        "The HTTP worker call was cancelled before lease acquisition.",
        { retryable: true },
      );
    }

    let lease: VectorWorkerLeaseResponse | null;
    try {
      lease = await this.#client.acquireLease({
        workerId: this.#config.workerId,
        leaseMs: this.#config.leaseMs,
        operations: this.#config.operations,
      }, { signal });
    } catch (error) {
      return result(
        this.#config.workerId,
        "control-uncertain",
        null,
        0,
        httpWorkerFailure(error),
      );
    }
    if (!lease) {
      return result(this.#config.workerId, "idle", null, 0, null);
    }

    const leaseToken = lease.leaseToken;
    let started: VectorWorkerRecordResponse;
    try {
      started = await this.#client.start(lease.record.id, leaseToken, { signal });
    } catch (error) {
      return result(
        this.#config.workerId,
        "control-uncertain",
        lease.record,
        0,
        httpWorkerFailure(error),
      );
    }

    const executionAbort = new AbortController();
    const stopHeartbeat = new AbortController();
    const onOuterAbort = () => executionAbort.abort(
      new HttpWorkerError(
        "HTTP_WORKER_CANCELLED",
        "The HTTP worker process was asked to stop.",
        { retryable: true, details: { jobId: started.record.id } },
      ),
    );
    signal?.addEventListener("abort", onOuterAbort, { once: true });
    const monitor = heartbeatMonitor(
      this.#client,
      lease,
      this.#config.leaseMs,
      this.#config.heartbeatMs,
      executionAbort,
      stopHeartbeat.signal,
    );

    try {
      const completion = await this.#executor.execute(
        executionRecord(started.record, leaseToken),
        { signal: executionAbort.signal },
      );
      const completed = await completeWithReplay(
        this.#client,
        started.record.id,
        completionInput(leaseToken, completion),
        this.#config.completionAttempts,
        this.#config.completionRetryMs,
        signal,
      );
      stopHeartbeat.abort();
      await monitor;
      return result(
        this.#config.workerId,
        "succeeded",
        completed.response.record,
        completed.attempts,
        null,
      );
    } catch (error) {
      if (error instanceof HttpWorkerError && error.code === "HTTP_WORKER_COMPLETION_UNCERTAIN") {
        stopHeartbeat.abort();
        await monitor;
        return result(
          this.#config.workerId,
          "control-uncertain",
          started.record,
          this.#config.completionAttempts,
          httpWorkerFailure(error),
        );
      }

      stopHeartbeat.abort();
      const heartbeat = await monitor;
      const failure = heartbeat.failure ?? httpWorkerFailure(error);
      if (
        heartbeat.cancellationRequested ||
        failure.code === "HTTP_WORKER_CANCELLED" ||
        failure.code === "VECTOR_WORKER_CANCELLED"
      ) {
        try {
          const cancelled = await this.#client.acknowledgeCancellation(
            started.record.id,
            leaseToken,
            { signal },
          );
          return result(
            this.#config.workerId,
            "cancelled",
            cancelled.record,
            0,
            failure,
          );
        } catch (transitionError) {
          return result(
            this.#config.workerId,
            "control-uncertain",
            started.record,
            0,
            httpWorkerFailure(transitionError),
          );
        }
      }

      const failureInput: HostedJobFailureInput = Object.freeze({
        code: failure.code.slice(0, 160) || "HTTP_WORKER_EXECUTION_FAILED",
        message: failure.message.slice(0, 2_000) || "HTTP worker execution failed.",
        retryable: failure.retryable,
        ...(failure.details ? { details: failure.details } : {}),
      });
      try {
        const failed = await this.#client.fail(
          started.record.id,
          leaseToken,
          failureInput,
          { signal },
        );
        return result(
          this.#config.workerId,
          terminalOutcome(failed.record),
          failed.record,
          0,
          failure,
        );
      } catch (transitionError) {
        return result(
          this.#config.workerId,
          "control-uncertain",
          started.record,
          0,
          httpWorkerFailure(transitionError),
        );
      }
    } finally {
      stopHeartbeat.abort();
      signal?.removeEventListener("abort", onOuterAbort);
    }
  }

  async run(options: HttpWorkerLoopOptions = {}): Promise<HttpWorkerLoopSummary> {
    const maxJobs = options.maxJobs ?? Number.POSITIVE_INFINITY;
    const idleExitMs = options.idleExitMs ?? Number.POSITIVE_INFINITY;
    if (
      !(maxJobs === Number.POSITIVE_INFINITY ||
        (Number.isSafeInteger(maxJobs) && maxJobs >= 1))
    ) {
      throw new HttpWorkerError(
        "HTTP_WORKER_CONFIG_INVALID",
        "maxJobs must be a positive safe integer when provided.",
      );
    }
    if (
      !(idleExitMs === Number.POSITIVE_INFINITY ||
        (Number.isSafeInteger(idleExitMs) && idleExitMs >= 0))
    ) {
      throw new HttpWorkerError(
        "HTTP_WORKER_CONFIG_INVALID",
        "idleExitMs must be a non-negative safe integer when provided.",
      );
    }

    const counts = {
      processed: 0,
      succeeded: 0,
      queued: 0,
      failed: 0,
      cancelled: 0,
      controlUncertain: 0,
    };
    let idleSince = Date.now();
    let stoppedBy: HttpWorkerLoopSummary["stoppedBy"] = "signal";
    while (!options.signal?.aborted) {
      const work = await this.runOne(options.signal);
      await options.onResult?.(work);
      if (work.outcome === "idle") {
        if (Date.now() - idleSince >= idleExitMs) {
          stoppedBy = "idle-timeout";
          break;
        }
        try {
          await delay(this.#config.pollMs, undefined, { signal: options.signal });
        } catch {
          stoppedBy = "signal";
          break;
        }
        continue;
      }
      idleSince = Date.now();
      counts.processed += 1;
      if (work.outcome === "succeeded") counts.succeeded += 1;
      else if (work.outcome === "queued") counts.queued += 1;
      else if (work.outcome === "failed") counts.failed += 1;
      else if (work.outcome === "cancelled") counts.cancelled += 1;
      else if (work.outcome === "control-uncertain") counts.controlUncertain += 1;
      if (counts.processed >= maxJobs) {
        stoppedBy = "max-jobs";
        break;
      }
    }
    return Object.freeze({
      contractVersion: HTTP_WORKER_CONTRACT_VERSION,
      workerId: this.#config.workerId,
      ...counts,
      stoppedBy,
    });
  }
}
