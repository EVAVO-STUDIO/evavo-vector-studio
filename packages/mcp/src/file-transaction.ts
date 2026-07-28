import { createHash, randomUUID } from "node:crypto";
import { link, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export type VectorMcpFileWrite = Readonly<{
  path: string;
  data: string | Uint8Array;
  mimeType: string;
}>;

export type VectorMcpFileReceipt = Readonly<{
  path: string;
  mimeType: string;
  bytes: number;
  sha256: string;
}>;

export class VectorMcpFileCommitError extends Error {
  readonly code = "VECTOR_MCP_FILE_COMMIT_FAILED" as const;
  readonly details: Readonly<Record<string, unknown>> | undefined;

  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super(message);
    this.name = "VectorMcpFileCommitError";
    this.details = details;
  }
}

type StagedWrite = Readonly<{
  targetPath: string;
  temporaryPath: string;
  mimeType: string;
  buffer: Buffer;
}>;

function pathKey(value: string): string {
  const normalised = path.normalize(path.resolve(value));
  return process.platform === "win32" ? normalised.toLowerCase() : normalised;
}

function asBuffer(data: string | Uint8Array): Buffer {
  return typeof data === "string"
    ? Buffer.from(data, "utf8")
    : Buffer.from(data.buffer, data.byteOffset, data.byteLength);
}

function receipt(staged: StagedWrite): VectorMcpFileReceipt {
  return Object.freeze({
    path: staged.targetPath,
    mimeType: staged.mimeType,
    bytes: staged.buffer.byteLength,
    sha256: createHash("sha256").update(staged.buffer).digest("hex"),
  });
}

function validateWrites(writes: readonly VectorMcpFileWrite[]): void {
  const seen = new Map<string, string>();
  for (const write of writes) {
    if (!write.path.trim() || write.path.includes("\0")) {
      throw new VectorMcpFileCommitError("Every file transaction output requires a non-empty path without null bytes.", {
        path: write.path,
      });
    }
    if (!write.mimeType.trim()) {
      throw new VectorMcpFileCommitError("Every file transaction output requires a MIME type.", {
        path: write.path,
      });
    }
    const targetPath = path.resolve(write.path);
    const key = pathKey(targetPath);
    const previous = seen.get(key);
    if (previous) {
      throw new VectorMcpFileCommitError("A file transaction cannot contain duplicate output paths.", {
        firstPath: previous,
        secondPath: targetPath,
      });
    }
    seen.set(key, targetPath);
  }
}

export async function commitNewVectorFiles(
  writes: readonly VectorMcpFileWrite[],
): Promise<readonly VectorMcpFileReceipt[]> {
  if (writes.length === 0) return Object.freeze([]);
  validateWrites(writes);

  const staged: StagedWrite[] = [];
  const committed: StagedWrite[] = [];
  try {
    for (const write of writes) {
      const targetPath = path.resolve(write.path);
      const directory = path.dirname(targetPath);
      await mkdir(directory, { recursive: true });
      const temporaryPath = path.join(
        directory,
        `.${path.basename(targetPath)}.evavo-${process.pid}-${randomUUID()}.tmp`,
      );
      const buffer = asBuffer(write.data);
      await writeFile(temporaryPath, buffer, { flag: "wx", mode: 0o600 });
      staged.push(Object.freeze({ targetPath, temporaryPath, mimeType: write.mimeType, buffer }));
    }

    for (const item of staged) {
      try {
        // Hard-linking from a temporary file in the target directory provides a
        // no-overwrite commit: a target created after policy validation causes
        // EEXIST instead of being replaced by rename semantics.
        await link(item.temporaryPath, item.targetPath);
      } catch (error) {
        throw new VectorMcpFileCommitError(
          "The MCP output transaction could not commit a new file without overwriting an existing path.",
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
    if (error instanceof VectorMcpFileCommitError) throw error;
    throw new VectorMcpFileCommitError("The MCP output transaction failed and was rolled back.", {
      cause: error instanceof Error ? error.message : String(error),
      outputPaths: writes.map((write) => write.path),
    });
  }
}
