export const VECTOR_RUNTIME_READINESS_CONTRACT_VERSION = "1.0" as const;
export const VECTOR_RUNTIME_CANONICAL_ORIGIN = "https://vector.evavo.com.au" as const;
export const VECTOR_RUNTIME_AUTHORITY_KEYS = Object.freeze([
  "EVAVO_CLIENT_APP_LAUNCH_SECRET",
  "EVAVO_VECTOR_PRIVATE_SIGNING_SECRET",
  "VECTOR_API_TOKEN",
  "VECTOR_WORKER_API_TOKEN",
] as const);

function environmentValue(
  environment: NodeJS.ProcessEnv,
  key: string,
): string {
  return String(environment[key] ?? "").trim();
}

function credentialReady(value: string, minimumLength = 32): boolean {
  return value.length >= minimumLength && !/\s/.test(value);
}

function exactTrue(value: string): boolean {
  return value.toLowerCase() === "true";
}

function validHttpsEndpoint(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash;
  } catch {
    return false;
  }
}

function normalisedMode(
  value: string,
  supported: readonly string[],
): string {
  const mode = value.toLowerCase() || "disabled";
  return supported.includes(mode) ? mode : "unsupported";
}

function separatedAuthorities(values: readonly string[]): boolean {
  return values.every((value) => credentialReady(value)) &&
    new Set(values).size === values.length;
}

export function vectorRuntimeReadinessPublicView(
  environment: NodeJS.ProcessEnv = process.env,
) {
  const vercelRuntime = environmentValue(environment, "VERCEL") === "1";
  const productionRuntime =
    environmentValue(environment, "NODE_ENV") === "production" &&
    vercelRuntime &&
    environmentValue(environment, "VERCEL_ENV") === "production";
  const canonicalOrigin =
    environmentValue(environment, "VECTOR_PUBLIC_ORIGIN") ===
    VECTOR_RUNTIME_CANONICAL_ORIGIN;

  const launchSecret = environmentValue(
    environment,
    "EVAVO_CLIENT_APP_LAUNCH_SECRET",
  );
  const privateSigningSecret = environmentValue(
    environment,
    "EVAVO_VECTOR_PRIVATE_SIGNING_SECRET",
  );
  const apiToken = environmentValue(environment, "VECTOR_API_TOKEN");
  const workerToken = environmentValue(
    environment,
    "VECTOR_WORKER_API_TOKEN",
  );
  const authorityValues = Object.freeze([
    launchSecret,
    privateSigningSecret,
    apiToken,
    workerToken,
  ]);

  const signedLaunchAuthorities =
    credentialReady(launchSecret) && credentialReady(privateSigningSecret);
  const apiAuthority = credentialReady(apiToken);
  const workerAuthority = credentialReady(workerToken);
  const authoritySeparation = separatedAuthorities(authorityValues);

  const replayMode = normalisedMode(
    environmentValue(environment, "VECTOR_HUB_REPLAY_MODE"),
    ["disabled", "memory", "upstash"],
  );
  const replayEndpoint = environmentValue(
    environment,
    "UPSTASH_REDIS_REST_URL",
  );
  const replayToken = environmentValue(
    environment,
    "UPSTASH_REDIS_REST_TOKEN",
  );
  const durableReplay = replayMode === "upstash" &&
    validHttpsEndpoint(replayEndpoint) &&
    credentialReady(replayToken);

  const interactiveChecks = Object.freeze({
    productionRuntime,
    canonicalOrigin,
    signedLaunchAuthorities,
    authoritySeparation,
    durableReplay,
    apiAuthority,
    workerAuthority,
  });
  const interactiveReady = Object.values(interactiveChecks).every(Boolean);

  const jobStoreMode = normalisedMode(
    environmentValue(environment, "VECTOR_JOB_STORE_MODE"),
    ["disabled", "file"],
  );
  const objectStoreMode = normalisedMode(
    environmentValue(environment, "VECTOR_OBJECT_STORE_MODE"),
    ["disabled", "file"],
  );
  const persistentJobRecords =
    jobStoreMode === "file" &&
    exactTrue(environmentValue(environment, "VECTOR_JOB_FILE_STORE_PERSISTENT")) &&
    !vercelRuntime;
  const persistentObjectTransfer =
    objectStoreMode === "file" &&
    exactTrue(
      environmentValue(environment, "VECTOR_OBJECT_FILE_STORE_PERSISTENT"),
    ) &&
    !vercelRuntime;
  const httpWorkerControl =
    workerAuthority && persistentJobRecords && persistentObjectTransfer;
  const automationChecks = Object.freeze({
    persistentJobRecords,
    persistentObjectTransfer,
    httpWorkerControl,
    providerQueueDelivery: false,
    managedRemoteExecution: false,
    distributedAutoscaling: false,
  });
  const automationReady =
    interactiveReady &&
    persistentJobRecords &&
    persistentObjectTransfer &&
    httpWorkerControl;

  const nextActionCodes: string[] = [];
  if (!productionRuntime) nextActionCodes.push("DEPLOY_CANONICAL_PRODUCTION_RUNTIME");
  if (!canonicalOrigin) nextActionCodes.push("CONFIGURE_CANONICAL_ORIGIN");
  if (!signedLaunchAuthorities || !apiAuthority || !workerAuthority) {
    nextActionCodes.push("CONFIGURE_RUNTIME_AUTHORITIES");
  }
  if (!authoritySeparation) nextActionCodes.push("SEPARATE_RUNTIME_AUTHORITIES");
  if (!durableReplay) nextActionCodes.push("CONFIGURE_DURABLE_REPLAY");
  if (!persistentJobRecords) nextActionCodes.push("CONFIGURE_PERSISTENT_JOB_RECORDS");
  if (!persistentObjectTransfer) {
    nextActionCodes.push("CONFIGURE_PERSISTENT_OBJECT_TRANSFER");
  }
  if (!httpWorkerControl) nextActionCodes.push("DEPLOY_HTTP_WORKER_CONTROL");
  nextActionCodes.push("RUN_LIVE_RELEASE_PROOFS");
  nextActionCodes.push("PROMOTE_FROM_CENTRAL_HUB");

  return Object.freeze({
    contractVersion: VECTOR_RUNTIME_READINESS_CONTRACT_VERSION,
    service: "evavo-vector-studio",
    canonicalOrigin: VECTOR_RUNTIME_CANONICAL_ORIGIN,
    interactive: Object.freeze({
      ready: interactiveReady,
      checks: interactiveChecks,
    }),
    automation: Object.freeze({
      ready: automationReady,
      storeModes: Object.freeze({
        jobRecords: jobStoreMode,
        objectTransfer: objectStoreMode,
        replay: replayMode,
      }),
      checks: automationChecks,
    }),
    release: Object.freeze({
      clientReleaseEligible: false,
      sourceProofRequired: true,
      publicRuntimeProofRequired: true,
      ownerLaunchProofRequired: true,
      clientLaunchProofRequired: true,
      replayRejectionProofRequired: true,
      centralHumanPromotionRequired: true,
    }),
    nextActionCodes: Object.freeze(nextActionCodes),
    sensitiveValuesIncluded: false,
    approval: "human-review-required",
  });
}
