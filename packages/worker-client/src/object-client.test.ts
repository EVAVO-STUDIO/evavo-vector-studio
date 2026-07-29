import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  VECTOR_OBJECT_TRANSFER_CONTRACT_VERSION,
  VECTOR_WORKER_PROTOCOL_VERSION,
  decodeVectorObjectTransaction,
} from "@evavo/worker-protocol";
import { VectorWorkerClientError } from "./errors.js";
import { createVectorWorkerObjectClient } from "./object-client.js";

const TOKEN = "object-client-test-token-with-24-characters";

function arrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const value = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(value).set(bytes);
  return value;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function protocolHeaders(extra: HeadersInit = {}): Headers {
  return new Headers({
    "x-vector-worker-protocol": VECTOR_WORKER_PROTOCOL_VERSION,
    "x-vector-object-transfer-contract":
      VECTOR_OBJECT_TRANSFER_CONTRACT_VERSION,
    ...extra,
  });
}

function uploadResponse(
  transaction: ReturnType<typeof decodeVectorObjectTransaction>,
  replayed = false,
): Response {
  const receipts = transaction.manifest.objects.map((item) => ({
    objectKey: item.objectKey,
    path: `object://${item.objectKey}`,
    mimeType: item.mimeType,
    bytes: item.bytes,
    sha256: item.sha256,
  }));
  return Response.json(
    {
      service: "evavo-vector-studio-worker-object-transfer",
      contractVersion: VECTOR_OBJECT_TRANSFER_CONTRACT_VERSION,
      transactionId: transaction.transactionId,
      bodySha256: transaction.bodySha256,
      idempotentReplay: replayed,
      mimeTypeVerification: replayed ? "content-only" : "verified",
      objects: receipts,
      existingObjectsOverwritten: false,
      generatedBodiesInJson: false,
    },
    {
      status: replayed ? 200 : 201,
      headers: protocolHeaders({
        "x-vector-object-transaction-id": transaction.transactionId,
        "x-vector-object-count": String(receipts.length),
        "x-vector-object-replayed": String(replayed),
      }),
    },
  );
}

test("rejects insecure non-local object URLs", () => {
  assert.throws(
    () => createVectorWorkerObjectClient({
      baseUrl: "http://worker.example.com",
      token: TOKEN,
    }),
    (error: unknown) =>
      error instanceof VectorWorkerClientError &&
      error.code === "VECTOR_WORKER_CLIENT_OPTIONS_INVALID",
  );
});

test("uploads an exact deterministic transaction and verifies every receipt", async () => {
  const requests: Request[] = [];
  const client = createVectorWorkerObjectClient({
    baseUrl: "https://worker.example.com/base/",
    token: TOKEN,
    fetch: async (input, init) => {
      const request = new Request(input, init);
      requests.push(request.clone());
      const transaction = decodeVectorObjectTransaction(
        new Uint8Array(await request.arrayBuffer()),
      );
      return uploadResponse(transaction);
    },
  });
  const writes = [
    {
      objectKey: "source/mark.svg",
      mimeType: "image/svg+xml",
      bytes: new TextEncoder().encode("<svg/>")
    },
    {
      objectKey: "source/mark.json",
      mimeType: "application/json",
      bytes: new TextEncoder().encode('{"ok":true}')
    },
  ] as const;

  const result = await client.uploadObjects(writes);
  assert.equal(result.replayed, false);
  assert.equal(result.mimeTypeVerification, "verified");
  assert.equal(result.receipts.length, 2);
  assert.equal(result.receipts[0]?.path, "object://source/mark.svg");
  assert.match(result.transactionId, /^[a-f0-9]{64}$/);
  assert.equal(requests[0]?.url, "https://worker.example.com/base/api/v1/worker/objects");
  assert.equal(requests[0]?.headers.get("authorization"), `Bearer ${TOKEN}`);
  assert.equal(
    requests[0]?.headers.get("content-type"),
    "application/vnd.evavo.vector-object-transaction",
  );
  assert.doesNotMatch(JSON.stringify(result), new RegExp(TOKEN));
});

test("accepts an exact replay but rejects altered upload evidence", async () => {
  let altered = false;
  const client = createVectorWorkerObjectClient({
    baseUrl: "https://worker.example.com",
    token: TOKEN,
    fetch: async (input, init) => {
      const request = new Request(input, init);
      const transaction = decodeVectorObjectTransaction(
        new Uint8Array(await request.arrayBuffer()),
      );
      if (!altered) return uploadResponse(transaction, true);
      const response = uploadResponse(transaction, true);
      const payload = await response.json() as Record<string, unknown>;
      payload.transactionId = "f".repeat(64);
      return Response.json(payload, {
        status: 200,
        headers: response.headers,
      });
    },
  });
  const writes = [{
    objectKey: "source/mark.svg",
    mimeType: "image/svg+xml",
    bytes: new TextEncoder().encode("<svg/>")
  }] as const;

  const replayed = await client.uploadObjects(writes);
  assert.equal(replayed.replayed, true);
  assert.equal(replayed.mimeTypeVerification, "content-only");

  altered = true;
  await assert.rejects(
    client.uploadObjects(writes),
    (error: unknown) =>
      error instanceof VectorWorkerClientError &&
      error.code === "VECTOR_WORKER_CLIENT_RESPONSE_INVALID",
  );
});

test("downloads raw bytes only after key, length and SHA-256 verification", async () => {
  const source = new TextEncoder().encode("verified-object-bytes");
  const digest = sha256(source);
  const client = createVectorWorkerObjectClient({
    baseUrl: "https://worker.example.com",
    token: TOKEN,
    fetch: async (input, init) => {
      const request = new Request(input, init);
      assert.equal(
        request.url,
        "https://worker.example.com/api/v1/worker/objects?key=source%2Fmark.svg",
      );
      assert.equal(request.headers.get("authorization"), `Bearer ${TOKEN}`);
      return new Response(arrayBuffer(source), {
        status: 200,
        headers: protocolHeaders({
          "content-type": "application/octet-stream",
          "content-length": String(source.byteLength),
          "x-vector-object-key": "source/mark.svg",
          "x-vector-object-bytes": String(source.byteLength),
          "x-vector-object-sha256": digest,
          "x-vector-object-stored-mime": "image/svg+xml",
        }),
      });
    },
  });

  const result = await client.downloadObject("source/mark.svg");
  assert.equal(result.objectKey, "source/mark.svg");
  assert.equal(result.mimeType, "image/svg+xml");
  assert.equal(result.byteCount, source.byteLength);
  assert.equal(result.sha256, digest);
  assert.deepEqual([...result.bytes], [...source]);
  source[0] = 99;
  assert.notEqual(result.bytes[0], 99);
});

test("rejects hash mismatch and oversized download declarations", async () => {
  const source = new Uint8Array([1, 2, 3]);
  const mismatch = createVectorWorkerObjectClient({
    baseUrl: "https://worker.example.com",
    token: TOKEN,
    fetch: async () => new Response(arrayBuffer(source), {
      status: 200,
      headers: protocolHeaders({
        "content-type": "application/octet-stream",
        "content-length": "3",
        "x-vector-object-key": "source/mark.bin",
        "x-vector-object-bytes": "3",
        "x-vector-object-sha256": "a".repeat(64),
        "x-vector-object-stored-mime": "application/octet-stream",
      }),
    }),
  });
  await assert.rejects(
    mismatch.downloadObject("source/mark.bin"),
    (error: unknown) =>
      error instanceof VectorWorkerClientError &&
      error.code === "VECTOR_WORKER_CLIENT_RESPONSE_INVALID",
  );

  const oversized = createVectorWorkerObjectClient({
    baseUrl: "https://worker.example.com",
    token: TOKEN,
    fetch: async () => new Response(null, {
      status: 200,
      headers: protocolHeaders({
        "content-type": "application/octet-stream",
        "content-length": "100",
      }),
    }),
  });
  await assert.rejects(
    oversized.downloadObject("source/mark.bin", { maximumBytes: 10 }),
    (error: unknown) =>
      error instanceof VectorWorkerClientError &&
      error.code === "VECTOR_WORKER_CLIENT_RESPONSE_TOO_LARGE",
  );
});

test("does not retry an object mutation automatically", async () => {
  let calls = 0;
  const client = createVectorWorkerObjectClient({
    baseUrl: "https://worker.example.com",
    token: TOKEN,
    fetch: async () => {
      calls += 1;
      throw new Error("network unavailable");
    },
  });
  await assert.rejects(
    client.uploadObjects([{
      objectKey: "source/mark.svg",
      mimeType: "image/svg+xml",
      bytes: new TextEncoder().encode("<svg/>")
    }]),
    (error: unknown) =>
      error instanceof VectorWorkerClientError &&
      error.code === "VECTOR_WORKER_CLIENT_NETWORK_FAILED" &&
      error.retryable,
  );
  assert.equal(calls, 1);
});
