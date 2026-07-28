export type RasterEngineErrorCode =
  | "RASTER_INPUT_EMPTY"
  | "RASTER_INPUT_TOO_LARGE"
  | "RASTER_FORMAT_UNSUPPORTED"
  | "RASTER_HEADER_INVALID"
  | "RASTER_PIXEL_LIMIT_EXCEEDED"
  | "RASTER_DECODE_FAILED"
  | "RASTER_DECODE_MISMATCH"
  | "RASTER_OPTIONS_INVALID"
  | "RASTER_TRACE_FAILED"
  | "RASTER_OUTPUT_INVALID"
  | "RASTER_RENDER_COMPARISON_FAILED"
  | "RASTER_DIFFERENCE_ARTIFACT_FAILED"
  | "RASTER_ABORTED";

export class RasterEngineError extends Error {
  readonly code: RasterEngineErrorCode;
  readonly status: number;
  readonly details: Readonly<Record<string, unknown>> | undefined;

  constructor(
    code: RasterEngineErrorCode,
    message: string,
    status = 400,
    details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = "RasterEngineError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new RasterEngineError("RASTER_ABORTED", "Raster processing was aborted.", 499);
  }
}

export function rasterFailure(
  code: RasterEngineErrorCode,
  message: string,
  error: unknown,
  status = 422,
): RasterEngineError {
  if (error instanceof RasterEngineError) return error;
  return new RasterEngineError(code, message, status, {
    cause: error instanceof Error ? error.message : String(error),
  });
}
