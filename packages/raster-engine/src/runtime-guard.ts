export const DEFAULT_TRACE_TIMEOUT_MS = 45_000;
export const MIN_TRACE_TIMEOUT_MS = 5_000;
export const MAX_TRACE_TIMEOUT_MS = 180_000;
export const DEFAULT_TRACE_MAX_CONCURRENT = 1;
export const MAX_TRACE_MAX_CONCURRENT = 4;

export type RasterRuntimeGuardConfig = Readonly<{
  timeoutMs: number;
  maxConcurrent: number;
  retryAfterSeconds: number;
}>;

export type RasterRuntimeGuardSnapshot = RasterRuntimeGuardConfig & Readonly<{
  activeExecutions: number;
  availableExecutions: number;
}>;

export type RasterRuntimeLease = Readonly<{
  signal: AbortSignal;
  startedAt: number;
  timedOut: () => boolean;
  release: () => void;
}>;

export type RasterRuntimeGuard = Readonly<{
  acquire: (requestSignal?: AbortSignal) => RasterRuntimeLease;
  snapshot: () => RasterRuntimeGuardSnapshot;
}>;

export type RasterRuntimeTimer = Readonly<{
  now: () => number;
  setTimeout: (callback: () => void, milliseconds: number) => ReturnType<typeof setTimeout>;
  clearTimeout: (handle: ReturnType<typeof setTimeout>) => void;
}>;

export type RasterRuntimeGuardErrorCode =
  | "RASTER_RUNTIME_BUSY"
  | "RASTER_RUNTIME_CONFIG_INVALID";

export class RasterRuntimeGuardError extends Error {
  readonly code: RasterRuntimeGuardErrorCode;
  readonly status: number;
  readonly retryAfterSeconds: number | undefined;
  readonly details: Readonly<Record<string, unknown>> | undefined;

  constructor(
    code: RasterRuntimeGuardErrorCode,
    message: string,
    status: number,
    options: Readonly<{
      retryAfterSeconds?: number;
      details?: Readonly<Record<string, unknown>>;
    }> = {},
  ) {
    super(message);
    this.name = "RasterRuntimeGuardError";
    this.code = code;
    this.status = status;
    this.retryAfterSeconds = options.retryAfterSeconds;
    this.details = options.details;
  }
}

const SYSTEM_RUNTIME_TIMER: RasterRuntimeTimer = Object.freeze({
  now: () => Date.now(),
  setTimeout: (callback, milliseconds) => setTimeout(callback, milliseconds),
  clearTimeout: (handle) => clearTimeout(handle),
});

function integerSetting(
  value: string | number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  name: string,
): number {
  if (value === undefined || value === "") return fallback;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new RasterRuntimeGuardError(
      "RASTER_RUNTIME_CONFIG_INVALID",
      `${name} must be an integer from ${minimum} to ${maximum}.`,
      500,
      { details: { name, value, minimum, maximum } },
    );
  }
  return parsed;
}

export function resolveRasterRuntimeGuardConfig(
  input: Readonly<{
    timeoutMs?: string | number;
    maxConcurrent?: string | number;
    retryAfterSeconds?: string | number;
  }> = {},
): RasterRuntimeGuardConfig {
  return Object.freeze({
    timeoutMs: integerSetting(
      input.timeoutMs,
      DEFAULT_TRACE_TIMEOUT_MS,
      MIN_TRACE_TIMEOUT_MS,
      MAX_TRACE_TIMEOUT_MS,
      "VECTOR_TRACE_TIMEOUT_MS",
    ),
    maxConcurrent: integerSetting(
      input.maxConcurrent,
      DEFAULT_TRACE_MAX_CONCURRENT,
      1,
      MAX_TRACE_MAX_CONCURRENT,
      "VECTOR_TRACE_MAX_CONCURRENT",
    ),
    retryAfterSeconds: integerSetting(
      input.retryAfterSeconds,
      5,
      1,
      60,
      "VECTOR_TRACE_RETRY_AFTER_SECONDS",
    ),
  });
}

export function resolveRasterRuntimeGuardConfigFromEnvironment(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): RasterRuntimeGuardConfig {
  return resolveRasterRuntimeGuardConfig({
    timeoutMs: environment.VECTOR_TRACE_TIMEOUT_MS,
    maxConcurrent: environment.VECTOR_TRACE_MAX_CONCURRENT,
    retryAfterSeconds: environment.VECTOR_TRACE_RETRY_AFTER_SECONDS,
  });
}

export function createRasterRuntimeGuard(
  config: RasterRuntimeGuardConfig = resolveRasterRuntimeGuardConfigFromEnvironment(),
  timer: RasterRuntimeTimer = SYSTEM_RUNTIME_TIMER,
): RasterRuntimeGuard {
  let activeExecutions = 0;

  function snapshot(): RasterRuntimeGuardSnapshot {
    return Object.freeze({
      ...config,
      activeExecutions,
      availableExecutions: Math.max(0, config.maxConcurrent - activeExecutions),
    });
  }

  function acquire(requestSignal?: AbortSignal): RasterRuntimeLease {
    if (activeExecutions >= config.maxConcurrent) {
      throw new RasterRuntimeGuardError(
        "RASTER_RUNTIME_BUSY",
        "The bounded raster runtime is already at its concurrency limit.",
        429,
        {
          retryAfterSeconds: config.retryAfterSeconds,
          details: snapshot(),
        },
      );
    }

    activeExecutions += 1;
    const controller = new AbortController();
    const startedAt = timer.now();
    let released = false;
    let timeoutReached = false;

    const forwardRequestAbort = (): void => {
      if (!controller.signal.aborted) controller.abort(requestSignal?.reason);
    };
    if (requestSignal?.aborted) forwardRequestAbort();
    else requestSignal?.addEventListener("abort", forwardRequestAbort, { once: true });

    const timeout = timer.setTimeout(() => {
      if (controller.signal.aborted) return;
      timeoutReached = true;
      controller.abort(new DOMException("The bounded raster runtime timed out.", "TimeoutError"));
    }, config.timeoutMs);
    (timeout as { unref?: () => void }).unref?.();

    function release(): void {
      if (released) return;
      released = true;
      timer.clearTimeout(timeout);
      requestSignal?.removeEventListener("abort", forwardRequestAbort);
      activeExecutions = Math.max(0, activeExecutions - 1);
    }

    return Object.freeze({
      signal: controller.signal,
      startedAt,
      timedOut: () => timeoutReached,
      release,
    });
  }

  return Object.freeze({ acquire, snapshot });
}
