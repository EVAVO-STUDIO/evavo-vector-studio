import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { TextDecoder } from "node:util";
import { VectorHubAuthError } from "./errors.js";

export const VECTOR_HUB_LAUNCH_VERSION = "evavo-client-app-launch-v1" as const;
export const VECTOR_HUB_LAUNCH_ISSUER = "evavo-client-hub" as const;
export const VECTOR_HUB_APPLICATION_KEY = "vector-studio" as const;
export const VECTOR_HUB_APPLICATION_LABEL = "EVAVO Vector Studio" as const;
export const VECTOR_HUB_TARGET_HOST = "vector.evavo.com.au" as const;
export const VECTOR_HUB_LAUNCH_TTL_SECONDS = 120;
export const VECTOR_HUB_LAUNCH_CLOCK_SKEW_SECONDS = 15;
export const VECTOR_HUB_LAUNCH_MAX_TOKEN_LENGTH = 8_192;
export const VECTOR_HUB_LAUNCH_MAX_REPLAY_TTL_SECONDS = 150;

const CLAIM_KEYS = Object.freeze([
  "applicationKey",
  "applicationLabel",
  "audience",
  "email",
  "expiresAt",
  "issuedAt",
  "issuer",
  "nonce",
  "organisationId",
  "organisationName",
  "subject",
  "targetHost",
  "version",
  "workspaceId",
  "workspaceName",
] as const);
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const SIGNATURE = /^[A-Za-z0-9_-]{43}$/;
const NONCE = /^[A-Za-z0-9_-]{16,96}$/;
const SCOPE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const WORKSPACE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CONTROL = /[\u0000-\u001f\u007f]/;
const STRICT_UTF8 = new TextDecoder("utf-8", { fatal: true });

export type VectorHubLaunchClaims = Readonly<{
  version: typeof VECTOR_HUB_LAUNCH_VERSION;
  issuer: typeof VECTOR_HUB_LAUNCH_ISSUER;
  audience: typeof VECTOR_HUB_TARGET_HOST;
  subject: string;
  email: string;
  organisationId: string;
  organisationName: string;
  workspaceId: string;
  workspaceName: string;
  applicationKey: typeof VECTOR_HUB_APPLICATION_KEY;
  applicationLabel: typeof VECTOR_HUB_APPLICATION_LABEL;
  targetHost: typeof VECTOR_HUB_TARGET_HOST;
  issuedAt: number;
  expiresAt: number;
  nonce: string;
}>;

export type VectorHubLaunchVerification =
  | Readonly<{
      ok: true;
      claims: VectorHubLaunchClaims;
      tokenSha256: string;
      replayKey: string;
      replayTtlSeconds: number;
    }>
  | Readonly<{ ok: false; reason: string }>;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function boundedText(value: unknown, maximum: number): value is string {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximum &&
    value === value.trim() &&
    !CONTROL.test(value);
}

function validEmail(value: unknown): value is string {
  return boundedText(value, 320) &&
    value === value.toLowerCase() &&
    value.includes("@") &&
    !/\s/.test(value);
}

function validEpoch(value: unknown): value is number {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value > 0 &&
    !Number.isNaN(new Date(value * 1_000).getTime());
}

function exactKeys(value: Record<string, unknown>): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === CLAIM_KEYS.length &&
    actual.every((key, index) => key === [...CLAIM_KEYS].sort()[index]);
}

function base64UrlEncode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function base64UrlDecode(value: string): string {
  const bytes = Buffer.from(value, "base64url");
  const decoded = STRICT_UTF8.decode(bytes);
  if (base64UrlEncode(decoded) !== value) {
    throw new Error("VECTOR_HUB_LAUNCH_BASE64_NON_CANONICAL");
  }
  return decoded;
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function safeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function assertVectorHubSecret(secret: string, label: string): void {
  if (
    typeof secret !== "string" ||
    secret.length < 32 ||
    secret.length > 512 ||
    secret !== secret.trim()
  ) {
    throw new VectorHubAuthError(
      "VECTOR_HUB_AUTH_CONFIGURATION_INVALID",
      `${label} must contain 32 to 512 characters with no surrounding whitespace.`,
      { details: { label } },
    );
  }
}

export function assertVectorHubSecretsSeparated(
  launchSecret: string,
  privateSessionSecret: string,
): void {
  assertVectorHubSecret(launchSecret, "EVAVO_CLIENT_APP_LAUNCH_SECRET");
  assertVectorHubSecret(privateSessionSecret, "EVAVO_VECTOR_PRIVATE_SIGNING_SECRET");
  if (safeEqual(launchSecret, privateSessionSecret)) {
    throw new VectorHubAuthError(
      "VECTOR_HUB_AUTH_CONFIGURATION_INVALID",
      "The hub handoff and Vector Studio private-session secrets must be different.",
      { details: { separation: "hub-handoff-vs-vector-private-session" } },
    );
  }
}

function parseClaims(value: unknown): VectorHubLaunchClaims | null {
  const source = record(value);
  if (!source || !exactKeys(source)) return null;
  if (
    source.version !== VECTOR_HUB_LAUNCH_VERSION ||
    source.issuer !== VECTOR_HUB_LAUNCH_ISSUER ||
    source.audience !== VECTOR_HUB_TARGET_HOST ||
    source.targetHost !== VECTOR_HUB_TARGET_HOST ||
    source.applicationKey !== VECTOR_HUB_APPLICATION_KEY ||
    source.applicationLabel !== VECTOR_HUB_APPLICATION_LABEL
  ) return null;
  if (
    !boundedText(source.subject, 128) ||
    !SCOPE_ID.test(source.subject) ||
    !validEmail(source.email) ||
    !boundedText(source.organisationId, 128) ||
    !SCOPE_ID.test(source.organisationId) ||
    !boundedText(source.organisationName, 160) ||
    !boundedText(source.workspaceId, 128) ||
    !WORKSPACE_ID.test(source.workspaceId) ||
    source.workspaceId !== source.workspaceId.toLowerCase() ||
    !boundedText(source.workspaceName, 160) ||
    !validEpoch(source.issuedAt) ||
    !validEpoch(source.expiresAt) ||
    source.expiresAt - source.issuedAt !== VECTOR_HUB_LAUNCH_TTL_SECONDS ||
    !boundedText(source.nonce, 96) ||
    !NONCE.test(source.nonce)
  ) return null;
  return Object.freeze({
    version: VECTOR_HUB_LAUNCH_VERSION,
    issuer: VECTOR_HUB_LAUNCH_ISSUER,
    audience: VECTOR_HUB_TARGET_HOST,
    subject: source.subject,
    email: source.email,
    organisationId: source.organisationId,
    organisationName: source.organisationName,
    workspaceId: source.workspaceId,
    workspaceName: source.workspaceName,
    applicationKey: VECTOR_HUB_APPLICATION_KEY,
    applicationLabel: VECTOR_HUB_APPLICATION_LABEL,
    targetHost: VECTOR_HUB_TARGET_HOST,
    issuedAt: source.issuedAt,
    expiresAt: source.expiresAt,
    nonce: source.nonce,
  });
}

export function vectorHubReplayTtlSeconds(
  claims: Pick<VectorHubLaunchClaims, "expiresAt">,
  now: number,
): number {
  if (!validEpoch(now)) {
    throw new VectorHubAuthError(
      "VECTOR_HUB_LAUNCH_TOKEN_INVALID",
      "The launch evaluation clock is invalid.",
    );
  }
  return Math.max(
    1,
    Math.min(
      VECTOR_HUB_LAUNCH_MAX_REPLAY_TTL_SECONDS,
      claims.expiresAt + VECTOR_HUB_LAUNCH_CLOCK_SKEW_SECONDS - now,
    ),
  );
}

export function verifyVectorHubLaunchToken(input: Readonly<{
  token: string;
  secret: string;
  now?: number;
}>): VectorHubLaunchVerification {
  try {
    assertVectorHubSecret(input.secret, "EVAVO_CLIENT_APP_LAUNCH_SECRET");
    const now = input.now ?? Math.floor(Date.now() / 1_000);
    if (!validEpoch(now)) return Object.freeze({ ok: false, reason: "VECTOR_HUB_LAUNCH_TIME_INVALID" });
    if (
      typeof input.token !== "string" ||
      input.token.length < 3 ||
      input.token.length > VECTOR_HUB_LAUNCH_MAX_TOKEN_LENGTH
    ) return Object.freeze({ ok: false, reason: "VECTOR_HUB_LAUNCH_TOKEN_SIZE_INVALID" });
    const parts = input.token.split(".");
    if (
      parts.length !== 2 ||
      !parts[0] ||
      !parts[1] ||
      !BASE64URL.test(parts[0]) ||
      !SIGNATURE.test(parts[1])
    ) return Object.freeze({ ok: false, reason: "VECTOR_HUB_LAUNCH_TOKEN_MALFORMED" });
    const [payload, signature] = parts;
    if (!safeEqual(sign(payload, input.secret), signature)) {
      return Object.freeze({ ok: false, reason: "VECTOR_HUB_LAUNCH_SIGNATURE_INVALID" });
    }
    const claims = parseClaims(JSON.parse(base64UrlDecode(payload)) as unknown);
    if (!claims) return Object.freeze({ ok: false, reason: "VECTOR_HUB_LAUNCH_CLAIMS_INVALID" });
    if (claims.issuedAt - VECTOR_HUB_LAUNCH_CLOCK_SKEW_SECONDS > now) {
      return Object.freeze({ ok: false, reason: "VECTOR_HUB_LAUNCH_NOT_YET_VALID" });
    }
    if (claims.expiresAt + VECTOR_HUB_LAUNCH_CLOCK_SKEW_SECONDS < now) {
      return Object.freeze({ ok: false, reason: "VECTOR_HUB_LAUNCH_EXPIRED" });
    }
    const tokenSha256 = sha256(input.token);
    return Object.freeze({
      ok: true,
      claims,
      tokenSha256,
      replayKey: `evavo:vector:hub-launch:${sha256(`evavo-vector-hub-launch-replay-v1\0${input.token}`)}`,
      replayTtlSeconds: vectorHubReplayTtlSeconds(claims, now),
    });
  } catch {
    return Object.freeze({ ok: false, reason: "VECTOR_HUB_LAUNCH_TOKEN_INVALID" });
  }
}

export function createVectorHubLaunchFixtureToken(input: Readonly<{
  secret: string;
  claims: VectorHubLaunchClaims;
}>): string {
  assertVectorHubSecret(input.secret, "EVAVO_CLIENT_APP_LAUNCH_SECRET");
  const claims = parseClaims(input.claims);
  if (!claims) {
    throw new VectorHubAuthError(
      "VECTOR_HUB_LAUNCH_TOKEN_INVALID",
      "Fixture claims do not satisfy the Vector Studio hub launch contract.",
    );
  }
  const payload = base64UrlEncode(JSON.stringify(claims));
  const token = `${payload}.${sign(payload, input.secret)}`;
  if (token.length > VECTOR_HUB_LAUNCH_MAX_TOKEN_LENGTH) {
    throw new VectorHubAuthError(
      "VECTOR_HUB_LAUNCH_TOKEN_INVALID",
      "The fixture launch token exceeds its byte limit.",
    );
  }
  return token;
}
