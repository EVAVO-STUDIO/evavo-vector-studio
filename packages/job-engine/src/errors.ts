export type BatchEngineErrorCode =
  | "BATCH_MANIFEST_INVALID"
  | "BATCH_MANIFEST_CHANGED"
  | "BATCH_HANDLER_MISSING"
  | "BATCH_JOB_LOCKED"
  | "BATCH_JOB_STATE_INVALID"
  | "BATCH_ITEM_REVISION_MISMATCH"
  | "BATCH_COMPLETED_OUTPUT_INVALID"
  | "BATCH_OPERATION_FAILED"
  | "BATCH_CANCELLED"
  | "BATCH_FILESYSTEM_FAILED";

export class BatchEngineError extends Error {
  readonly code: BatchEngineErrorCode;
  readonly details: Readonly<Record<string, unknown>> | undefined;
  readonly retryable: boolean;

  constructor(
    code: BatchEngineErrorCode,
    message: string,
    options: Readonly<{
      details?: Readonly<Record<string, unknown>>;
      retryable?: boolean;
      cause?: unknown;
    }> = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "BatchEngineError";
    this.code = code;
    this.details = options.details;
    this.retryable = options.retryable ?? false;
  }
}

export function batchFailure(
  error: unknown,
  fallbackCode: BatchEngineErrorCode = "BATCH_OPERATION_FAILED",
  fallbackMessage = "The durable batch operation failed.",
  details: Readonly<Record<string, unknown>> = {},
): BatchEngineError {
  if (error instanceof BatchEngineError) return error;
  return new BatchEngineError(fallbackCode, fallbackMessage, {
    details: {
      ...details,
      cause: error instanceof Error ? error.message : String(error),
    },
    cause: error,
  });
}
