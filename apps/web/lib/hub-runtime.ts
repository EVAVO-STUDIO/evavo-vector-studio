import {
  MemoryVectorHubLaunchReplayStore,
  VECTOR_HUB_TARGET_HOST,
  VectorHubAuthError,
  assertVectorHubSecretsSeparated,
  createUpstashVectorHubLaunchReplayStore,
  type VectorHubLaunchReplayStore,
} from "@evavo/hub-auth";

export type VectorHubReplayMode = "disabled" | "memory" | "upstash";

export type VectorHubAuthRuntime = Readonly<{
  available: boolean;
  production: boolean;
  publicOrigin: string;
  targetHost: typeof VECTOR_HUB_TARGET_HOST;
  replayMode: VectorHubReplayMode;
  replayDurable: boolean;
  launchSecret: string | null;
  privateSessionSecret: string | null;
  replayStore: VectorHubLaunchReplayStore | null;
  reason: string | null;
}>;

const globalRuntime = globalThis as typeof globalThis & {
  __evavoVectorHubMemoryReplayStore?: MemoryVectorHubLaunchReplayStore;
};

function publicOrigin(production: boolean): string {
  const configured = process.env.VECTOR_PUBLIC_ORIGIN;
  const value = configured === undefined
    ? production
      ? ""
      : "http://localhost:3000"
    : configured;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new VectorHubAuthError(
      "VECTOR_HUB_AUTH_CONFIGURATION_INVALID",
      "VECTOR_PUBLIC_ORIGIN must be an absolute origin.",
    );
  }
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== "/" && url.pathname !== "")
  ) {
    throw new VectorHubAuthError(
      "VECTOR_HUB_AUTH_CONFIGURATION_INVALID",
      "VECTOR_PUBLIC_ORIGIN must not contain credentials, paths, query parameters or fragments.",
    );
  }
  if (production) {
    if (url.protocol !== "https:" || url.hostname !== VECTOR_HUB_TARGET_HOST || url.port) {
      throw new VectorHubAuthError(
        "VECTOR_HUB_AUTH_CONFIGURATION_INVALID",
        `Production VECTOR_PUBLIC_ORIGIN must equal https://${VECTOR_HUB_TARGET_HOST}.`,
      );
    }
  } else if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new VectorHubAuthError(
      "VECTOR_HUB_AUTH_CONFIGURATION_INVALID",
      "Development VECTOR_PUBLIC_ORIGIN must use HTTP or HTTPS.",
    );
  }
  return url.origin;
}

function replayMode(production: boolean): VectorHubReplayMode {
  const value = process.env.VECTOR_HUB_REPLAY_MODE?.trim().toLowerCase();
  if (!value) return production ? "disabled" : "memory";
  if (value === "disabled" || value === "memory" || value === "upstash") {
    return value;
  }
  throw new VectorHubAuthError(
    "VECTOR_HUB_AUTH_CONFIGURATION_INVALID",
    "VECTOR_HUB_REPLAY_MODE must be disabled, memory or upstash.",
  );
}

function memoryReplayStore(): MemoryVectorHubLaunchReplayStore {
  globalRuntime.__evavoVectorHubMemoryReplayStore ??=
    new MemoryVectorHubLaunchReplayStore();
  return globalRuntime.__evavoVectorHubMemoryReplayStore;
}

export function getVectorHubAuthRuntime(): VectorHubAuthRuntime {
  const production = process.env.NODE_ENV === "production";
  let origin = production
    ? `https://${VECTOR_HUB_TARGET_HOST}`
    : "http://localhost:3000";
  let mode: VectorHubReplayMode = production ? "disabled" : "memory";
  try {
    origin = publicOrigin(production);
    mode = replayMode(production);
    const launchSecret = process.env.EVAVO_CLIENT_APP_LAUNCH_SECRET ?? "";
    const privateSessionSecret = process.env.EVAVO_VECTOR_PRIVATE_SIGNING_SECRET ?? "";
    assertVectorHubSecretsSeparated(launchSecret, privateSessionSecret);
    if (mode === "disabled") {
      return Object.freeze({
        available: false,
        production,
        publicOrigin: origin,
        targetHost: VECTOR_HUB_TARGET_HOST,
        replayMode: mode,
        replayDurable: false,
        launchSecret: null,
        privateSessionSecret: null,
        replayStore: null,
        reason: "Durable one-time launch replay storage is disabled.",
      });
    }
    if (production && mode === "memory") {
      throw new VectorHubAuthError(
        "VECTOR_HUB_AUTH_CONFIGURATION_INVALID",
        "In-memory launch replay storage is forbidden in production.",
      );
    }
    const replayStore = mode === "memory"
      ? memoryReplayStore()
      : createUpstashVectorHubLaunchReplayStore({
          url: process.env.UPSTASH_REDIS_REST_URL ?? "",
          token: process.env.UPSTASH_REDIS_REST_TOKEN ?? "",
        });
    return Object.freeze({
      available: true,
      production,
      publicOrigin: origin,
      targetHost: VECTOR_HUB_TARGET_HOST,
      replayMode: mode,
      replayDurable: replayStore.durable,
      launchSecret,
      privateSessionSecret,
      replayStore,
      reason: null,
    });
  } catch {
    return Object.freeze({
      available: false,
      production,
      publicOrigin: origin,
      targetHost: VECTOR_HUB_TARGET_HOST,
      replayMode: mode,
      replayDurable: false,
      launchSecret: null,
      privateSessionSecret: null,
      replayStore: null,
      reason: "Vector Studio signed launch is not safely configured.",
    });
  }
}

export function requireVectorHubAuthRuntime(): Readonly<{
  production: boolean;
  publicOrigin: string;
  launchSecret: string;
  privateSessionSecret: string;
  replayStore: VectorHubLaunchReplayStore;
}> {
  const runtime = getVectorHubAuthRuntime();
  if (
    !runtime.available ||
    !runtime.launchSecret ||
    !runtime.privateSessionSecret ||
    !runtime.replayStore
  ) {
    throw new VectorHubAuthError(
      "VECTOR_HUB_AUTH_CONFIGURATION_INVALID",
      runtime.reason ?? "Vector Studio signed launch is unavailable.",
      { retryable: true },
    );
  }
  return Object.freeze({
    production: runtime.production,
    publicOrigin: runtime.publicOrigin,
    launchSecret: runtime.launchSecret,
    privateSessionSecret: runtime.privateSessionSecret,
    replayStore: runtime.replayStore,
  });
}

export function vectorHubRuntimePublicView(): Readonly<Record<string, unknown>> {
  const runtime = getVectorHubAuthRuntime();
  return Object.freeze({
    contractVersion: "1.0",
    applicationKey: "vector-studio",
    targetHost: runtime.targetHost,
    signedLaunchReceiverAvailable: runtime.available,
    appPrivateSessionAvailable: runtime.available,
    oneTimeReplayAvailable: runtime.available,
    replayMode: runtime.replayMode,
    replayDurable: runtime.replayDurable,
    production: runtime.production,
    secretsReturned: false,
    reason: runtime.reason,
  });
}

export function resetVectorHubRuntimeForTests(): void {
  delete globalRuntime.__evavoVectorHubMemoryReplayStore;
}
