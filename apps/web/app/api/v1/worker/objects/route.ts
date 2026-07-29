import { workerApiAuthorisationFailure } from "../../../../../lib/api-security";
import {
  VECTOR_OBJECT_MAX_BYTES,
  VECTOR_OBJECT_TRANSFER_CONTRACT_VERSION,
} from "@evavo/worker-protocol";
import {
  commitVectorObjectTransactionIdempotently,
} from "@evavo/worker-engine/object-store";
import {
  parseWorkerObjectKey,
  parseWorkerObjectTransaction,
  requireWorkerObjectRuntime,
  workerObjectDownloadResponse,
  workerObjectErrorResponse,
} from "../../../../../lib/worker-object-api";
import { workerJson } from "../../../../../lib/worker-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const authFailure = workerApiAuthorisationFailure(request);
  if (authFailure) return authFailure;
  try {
    const required = await requireWorkerObjectRuntime();
    if (required.response) return required.response;
    const transaction = await parseWorkerObjectTransaction(request);
    const committed = await commitVectorObjectTransactionIdempotently(
      required.runtime.store!,
      transaction,
      { signal: request.signal },
    );
    return workerJson(
      {
        service: "evavo-vector-studio-worker-object-transfer",
        contractVersion: VECTOR_OBJECT_TRANSFER_CONTRACT_VERSION,
        transactionId: committed.transactionId,
        bodySha256: committed.bodySha256,
        idempotentReplay: committed.replayed,
        mimeTypeVerification: committed.mimeTypeVerification,
        objects: committed.receipts,
        existingObjectsOverwritten: committed.existingObjectsOverwritten,
        generatedBodiesInJson: false,
      },
      committed.replayed ? 200 : 201,
      {
        "x-vector-object-transfer-contract":
          VECTOR_OBJECT_TRANSFER_CONTRACT_VERSION,
        "x-vector-object-transaction-id": committed.transactionId,
        "x-vector-object-count": String(committed.receipts.length),
        "x-vector-object-replayed": String(committed.replayed),
      },
    );
  } catch (error) {
    return workerObjectErrorResponse(error);
  }
}

export async function GET(request: Request): Promise<Response> {
  const authFailure = workerApiAuthorisationFailure(request);
  if (authFailure) return authFailure;
  try {
    const required = await requireWorkerObjectRuntime();
    if (required.response) return required.response;
    const objectKey = parseWorkerObjectKey(request);
    const object = await required.runtime.store!.get(objectKey, {
      maximumBytes: VECTOR_OBJECT_MAX_BYTES,
      signal: request.signal,
    });
    return workerObjectDownloadResponse(object);
  } catch (error) {
    return workerObjectErrorResponse(error);
  }
}
