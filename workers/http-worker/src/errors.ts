import { VectorWorkerClientError } from "@evavo/worker-client";
import { VectorWorkerError } from "@evavo/worker-engine";

export type HttpWorkerErrorCode =
  | "HTTP_WORKER_CONFIG_INVALID"
  | "HTTP_WORKER_CANCELLED"
  | "HTTP_WORKER_CONTROL_UNCERTAIN"
  | "HTTP_WORKER_COMPLETION_UNCERTAIN"
  | "HTTP_WORKER_LEASE_INVALID"
  | "HTTP_WORKER_EXECUTION_FAILED";

export class HttpWorkerError extends Error {
  readonly code: HttpWorkerErrorCode;
  readonly retryable: boolean;
  readonly details: Readonly<Record<string, unknown>> | undefined;

  constructor(
    code: HttpWorkerErrorCode,
    message: string,
    options: Readonly<{
      retryable?: boolean;
      details?: Readonly<Record<string, unknown>>;
      cause?: unknown;
    }> = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "HttpWorkerError";
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.details = options.details;
  }
}

export function httpWorkerFailure(error: unknown): Readonly<{
  code: string;
  message: string;
  retryable: boolean;
  details: Readonly<Record<string, unknown>> | null;
}> {
  if (error instanceof HttpWorkerError) {
    return Object.freeze({
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      details: error.details ?? null,
    });
  }
  if (error instanceof VectorWorkerClientError) {
    return Object.freeze({
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      details: error.details ?? null,
    });
  }
  if (error instanceof VectorWorkerError) {
    return Object.freeze({
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      details: error.details ?? null,
    });
  }
  return Object.freeze({
    code: "HTTP_WORKER_EXECUTION_FAILED",
    message: error instanceof Error ? error.message : String(error),
    retryable: false,
    details: null,
  });
}
