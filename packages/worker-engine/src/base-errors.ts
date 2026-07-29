export type VectorWorkerErrorCode =
  | "VECTOR_WORKER_JOB_INVALID"
  | "VECTOR_WORKER_OPERATION_UNSUPPORTED"
  | "VECTOR_WORKER_PAYLOAD_INVALID"
  | "VECTOR_WORKER_CANCELLED"
  | "VECTOR_WORKER_OBJECT_KEY_INVALID"
  | "VECTOR_WORKER_OBJECT_NOT_FOUND"
  | "VECTOR_WORKER_OBJECT_NOT_FILE"
  | "VECTOR_WORKER_OBJECT_TOO_LARGE"
  | "VECTOR_WORKER_OBJECT_HASH_MISMATCH"
  | "VECTOR_WORKER_OBJECT_EXISTS"
  | "VECTOR_WORKER_OBJECT_COLLISION"
  | "VECTOR_WORKER_OBJECT_TRANSACTION_CONFLICT"
  | "VECTOR_WORKER_OBJECT_STORE_FAILED"
  | "VECTOR_WORKER_OUTPUT_TOO_LARGE"
  | "VECTOR_WORKER_EXECUTION_FAILED";

export class VectorWorkerError extends Error {
  readonly code: VectorWorkerErrorCode | string;
  readonly retryable: boolean;
  readonly details: Readonly<Record<string, unknown>> | undefined;

  constructor(
    code: VectorWorkerErrorCode | string,
    message: string,
    options: Readonly<{
      retryable?: boolean;
      details?: Readonly<Record<string, unknown>>;
      cause?: unknown;
    }> = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "VectorWorkerError";
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.details = options.details;
  }
}

export function throwIfWorkerAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new VectorWorkerError(
      "VECTOR_WORKER_CANCELLED",
      "The vector worker operation was cancelled.",
      { retryable: true },
    );
  }
}
