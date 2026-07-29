import type {
  VectorObjectTransferWrite,
} from "@evavo/worker-protocol";

export const VECTOR_WORKER_OBJECT_CLIENT_VERSION = "1.0" as const;
export const DEFAULT_WORKER_OBJECT_CLIENT_TIMEOUT_MS = 60_000;
export const DEFAULT_WORKER_OBJECT_CLIENT_MAX_JSON_BYTES = 512 * 1024;

export type VectorWorkerObjectFetch = typeof fetch;

export type VectorWorkerObjectClientOptions = Readonly<{
  baseUrl: string;
  token: string;
  fetch?: VectorWorkerObjectFetch;
  timeoutMs?: number;
  maximumJsonBytes?: number;
  allowInsecureHttp?: boolean;
}>;

export type VectorWorkerObjectRequestOptions = Readonly<{
  signal?: AbortSignal;
  maximumBytes?: number;
}>;

export type VectorWorkerObjectReceipt = Readonly<{
  objectKey: string;
  path: string;
  mimeType: string;
  bytes: number;
  sha256: string;
}>;

export type VectorWorkerObjectUploadResult = Readonly<{
  contractVersion: "1.0";
  transactionId: string;
  bodySha256: string;
  replayed: boolean;
  mimeTypeVerification: "verified" | "content-only";
  receipts: readonly VectorWorkerObjectReceipt[];
  existingObjectsOverwritten: false;
}>;

export type VectorWorkerObjectDownloadResult = Readonly<{
  objectKey: string;
  mimeType: string;
  bytes: Uint8Array;
  byteCount: number;
  sha256: string;
}>;

export type VectorWorkerObjectClient = Readonly<{
  version: typeof VECTOR_WORKER_OBJECT_CLIENT_VERSION;
  baseUrl: string;
  uploadObjects: (
    writes: readonly VectorObjectTransferWrite[],
    options?: VectorWorkerObjectRequestOptions,
  ) => Promise<VectorWorkerObjectUploadResult>;
  downloadObject: (
    objectKey: string,
    options?: VectorWorkerObjectRequestOptions,
  ) => Promise<VectorWorkerObjectDownloadResult>;
}>;
