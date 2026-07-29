import assert from "node:assert/strict";
import test from "node:test";
import { VectorWorkerProtocolError } from "./errors.js";
import { readVectorObjectTransactionRequestBody } from "./object-transfer-http.js";

function requestBody(bytes: Uint8Array): ArrayBuffer {
  const body = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(body).set(bytes);
  return body;
}

function request(body?: Uint8Array, signal?: AbortSignal): Request {
  return new Request("https://vector.example.test/api/v1/worker/objects", {
    method: "POST",
    ...(body ? { body: requestBody(body) } : {}),
    ...(signal ? { signal } : {}),
  });
}

test("reads a bounded request body without changing its bytes", async () => {
  const source = new Uint8Array([1, 2, 3, 4, 5]);
  const body = await readVectorObjectTransactionRequestBody(
    request(source),
    source.byteLength,
  );
  assert.deepEqual([...body], [...source]);
  source[0] = 99;
  assert.equal(body[0], 1);
});

test("rejects a body as soon as it exceeds the configured request limit", async () => {
  await assert.rejects(
    readVectorObjectTransactionRequestBody(
      request(new Uint8Array([1, 2, 3, 4, 5, 6])),
      5,
    ),
    (error: unknown) =>
      error instanceof VectorWorkerProtocolError &&
      error.code === "VECTOR_WORKER_OBJECT_TRANSACTION_TOO_LARGE" &&
      error.status === 413 &&
      error.details?.maximum === 5,
  );
});

test("rejects empty and already-cancelled requests deterministically", async () => {
  await assert.rejects(
    readVectorObjectTransactionRequestBody(request(), 10),
    (error: unknown) =>
      error instanceof VectorWorkerProtocolError &&
      error.code === "VECTOR_WORKER_OBJECT_TRANSACTION_INVALID" &&
      error.status === 400,
  );

  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    readVectorObjectTransactionRequestBody(
      request(new Uint8Array([1]), controller.signal),
      10,
    ),
    (error: unknown) =>
      error instanceof VectorWorkerProtocolError &&
      error.code === "VECTOR_WORKER_OBJECT_TRANSACTION_INVALID" &&
      error.status === 408 &&
      error.retryable,
  );
});

test("rejects invalid local maximum configuration", async () => {
  await assert.rejects(
    readVectorObjectTransactionRequestBody(
      request(new Uint8Array([1])),
      0,
    ),
    (error: unknown) =>
      error instanceof VectorWorkerProtocolError &&
      error.code === "VECTOR_WORKER_OBJECT_TRANSACTION_INVALID" &&
      error.status === 500,
  );
});
