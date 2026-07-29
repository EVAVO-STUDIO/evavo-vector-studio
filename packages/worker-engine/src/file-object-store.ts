import { createHash, randomUUID } from "node:crypto";
import {
  link,
  lstat,
  mkdir,
  open,
  realpath,
  rm,
  stat,
} from "node:fs/promises";
import path from "node:path";
import {
  VectorWorkerError,
  throwIfWorkerAborted,
} from "./base-errors.js";
import {
  VECTOR_WORKER_MAX_OUTPUT_BYTES,
  VECTOR_WORKER_MAX_SOURCE_BYTES,
  type ObjectReceipt,
  type ObjectWrite,
  type StoredObject,
  type VectorObjectStore,
} from "./types.js";

const OBJECT_KEY = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,1023}$/;

function pathKey(value: string): string {
  const normalised = path.normalize(value);
  return process.platform === "win32" ? normalised.toLowerCase() : normalised;
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256")
    .update(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength))
    .digest("hex");
}

function validateObjectKey(objectKey: string): readonly string[] {
  if (
    !OBJECT_KEY.test(objectKey) ||
    objectKey.startsWith("/") ||
    objectKey.includes("\\") ||
    objectKey.includes("\0")
  ) {
    throw new VectorWorkerError(
      "VECTOR_WORKER_OBJECT_KEY_INVALID",
      "Object keys must be portable relative slash-separated paths.",
      { details: { objectKey } },
    );
  }
  const segments = objectKey.split("/");
  if (
    segments.some((segment) =>
      !segment || segment === "." || segment === ".."
    )
  ) {
    throw new VectorWorkerError(
      "VECTOR_WORKER_OBJECT_KEY_INVALID",
      "Object keys cannot contain empty, dot or parent segments.",
      { details: { objectKey } },
    );
  }
  return Object.freeze(segments);
}

async function nearestExistingDirectory(
  directory: string,
): Promise<Readonly<{ canonical: string; missing: readonly string[] }>> {
  let current = directory;
  const missing: string[] = [];
  for (;;) {
    try {
      const information = await stat(current);
      if (!information.isDirectory()) {
        throw new VectorWorkerError(
          "VECTOR_WORKER_OBJECT_STORE_FAILED",
          "An object-store path ancestor exists but is not a directory.",
          { details: { ancestor: current } },
        );
      }
      return Object.freeze({
        canonical: await realpath(current),
        missing: Object.freeze(missing),
      });
    } catch (error) {
      if (error instanceof VectorWorkerError) throw error;
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw new VectorWorkerError(
          "VECTOR_WORKER_OBJECT_STORE_FAILED",
          "An object-store path ancestor could not be inspected.",
          {
            retryable: true,
            details: {
              directory: current,
              cause: error instanceof Error ? error.message : String(error),
            },
            cause: error,
          },
        );
      }
      const parent = path.dirname(current);
      if (parent === current) {
        throw new VectorWorkerError(
          "VECTOR_WORKER_OBJECT_STORE_FAILED",
          "No existing object-store path ancestor could be resolved.",
          { details: { directory } },
        );
      }
      missing.unshift(path.basename(current));
      current = parent;
    }
  }
}

export class FileVectorObjectStore implements VectorObjectStore {
  readonly rootPath: string;

  private constructor(rootPath: string) {
    this.rootPath = rootPath;
  }

  static async open(requestedRootPath: string): Promise<FileVectorObjectStore> {
    const absolute = path.resolve(requestedRootPath);
    await mkdir(absolute, { recursive: true });
    const canonical = await realpath(absolute);
    const information = await stat(canonical);
    if (!information.isDirectory()) {
      throw new VectorWorkerError(
        "VECTOR_WORKER_OBJECT_STORE_FAILED",
        "The vector object-store root must be a directory.",
        { details: { requestedRootPath, canonical } },
      );
    }
    return new FileVectorObjectStore(canonical);
  }

  async #resolveExisting(objectKey: string): Promise<string> {
    const segments = validateObjectKey(objectKey);
    const absolute = path.resolve(this.rootPath, ...segments);
    let canonical: string;
    try {
      canonical = await realpath(absolute);
    } catch (error) {
      throw new VectorWorkerError(
        "VECTOR_WORKER_OBJECT_NOT_FOUND",
        "The requested object does not exist or cannot be resolved.",
        {
          details: {
            objectKey,
            cause: error instanceof Error ? error.message : String(error),
          },
          cause: error,
        },
      );
    }
    if (!isWithin(this.rootPath, canonical)) {
      throw new VectorWorkerError(
        "VECTOR_WORKER_OBJECT_KEY_INVALID",
        "The requested object resolves outside the object-store root.",
        { details: { objectKey, canonical, rootPath: this.rootPath } },
      );
    }
    const information = await stat(canonical);
    if (!information.isFile()) {
      throw new VectorWorkerError(
        "VECTOR_WORKER_OBJECT_NOT_FILE",
        "The requested object is not a regular file.",
        { details: { objectKey, canonical } },
      );
    }
    return canonical;
  }

  async #resolveNew(objectKey: string): Promise<string> {
    const segments = validateObjectKey(objectKey);
    const absolute = path.resolve(this.rootPath, ...segments);
    const ancestor = await nearestExistingDirectory(path.dirname(absolute));
    if (!isWithin(this.rootPath, ancestor.canonical)) {
      throw new VectorWorkerError(
        "VECTOR_WORKER_OBJECT_KEY_INVALID",
        "The output object parent resolves outside the object-store root.",
        { details: { objectKey, parent: ancestor.canonical } },
      );
    }

    let parent = ancestor.canonical;
    for (const segment of ancestor.missing) {
      const next = path.join(parent, segment);
      await mkdir(next).catch((error) => {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      });
      const canonical = await realpath(next);
      if (!isWithin(this.rootPath, canonical)) {
        throw new VectorWorkerError(
          "VECTOR_WORKER_OBJECT_KEY_INVALID",
          "A newly created output directory escaped the object-store root.",
          { details: { objectKey, directory: canonical } },
        );
      }
      parent = canonical;
    }

    const candidate = path.join(parent, path.basename(absolute));
    if (!isWithin(this.rootPath, candidate)) {
      throw new VectorWorkerError(
        "VECTOR_WORKER_OBJECT_KEY_INVALID",
        "The output object resolves outside the object-store root.",
        { details: { objectKey, candidate } },
      );
    }
    try {
      await lstat(candidate);
      throw new VectorWorkerError(
        "VECTOR_WORKER_OBJECT_EXISTS",
        "Immutable object storage never overwrites an existing object key.",
        { details: { objectKey, candidate } },
      );
    } catch (error) {
      if (error instanceof VectorWorkerError) throw error;
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw new VectorWorkerError(
          "VECTOR_WORKER_OBJECT_STORE_FAILED",
          "The output object path could not be inspected safely.",
          {
            retryable: true,
            details: {
              objectKey,
              cause: error instanceof Error ? error.message : String(error),
            },
            cause: error,
          },
        );
      }
    }
    return candidate;
  }

  async get(
    objectKey: string,
    options: Readonly<{ maximumBytes?: number; signal?: AbortSignal }> = {},
  ): Promise<StoredObject> {
    throwIfWorkerAborted(options.signal);
    const maximumBytes = options.maximumBytes ?? VECTOR_WORKER_MAX_SOURCE_BYTES;
    if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
      throw new VectorWorkerError(
        "VECTOR_WORKER_PAYLOAD_INVALID",
        "maximumBytes must be a positive safe integer.",
        { details: { maximumBytes } },
      );
    }
    const resolvedPath = await this.#resolveExisting(objectKey);
    const information = await stat(resolvedPath);
    if (information.size > maximumBytes) {
      throw new VectorWorkerError(
        "VECTOR_WORKER_OBJECT_TOO_LARGE",
        "The requested object exceeds the operation byte limit.",
        {
          details: {
            objectKey,
            bytes: information.size,
            maximumBytes,
          },
        },
      );
    }
    const handle = await open(resolvedPath, "r");
    try {
      const source = await handle.readFile();
      throwIfWorkerAborted(options.signal);
      const bytes = new Uint8Array(
        source.buffer,
        source.byteOffset,
        source.byteLength,
      );
      return Object.freeze({
        objectKey,
        mimeType: "application/octet-stream",
        bytes: new Uint8Array(bytes),
        byteCount: bytes.byteLength,
        sha256: sha256(bytes),
      });
    } finally {
      await handle.close();
    }
  }

  async putManyNew(
    writes: readonly ObjectWrite[],
    options: Readonly<{ signal?: AbortSignal }> = {},
  ): Promise<readonly ObjectReceipt[]> {
    throwIfWorkerAborted(options.signal);
    if (!Array.isArray(writes) || writes.length < 1 || writes.length > 16) {
      throw new VectorWorkerError(
        "VECTOR_WORKER_PAYLOAD_INVALID",
        "Object transactions must contain 1 to 16 writes.",
      );
    }

    const targetKeys = new Map<string, string>();
    const prepared = [] as Array<{
      write: ObjectWrite;
      targetPath: string;
      temporaryPath: string;
      bytes: Uint8Array;
      sha256: string;
    }>;
    try {
      for (const write of writes) {
        throwIfWorkerAborted(options.signal);
        if (
          typeof write.mimeType !== "string" ||
          !write.mimeType.trim() ||
          write.mimeType.length > 160
        ) {
          throw new VectorWorkerError(
            "VECTOR_WORKER_PAYLOAD_INVALID",
            "Every object write requires a bounded MIME type.",
            { details: { objectKey: write.objectKey } },
          );
        }
        if (
          !(write.bytes instanceof Uint8Array) ||
          write.bytes.byteLength > VECTOR_WORKER_MAX_OUTPUT_BYTES
        ) {
          throw new VectorWorkerError(
            "VECTOR_WORKER_OUTPUT_TOO_LARGE",
            "An output object exceeds the worker byte limit.",
            {
              details: {
                objectKey: write.objectKey,
                bytes: write.bytes?.byteLength,
                maximum: VECTOR_WORKER_MAX_OUTPUT_BYTES,
              },
            },
          );
        }
        const targetPath = await this.#resolveNew(write.objectKey);
        const key = pathKey(targetPath);
        const previous = targetKeys.get(key);
        if (previous) {
          throw new VectorWorkerError(
            "VECTOR_WORKER_OBJECT_COLLISION",
            "Object transaction keys must resolve to distinct paths.",
            {
              details: {
                firstObjectKey: previous,
                secondObjectKey: write.objectKey,
              },
            },
          );
        }
        targetKeys.set(key, write.objectKey);
        prepared.push({
          write,
          targetPath,
          temporaryPath: path.join(
            path.dirname(targetPath),
            `.${path.basename(targetPath)}.${randomUUID()}.tmp`,
          ),
          bytes: new Uint8Array(write.bytes),
          sha256: sha256(write.bytes),
        });
      }

      for (const item of prepared) {
        throwIfWorkerAborted(options.signal);
        const handle = await open(item.temporaryPath, "wx", 0o600);
        try {
          await handle.writeFile(item.bytes);
          await handle.sync();
        } finally {
          await handle.close();
        }
      }

      const committed: typeof prepared = [];
      try {
        for (const item of prepared) {
          throwIfWorkerAborted(options.signal);
          await link(item.temporaryPath, item.targetPath);
          committed.push(item);
        }
      } catch (error) {
        await Promise.all(
          committed.map((item) => rm(item.targetPath, { force: true })),
        );
        if (
          (error as NodeJS.ErrnoException).code === "EEXIST"
        ) {
          throw new VectorWorkerError(
            "VECTOR_WORKER_OBJECT_EXISTS",
            "An immutable object key was occupied during commit.",
            { retryable: false, cause: error },
          );
        }
        throw error;
      }

      return Object.freeze(prepared.map((item) => Object.freeze({
        objectKey: item.write.objectKey,
        path: item.targetPath,
        mimeType: item.write.mimeType,
        bytes: item.bytes.byteLength,
        sha256: item.sha256,
      })));
    } catch (error) {
      if (error instanceof VectorWorkerError) throw error;
      throw new VectorWorkerError(
        "VECTOR_WORKER_OBJECT_STORE_FAILED",
        "The object transaction failed.",
        {
          retryable: true,
          details: {
            cause: error instanceof Error ? error.message : String(error),
          },
          cause: error,
        },
      );
    } finally {
      await Promise.all(
        prepared.map((item) => rm(item.temporaryPath, { force: true })),
      );
    }
  }
}
