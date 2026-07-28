export type MotionEngineErrorCode =
  | "MOTION_SPEC_INVALID"
  | "MOTION_SOURCE_INVALID"
  | "MOTION_SOURCE_ALREADY_ANIMATED"
  | "MOTION_TARGET_MISSING"
  | "MOTION_TARGET_DUPLICATE"
  | "MOTION_TARGET_BASE_TRANSFORM_UNSUPPORTED"
  | "MOTION_OUTPUT_INVALID";

export class MotionEngineError extends Error {
  readonly code: MotionEngineErrorCode;
  readonly details: Readonly<Record<string, unknown>> | undefined;

  constructor(
    code: MotionEngineErrorCode,
    message: string,
    details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = "MotionEngineError";
    this.code = code;
    this.details = details;
  }
}
