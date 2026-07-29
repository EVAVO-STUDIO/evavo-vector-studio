import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  VectorWorkerClientError,
  type VectorWorkerObjectClient,
  type VectorWorkerObjectDownloadResult,
  type VectorWorkerObjectUploadResult,
} from "@evavo/worker-client";
import {
  VectorWorkerError,
} from "@evavo/worker-engine/object-store";
import {
  HttpVectorObjectStore,
} from "./http-object-store.js";

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function downloaded(
  objectKey: string,
  bytes: Uint8Array,
  mimeType = "application/octet-stream",
): VectorWorkerObjectDownloadResult {
  return Object.freeze({
    objectKey,
    mimeType,
    bytes: new Uint8Array(bytes),
    byteCount: bytes.byteLength,
    sha256: sha256(bytes),
  });
}

function uploaded(
  objectKey: string,
  bytes: Uint8Array,
  mimeType: string,
): VectorWorkerObjectUploadResult {
  return Object.freeze({
    contractVersion: "1.0",
    transactionId: "a".repeat(64),
    bodySha256: "a".repeat(64),
    replayed: false,
    mimeTypeVerification: "verified",
    receipts: Object.freeze([
      Object.freeze({
        objectKey,
        path: `object://${objectKey}`,
        mimeType,
        bytes: bytes.byteLength,
        sha256: sha256(bytes),
      }),
    ]),
    existingObjectsOverwritten: false,
  });
}

function client(
  overrides: Partial<VectorWorkerObjectClient>,
): VectorWorkerObjectClient {
  return Object.freeze({
    version: "1.0",
    baseUrl: "https://worker.example.com/",
    async uploadObjects(): Promise<never> {
      throw new Error("Unexpected upload.");
    },
    async downloadObject(): Promise<never> {
      throw new Error("Unexpected download.");
    },
    ...overrides,
  });
}

test("retries a safe download transport failure and returns verified bytes", async () => {
  const source = new TextEncoder().encode("remote-source");
  let calls = 0;
  const store = new HttpVectorObjectStore({
    client: client({
      async downloadObject(objectKey) {
        calls += 1;
        if (calls === 1) {
          throw new VectorWorkerClientError(
            "VECTOR_WORKER_CLIENT_NETWORK_FAILED",
            "Synthetic transport failure.",
            { retryable: true },
          );
        }
        return downloaded(objectKey, source, "image/svg+xml");
      },
    }),
    downloadAttempts: 2,
    retryMs: 100,
  });

  const result = await store.get("source/mark.svg");
  assert.equal(calls, 2);
  assert.equal(result.objectKey, "source/mark.svg");
  assert.equal(result.mimeType, "image/svg+xml");
  assert.equal(result.sha256, sha256(source));
  assert.deepEqual([...result.bytes], [...source]);
  source[0] = 99;
  assert.notEqual(result.bytes[0], 99);
});

test("retries one exact copied upload after an uncertain response", async () => {
  const source = new Uint8Array([1, 2, 3, 4]);
  let calls = 0;
  const observed: number[] = [];
  const store = new HttpVectorObjectStore({
    client: client({
      async uploadObjects(writes) {
        calls += 1;
        observed.push(writes[0]?.bytes[0] ?? -1);
        if (calls === 1) {
          source[0] = 99;
          throw new VectorWorkerClientError(
            "VECTOR_WORKER_CLIENT_RESPONSE_INVALID",
            "Synthetic lost upload response.",
            { retryable: false },
          );
        }
        return uploaded(
          writes[0]!.objectKey,
          writes[0]!.bytes,
          writes[0]!.mimeType,
        );
      },
    }),
    uploadAttempts: 2,
    retryMs: 100,
  });

  const receipts = await store.putManyNew([
    Object.freeze({
      objectKey: "output/mark.svg",
      mimeType: "image/svg+xml",
      bytes: source,
    }),
  ]);
  assert.equal(calls, 2);
  assert.deepEqual(observed, [1, 1]);
  assert.equal(receipts[0]?.path, "object://output/mark.svg");
  assert.equal(receipts[0]?.sha256, sha256(new Uint8Array([1, 2, 3, 4])));
});

test("does not retry immutable transaction conflicts", async () => {
  let calls = 0;
  const store = new HttpVectorObjectStore({
    client: client({
      async uploadObjects() {
        calls += 1;
        throw new VectorWorkerClientError(
          "VECTOR_WORKER_CLIENT_HTTP_FAILED",
          "Retained object conflict.",
          {
            status: 409,
            retryable: false,
            details: {
              serverCode: "VECTOR_WORKER_OBJECT_TRANSACTION_CONFLICT",
            },
          },
        );
      },
    }),
    uploadAttempts: 3,
    retryMs: 100,
  });

  await assert.rejects(
    store.putManyNew([
      {
        objectKey: "output/mark.svg",
        mimeType: "image/svg+xml",
        bytes: new Uint8Array([1]),
      },
    ]),
    (error: unknown) =>
      error instanceof VectorWorkerError &&
      error.code === "VECTOR_WORKER_OBJECT_TRANSACTION_CONFLICT" &&
      !error.retryable,
  );
  assert.equal(calls, 1);
});

test("maps missing downloads to the governed worker error", async () => {
  const store = new HttpVectorObjectStore({
    client: client({
      async downloadObject() {
        throw new VectorWorkerClientError(
          "VECTOR_WORKER_CLIENT_HTTP_FAILED",
          "Object not found.",
          {
            status: 404,
            details: { serverCode: "VECTOR_WORKER_OBJECT_NOT_FOUND" },
          },
        );
      },
    }),
    downloadAttempts: 3,
    retryMs: 100,
  });

  await assert.rejects(
    store.get("source/missing.svg"),
    (error: unknown) =>
      error instanceof VectorWorkerError &&
      error.code === "VECTOR_WORKER_OBJECT_NOT_FOUND" &&
      !error.retryable,
  );
});

test("stops before network access when the operation is cancelled", async () => {
  let calls = 0;
  const store = new HttpVectorObjectStore({
    client: client({
      async downloadObject(): Promise<never> {
        calls += 1;
        throw new Error("Cancelled work must not reach the client.");
      },
    }),
  });
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(
    store.get("source/mark.svg", { signal: controller.signal }),
    (error: unknown) =>
      error instanceof VectorWorkerError &&
      error.code === "VECTOR_WORKER_CANCELLED" &&
      error.retryable,
  );
  assert.equal(calls, 0);
});

test("reports the HTTP transport without claiming queue or overwrite behavior", () => {
  const store = new HttpVectorObjectStore({ client: client({}) });
  assert.deepEqual(store.capabilities, {
    contractVersion: "1.0",
    transport: "worker-object-transfer-api",
    downloadAttempts: 3,
    uploadAttempts: 3,
    retryMs: 500,
    exactUploadReplay: true,
    downloadSha256Verification: true,
    sharedFilesystemRequired: false,
    existingObjectsOverwritten: false,
  });
});
