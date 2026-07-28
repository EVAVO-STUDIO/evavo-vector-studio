export type LottieEngineErrorCode =
  | "LOTTIE_OPTIONS_INVALID"
  | "LOTTIE_SOURCE_INVALID"
  | "LOTTIE_SOURCE_UNSUPPORTED"
  | "LOTTIE_TARGET_MISSING"
  | "LOTTIE_TARGET_DUPLICATE"
  | "LOTTIE_TARGET_OVERLAP"
  | "LOTTIE_PATH_INVALID"
  | "LOTTIE_STYLE_UNSUPPORTED"
  | "LOTTIE_MOTION_UNSUPPORTED"
  | "LOTTIE_OUTPUT_INVALID"
  | "DOTLOTTIE_OPTIONS_INVALID"
  | "DOTLOTTIE_SOURCE_INVALID"
  | "DOTLOTTIE_ARCHIVE_INVALID"
  | "DOTLOTTIE_OUTPUT_INVALID"
  | "DOTLOTTIE_OUTPUT_TOO_LARGE";

export class LottieEngineError extends Error {
  readonly code: LottieEngineErrorCode;
  readonly details: Readonly<Record<string, unknown>> | undefined;

  constructor(
    code: LottieEngineErrorCode,
    message: string,
    details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = "LottieEngineError";
    this.code = code;
    this.details = details;
  }
}

export function lottieFailure(
  code: LottieEngineErrorCode,
  message: string,
  error: unknown,
  details: Readonly<Record<string, unknown>> = {},
): LottieEngineError {
  if (error instanceof LottieEngineError) return error;
  return new LottieEngineError(code, message, {
    ...details,
    cause: error instanceof Error ? error.message : String(error),
  });
}
