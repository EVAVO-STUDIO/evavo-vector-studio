import { LottieEngineError } from "@evavo/lottie-engine";
import { MotionEngineError } from "@evavo/motion-engine";
import { RasterEngineError, RasterRuntimeGuardError } from "@evavo/raster-engine";
import { VectorWorkerError } from "./base-errors.js";

export * from "./base-errors.js";

export function vectorWorkerFailure(error: unknown): VectorWorkerError {
  if (error instanceof VectorWorkerError) return error;
  if (error instanceof RasterRuntimeGuardError) {
    return new VectorWorkerError(error.code, error.message, {
      retryable: error.code === "RASTER_RUNTIME_BUSY",
      details: error.details,
      cause: error,
    });
  }
  if (error instanceof RasterEngineError) {
    return new VectorWorkerError(error.code, error.message, {
      retryable: error.code === "RASTER_ABORTED",
      details: error.details,
      cause: error,
    });
  }
  if (error instanceof MotionEngineError || error instanceof LottieEngineError) {
    return new VectorWorkerError(error.code, error.message, {
      retryable: false,
      details: error.details,
      cause: error,
    });
  }
  return new VectorWorkerError(
    "VECTOR_WORKER_EXECUTION_FAILED",
    error instanceof Error ? error.message : String(error),
    { retryable: false, cause: error },
  );
}
