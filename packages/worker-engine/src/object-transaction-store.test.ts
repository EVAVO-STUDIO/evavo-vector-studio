import assert from "node:assert/strict";
import test from "node:test";
import {
  decodeVectorObjectTransaction,
  encodeVectorObjectTransaction,
} from "@evavo/worker-protocol";
import { VectorWorkerError } from "./base-errors.js";
import { MemoryVectorObjectStore } from "./memory-object-store.js";
import { commitVectorObjectTransactionIdempotently } from "./object-transaction-store.js";
import type { VectorObjectStore } from "./types.js";

function transaction(
  writes: readonly Readonly<{
    objectKey: string;
    mimeType: string;
    source: string;
  }>[],
) {
  return decodeVectorObjectTransaction(
    encodeVectorObjectTransaction(
      writes.map((write) => Object.freeze({
        objectKey: write.objectKey,
        mimeType: write.mimeType,
        bytes: new TextEncoder().encode(write.source),
      })),
    ).body,
  );
}

const firstTransaction = transaction([
  {
    objectKey: "source/mark.svg",
    mimeType: "image/svg+xml",
    source: '<svg xmlns="http://www.w3.org/2000/svg"/>',
  },
  {
    objectKey: "source/mark.evidence.json",
    mimeType: "application/json",
    source: '{"kind":"fixture"}',
  },
]);

test("commits a new transaction and replays the same immutable content", async () => {
  const store = new MemoryVectorObjectStore();
  const committed = await commitVectorObjectTransactionIdempotently(
    store,
    firstTransaction,
  );
  assert.equal(committed.replayed, false);
  assert.equal(committed.mimeTypeVerification, "verified");
  assert.equal(committed.existingObjectsOverwritten, false);
  assert.equal(committed.receipts.length, 2);
  assert.equal(committed.receipts[0]?.path, "object://source/mark.svg");
  assert.match(committed.transactionId, /^[a-f0-9]{64}$/);

  const replayed = await commitVectorObjectTransactionIdempotently(
    store,
    firstTransaction,
  );
  assert.equal(replayed.replayed, true);
  assert.equal(replayed.transactionId, committed.transactionId);
  assert.deepEqual(replayed.receipts, committed.receipts);
});

test("rejects changed bytes or MIME under an immutable object key", async () => {
  const store = new MemoryVectorObjectStore();
  await commitVectorObjectTransactionIdempotently(store, firstTransaction);

  for (const changed of [
    transaction([
      {
        objectKey: "source/mark.svg",
        mimeType: "image/svg+xml",
        source: "<svg><changed/></svg>",
      },
    ]),
    transaction([
      {
        objectKey: "source/mark.svg",
        mimeType: "text/plain",
        source: '<svg xmlns="http://www.w3.org/2000/svg"/>',
      },
    ]),
  ]) {
    await assert.rejects(
      commitVectorObjectTransactionIdempotently(store, changed),
      (error: unknown) =>
        error instanceof VectorWorkerError &&
        error.code === "VECTOR_WORKER_OBJECT_TRANSACTION_CONFLICT" &&
        !error.retryable,
    );
  }
});

test("rejects partial overlap rather than mixing transaction revisions", async () => {
  const store = new MemoryVectorObjectStore();
  const first = firstTransaction.writes[0]!;
  store.seed(first.objectKey, first.bytes, first.mimeType);

  await assert.rejects(
    commitVectorObjectTransactionIdempotently(store, firstTransaction),
    (error: unknown) => {
      assert.ok(error instanceof VectorWorkerError);
      assert.equal(error.code, "VECTOR_WORKER_OBJECT_TRANSACTION_CONFLICT");
      assert.deepEqual(error.details?.existingObjectKeys, ["source/mark.svg"]);
      assert.deepEqual(error.details?.missingObjectKeys, [
        "source/mark.evidence.json",
      ]);
      return true;
    },
  );
  assert.equal(store.has("source/mark.evidence.json"), false);
});

test("reports content-only replay when a store cannot retain MIME metadata", async () => {
  const item = firstTransaction.manifest.objects[0]!;
  const bytes = firstTransaction.writes[0]!.bytes;
  const store: VectorObjectStore = Object.freeze({
    async get() {
      return Object.freeze({
        objectKey: item.objectKey,
        mimeType: "application/octet-stream",
        bytes: new Uint8Array(bytes),
        byteCount: item.bytes,
        sha256: item.sha256,
      });
    },
    async putManyNew(): Promise<never> {
      throw new Error("A complete replay must not write objects.");
    },
  });
  const one = transaction([
    {
      objectKey: item.objectKey,
      mimeType: item.mimeType,
      source: new TextDecoder().decode(bytes),
    },
  ]);
  const replayed = await commitVectorObjectTransactionIdempotently(store, one);
  assert.equal(replayed.replayed, true);
  assert.equal(replayed.mimeTypeVerification, "content-only");
});

test("honours cancellation before object inspection or commit", async () => {
  const store = new MemoryVectorObjectStore();
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    commitVectorObjectTransactionIdempotently(store, firstTransaction, {
      signal: controller.signal,
    }),
    (error: unknown) =>
      error instanceof VectorWorkerError &&
      error.code === "VECTOR_WORKER_CANCELLED" &&
      error.retryable,
  );
  assert.equal(store.has("source/mark.svg"), false);
});
