import {
  VECTOR_OBJECT_MAX_BYTES,
  VECTOR_OBJECT_TRANSACTION_CONTENT_TYPE,
  VECTOR_OBJECT_TRANSACTION_MAX_BYTES,
  VECTOR_OBJECT_TRANSACTION_MAX_ITEMS,
  VECTOR_OBJECT_TRANSFER_CONTRACT_VERSION,
  VectorWorkerProtocolError,
  decodeVectorObjectTransaction,
  type DecodedVectorObjectTransaction,
} from "@evavo/worker-protocol";
import {
  VectorWorkerError,
  commitVectorObjectTransactionIdempotently,
  type StoredObject,
} from "@evavo/worker-engine/object-store";
import { noStoreHeaders } from "./api-security";
import {
  workerJson,
  workerProtocolHeaders,
} from "./worker-api";
import {
  getWorkerObjectStoreRuntime,
  type WorkerObjectStoreRuntime,
} from "./worker-object-store";

const PUBLIC_DETAIL_FIELDS = new Set([
  "transactionId",
  "objectKey",
  "expectedBytes",
  "actualBytes",
  "expectedSha256",
  "actualSha256",
  "expectedMimeType",
  "actualMimeType",
  "existingObjectKeys",
  "missingObjectKeys",
  "maximum",
  "bytes",
  "count",
]);

function publicDetails(
  details: Readonly<Record<string, unknown>> | undefined,
): Readonly<Record<string, unknown>> | undefined {
  if (!details) return undefined;
  const entries = Object.entries(details)
    .filter(([key]) => PUBLIC_DETAIL_FIELDS.has(key));
  return entries.length > 0 ? Object.freeze(Object.fromEntries(entries)) : undefined;
}

export function workerObjectRuntimeView(
  runtimeValue: WorkerObjectStoreRuntime,
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    contractVersion: VECTOR_OBJECT_TRANSFER_CONTRACT_VERSION,
    contentType: VECTOR_OBJECT_TRANSACTION_CONTENT_TYPE,
    objectTransferAvailable: runtimeValue.objectTransferAvailable,
    persistentObjects: runtimeValue.persistentObjects,
    storeMode: runtimeValue.mode,
    storePathConfigured: runtimeValue.storePath !== null,
    reason: runtimeValue.reason,
    limits: Object.freeze({
      maximumObjectBytes: VECTOR_OBJECT_MAX_BYTES,
      maximumTransactionBytes: VECTOR_OBJECT_TRANSACTION_MAX_BYTES,
      maximumTransactionItems: VECTOR_OBJECT_TRANSACTION_MAX_ITEMS,
    }),
    endpoints: Object.freeze({
      upload: "/api/v1/worker/objects",
      download: "/api/v1/worker/objects?key={objectKey}",
    }),
    transferPolicy: Object.freeze({
      immutableNewObjectsOnly: true,
      atomicMultiObjectCommit: true,
      exactContentReplay: true,
      partialReplayRejected: true,
      changedContentRejected: true,
      generatedBodiesInJson: false,
      rawDownloadContentType: "application/octet-stream",
      mimeMetadataOnFileReplay: "content-only",
      productionFileStoreRequiresPersistentVolumeAcknowledgement: true,
    }),
  });
}

export async function requireWorkerObjectRuntime(): Promise<
  | Readonly<{ runtime: WorkerObjectStoreRuntime; response: null }>
  | Readonly<{ runtime: WorkerObjectStoreRuntime; response: Response }>
> {
  const runtimeValue = await getWorkerObjectStoreRuntime();
  return runtimeValue.available && runtimeValue.store
    ? Object.freeze({ runtime: runtimeValue, response: null })
    : Object.freeze({
        runtime: runtimeValue,
        response: workerJson(
          {
            error: "VECTOR_WORKER_OBJECT_STORE_NOT_CONFIGURED",
            message: runtimeValue.reason,
            contract: workerObjectRuntimeView(runtimeValue),
          },
          503,
        ),
      });
}

export async function parseWorkerObjectTransaction(
  request: Request,
): Promise<DecodedVectorObjectTransaction> {
  const contentType = request.headers.get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (contentType !== VECTOR_OBJECT_TRANSACTION_CONTENT_TYPE) {
    throw new VectorWorkerProtocolError(
      "VECTOR_WORKER_OBJECT_TRANSACTION_INVALID",
      `Object uploads require Content-Type: ${VECTOR_OBJECT_TRANSACTION_CONTENT_TYPE}.`,
      { status: 415, details: { contentType: contentType ?? null } },
    );
  }
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > VECTOR_OBJECT_TRANSACTION_MAX_BYTES
  ) {
    throw new VectorWorkerProtocolError(
      "VECTOR_WORKER_OBJECT_TRANSACTION_TOO_LARGE",
      "The declared object transaction exceeds the transfer byte limit.",
      {
        status: 413,
        details: {
          bytes: declaredLength,
          maximum: VECTOR_OBJECT_TRANSACTION_MAX_BYTES,
        },
      },
    );
  }
  const body = new Uint8Array(await request.arrayBuffer());
  if (body.byteLength < 1) {
    throw new VectorWorkerProtocolError(
      "VECTOR_WORKER_OBJECT_TRANSACTION_INVALID",
      "The object transaction body is empty.",
      { status: 400 },
    );
  }
  if (body.byteLength > VECTOR_OBJECT_TRANSACTION_MAX_BYTES) {
    throw new VectorWorkerProtocolError(
      "VECTOR_WORKER_OBJECT_TRANSACTION_TOO_LARGE",
      "The object transaction exceeds the transfer byte limit.",
      {
        status: 413,
        details: {
          bytes: body.byteLength,
          maximum: VECTOR_OBJECT_TRANSACTION_MAX_BYTES,
        },
      },
    );
  }
  return decodeVectorObjectTransaction(body);
}

export function parseWorkerObjectKey(request: Request): string {
  const url = new URL(request.url);
  const keys = url.searchParams.getAll("key");
  const unknown = [...url.searchParams.keys()]
    .filter((name) => name !== "key");
  if (keys.length !== 1 || !keys[0]?.trim() || unknown.length > 0) {
    throw new VectorWorkerProtocolError(
      "VECTOR_WORKER_PROTOCOL_REQUEST_INVALID",
      "Object download requires exactly one non-empty key query parameter and no unsupported parameters.",
      {
        status: 422,
        details: {
          keyCount: keys.length,
          unknownFields: unknown.sort(),
        },
      },
    );
  }
  return keys[0].trim();
}

export function workerObjectDownloadResponse(object: StoredObject): Response {
  const filename = object.objectKey.split("/").at(-1) || "vector-object.bin";
  const safeFilename = filename.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 180) ||
    "vector-object.bin";
  const headers = noStoreHeaders(workerProtocolHeaders({
    "content-type": "application/octet-stream",
    "content-length": String(object.byteCount),
    "content-disposition": `attachment; filename="${safeFilename}"`,
    "x-vector-object-transfer-contract":
      VECTOR_OBJECT_TRANSFER_CONTRACT_VERSION,
    "x-vector-object-key": encodeURIComponent(object.objectKey),
    "x-vector-object-bytes": String(object.byteCount),
    "x-vector-object-sha256": object.sha256,
    "x-vector-object-stored-mime": object.mimeType,
  }));
  return new Response(object.bytes, { status: 200, headers });
}

export function workerObjectErrorResponse(error: unknown): Response {
  if (error instanceof VectorWorkerProtocolError) {
    return workerJson(
      {
        error: error.code,
        message: error.message,
        retryable: error.retryable,
        details: publicDetails(error.details),
      },
      error.status,
      error.retryable ? { "retry-after": "1" } : {},
    );
  }
  if (error instanceof VectorWorkerError) {
    const status = error.code === "VECTOR_WORKER_OBJECT_NOT_FOUND"
      ? 404
      : error.code === "VECTOR_WORKER_OBJECT_TOO_LARGE" ||
          error.code === "VECTOR_WORKER_OUTPUT_TOO_LARGE"
      ? 413
      : error.code === "VECTOR_WORKER_OBJECT_EXISTS" ||
          error.code === "VECTOR_WORKER_OBJECT_COLLISION" ||
          error.code === "VECTOR_WORKER_OBJECT_TRANSACTION_CONFLICT"
      ? 409
      : error.code === "VECTOR_WORKER_OBJECT_KEY_INVALID" ||
          error.code === "VECTOR_WORKER_PAYLOAD_INVALID" ||
          error.code === "VECTOR_WORKER_OBJECT_HASH_MISMATCH"
      ? 422
      : error.retryable
      ? 503
      : 500;
    return workerJson(
      {
        error: error.code,
        message: error.message,
        retryable: error.retryable,
        details: publicDetails(error.details),
      },
      status,
      error.retryable ? { "retry-after": "1" } : {},
    );
  }
  return workerJson(
    {
      error: "VECTOR_WORKER_OBJECT_TRANSFER_FAILED",
      message: error instanceof Error ? error.message : String(error),
      retryable: false,
    },
    500,
  );
}
