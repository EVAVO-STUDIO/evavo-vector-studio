import {
  VECTOR_OBJECT_TRANSACTION_MAX_BYTES,
} from "./object-transfer.js";
import { VectorWorkerProtocolError } from "./errors.js";

function invalid(
  message: string,
  options: Readonly<{
    status?: number;
    retryable?: boolean;
    details?: Readonly<Record<string, unknown>>;
  }> = {},
): never {
  throw new VectorWorkerProtocolError(
    "VECTOR_WORKER_OBJECT_TRANSACTION_INVALID",
    message,
    options,
  );
}

function tooLarge(bytes: number, maximum: number): never {
  throw new VectorWorkerProtocolError(
    "VECTOR_WORKER_OBJECT_TRANSACTION_TOO_LARGE",
    "The object transaction exceeds the transfer byte limit.",
    {
      status: 413,
      details: { bytes, maximum },
    },
  );
}

export async function readVectorObjectTransactionRequestBody(
  request: Request,
  maximumBytes = VECTOR_OBJECT_TRANSACTION_MAX_BYTES,
): Promise<Uint8Array> {
  if (
    !Number.isSafeInteger(maximumBytes) ||
    maximumBytes < 1 ||
    maximumBytes > VECTOR_OBJECT_TRANSACTION_MAX_BYTES
  ) {
    invalid(
      `maximumBytes must be an integer from 1 to ${VECTOR_OBJECT_TRANSACTION_MAX_BYTES}.`,
      { status: 500, details: { maximumBytes } },
    );
  }

  if (request.signal.aborted) {
    invalid("The object transaction request was cancelled.", {
      status: 408,
      retryable: true,
    });
  }
  if (!request.body) {
    invalid("The object transaction body is empty.", { status: 400 });
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let cancelled = false;
  const onAbort = () => {
    cancelled = true;
    void reader.cancel(request.signal.reason).catch(() => undefined);
  };
  request.signal.addEventListener("abort", onAbort, { once: true });

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel("object-transaction-too-large").catch(() => undefined);
        tooLarge(total, maximumBytes);
      }
      chunks.push(new Uint8Array(value));
    }
  } catch (error) {
    if (error instanceof VectorWorkerProtocolError) throw error;
    if (cancelled || request.signal.aborted) {
      invalid("The object transaction request was cancelled.", {
        status: 408,
        retryable: true,
      });
    }
    throw new VectorWorkerProtocolError(
      "VECTOR_WORKER_OBJECT_TRANSACTION_INVALID",
      "The object transaction request body could not be read.",
      { status: 400, cause: error },
    );
  } finally {
    request.signal.removeEventListener("abort", onAbort);
    reader.releaseLock();
  }

  if (cancelled || request.signal.aborted) {
    invalid("The object transaction request was cancelled.", {
      status: 408,
      retryable: true,
    });
  }
  if (total < 1) {
    invalid("The object transaction body is empty.", { status: 400 });
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}
