export type HostedJobErrorCode =
  | "HOSTED_JOB_REQUEST_INVALID"
  | "HOSTED_JOB_IDEMPOTENCY_CONFLICT"
  | "HOSTED_JOB_NOT_FOUND"
  | "HOSTED_JOB_CONCURRENCY_CONFLICT"
  | "HOSTED_JOB_TRANSITION_INVALID"
  | "HOSTED_JOB_LEASE_INVALID"
  | "HOSTED_JOB_LEASE_EXPIRED"
  | "HOSTED_JOB_CANCELLATION_REQUESTED"
  | "HOSTED_JOB_STORE_BUSY"
  | "HOSTED_JOB_STORE_CORRUPT"
  | "HOSTED_JOB_STORE_FAILED";

export class HostedJobError extends Error {
  readonly code: HostedJobErrorCode;
  readonly status: number;
  readonly retryable: boolean;
  readonly details: Readonly<Record<string, unknown>> | undefined;

  constructor(
    code: HostedJobErrorCode,
    message: string,
    options: Readonly<{
      status?: number;
      retryable?: boolean;
      details?: Readonly<Record<string, unknown>>;
      cause?: unknown;
    }> = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "HostedJobError";
    this.code = code;
    this.status = options.status ?? 400;
    this.retryable = options.retryable ?? false;
    this.details = options.details;
  }
}

export function hostedJobFailure(
  error: unknown,
  fallbackMessage = "The hosted job operation failed.",
): HostedJobError {
  if (error instanceof HostedJobError) return error;
  return new HostedJobError(
    "HOSTED_JOB_STORE_FAILED",
    fallbackMessage,
    {
      status: 500,
      details: {
        cause: error instanceof Error ? error.message : String(error),
      },
      cause: error,
    },
  );
}
