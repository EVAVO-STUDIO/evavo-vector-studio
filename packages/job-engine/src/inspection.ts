import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { BatchEngineError } from "./errors.js";
import { canonicalBatchRoot } from "./path-policy.js";
import { batchJobPaths } from "./store.js";
import {
  BATCH_CONTRACT_VERSION,
  type BatchItemStatus,
  type BatchJobEvent,
  type BatchJobState,
} from "./types.js";

export type InspectDurableBatchOptions = Readonly<{
  jobId: string;
  rootPath: string;
  stateRootPath?: string;
  eventLimit?: number;
}>;

export type DurableBatchInspection = Readonly<{
  jobDirectory: string;
  state: BatchJobState;
  progress: Readonly<{
    total: number;
    pending: number;
    running: number;
    complete: number;
    failed: number;
    skipped: number;
    percentComplete: number;
  }>;
  lock: Readonly<{
    present: boolean;
    createdAt: string | null;
    ageMs: number | null;
    pid: number | null;
  }>;
  recentEvents: readonly BatchJobEvent[];
}>;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function parseState(source: string, statePath: string): BatchJobState {
  let value: unknown;
  try {
    value = JSON.parse(source) as unknown;
  } catch (error) {
    throw new BatchEngineError(
      "BATCH_JOB_STATE_INVALID",
      "The durable batch state is not valid JSON.",
      {
        details: {
          statePath,
          cause: error instanceof Error ? error.message : String(error),
        },
        cause: error,
      },
    );
  }
  const state = record(value);
  if (
    !state ||
    state.contractVersion !== BATCH_CONTRACT_VERSION ||
    typeof state.jobId !== "string" ||
    typeof state.status !== "string" ||
    !Array.isArray(state.items)
  ) {
    throw new BatchEngineError(
      "BATCH_JOB_STATE_INVALID",
      "The durable batch state is missing required contract fields.",
      { details: { statePath } },
    );
  }
  return value as BatchJobState;
}

function parseEvent(line: string): BatchJobEvent | null {
  if (!line.trim()) return null;
  try {
    const value = JSON.parse(line) as unknown;
    const event = record(value);
    if (
      !event ||
      typeof event.at !== "string" ||
      typeof event.type !== "string" ||
      typeof event.jobId !== "string"
    ) {
      return null;
    }
    return value as BatchJobEvent;
  } catch {
    return null;
  }
}

function countStatus(
  state: BatchJobState,
  status: BatchItemStatus,
): number {
  return state.items.filter((item) => item.status === status).length;
}

async function readRecentEvents(
  eventsPath: string,
  eventLimit: number,
): Promise<readonly BatchJobEvent[]> {
  if (eventLimit === 0) return Object.freeze([]);
  try {
    const source = await readFile(eventsPath, "utf8");
    const events = source
      .split(/\r?\n/)
      .map(parseEvent)
      .filter((event): event is BatchJobEvent => event !== null);
    return Object.freeze(events.slice(-eventLimit));
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return Object.freeze([]);
    }
    throw new BatchEngineError(
      "BATCH_FILESYSTEM_FAILED",
      "The durable batch event journal could not be read.",
      {
        details: {
          eventsPath,
          cause: error instanceof Error ? error.message : String(error),
        },
        cause: error,
      },
    );
  }
}

async function inspectLock(lockPath: string): Promise<DurableBatchInspection["lock"]> {
  try {
    const [source, information] = await Promise.all([
      readFile(lockPath, "utf8"),
      stat(lockPath),
    ]);
    const value = JSON.parse(source) as unknown;
    const lock = record(value);
    const createdAt = typeof lock?.createdAt === "string"
      ? lock.createdAt
      : null;
    const createdTime = createdAt ? Date.parse(createdAt) : Number.NaN;
    return Object.freeze({
      present: true,
      createdAt,
      ageMs: Number.isFinite(createdTime)
        ? Math.max(0, Date.now() - createdTime)
        : Math.max(0, Date.now() - information.mtimeMs),
      pid: typeof lock?.pid === "number" ? lock.pid : null,
    });
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return Object.freeze({
        present: false,
        createdAt: null,
        ageMs: null,
        pid: null,
      });
    }
    return Object.freeze({
      present: true,
      createdAt: null,
      ageMs: null,
      pid: null,
    });
  }
}

export async function inspectDurableBatch(
  options: InspectDurableBatchOptions,
): Promise<DurableBatchInspection> {
  const eventLimit = options.eventLimit ?? 50;
  if (!Number.isSafeInteger(eventLimit) || eventLimit < 0 || eventLimit > 1_000) {
    throw new BatchEngineError(
      "BATCH_JOB_STATE_INVALID",
      "eventLimit must be an integer from 0 to 1000.",
      { details: { eventLimit } },
    );
  }
  const rootPath = await canonicalBatchRoot(options.rootPath);
  const paths = batchJobPaths(
    rootPath,
    options.jobId,
    options.stateRootPath,
  );
  let source: string;
  try {
    source = await readFile(paths.statePath, "utf8");
  } catch (error) {
    throw new BatchEngineError(
      "BATCH_FILESYSTEM_FAILED",
      "The durable batch state could not be read.",
      {
        details: {
          statePath: paths.statePath,
          cause: error instanceof Error ? error.message : String(error),
        },
        cause: error,
      },
    );
  }
  const state = parseState(source, paths.statePath);
  if (state.jobId !== options.jobId) {
    throw new BatchEngineError(
      "BATCH_JOB_STATE_INVALID",
      "The durable state job ID does not match the requested job.",
      {
        details: {
          requestedJobId: options.jobId,
          retainedJobId: state.jobId,
        },
      },
    );
  }
  const total = state.items.length;
  const complete = countStatus(state, "complete");
  const [recentEvents, lock] = await Promise.all([
    readRecentEvents(paths.eventsPath, eventLimit),
    inspectLock(paths.lockPath),
  ]);
  return Object.freeze({
    jobDirectory: paths.jobDirectory,
    state,
    progress: Object.freeze({
      total,
      pending: countStatus(state, "pending"),
      running: countStatus(state, "running"),
      complete,
      failed: countStatus(state, "failed"),
      skipped: countStatus(state, "skipped"),
      percentComplete: total === 0
        ? 0
        : Number(((complete / total) * 100).toFixed(2)),
    }),
    lock,
    recentEvents,
  });
}
