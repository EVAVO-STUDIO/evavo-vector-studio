export type VectorWorkerClientErrorCode =
  | "VECTOR_WORKER_CLIENT_OPTIONS_INVALID"
  | "VECTOR_WORKER_CLIENT_ABORTED"
  | "VECTOR_WORKER_CLIENT_TIMEOUT"
  | "VECTOR_WORKER_CLIENT_NETWORK_FAILED"
  | "VECTOR_WORKER_CLIENT_HTTP_FAILED"
  | "VECTOR_WORKER_CLIENT_RESPONSE_TOO_LARGE"
  | "VECTOR_WORKER_CLIENT_RESPONSE_INVALID";

export class VectorWorkerClientError extends Error {
  readonly code: VectorWorkerClientErrorCode;
  readonly status: number | null;
  readonly retryable: boolean;
  readonly details: Readonly<Record<string, unknown>> | undefined;

  constructor(
    code: VectorWorkerClientErrorCode,
    message: string,
    options: Readonly<{
      status?: number | null;
      retryable?: boolean;
      details?: Readonly<Record<string, unknown>>;
      cause?: unknown;
    }> = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "VectorWorkerClientError";
    this.code = code;
    this.status = options.status ?? null;
    this.retryable = options.retryable ?? false;
    this.details = options.details;
  }
}
