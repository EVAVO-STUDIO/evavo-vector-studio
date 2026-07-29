import type {
  DecodedVectorObjectTransaction,
  VectorObjectTransferManifestItem,
} from "@evavo/worker-protocol";
import {
  VectorWorkerError,
  throwIfWorkerAborted,
} from "./base-errors.js";
import type {
  ObjectReceipt,
  VectorObjectStore,
} from "./types.js";

export type VectorObjectTransactionMimeVerification =
  | "verified"
  | "content-only";

export type VectorObjectTransactionStoreResult = Readonly<{
  transactionId: string;
  bodySha256: string;
  replayed: boolean;
  mimeTypeVerification: VectorObjectTransactionMimeVerification;
  receipts: readonly ObjectReceipt[];
  existingObjectsOverwritten: false;
}>;

type ExistingTransactionState = Readonly<{
  existing: readonly VectorObjectTransferManifestItem[];
  missing: readonly VectorObjectTransferManifestItem[];
  mimeTypeVerification: VectorObjectTransactionMimeVerification;
}>;

function conflict(
  transaction: DecodedVectorObjectTransaction,
  message: string,
  details: Readonly<Record<string, unknown>> = {},
): never {
  throw new VectorWorkerError(
    "VECTOR_WORKER_OBJECT_TRANSACTION_CONFLICT",
    message,
    {
      retryable: false,
      details: {
        transactionId: transaction.transactionId,
        ...details,
      },
    },
  );
}

function publicReceipt(
  item: VectorObjectTransferManifestItem,
): ObjectReceipt {
  return Object.freeze({
    objectKey: item.objectKey,
    path: `object://${item.objectKey}`,
    mimeType: item.mimeType,
    bytes: item.bytes,
    sha256: item.sha256,
  });
}

async function inspectExistingTransaction(
  store: VectorObjectStore,
  transaction: DecodedVectorObjectTransaction,
  signal?: AbortSignal,
): Promise<ExistingTransactionState> {
  const existing: VectorObjectTransferManifestItem[] = [];
  const missing: VectorObjectTransferManifestItem[] = [];
  let contentOnly = false;

  for (const item of transaction.manifest.objects) {
    throwIfWorkerAborted(signal);
    try {
      const retained = await store.get(item.objectKey, {
        maximumBytes: item.bytes,
        signal,
      });
      if (
        retained.byteCount !== item.bytes ||
        retained.sha256 !== item.sha256
      ) {
        conflict(
          transaction,
          "An immutable object key is already bound to different bytes.",
          {
            objectKey: item.objectKey,
            expectedBytes: item.bytes,
            actualBytes: retained.byteCount,
            expectedSha256: item.sha256,
            actualSha256: retained.sha256,
          },
        );
      }
      if (
        retained.mimeType !== "application/octet-stream" &&
        retained.mimeType !== item.mimeType
      ) {
        conflict(
          transaction,
          "An immutable object key is already bound to a different MIME type.",
          {
            objectKey: item.objectKey,
            expectedMimeType: item.mimeType,
            actualMimeType: retained.mimeType,
          },
        );
      }
      if (
        retained.mimeType === "application/octet-stream" &&
        item.mimeType !== "application/octet-stream"
      ) {
        contentOnly = true;
      }
      existing.push(item);
    } catch (error) {
      if (
        error instanceof VectorWorkerError &&
        error.code === "VECTOR_WORKER_OBJECT_NOT_FOUND"
      ) {
        missing.push(item);
        continue;
      }
      if (
        error instanceof VectorWorkerError &&
        error.code === "VECTOR_WORKER_OBJECT_TOO_LARGE"
      ) {
        conflict(
          transaction,
          "An immutable object key is already bound to a larger object.",
          { objectKey: item.objectKey, expectedBytes: item.bytes },
        );
      }
      throw error;
    }
  }

  return Object.freeze({
    existing: Object.freeze(existing),
    missing: Object.freeze(missing),
    mimeTypeVerification: contentOnly ? "content-only" : "verified",
  });
}

function validateCommittedReceipts(
  transaction: DecodedVectorObjectTransaction,
  receipts: readonly ObjectReceipt[],
): void {
  if (receipts.length !== transaction.manifest.objects.length) {
    throw new VectorWorkerError(
      "VECTOR_WORKER_OBJECT_STORE_FAILED",
      "The object store returned an incomplete transaction receipt set.",
      {
        retryable: true,
        details: {
          transactionId: transaction.transactionId,
          expected: transaction.manifest.objects.length,
          actual: receipts.length,
        },
      },
    );
  }
  const byKey = new Map(receipts.map((receipt) => [receipt.objectKey, receipt]));
  for (const item of transaction.manifest.objects) {
    const receipt = byKey.get(item.objectKey);
    if (
      !receipt ||
      receipt.bytes !== item.bytes ||
      receipt.sha256 !== item.sha256 ||
      receipt.mimeType !== item.mimeType
    ) {
      throw new VectorWorkerError(
        "VECTOR_WORKER_OBJECT_STORE_FAILED",
        "The object store returned a receipt that does not match the decoded transaction.",
        {
          retryable: true,
          details: {
            transactionId: transaction.transactionId,
            objectKey: item.objectKey,
          },
        },
      );
    }
  }
}

function result(
  transaction: DecodedVectorObjectTransaction,
  replayed: boolean,
  mimeTypeVerification: VectorObjectTransactionMimeVerification,
): VectorObjectTransactionStoreResult {
  return Object.freeze({
    transactionId: transaction.transactionId,
    bodySha256: transaction.bodySha256,
    replayed,
    mimeTypeVerification,
    receipts: Object.freeze(
      transaction.manifest.objects.map(publicReceipt),
    ),
    existingObjectsOverwritten: false as const,
  });
}

export async function commitVectorObjectTransactionIdempotently(
  store: VectorObjectStore,
  transaction: DecodedVectorObjectTransaction,
  options: Readonly<{ signal?: AbortSignal }> = {},
): Promise<VectorObjectTransactionStoreResult> {
  throwIfWorkerAborted(options.signal);
  const initial = await inspectExistingTransaction(
    store,
    transaction,
    options.signal,
  );

  if (initial.existing.length === transaction.manifest.objects.length) {
    return result(
      transaction,
      true,
      initial.mimeTypeVerification,
    );
  }
  if (initial.existing.length > 0) {
    conflict(
      transaction,
      "The object transaction partially overlaps immutable retained objects.",
      {
        existingObjectKeys: initial.existing.map((item) => item.objectKey),
        missingObjectKeys: initial.missing.map((item) => item.objectKey),
      },
    );
  }

  try {
    const receipts = await store.putManyNew(transaction.writes, {
      signal: options.signal,
    });
    validateCommittedReceipts(transaction, receipts);
    return result(transaction, false, "verified");
  } catch (error) {
    if (
      error instanceof VectorWorkerError &&
      error.code === "VECTOR_WORKER_OBJECT_EXISTS"
    ) {
      const raced = await inspectExistingTransaction(
        store,
        transaction,
        options.signal,
      );
      if (raced.existing.length === transaction.manifest.objects.length) {
        return result(
          transaction,
          true,
          raced.mimeTypeVerification,
        );
      }
      conflict(
        transaction,
        "The object transaction collided with a different concurrent immutable commit.",
        {
          existingObjectKeys: raced.existing.map((item) => item.objectKey),
          missingObjectKeys: raced.missing.map((item) => item.objectKey),
        },
      );
    }
    throw error;
  }
}
