import { createHash } from "node:crypto";
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

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function validKey(objectKey: string): boolean {
  return Boolean(objectKey) &&
    !objectKey.startsWith("/") &&
    !objectKey.includes("\\") &&
    !objectKey.includes("\0") &&
    objectKey.split("/").every((segment) =>
      Boolean(segment) && segment !== "." && segment !== ".."
    );
}

export class MemoryVectorObjectStore implements VectorObjectStore {
  readonly #objects = new Map<
    string,
    Readonly<{ mimeType: string; bytes: Uint8Array }>
  >();

  seed(
    objectKey: string,
    bytes: Uint8Array | string,
    mimeType = "application/octet-stream",
  ): void {
    if (!validKey(objectKey)) {
      throw new VectorWorkerError(
        "VECTOR_WORKER_OBJECT_KEY_INVALID",
        "The seeded object key is invalid.",
        { details: { objectKey } },
      );
    }
    const source = typeof bytes === "string"
      ? new TextEncoder().encode(bytes)
      : new Uint8Array(bytes);
    this.#objects.set(objectKey, Object.freeze({ mimeType, bytes: source }));
  }

  has(objectKey: string): boolean {
    return this.#objects.has(objectKey);
  }

  async get(
    objectKey: string,
    options: Readonly<{ maximumBytes?: number; signal?: AbortSignal }> = {},
  ): Promise<StoredObject> {
    throwIfWorkerAborted(options.signal);
    const maximumBytes = options.maximumBytes ?? VECTOR_WORKER_MAX_SOURCE_BYTES;
    const retained = this.#objects.get(objectKey);
    if (!retained) {
      throw new VectorWorkerError(
        "VECTOR_WORKER_OBJECT_NOT_FOUND",
        "The requested in-memory object does not exist.",
        { details: { objectKey } },
      );
    }
    if (retained.bytes.byteLength > maximumBytes) {
      throw new VectorWorkerError(
        "VECTOR_WORKER_OBJECT_TOO_LARGE",
        "The requested in-memory object exceeds the byte limit.",
        {
          details: {
            objectKey,
            bytes: retained.bytes.byteLength,
            maximumBytes,
          },
        },
      );
    }
    const bytes = new Uint8Array(retained.bytes);
    return Object.freeze({
      objectKey,
      mimeType: retained.mimeType,
      bytes,
      byteCount: bytes.byteLength,
      sha256: sha256(bytes),
    });
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
    const seen = new Set<string>();
    for (const write of writes) {
      if (!validKey(write.objectKey)) {
        throw new VectorWorkerError(
          "VECTOR_WORKER_OBJECT_KEY_INVALID",
          "The output object key is invalid.",
          { details: { objectKey: write.objectKey } },
        );
      }
      if (seen.has(write.objectKey)) {
        throw new VectorWorkerError(
          "VECTOR_WORKER_OBJECT_COLLISION",
          "Object transaction keys must be unique.",
          { details: { objectKey: write.objectKey } },
        );
      }
      seen.add(write.objectKey);
      if (this.#objects.has(write.objectKey)) {
        throw new VectorWorkerError(
          "VECTOR_WORKER_OBJECT_EXISTS",
          "Immutable object storage never overwrites an existing key.",
          { details: { objectKey: write.objectKey } },
        );
      }
      if (write.bytes.byteLength > VECTOR_WORKER_MAX_OUTPUT_BYTES) {
        throw new VectorWorkerError(
          "VECTOR_WORKER_OUTPUT_TOO_LARGE",
          "An output object exceeds the worker byte limit.",
          { details: { objectKey: write.objectKey } },
        );
      }
    }
    throwIfWorkerAborted(options.signal);
    for (const write of writes) {
      this.#objects.set(
        write.objectKey,
        Object.freeze({
          mimeType: write.mimeType,
          bytes: new Uint8Array(write.bytes),
        }),
      );
    }
    return Object.freeze(writes.map((write) => Object.freeze({
      objectKey: write.objectKey,
      path: `memory://${write.objectKey}`,
      mimeType: write.mimeType,
      bytes: write.bytes.byteLength,
      sha256: sha256(write.bytes),
    })));
  }
}
