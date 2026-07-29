import { Buffer } from "node:buffer";
import { VectorHubAuthError } from "./errors.js";
import { VECTOR_HUB_LAUNCH_MAX_REPLAY_TTL_SECONDS } from "./launch.js";

export type VectorHubLaunchReplayResult = "consumed" | "replayed";

export type VectorHubLaunchReplayStore = Readonly<{
  mode: "memory" | "upstash-rest";
  durable: boolean;
  consume: (
    replayKey: string,
    ttlSeconds: number,
    options?: Readonly<{ signal?: AbortSignal }>,
  ) => Promise<VectorHubLaunchReplayResult>;
}>;

const REPLAY_KEY = /^evavo:vector:hub-launch:[a-f0-9]{64}$/;
const MAX_RESPONSE_BYTES = 8 * 1024;

function validateRequest(replayKey: string, ttlSeconds: number): void {
  if (!REPLAY_KEY.test(replayKey)) {
    throw new VectorHubAuthError(
      "VECTOR_HUB_LAUNCH_REPLAY_UNAVAILABLE",
      "The derived launch replay key is invalid.",
      { details: { replayKeyShape: "invalid" } },
    );
  }
  if (
    !Number.isSafeInteger(ttlSeconds) ||
    ttlSeconds < 1 ||
    ttlSeconds > VECTOR_HUB_LAUNCH_MAX_REPLAY_TTL_SECONDS
  ) {
    throw new VectorHubAuthError(
      "VECTOR_HUB_LAUNCH_REPLAY_UNAVAILABLE",
      "The launch replay TTL is outside the governed range.",
      {
        details: {
          ttlSeconds,
          maximum: VECTOR_HUB_LAUNCH_MAX_REPLAY_TTL_SECONDS,
        },
      },
    );
  }
}

export class MemoryVectorHubLaunchReplayStore
  implements VectorHubLaunchReplayStore {
  readonly mode = "memory" as const;
  readonly durable = false as const;
  readonly #entries = new Map<string, number>();

  async consume(
    replayKey: string,
    ttlSeconds: number,
    options: Readonly<{ signal?: AbortSignal }> = {},
  ): Promise<VectorHubLaunchReplayResult> {
    validateRequest(replayKey, ttlSeconds);
    if (options.signal?.aborted) {
      throw new VectorHubAuthError(
        "VECTOR_HUB_LAUNCH_REPLAY_UNAVAILABLE",
        "The launch replay request was cancelled.",
        { retryable: true },
      );
    }
    const now = Date.now();
    for (const [key, expiresAt] of this.#entries) {
      if (expiresAt <= now) this.#entries.delete(key);
    }
    if (this.#entries.has(replayKey)) return "replayed";
    this.#entries.set(replayKey, now + ttlSeconds * 1_000);
    return "consumed";
  }
}

function resolveUpstashUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch (cause) {
    throw new VectorHubAuthError(
      "VECTOR_HUB_AUTH_CONFIGURATION_INVALID",
      "UPSTASH_REDIS_REST_URL must be an absolute HTTPS URL.",
      { cause },
    );
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== "/" && url.pathname !== "") ||
    !(url.hostname === "upstash.io" || url.hostname.endsWith(".upstash.io"))
  ) {
    throw new VectorHubAuthError(
      "VECTOR_HUB_AUTH_CONFIGURATION_INVALID",
      "UPSTASH_REDIS_REST_URL must be a bare HTTPS Upstash Redis origin.",
    );
  }
  url.pathname = "/";
  return url;
}

function resolveToken(value: string): string {
  if (
    typeof value !== "string" ||
    value.length < 16 ||
    value.length > 4_096 ||
    value !== value.trim() ||
    /\s/.test(value)
  ) {
    throw new VectorHubAuthError(
      "VECTOR_HUB_AUTH_CONFIGURATION_INVALID",
      "UPSTASH_REDIS_REST_TOKEN must be a bounded server-only token.",
    );
  }
  return value;
}

function boundedInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  field: string,
): number {
  const resolved = value ?? fallback;
  if (
    !Number.isSafeInteger(resolved) ||
    resolved < minimum ||
    resolved > maximum
  ) {
    throw new VectorHubAuthError(
      "VECTOR_HUB_AUTH_CONFIGURATION_INVALID",
      `${field} must be an integer from ${minimum} to ${maximum}.`,
      { details: { field, value: resolved } },
    );
  }
  return resolved;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function createUpstashVectorHubLaunchReplayStore(input: Readonly<{
  url: string;
  token: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}>): VectorHubLaunchReplayStore {
  const url = resolveUpstashUrl(input.url);
  const token = resolveToken(input.token);
  const fetchImpl = input.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new VectorHubAuthError(
      "VECTOR_HUB_AUTH_CONFIGURATION_INVALID",
      "A Fetch-compatible transport is required for launch replay storage.",
    );
  }
  const timeoutMs = boundedInteger(input.timeoutMs, 5_000, 1_000, 15_000, "timeoutMs");

  return Object.freeze({
    mode: "upstash-rest" as const,
    durable: true,
    async consume(
      replayKey: string,
      ttlSeconds: number,
      options: Readonly<{ signal?: AbortSignal }> = {},
    ): Promise<VectorHubLaunchReplayResult> {
      validateRequest(replayKey, ttlSeconds);
      if (options.signal?.aborted) {
        throw new VectorHubAuthError(
          "VECTOR_HUB_LAUNCH_REPLAY_UNAVAILABLE",
          "The launch replay request was cancelled.",
          { retryable: true },
        );
      }
      const controller = new AbortController();
      let timedOut = false;
      const onAbort = () => controller.abort(options.signal?.reason);
      options.signal?.addEventListener("abort", onAbort, { once: true });
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort(new Error("vector-hub-replay-timeout"));
      }, timeoutMs);
      try {
        let response: Response;
        try {
          response = await fetchImpl(url, {
            method: "POST",
            headers: {
              accept: "application/json",
              authorization: `Bearer ${token}`,
              "content-type": "application/json",
            },
            body: JSON.stringify(["SET", replayKey, "1", "EX", ttlSeconds, "NX"]),
            cache: "no-store",
            redirect: "error",
            signal: controller.signal,
          });
        } catch (cause) {
          throw new VectorHubAuthError(
            "VECTOR_HUB_LAUNCH_REPLAY_UNAVAILABLE",
            timedOut
              ? "The launch replay store exceeded its timeout."
              : options.signal?.aborted
              ? "The launch replay request was cancelled."
              : "The launch replay store could not be reached.",
            {
              retryable: true,
              details: { timeoutMs },
              cause,
            },
          );
        }
        const declaredLength = Number(response.headers.get("content-length") ?? 0);
        if (
          Number.isFinite(declaredLength) &&
          declaredLength > MAX_RESPONSE_BYTES
        ) {
          throw new VectorHubAuthError(
            "VECTOR_HUB_LAUNCH_REPLAY_UNAVAILABLE",
            "The launch replay store returned an oversized response.",
            { retryable: true, details: { declaredLength } },
          );
        }
        const text = await response.text();
        if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) {
          throw new VectorHubAuthError(
            "VECTOR_HUB_LAUNCH_REPLAY_UNAVAILABLE",
            "The launch replay store returned an oversized response.",
            { retryable: true },
          );
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(text) as unknown;
        } catch (cause) {
          throw new VectorHubAuthError(
            "VECTOR_HUB_LAUNCH_REPLAY_UNAVAILABLE",
            "The launch replay store returned invalid JSON.",
            { retryable: true, cause },
          );
        }
        const payload = record(parsed);
        if (!response.ok || !payload || Object.keys(payload).some((key) => key !== "result" && key !== "error")) {
          throw new VectorHubAuthError(
            "VECTOR_HUB_LAUNCH_REPLAY_UNAVAILABLE",
            "The launch replay store rejected the atomic consume request.",
            {
              retryable: response.status === 429 || response.status >= 500,
              details: { status: response.status },
            },
          );
        }
        if (payload.result === "OK") return "consumed";
        if (payload.result === null) return "replayed";
        throw new VectorHubAuthError(
          "VECTOR_HUB_LAUNCH_REPLAY_UNAVAILABLE",
          "The launch replay store returned an unexpected result.",
          { retryable: true },
        );
      } finally {
        clearTimeout(timer);
        options.signal?.removeEventListener("abort", onAbort);
      }
    },
  });
}
