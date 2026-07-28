import { createHash, randomUUID } from "node:crypto";
import {
  appendFile,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { BatchEngineError } from "./errors.js";
import {
  BATCH_CONTRACT_VERSION,
  DEFAULT_STALE_LOCK_MS,
  type BatchJobEvent,
  type BatchJobState,
  type BatchManifest,
  type BatchOutputReceipt,
} from "./types.js";

export type BatchJobPaths = Readonly<{
  stateRootPath: string;
  jobDirectory: string;
  statePath: string;
  eventsPath: string;
  lockPath: string;
}>;

export type BatchJobLock = Readonly<{
  token: string;
  lockPath: string;
}>;

type LockDocument = Readonly<{
  token: string;
  pid: number;
  createdAt: string;
}>;

function isoNow(): string {
  return new Date().toISOString();
}

function stateJson(state: BatchJobState): string {
  return `${JSON.stringify(state, null, 2)}\n`;
}

export function batchJobPaths(
  rootPath: string,
  jobId: string,
  stateRootPath?: string,
): BatchJobPaths {
  const resolvedRoot = path.resolve(rootPath);
  const resolvedStateRoot = path.resolve(
    stateRootPath ?? path.join(resolvedRoot, ".evavo-vector-jobs"),
  );
  const jobDirectory = path.join(resolvedStateRoot, jobId);
  return Object.freeze({
    stateRootPath: resolvedStateRoot,
    jobDirectory,
    statePath: path.join(jobDirectory, "state.json"),
    eventsPath: path.join(jobDirectory, "events.ndjson"),
    lockPath: path.join(jobDirectory, "runner.lock"),
  });
}

export function initialBatchState(options: Readonly<{
  manifest: BatchManifest;
  manifestPath: string;
  manifestSha256: string;
  rootPath: string;
}>): BatchJobState {
  const now = isoNow();
  return Object.freeze({
    contractVersion: BATCH_CONTRACT_VERSION,
    jobId: options.manifest.id,
    manifestPath: path.resolve(options.manifestPath),
    manifestSha256: options.manifestSha256,
    rootPath: path.resolve(options.rootPath),
    failureMode: options.manifest.failureMode,
    status: "pending",
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    finishedAt: null,
    items: Object.freeze(
      options.manifest.items.map((item) => Object.freeze({
        id: item.id,
        operation: item.operation,
        status: "pending" as const,
        attempts: 0,
        revision: null,
        startedAt: null,
        finishedAt: null,
        outputs: Object.freeze([]),
        evidence: null,
        error: null,
      })),
    ),
  });
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
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BatchEngineError(
      "BATCH_JOB_STATE_INVALID",
      "The durable batch state must contain an object.",
      { details: { statePath } },
    );
  }
  const state = value as Partial<BatchJobState>;
  if (
    state.contractVersion !== BATCH_CONTRACT_VERSION ||
    typeof state.jobId !== "string" ||
    typeof state.manifestSha256 !== "string" ||
    typeof state.rootPath !== "string" ||
    !Array.isArray(state.items)
  ) {
    throw new BatchEngineError(
      "BATCH_JOB_STATE_INVALID",
      "The durable batch state is missing required contract fields.",
      { details: { statePath } },
    );
  }
  return state as BatchJobState;
}

export async function writeBatchState(
  statePath: string,
  state: BatchJobState,
): Promise<void> {
  const directory = path.dirname(statePath);
  await mkdir(directory, { recursive: true });
  const temporaryPath = path.join(
    directory,
    `.${path.basename(statePath)}.${process.pid}.${randomUUID()}.tmp`,
  );
  try {
    await writeFile(temporaryPath, stateJson(state), {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    await rename(temporaryPath, statePath);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw new BatchEngineError(
      "BATCH_FILESYSTEM_FAILED",
      "The durable batch state could not be committed atomically.",
      {
        details: {
          statePath,
          cause: error instanceof Error ? error.message : String(error),
        },
        cause: error,
      },
    );
  }
}

export async function readOrCreateBatchState(options: Readonly<{
  paths: BatchJobPaths;
  manifest: BatchManifest;
  manifestPath: string;
  manifestSha256: string;
  rootPath: string;
}>): Promise<Readonly<{ state: BatchJobState; created: boolean }>> {
  await mkdir(options.paths.jobDirectory, { recursive: true });
  try {
    const source = await readFile(options.paths.statePath, "utf8");
    const state = parseState(source, options.paths.statePath);
    if (state.jobId !== options.manifest.id) {
      throw new BatchEngineError(
        "BATCH_JOB_STATE_INVALID",
        "The durable state job ID does not match the manifest.",
        {
          details: {
            stateJobId: state.jobId,
            manifestJobId: options.manifest.id,
          },
        },
      );
    }
    if (state.manifestSha256 !== options.manifestSha256) {
      throw new BatchEngineError(
        "BATCH_MANIFEST_CHANGED",
        "The batch manifest changed after durable state was created.",
        {
          details: {
            jobId: state.jobId,
            retainedManifestSha256: state.manifestSha256,
            receivedManifestSha256: options.manifestSha256,
          },
        },
      );
    }
    if (path.resolve(state.rootPath) !== path.resolve(options.rootPath)) {
      throw new BatchEngineError(
        "BATCH_JOB_STATE_INVALID",
        "The durable state root does not match the requested execution root.",
        {
          details: {
            retainedRootPath: state.rootPath,
            requestedRootPath: options.rootPath,
          },
        },
      );
    }
    return Object.freeze({ state, created: false });
  } catch (error) {
    if (
      error instanceof BatchEngineError ||
      !(error instanceof Error) ||
      !("code" in error) ||
      error.code !== "ENOENT"
    ) {
      throw error;
    }
  }

  const state = initialBatchState({
    manifest: options.manifest,
    manifestPath: options.manifestPath,
    manifestSha256: options.manifestSha256,
    rootPath: options.rootPath,
  });
  await writeBatchState(options.paths.statePath, state);
  return Object.freeze({ state, created: true });
}

export async function appendBatchEvent(
  eventsPath: string,
  event: Omit<BatchJobEvent, "at"> & Readonly<{ at?: string }>,
): Promise<void> {
  await mkdir(path.dirname(eventsPath), { recursive: true });
  const document: BatchJobEvent = Object.freeze({
    at: event.at ?? isoNow(),
    type: event.type,
    jobId: event.jobId,
    ...(event.itemId ? { itemId: event.itemId } : {}),
    ...(event.details ? { details: event.details } : {}),
  });
  await appendFile(eventsPath, `${JSON.stringify(document)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

async function readLock(lockPath: string): Promise<LockDocument | null> {
  try {
    const source = await readFile(lockPath, "utf8");
    const value = JSON.parse(source) as Partial<LockDocument>;
    return (
      typeof value.token === "string" &&
      typeof value.pid === "number" &&
      typeof value.createdAt === "string"
    )
      ? value as LockDocument
      : null;
  } catch {
    return null;
  }
}

export async function acquireBatchLock(
  paths: BatchJobPaths,
  staleLockMs = DEFAULT_STALE_LOCK_MS,
): Promise<BatchJobLock> {
  await mkdir(paths.jobDirectory, { recursive: true });
  const token = randomUUID();
  const document: LockDocument = Object.freeze({
    token,
    pid: process.pid,
    createdAt: isoNow(),
  });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await open(paths.lockPath, "wx", 0o600);
      try {
        await handle.writeFile(`${JSON.stringify(document, null, 2)}\n`, "utf8");
      } finally {
        await handle.close();
      }
      return Object.freeze({ token, lockPath: paths.lockPath });
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !("code" in error) ||
        error.code !== "EEXIST"
      ) {
        throw new BatchEngineError(
          "BATCH_FILESYSTEM_FAILED",
          "The durable batch lock could not be created.",
          {
            details: {
              lockPath: paths.lockPath,
              cause: error instanceof Error ? error.message : String(error),
            },
            cause: error,
          },
        );
      }
      const existing = await readLock(paths.lockPath);
      const createdAt = existing ? Date.parse(existing.createdAt) : Number.NaN;
      const stale =
        !Number.isFinite(createdAt) ||
        Date.now() - createdAt > staleLockMs;
      if (!stale || attempt > 0) {
        throw new BatchEngineError(
          "BATCH_JOB_LOCKED",
          "Another runner owns the durable batch job lock.",
          {
            retryable: true,
            details: {
              lockPath: paths.lockPath,
              owner: existing,
              staleAfterMs: staleLockMs,
            },
          },
        );
      }
      const stalePath = `${paths.lockPath}.stale.${Date.now()}.${randomUUID()}`;
      try {
        await rename(paths.lockPath, stalePath);
      } catch (renameError) {
        throw new BatchEngineError(
          "BATCH_JOB_LOCKED",
          "The stale durable batch lock could not be recovered safely.",
          {
            retryable: true,
            details: {
              lockPath: paths.lockPath,
              cause: renameError instanceof Error
                ? renameError.message
                : String(renameError),
            },
            cause: renameError,
          },
        );
      }
    }
  }
  throw new BatchEngineError(
    "BATCH_JOB_LOCKED",
    "The durable batch lock could not be acquired.",
    { retryable: true, details: { lockPath: paths.lockPath } },
  );
}

export async function releaseBatchLock(lock: BatchJobLock): Promise<void> {
  const existing = await readLock(lock.lockPath);
  if (existing?.token === lock.token) {
    await rm(lock.lockPath, { force: true });
  }
}

export async function verifyBatchOutputReceipt(
  receipt: BatchOutputReceipt,
): Promise<boolean> {
  try {
    const information = await stat(receipt.path);
    if (!information.isFile() || information.size !== receipt.bytes) return false;
    const source = await readFile(receipt.path);
    const hash = createHash("sha256").update(source).digest("hex");
    return hash === receipt.sha256;
  } catch {
    return false;
  }
}

export async function verifyBatchOutputReceipts(
  receipts: readonly BatchOutputReceipt[],
): Promise<boolean> {
  if (receipts.length < 1) return false;
  const checks = await Promise.all(receipts.map(verifyBatchOutputReceipt));
  return checks.every(Boolean);
}
