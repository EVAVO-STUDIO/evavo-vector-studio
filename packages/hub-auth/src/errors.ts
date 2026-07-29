export type VectorHubAuthErrorCode =
  | "VECTOR_HUB_AUTH_CONFIGURATION_INVALID"
  | "VECTOR_HUB_LAUNCH_TOKEN_INVALID"
  | "VECTOR_HUB_LAUNCH_REPLAYED"
  | "VECTOR_HUB_LAUNCH_REPLAY_UNAVAILABLE"
  | "VECTOR_HUB_SESSION_INVALID"
  | "VECTOR_HUB_SESSION_EXPIRED";

export class VectorHubAuthError extends Error {
  readonly code: VectorHubAuthErrorCode;
  readonly retryable: boolean;
  readonly details: Readonly<Record<string, unknown>> | undefined;

  constructor(
    code: VectorHubAuthErrorCode,
    message: string,
    options: Readonly<{
      retryable?: boolean;
      details?: Readonly<Record<string, unknown>>;
      cause?: unknown;
    }> = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "VectorHubAuthError";
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.details = options.details;
  }
}
