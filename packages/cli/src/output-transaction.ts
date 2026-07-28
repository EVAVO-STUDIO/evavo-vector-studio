import { createHash, randomUUID } from "node:crypto";
import { link, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export type CliOutputWrite = Readonly<{
  path: string;
  data: string | Uint8Array;
  mimeType: string;
}>;

export type CliOutputReceipt = Readonly<{
  path: string;
  mimeType: string;
  bytes: number;
  sha256: string;
}>;

export class CliOutputTransactionError extends Error {
  readonly code = "VECTOR_OUTPUT_TRANSACTION_FAILED" as const;
  readonly details: Readonly<Record<string, unknown>> | undefined;

  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super(message);
    this.name = "CliOutputTransactionError";
    this.details = details;
  }
}

type StagedOutput = Readonly<{
  targetPath: string;
  temporaryPath: string;
  mimeType: string;
  buffer: Buffer;
}>;

function pathKey(value: string): string {
  const resolved = path.normalize(path.resolve(value));
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function bufferFor(data: string | Uint8Array): Buffer {
  return typeof data === "string"
    ? Buffer.from(data, "utf8")
    : Buffer.from(data.buffer, data.byteOffset, data.byteLength);
}

function validateWrites(writes: readonly CliOutputWrite[]): void {
  const seen = new Map<string, string>();
  for (const write of writes) {
    if (!write.path.trim() || write.path.includes("\0")) {
      throw new CliOutputTransactionError("Every output requires a non-empty path without null bytes.", {
        path: write.path,
      });
    }
    if (!write.mimeType.trim()) {
      throw new CliOutputTransactionError("Every output requires a MIME type.", { path: write.path });
    }
    const targetPath = path.resolve(write.path);
    const key = pathKey(targetPath);
    const previous = seen.get(key);
    if (previous) {
      throw new CliOutputTransactionError("An output transaction cannot contain duplicate paths.", {
        firstPath: previous,
        secondPath: targetPath,
      });
    }
    seen.set(key, targetPath);
  }
}

function receipt(item: StagedOutput): CliOutputReceipt {
  return Object.freeze({
    path: item.targetPath,
    mimeType: item.mimeType,
    bytes: item.buffer.byteLength,
    sha256: createHash("sha256").update(item.buffer).digest("hex"),
  });
}

export async function commitNewOutputFiles(
  writes: readonly CliOutputWrite[],
): Promise<readonly CliOutputReceipt[]> {
  if (writes.length === 0) return Object.freeze([]);
  validateWrites(writes);

  const staged: StagedOutput[] = [];
  const committed: StagedOutput[] = [];
  try {
    for (const write of writes) {
      const targetPath = path.resolve(write.path);
      const directory = path.dirname(targetPath);
      await mkdir(directory, { recursive: true });
      const temporaryPath = path.join(
        directory,
        `.${path.basename(targetPath)}.evavo-${process.pid}-${randomUUID()}.tmp`,
      );
      const buffer = bufferFor(write.data);
      await writeFile(temporaryPath, buffer, { flag: "wx", mode: 0o600 });
      staged.push(Object.freeze({ targetPath, temporaryPath, mimeType: write.mimeType, buffer }));
    }

    for (const item of staged) {
      try {
        await link(item.temporaryPath, item.targetPath);
      } catch (error) {
        throw new CliOutputTransactionError(
          "The output transaction could not create a new destination without overwriting an existing file.",
          {
            targetPath: item.targetPath,
            cause: error instanceof Error ? error.message : String(error),
          },
        );
      }
      committed.push(item);
      await rm(item.temporaryPath, { force: true });
    }

    return Object.freeze(committed.map(receipt));
  } catch (error) {
    await Promise.allSettled([
      ...staged.map((item) => rm(item.temporaryPath, { force: true })),
      ...committed.map((item) => rm(item.targetPath, { force: true })),
    ]);
    if (error instanceof CliOutputTransactionError) throw error;
    throw new CliOutputTransactionError("The output transaction failed and was rolled back.", {
      cause: error instanceof Error ? error.message : String(error),
      outputPaths: writes.map((write) => write.path),
    });
  }
}
