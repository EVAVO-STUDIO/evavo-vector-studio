export const VECTOR_DEPLOYMENT_PROFILE_VERSION = "1.0";

export const VERCEL_FUNCTION_BODY_LIMIT_BYTES = 4_500_000;
export const VERCEL_SAFE_REQUEST_BYTES = 4_000_000;
export const VERCEL_SAFE_RESPONSE_BYTES = 4_000_000;
export const VERCEL_SAFE_MULTIPART_FILE_BYTES = 3_250_000;
export const VERCEL_SAFE_BASE64_BINARY_BYTES = 2_750_000;
export const LOCAL_INTERACTIVE_RESPONSE_BYTES = 64 * 1024 * 1024;

export type VectorHostingProfile = "local" | "vercel";

export type VectorInteractivePayloadPolicy = Readonly<{
  version: typeof VECTOR_DEPLOYMENT_PROFILE_VERSION;
  hostingProfile: VectorHostingProfile;
  provider: "local-node" | "vercel-functions";
  providerBodyLimitBytes: number | null;
  maxFileBytes: number;
  maxRequestBytes: number;
  maxResponseBytes: number;
  maxBase64BinaryBytes: number;
  providerDirectPrivateStorageConfigured: false;
  largeObjectTransports: readonly [
    "local-cli",
    "local-mcp",
    "self-hosted-worker",
    "provider-direct-private-storage-pending",
  ];
}>;

function isVercelRuntime(environment: NodeJS.ProcessEnv): boolean {
  return environment.VERCEL === "1" || environment.VERCEL_ENV !== undefined;
}

export function resolveVectorInteractivePayloadPolicy({
  environment = process.env,
  localMaxFileBytes,
  localMaxRequestBytes,
  localMaxResponseBytes = LOCAL_INTERACTIVE_RESPONSE_BYTES,
}: Readonly<{
  environment?: NodeJS.ProcessEnv;
  localMaxFileBytes: number;
  localMaxRequestBytes: number;
  localMaxResponseBytes?: number;
}>): VectorInteractivePayloadPolicy {
  if (
    !Number.isSafeInteger(localMaxFileBytes) ||
    localMaxFileBytes <= 0 ||
    !Number.isSafeInteger(localMaxRequestBytes) ||
    localMaxRequestBytes < localMaxFileBytes ||
    !Number.isSafeInteger(localMaxResponseBytes) ||
    localMaxResponseBytes <= 0
  ) {
    throw new Error("VECTOR_DEPLOYMENT_PAYLOAD_POLICY_INVALID");
  }

  const vercel = isVercelRuntime(environment);
  return Object.freeze({
    version: VECTOR_DEPLOYMENT_PROFILE_VERSION,
    hostingProfile: vercel ? "vercel" : "local",
    provider: vercel ? "vercel-functions" : "local-node",
    providerBodyLimitBytes: vercel ? VERCEL_FUNCTION_BODY_LIMIT_BYTES : null,
    maxFileBytes: vercel
      ? Math.min(localMaxFileBytes, VERCEL_SAFE_MULTIPART_FILE_BYTES)
      : localMaxFileBytes,
    maxRequestBytes: vercel
      ? Math.min(localMaxRequestBytes, VERCEL_SAFE_REQUEST_BYTES)
      : localMaxRequestBytes,
    maxResponseBytes: vercel
      ? Math.min(localMaxResponseBytes, VERCEL_SAFE_RESPONSE_BYTES)
      : localMaxResponseBytes,
    maxBase64BinaryBytes: vercel
      ? VERCEL_SAFE_BASE64_BINARY_BYTES
      : Math.min(localMaxResponseBytes, Math.floor(localMaxResponseBytes * 0.72)),
    providerDirectPrivateStorageConfigured: false,
    largeObjectTransports: Object.freeze([
      "local-cli",
      "local-mcp",
      "self-hosted-worker",
      "provider-direct-private-storage-pending",
    ] as const),
  });
}

export function encodedTextBytes(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

export function encodedJsonBytes(value: unknown): number {
  return encodedTextBytes(JSON.stringify(value));
}

export function vectorDeploymentPublicView(
  environment: NodeJS.ProcessEnv = process.env,
): Readonly<{
  profileVersion: typeof VECTOR_DEPLOYMENT_PROFILE_VERSION;
  hostingProfile: VectorHostingProfile;
  provider: "local-node" | "vercel-functions";
  providerBodyLimitBytes: number | null;
  synchronousRequestBytes: number;
  synchronousResponseBytes: number;
  synchronousMultipartFileBytes: number;
  synchronousBase64BinaryBytes: number;
  providerDirectPrivateStorageConfigured: false;
  largeObjectTransports: readonly string[];
}> {
  const policy = resolveVectorInteractivePayloadPolicy({
    environment,
    localMaxFileBytes: 25 * 1024 * 1024,
    localMaxRequestBytes: 26 * 1024 * 1024,
  });
  return Object.freeze({
    profileVersion: policy.version,
    hostingProfile: policy.hostingProfile,
    provider: policy.provider,
    providerBodyLimitBytes: policy.providerBodyLimitBytes,
    synchronousRequestBytes: policy.maxRequestBytes,
    synchronousResponseBytes: policy.maxResponseBytes,
    synchronousMultipartFileBytes: policy.maxFileBytes,
    synchronousBase64BinaryBytes: policy.maxBase64BinaryBytes,
    providerDirectPrivateStorageConfigured:
      policy.providerDirectPrivateStorageConfigured,
    largeObjectTransports: policy.largeObjectTransports,
  });
}
