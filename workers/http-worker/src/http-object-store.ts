import { setTimeout as delay } from "node:timers/promises";
import {
  VectorWorkerClientError,
  type VectorWorkerObjectClient,
} from "@evavo/worker-client";
import {
  VECTOR_WORKER_MAX_SOURCE_BYTES,
  VectorWorkerError,
  type ObjectReceipt,
  type ObjectWrite,
  type StoredObject,
  type VectorObjectStore,
} from "@evavo/worker-engine/object-store";

export const HTTP_OBJECT_STORE_CONTRACT_VERSION = "1.0" as const;
export const DEFAULT_HTTP_OBJECT_DOWNLOAD_ATTEMPTS = 3;
export const DEFAULT_HTTP_OBJECT_UPLOAD_ATTEMPTS = 3;
export const DEFAULT_HTTP_OBJECT_RETRY_MS = 500;

export type HttpVectorObjectStoreOptions = Readonly<{
  client: VectorWorkerObjectClient;
  downloadAttempts?: number;
  uploadAttempts?: number;
  retryMs?: number;
}>;

const SAFE_RETRY_CLIENT_CODES = new Set([
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
    throw new VectorWorkerError(
      "VECTOR_WORKER_OBJECT_STORE_FAILED",
      `${field} must be an integer from ${minimum} to ${maximum}.`,
      {
        retryable: false,
        details: { field, value: resolved, minimum, maximum },
      },
    );
  }
  return resolved;
}

function clientServerCode(error: VectorWorkerClientError): string | null {
  return typeof error.details?.serverCode === "string"
    ? error.details.serverCode
    : null;
}

function safeToRetry(error: unknown): boolean {
  if (!(error instanceof VectorWorkerClientError)) return false;
  if (error.code === "VECTOR_WORKER_CLIENT_ABORTED") return false;
  if (SAFE_RETRY_CLIENT_CODES.has(error.code)) return true;
  return error.code === "VECTOR_WORKER_CLIENT_HTTP_FAILED" && error.retryable;
}

function mappedFailure(
  error: unknown,
  operation: "download" | "upload",
  objectKeys: readonly string[],
): VectorWorkerError {
  if (error instanceof VectorWorkerError) return error;
  if (!(error instanceof VectorWorkerClientError)) {
    return new VectorWorkerError(
      "VECTOR_WORKER_OBJECT_STORE_FAILED",
      `The HTTP object ${operation} failed.`,
      {
        retryable: false,
        details: { operation, objectKeys },
        cause: error,
      },
    );
  }

  const serverCode = clientServerCode(error);
  const details = Object.freeze({
    operation,
    objectKeys,
    clientCode: error.code,
    status: error.status,
    serverCode,
  });
  if (error.code === "VECTOR_WORKER_CLIENT_ABORTED") {
    return new VectorWorkerError(
      "VECTOR_WORKER_CANCELLED",
      `The HTTP object ${operation} was cancelled.`,
      { retryable: true, details, cause: error },
    );
  }
  if (
    serverCode === "VECTOR_WORKER_OBJECT_NOT_FOUND" ||
    error.status === 404
  ) {
    return new VectorWorkerError(
      "VECTOR_WORKER_OBJECT_NOT_FOUND",
      "The requested immutable object does not exist.",
      { retryable: false, details, cause: error },
    );
  }
  if (
    serverCode === "VECTOR_WORKER_OBJECT_TRANSACTION_CONFLICT" ||
    serverCode === "VECTOR_WORKER_OBJECT_EXISTS" ||
    error.status === 409
  ) {
    return new VectorWorkerError(
      "VECTOR_WORKER_OBJECT_TRANSACTION_CONFLICT",
      "The immutable object transaction conflicts with retained content.",
      { retryable: false, details, cause: error },
    );
  }
  if (
    serverCode === "VECTOR_WORKER_OBJECT_TOO_LARGE" ||
    serverCode === "VECTOR_WORKER_OUTPUT_TOO_LARGE" ||
    error.code === "VECTOR_WORKER_CLIENT_RESPONSE_TOO_LARGE" ||
    error.status === 413
  ) {
    return new VectorWorkerError(
      "VECTOR_WORKER_OBJECT_TOO_LARGE",
      `The HTTP object ${operation} exceeded its configured byte limit.`,
      { retryable: false, details, cause: error },
    );
  }
  if (
    serverCode === "VECTOR_WORKER_OBJECT_HASH_MISMATCH" ||
    error.status === 422
  ) {
    return new VectorWorkerError(
      "VECTOR_WORKER_OBJECT_HASH_MISMATCH",
      `The HTTP object ${operation} failed integrity validation.`,
      { retryable: false, details, cause: error },
    );
  }
  return new VectorWorkerError(
    "VECTOR_WORKER_OBJECT_STORE_FAILED",
    `The HTTP object ${operation} could not be completed.`,
    {
      retryable: safeToRetry(error),
      details,
      cause: error,
    },
  );
}

async function withRetries<T>(
  operation: "download" | "upload",
  objectKeys: readonly string[],
  attempts: number,
  retryMs: number,
  signal: AbortSignal | undefined,
  execute: () => Promise<T>,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (signal?.aborted) {
      throw new VectorWorkerError(
        "VECTOR_WORKER_CANCELLED",
        `The HTTP object ${operation} was cancelled.`,
        {
          retryable: true,
          details: { operation, objectKeys, attempt },
        },
      );
    }
    try {
      return await execute();
    } catch (error) {
      lastError = error;
      if (
        attempt >= attempts ||
        signal?.aborted ||
        !safeToRetry(error)
      ) {
        break;
      }
      try {
        await delay(retryMs, undefined, { signal });
      } catch (delayError) {
        if (signal?.aborted) {
          throw new VectorWorkerError(
            "VECTOR_WORKER_CANCELLED",
            `The HTTP object ${operation} retry was cancelled.`,
            {
              retryable: true,
              details: { operation, objectKeys, attempt },
              cause: delayError,
            },
          );
        }
        throw delayError;
      }
    }
  }
  throw mappedFailure(lastError, operation, objectKeys);
}

function copyWrites(writes: readonly ObjectWrite[]): readonly ObjectWrite[] {
  return Object.freeze(
    writes.map((write) => Object.freeze({
      objectKey: write.objectKey,
      mimeType: write.mimeType,
      bytes: new Uint8Array(write.bytes),
    })),
  );
}

export class HttpVectorObjectStore implements VectorObjectStore {
  readonly #client: VectorWorkerObjectClient;
  readonly #downloadAttempts: number;
  readonly #uploadAttempts: number;
  readonly #retryMs: number;

  constructor(options: HttpVectorObjectStoreOptions) {
    this.#client = options.client;
    this.#downloadAttempts = boundedInteger(
      options.downloadAttempts,
      DEFAULT_HTTP_OBJECT_DOWNLOAD_ATTEMPTS,
      1,
      10,
      "downloadAttempts",
    );
    this.#uploadAttempts = boundedInteger(
      options.uploadAttempts,
      DEFAULT_HTTP_OBJECT_UPLOAD_ATTEMPTS,
      1,
      10,
      "uploadAttempts",
    );
    this.#retryMs = boundedInteger(
      options.retryMs,
      DEFAULT_HTTP_OBJECT_RETRY_MS,
      100,
      30_000,
      "retryMs",
    );
  }

  get capabilities(): Readonly<Record<string, unknown>> {
    return Object.freeze({
      contractVersion: HTTP_OBJECT_STORE_CONTRACT_VERSION,
      transport: "worker-object-transfer-api",
      downloadAttempts: this.#downloadAttempts,
      uploadAttempts: this.#uploadAttempts,
      retryMs: this.#retryMs,
      exactUploadReplay: true,
      downloadSha256Verification: true,
      sharedFilesystemRequired: false,
      existingObjectsOverwritten: false,
    });
  }

  async get(
    objectKey: string,
    options: Readonly<{
      maximumBytes?: number;
      signal?: AbortSignal;
    }> = {},
  ): Promise<StoredObject> {
    const maximumBytes = boundedInteger(
      options.maximumBytes,
      VECTOR_WORKER_MAX_SOURCE_BYTES,
      1,
      VECTOR_WORKER_MAX_SOURCE_BYTES,
      "maximumBytes",
    );
    const downloaded = await withRetries(
      "download",
      [objectKey],
      this.#downloadAttempts,
      this.#retryMs,
      options.signal,
      () => this.#client.downloadObject(objectKey, {
        maximumBytes,
        signal: options.signal,
      }),
    );
    return Object.freeze({
      objectKey: downloaded.objectKey,
      mimeType: downloaded.mimeType,
      bytes: new Uint8Array(downloaded.bytes),
      byteCount: downloaded.byteCount,
      sha256: downloaded.sha256,
    });
  }

  async putManyNew(
    writes: readonly ObjectWrite[],
    options: Readonly<{ signal?: AbortSignal }> = {},
  ): Promise<readonly ObjectReceipt[]> {
    const copied = copyWrites(writes);
    const objectKeys = Object.freeze(copied.map((write) => write.objectKey));
    const uploaded = await withRetries(
      "upload",
      objectKeys,
      this.#uploadAttempts,
      this.#retryMs,
      options.signal,
      () => this.#client.uploadObjects(copied, {
        signal: options.signal,
      }),
    );
    return Object.freeze(
      uploaded.receipts.map((receipt) => Object.freeze({ ...receipt })),
    );
  }
}
