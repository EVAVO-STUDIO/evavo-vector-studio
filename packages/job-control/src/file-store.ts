import { randomUUID } from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { hostedJobIdempotencyDigest } from "./canonical.js";
import { HostedJobError, hostedJobFailure } from "./errors.js";
import type {
  HostedJobRecord,
  HostedJobStore,
  HostedJobStoreCreateResult,
} from "./types.js";
import { parseHostedJobRecord } from "./validation.js";

const LOCK_WAIT_MS = 5_000;
const STALE_LOCK_MS = 60_000;

function jobFileName(jobId: string): string {
  return `${jobId}.json`;
}

function isNodeError(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

async function readJsonFile(filePath: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as unknown;
  } catch (error) {
    if (isNodeError(error, "ENOENT")) throw error;
    throw new HostedJobError(
      "HOSTED_JOB_STORE_CORRUPT",
      "A hosted job store file could not be parsed.",
      {
        status: 500,
        details: {
          filePath,
          cause: error instanceof Error ? error.message : String(error),
        },
        cause: error,
      },
    );
  }
}

async function atomicWriteJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${randomUUID()}.tmp`,
  );
  let handle;
  try {
    handle = await open(temporaryPath, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporaryPath, filePath);
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw hostedJobFailure(error, "The hosted job store could not commit an atomic JSON file.");
  }
}

async function withLock<T>(lockPath: string, operation: () => Promise<T>): Promise<T> {
  const deadline = Date.now() + LOCK_WAIT_MS;
  let lockHandle;
  for (;;) {
    try {
      lockHandle = await open(lockPath, "wx", 0o600);
      await lockHandle.writeFile(`${JSON.stringify({
        pid: process.pid,
        createdAt: new Date().toISOString(),
        token: randomUUID(),
      })}\n`, "utf8");
      await lockHandle.sync();
      break;
    } catch (error) {
      if (!isNodeError(error, "EEXIST")) {
        throw hostedJobFailure(error, "The hosted job store lock could not be created.");
      }
      try {
        const information = await stat(lockPath);
        if (Date.now() - information.mtimeMs > STALE_LOCK_MS) {
          await rename(lockPath, `${lockPath}.stale.${Date.now()}.${randomUUID()}`).catch(() => undefined);
          continue;
        }
      } catch (inspectionError) {
        if (!isNodeError(inspectionError, "ENOENT")) {
          throw hostedJobFailure(inspectionError, "The hosted job store lock could not be inspected.");
        }
      }
      if (Date.now() >= deadline) {
        throw new HostedJobError(
          "HOSTED_JOB_STORE_BUSY",
          "The hosted job store is busy.",
          { status: 503, retryable: true, details: { lockPath } },
        );
      }
      await delay(20);
    }
  }

  try {
    return await operation();
  } finally {
    await lockHandle?.close().catch(() => undefined);
    await rm(lockPath, { force: true }).catch(() => undefined);
  }
}

export class FileHostedJobStore implements HostedJobStore {
  readonly rootPath: string;
  readonly jobsPath: string;
  readonly idempotencyPath: string;
  readonly locksPath: string;

  private constructor(rootPath: string) {
    this.rootPath = rootPath;
    this.jobsPath = path.join(rootPath, "jobs");
    this.idempotencyPath = path.join(rootPath, "idempotency");
    this.locksPath = path.join(rootPath, "locks");
  }

  static async open(requestedRootPath: string): Promise<FileHostedJobStore> {
    const absolute = path.resolve(requestedRootPath);
    await mkdir(absolute, { recursive: true });
    const canonical = await realpath(absolute);
    const information = await stat(canonical);
    if (!information.isDirectory()) {
      throw new HostedJobError(
        "HOSTED_JOB_STORE_FAILED",
        "The hosted job file-store root must be a directory.",
        { status: 500, details: { requestedRootPath, canonical } },
      );
    }
    const store = new FileHostedJobStore(canonical);
    await Promise.all([
      mkdir(store.jobsPath, { recursive: true }),
      mkdir(store.idempotencyPath, { recursive: true }),
      mkdir(store.locksPath, { recursive: true }),
    ]);
    return store;
  }

  #jobPath(jobId: string): string {
    return path.join(this.jobsPath, jobFileName(jobId));
  }

  #idempotencyIndexPath(record: Pick<HostedJobRecord, "workspaceId" | "idempotencyKey">): string {
    return path.join(
      this.idempotencyPath,
      `${hostedJobIdempotencyDigest(record.workspaceId, record.idempotencyKey)}.json`,
    );
  }

  async #findByIdempotency(
    workspaceId: string,
    idempotencyKey: string,
  ): Promise<HostedJobRecord | null> {
    const indexPath = this.#idempotencyIndexPath({ workspaceId, idempotencyKey });
    try {
      const value = await readJsonFile(indexPath);
      if (
        value === null ||
        typeof value !== "object" ||
        Array.isArray(value) ||
        typeof (value as Record<string, unknown>).jobId !== "string"
      ) {
        throw new HostedJobError(
          "HOSTED_JOB_STORE_CORRUPT",
          "The hosted job idempotency index is invalid.",
          { status: 500, details: { indexPath } },
        );
      }
      return await this.get((value as Record<string, unknown>).jobId as string);
    } catch (error) {
      if (!isNodeError(error, "ENOENT")) throw error;
    }

    const records = await this.list();
    return records.find((record) =>
      record.workspaceId === workspaceId && record.idempotencyKey === idempotencyKey
    ) ?? null;
  }

  async create(record: HostedJobRecord): Promise<HostedJobStoreCreateResult> {
    return withLock(path.join(this.locksPath, "create.lock"), async () => {
      const existing = await this.#findByIdempotency(record.workspaceId, record.idempotencyKey);
      if (existing) {
        return Object.freeze({ record: existing, created: false });
      }
      const jobPath = this.#jobPath(record.id);
      try {
        await stat(jobPath);
        throw new HostedJobError(
          "HOSTED_JOB_STORE_FAILED",
          "The generated hosted job ID already exists.",
          { status: 500, retryable: true, details: { jobId: record.id } },
        );
      } catch (error) {
        if (!isNodeError(error, "ENOENT")) throw error;
      }

      const indexPath = this.#idempotencyIndexPath(record);
      await atomicWriteJson(jobPath, record);
      try {
        await atomicWriteJson(indexPath, {
          workspaceId: record.workspaceId,
          idempotencyKey: record.idempotencyKey,
          jobId: record.id,
        });
      } catch (error) {
        await rm(jobPath, { force: true }).catch(() => undefined);
        throw error;
      }
      return Object.freeze({ record, created: true });
    });
  }

  async get(jobId: string): Promise<HostedJobRecord | null> {
    try {
      return parseHostedJobRecord(await readJsonFile(this.#jobPath(jobId)));
    } catch (error) {
      if (isNodeError(error, "ENOENT")) return null;
      throw error;
    }
  }

  async compareAndSwap(
    jobId: string,
    expectedVersion: number,
    next: HostedJobRecord,
  ): Promise<boolean> {
    return withLock(path.join(this.locksPath, `${jobId}.lock`), async () => {
      const current = await this.get(jobId);
      if (!current || current.version !== expectedVersion) return false;
      if (next.id !== current.id || next.version !== expectedVersion + 1) {
        throw new HostedJobError(
          "HOSTED_JOB_TRANSITION_INVALID",
          "The hosted job replacement does not advance the expected version.",
          { status: 500, details: { jobId, expectedVersion, nextVersion: next.version } },
        );
      }
      await atomicWriteJson(this.#jobPath(jobId), next);
      return true;
    });
  }

  async list(): Promise<readonly HostedJobRecord[]> {
    let entries: string[];
    try {
      entries = await readdir(this.jobsPath);
    } catch (error) {
      throw hostedJobFailure(error, "The hosted job store could not list job records.");
    }
    const records: HostedJobRecord[] = [];
    for (const entry of entries.sort()) {
      if (!entry.endsWith(".json")) continue;
      records.push(parseHostedJobRecord(await readJsonFile(path.join(this.jobsPath, entry))));
    }
    return Object.freeze(records);
  }
}
