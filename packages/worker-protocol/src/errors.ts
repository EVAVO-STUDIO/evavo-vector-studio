export type VectorWorkerProtocolErrorCode =
  | "VECTOR_WORKER_PROTOCOL_REQUEST_INVALID"
  | "VECTOR_WORKER_PROTOCOL_OPERATION_UNSUPPORTED"
  | "VECTOR_WORKER_PROTOCOL_BODY_TOO_LARGE"
  | "VECTOR_WORKER_OBJECT_TRANSACTION_INVALID"
  | "VECTOR_WORKER_OBJECT_TRANSACTION_TOO_LARGE"
  | "VECTOR_WORKER_OBJECT_HASH_MISMATCH";

export class VectorWorkerProtocolError extends Error {
  readonly code: VectorWorkerProtocolErrorCode;
  readonly status: number;
  readonly retryable: boolean;
  readonly details: Readonly<Record<string, unknown>> | undefined;

  constructor(
    code: VectorWorkerProtocolErrorCode,
    message: string,
    options: Readonly<{
      status?: number;
      retryable?: boolean;
      details?: Readonly<Record<string, unknown>>;
      cause?: unknown;
    }> = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "VectorWorkerProtocolError";
    this.code = code;
    this.status = options.status ?? 422;
    this.retryable = options.retryable ?? false;
    this.details = options.details;
  }
}
