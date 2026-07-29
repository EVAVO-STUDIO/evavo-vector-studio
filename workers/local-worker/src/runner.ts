import { setTimeout as delay } from "node:timers/promises";
import {
  HostedJobController,
  HostedJobError,
  type HostedJobOperation,
  type HostedJobRecord,
} from "@evavo/job-control";
import {
  VECTOR_WORKER_SUPPORTED_OPERATIONS,
  VectorWorkerError,
  vectorWorkerFailure,
  type VectorWorkerExecutor,
} from "@evavo/worker-engine";

export const LOCAL_WORKER_CONTRACT_VERSION = "1.0" as const;
export const DEFAULT_LOCAL_WORKER_LEASE_MS = 60_000;
export const DEFAULT_LOCAL_WORKER_HEARTBEAT_MS = 15_000;
export const DEFAULT_LOCAL_WORKER_POLL_MS = 1_000;

export type LocalWorkerConfig = Readonly<{
  workerId: string;
  leaseMs?: number;
  heartbeatMs?: number;
  pollMs?: number;
  operations?: readonly HostedJobOperation[];
}>;

export type LocalWorkResult = Readonly<{
  contractVersion: typeof LOCAL_WORKER_CONTRACT_VERSION;
  workerId: string;
  outcome: "idle" | "succeeded" | "queued" | "failed" | "cancelled";
  job: HostedJobRecord | null;
  error: Readonly<{
    code: string;
    message: string;
    retryable: boolean;
    details: Readonly<Record<string, unknown>> | null;
  }> | null;
}>;

export type LocalWorkerLoopOptions = Readonly<{
  signal?: AbortSignal;
  maxJobs?: number;
  idleExitMs?: number;
  onResult?: (result: LocalWorkResult) => void | Promise<void>;
}>;

export type LocalWorkerLoopSummary = Readonly<{
  contractVersion: typeof LOCAL_WORKER_CONTRACT_VERSION;
  workerId: string;
  processed: number;
  succeeded: number;
  queued: number;
  failed: number;
  cancelled: number;
  stoppedBy: "signal" | "max-jobs" | "idle-timeout";
}>;

const WORKER_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function workerError(
  code: string,
  message: string,
  retryable: boolean,
  details: Readonly<Record<string, unknown>> | undefined = undefined,
): Readonly<{
  code: string;
  message: string;
  retryable: boolean;
  details: Readonly<Record<string, unknown>> | null;
}> {
  return Object.freeze({
    code,
    message,
    retryable,
    details: details ?? null,
  });
}

function validateConfig(config: LocalWorkerConfig): Readonly<{
  workerId: string;
  leaseMs: number;
  heartbeatMs: number;
  pollMs: number;
  operations: readonly HostedJobOperation[];
}> {
  if (!WORKER_ID.test(config.workerId)) {
    throw new VectorWorkerError(
      "LOCAL_WORKER_CONFIG_INVALID",
      "workerId must be a portable 1 to 128 character identifier.",
      { details: { workerId: config.workerId } },
    );
  }
  const leaseMs = config.leaseMs ?? DEFAULT_LOCAL_WORKER_LEASE_MS;
  const heartbeatMs = config.heartbeatMs ?? DEFAULT_LOCAL_WORKER_HEARTBEAT_MS;
  const pollMs = config.pollMs ?? DEFAULT_LOCAL_WORKER_POLL_MS;
  if (!Number.isSafeInteger(leaseMs) || leaseMs < 5_000 || leaseMs > 900_000) {
    throw new VectorWorkerError(
      "LOCAL_WORKER_CONFIG_INVALID",
      "leaseMs must be an integer from 5000 to 900000.",
      { details: { leaseMs } },
    );
  }
  if (
    !Number.isSafeInteger(heartbeatMs) ||
    heartbeatMs < 1_000 ||
    heartbeatMs >= leaseMs / 2
  ) {
    throw new VectorWorkerError(
      "LOCAL_WORKER_CONFIG_INVALID",
      "heartbeatMs must be at least 1000 and less than half the lease duration.",
      { details: { heartbeatMs, leaseMs } },
    );
  }
  if (!Number.isSafeInteger(pollMs) || pollMs < 100 || pollMs > 60_000) {
    throw new VectorWorkerError(
      "LOCAL_WORKER_CONFIG_INVALID",
      "pollMs must be an integer from 100 to 60000.",
      { details: { pollMs } },
    );
  }
  const operations = config.operations ?? VECTOR_WORKER_SUPPORTED_OPERATIONS;
  if (!Array.isArray(operations) || operations.length < 1) {
    throw new VectorWorkerError(
      "LOCAL_WORKER_CONFIG_INVALID",
      "At least one supported worker operation is required.",
    );
  }
  const supported = new Set<HostedJobOperation>(VECTOR_WORKER_SUPPORTED_OPERATIONS);
  for (const operation of operations) {
    if (!supported.has(operation)) {
      throw new VectorWorkerError(
        "LOCAL_WORKER_CONFIG_INVALID",
        "The local worker cannot advertise an unsupported operation.",
        { details: { operation } },
      );
    }
  }
  return Object.freeze({
    workerId: config.workerId,
    leaseMs,
    heartbeatMs,
    pollMs,
    operations: Object.freeze([...new Set(operations)]),
  });
}

function terminalOutcome(record: HostedJobRecord): LocalWorkResult["outcome"] {
  if (record.status === "succeeded") return "succeeded";
  if (record.status === "cancelled") return "cancelled";
  if (record.status === "failed") return "failed";
  return "queued";
}

async function heartbeatMonitor(
  controller: HostedJobController,
  jobId: string,
  leaseToken: string,
  leaseMs: number,
  heartbeatMs: number,
  executionAbort: AbortController,
  stopSignal: AbortSignal,
): Promise<VectorWorkerError | null> {
  for (;;) {
    try {
      await delay(heartbeatMs, undefined, { signal: stopSignal });
    } catch (error) {
      if (stopSignal.aborted) return null;
      const failure = vectorWorkerFailure(error);
      executionAbort.abort(failure);
      return failure;
    }
    if (stopSignal.aborted) return null;
    try {
      const current = await controller.get(jobId);
      if (current.status === "cancel-requested") {
        const cancellation = new VectorWorkerError(
          "VECTOR_WORKER_CANCELLED",
          "The hosted job cancellation request was observed by the local worker.",
          { retryable: false, details: { jobId } },
        );
        executionAbort.abort(cancellation);
        return cancellation;
      }
      if (current.status !== "leased" && current.status !== "running") {
        const transition = new VectorWorkerError(
          "LOCAL_WORKER_LEASE_LOST",
          "The hosted job left its active lease state while executing.",
          {
            retryable: true,
            details: { jobId, status: current.status },
          },
        );
        executionAbort.abort(transition);
        return transition;
      }
      await controller.heartbeat(jobId, leaseToken, leaseMs);
    } catch (error) {
      const failure = vectorWorkerFailure(error);
      executionAbort.abort(failure);
      return failure;
    }
  }
}

export class LocalVectorWorker {
  readonly #controller: HostedJobController;
  readonly #executor: VectorWorkerExecutor;
  readonly #config: ReturnType<typeof validateConfig>;

  constructor(
    controller: HostedJobController,
    executor: VectorWorkerExecutor,
    config: LocalWorkerConfig,
  ) {
    this.#controller = controller;
    this.#executor = executor;
    this.#config = validateConfig(config);
  }

  get capabilities(): Readonly<Record<string, unknown>> {
    return Object.freeze({
      contractVersion: LOCAL_WORKER_CONTRACT_VERSION,
      workerId: this.#config.workerId,
      execution: "local-single-process",
      operations: this.#config.operations,
      leaseMs: this.#config.leaseMs,
      heartbeatMs: this.#config.heartbeatMs,
      pollMs: this.#config.pollMs,
      persistentJobRecords: true,
      immutableObjectStorage: true,
      hostedBackgroundQueue: false,
      remoteExecutionAvailable: false,
      approval: "human-review-required",
    });
  }

  async runOne(signal?: AbortSignal): Promise<LocalWorkResult> {
    if (signal?.aborted) {
      throw new VectorWorkerError(
        "VECTOR_WORKER_CANCELLED",
        "The local worker call was cancelled before lease acquisition.",
        { retryable: true },
      );
    }
    const leased = await this.#controller.acquireLease({
      workerId: this.#config.workerId,
      leaseMs: this.#config.leaseMs,
      operations: this.#config.operations,
    });
    if (!leased) {
      return Object.freeze({
        contractVersion: LOCAL_WORKER_CONTRACT_VERSION,
        workerId: this.#config.workerId,
        outcome: "idle",
        job: null,
        error: null,
      });
    }
    const leaseToken = leased.lease?.token;
    if (!leaseToken) {
      throw new VectorWorkerError(
        "LOCAL_WORKER_LEASE_LOST",
        "The leased hosted job does not contain a lease token.",
        { retryable: true, details: { jobId: leased.id } },
      );
    }
    const running = await this.#controller.start(leased.id, leaseToken);
    const executionAbort = new AbortController();
    const stopMonitor = new AbortController();
    const onOuterAbort = () => {
      executionAbort.abort(
        new VectorWorkerError(
          "VECTOR_WORKER_CANCELLED",
          "The local worker process was asked to stop.",
          { retryable: true, details: { jobId: running.id } },
        ),
      );
    };
    signal?.addEventListener("abort", onOuterAbort, { once: true });
    const monitor = heartbeatMonitor(
      this.#controller,
      running.id,
      leaseToken,
      this.#config.leaseMs,
      this.#config.heartbeatMs,
      executionAbort,
      stopMonitor.signal,
    );

    try {
      const completion = await this.#executor.execute(running, {
        signal: executionAbort.signal,
      });
      stopMonitor.abort();
      const monitorFailure = await monitor;
      if (monitorFailure && monitorFailure.code !== "VECTOR_WORKER_CANCELLED") {
        throw monitorFailure;
      }
      const completed = await this.#controller.succeed(
        running.id,
        leaseToken,
        completion,
      );
      return Object.freeze({
        contractVersion: LOCAL_WORKER_CONTRACT_VERSION,
        workerId: this.#config.workerId,
        outcome: "succeeded",
        job: completed,
        error: null,
      });
    } catch (error) {
      stopMonitor.abort();
      const monitorFailure = await monitor;
      const failure = monitorFailure ?? vectorWorkerFailure(error);
      let current: HostedJobRecord;
      try {
        current = await this.#controller.get(running.id);
      } catch (inspectionError) {
        const inspectedFailure = vectorWorkerFailure(inspectionError);
        return Object.freeze({
          contractVersion: LOCAL_WORKER_CONTRACT_VERSION,
          workerId: this.#config.workerId,
          outcome: "failed",
          job: null,
          error: workerError(
            inspectedFailure.code,
            inspectedFailure.message,
            inspectedFailure.retryable,
            inspectedFailure.details,
          ),
        });
      }

      try {
        const terminal = current.status === "cancel-requested"
          ? await this.#controller.acknowledgeCancellation(
              current.id,
              leaseToken,
            )
          : await this.#controller.fail(current.id, leaseToken, {
              code: failure.code,
              message: failure.message,
              retryable: failure.retryable,
              details: failure.details,
            });
        return Object.freeze({
          contractVersion: LOCAL_WORKER_CONTRACT_VERSION,
          workerId: this.#config.workerId,
          outcome: terminalOutcome(terminal),
          job: terminal,
          error: workerError(
            failure.code,
            failure.message,
            failure.retryable,
            failure.details,
          ),
        });
      } catch (transitionError) {
        const transitionFailure = transitionError instanceof HostedJobError
          ? transitionError
          : vectorWorkerFailure(transitionError);
        return Object.freeze({
          contractVersion: LOCAL_WORKER_CONTRACT_VERSION,
          workerId: this.#config.workerId,
          outcome: "failed",
          job: current,
          error: workerError(
            transitionFailure.code,
            transitionFailure.message,
            transitionFailure.retryable,
            transitionFailure.details,
          ),
        });
      }
    } finally {
      stopMonitor.abort();
      signal?.removeEventListener("abort", onOuterAbort);
    }
  }

  async run(
    options: LocalWorkerLoopOptions = {},
  ): Promise<LocalWorkerLoopSummary> {
    const maxJobs = options.maxJobs ?? Number.POSITIVE_INFINITY;
    const idleExitMs = options.idleExitMs ?? Number.POSITIVE_INFINITY;
    if (
      !(maxJobs === Number.POSITIVE_INFINITY ||
        (Number.isSafeInteger(maxJobs) && maxJobs >= 1))
    ) {
      throw new VectorWorkerError(
        "LOCAL_WORKER_CONFIG_INVALID",
        "maxJobs must be a positive safe integer when provided.",
      );
    }
    if (
      !(idleExitMs === Number.POSITIVE_INFINITY ||
        (Number.isSafeInteger(idleExitMs) && idleExitMs >= 0))
    ) {
      throw new VectorWorkerError(
        "LOCAL_WORKER_CONFIG_INVALID",
        "idleExitMs must be a non-negative safe integer when provided.",
      );
    }

    const counts = {
      processed: 0,
      succeeded: 0,
      queued: 0,
      failed: 0,
      cancelled: 0,
    };
    let idleSince = Date.now();
    let stoppedBy: LocalWorkerLoopSummary["stoppedBy"] = "signal";
    while (!options.signal?.aborted) {
      const result = await this.runOne(options.signal);
      await options.onResult?.(result);
      if (result.outcome === "idle") {
        if (Date.now() - idleSince >= idleExitMs) {
          stoppedBy = "idle-timeout";
          break;
        }
        try {
          await delay(this.#config.pollMs, undefined, {
            signal: options.signal,
          });
        } catch {
          stoppedBy = "signal";
          break;
        }
        continue;
      }
      idleSince = Date.now();
      counts.processed += 1;
      if (result.outcome === "succeeded") counts.succeeded += 1;
      else if (result.outcome === "queued") counts.queued += 1;
      else if (result.outcome === "failed") counts.failed += 1;
      else if (result.outcome === "cancelled") counts.cancelled += 1;
      if (counts.processed >= maxJobs) {
        stoppedBy = "max-jobs";
        break;
      }
    }
    return Object.freeze({
      contractVersion: LOCAL_WORKER_CONTRACT_VERSION,
      workerId: this.#config.workerId,
      ...counts,
      stoppedBy,
    });
  }
}
