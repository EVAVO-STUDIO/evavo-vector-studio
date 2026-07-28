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

export async function commitNewVectorFiles(
  writes: readonly VectorMcpFileWrite[],
): Promise<readonly VectorMcpFileReceipt[]> {
  if (writes.length === 0) return Object.freeze([]);
  const uniqueTargets = new Set(writes.map((write) => path.normalize(write.path)));
  if (uniqueTargets.size !== writes.length) {
    throw new VectorMcpFileCommitError("A file transaction cannot contain duplicate output paths.", {
      outputPaths: writes.map((write) => write.path),
    });
  }

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
      await writeFile(temporaryPath, buffer, { flag: "wx" });
      staged.push(Object.freeze({ targetPath, temporaryPath, mimeType: write.mimeType, buffer }));
    }

    for (const item of staged) {
      try {
        // A hard link is used instead of rename so an output created after policy
        // validation still causes EEXIST rather than being overwritten atomically.
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
