import { BatchEngineError } from "@evavo/job-engine";
import { LottieEngineError } from "@evavo/lottie-engine";
import { MotionEngineError } from "@evavo/motion-engine";
import { RasterEngineError, RasterRuntimeGuardError } from "@evavo/raster-engine";
import { VectorMcpFileCommitError } from "./file-transaction.js";
import { VectorMcpPathError } from "./path-policy.js";

export type VectorMcpFailure = Readonly<{
  ok: false;
  error: Readonly<{
    code: string;
    message: string;
    retryable: boolean;
    details?: Readonly<Record<string, unknown>>;
  }>;
}>;

export class VectorMcpOperationError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly details: Readonly<Record<string, unknown>> | undefined;

  constructor(
    code: string,
    message: string,
    options: Readonly<{
      retryable?: boolean;
      details?: Readonly<Record<string, unknown>>;
    }> = {},
  ) {
    super(message);
    this.name = "VectorMcpOperationError";
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.details = options.details;
  }
}

function failure(
  code: string,
  message: string,
  retryable: boolean,
  details?: Readonly<Record<string, unknown>>,
): VectorMcpFailure {
  return Object.freeze({
    ok: false,
    error: Object.freeze({ code, message, retryable, ...(details ? { details } : {}) }),
  });
}

export function vectorMcpFailure(error: unknown): VectorMcpFailure {
  if (error instanceof VectorMcpOperationError) {
    return failure(error.code, error.message, error.retryable, error.details);
  }
  if (error instanceof VectorMcpPathError) {
    return failure(error.code, error.message, false, error.details);
  }
  if (error instanceof VectorMcpFileCommitError) {
    return failure(error.code, error.message, false, error.details);
  }
  if (error instanceof BatchEngineError) {
    return failure(error.code, error.message, error.retryable, error.details);
  }
  if (error instanceof LottieEngineError) {
    return failure(error.code, error.message, false, error.details);
  }
  if (error instanceof MotionEngineError) {
    return failure(error.code, error.message, false, error.details);
  }
  if (error instanceof RasterRuntimeGuardError) {
    return failure(error.code, error.message, error.code === "RASTER_RUNTIME_BUSY", {
      ...(error.details ?? {}),
      ...(error.retryAfterSeconds ? { retryAfterSeconds: error.retryAfterSeconds } : {}),
    });
  }
  if (error instanceof RasterEngineError) {
    return failure(
      error.code,
      error.message,
      error.code === "RASTER_ABORTED",
      error.details,
    );
  }
  return failure(
    "VECTOR_MCP_OPERATION_FAILED",
    error instanceof Error ? error.message : String(error),
    false,
  );
}
