import { createHmac, timingSafeEqual } from "node:crypto";
import { TextDecoder } from "node:util";
import {
  VECTOR_HUB_APPLICATION_KEY,
  VECTOR_HUB_APPLICATION_LABEL,
  VECTOR_HUB_TARGET_HOST,
  assertVectorHubSecret,
  type VectorHubLaunchClaims,
} from "./launch.js";
import { VectorHubAuthError } from "./errors.js";

export const VECTOR_WORKSPACE_SESSION_VERSION = "evavo-vector-session-v1" as const;
export const VECTOR_WORKSPACE_SESSION_ISSUER = "evavo-vector-studio" as const;
export const VECTOR_WORKSPACE_SESSION_TTL_SECONDS = 8 * 60 * 60;
export const VECTOR_WORKSPACE_SESSION_CLOCK_SKEW_SECONDS = 15;
export const VECTOR_WORKSPACE_SESSION_MAX_TOKEN_LENGTH = 8_192;

const SESSION_DOMAIN = "evavo-vector-session";
const SESSION_KEYS = Object.freeze([
  "actorType",
  "applicationKey",
  "applicationLabel",
  "audience",
  "email",
  "expiresAt",
  "issuedAt",
  "issuer",
  "organisationId",
  "organisationName",
  "sessionId",
  "subject",
  "version",
  "workspaceId",
  "workspaceName",
] as const);
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const SIGNATURE = /^[A-Za-z0-9_-]{43}$/;
const SESSION_ID = /^[A-Za-z0-9_-]{24,96}$/;
const SCOPE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const WORKSPACE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CONTROL = /[\u0000-\u001f\u007f]/;
const STRICT_UTF8 = new TextDecoder("utf-8", { fatal: true });

export type VectorWorkspaceSessionClaims = Readonly<{
  version: typeof VECTOR_WORKSPACE_SESSION_VERSION;
  issuer: typeof VECTOR_WORKSPACE_SESSION_ISSUER;
  audience: typeof VECTOR_HUB_TARGET_HOST;
  actorType: "client";
  subject: string;
  email: string;
  organisationId: string;
  organisationName: string;
  workspaceId: string;
  workspaceName: string;
  applicationKey: typeof VECTOR_HUB_APPLICATION_KEY;
  applicationLabel: typeof VECTOR_HUB_APPLICATION_LABEL;
  sessionId: string;
  issuedAt: number;
  expiresAt: number;
}>;

export type VectorWorkspaceSessionVerification =
  | Readonly<{ ok: true; claims: VectorWorkspaceSessionClaims }>
  | Readonly<{ ok: false; reason: string }>;

export type VectorWorkspaceContext = Readonly<{
  actorType: "client" | "local-development";
  subject: string;
  email: string;
  organisation: Readonly<{ id: string; name: string }>;
  workspace: Readonly<{ id: string; name: string }>;
  application: Readonly<{
    key: typeof VECTOR_HUB_APPLICATION_KEY;
    label: typeof VECTOR_HUB_APPLICATION_LABEL;
  }>;
  expiresAt: string | null;
}>;

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

function validEpoch(value: unknown): value is number {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value > 0 &&
    !Number.isNaN(new Date(value * 1_000).getTime());
}

function exactKeys(value: Record<string, unknown>): boolean {
  const expected = [...SESSION_KEYS].sort();
  const actual = Object.keys(value).sort();
  return actual.length === expected.length &&
    actual.every((key, index) => key === expected[index]);
}

function encode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decode(value: string): string {
  const decoded = STRICT_UTF8.decode(Buffer.from(value, "base64url"));
  if (encode(decoded) !== value) throw new Error("VECTOR_WORKSPACE_SESSION_BASE64_NON_CANONICAL");
  return decoded;
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret)
    .update(`${SESSION_DOMAIN}.${payload}`)
    .digest("base64url");
}

function safeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function parseClaims(value: unknown): VectorWorkspaceSessionClaims | null {
  const source = record(value);
  if (!source || !exactKeys(source)) return null;
  if (
    source.version !== VECTOR_WORKSPACE_SESSION_VERSION ||
    source.issuer !== VECTOR_WORKSPACE_SESSION_ISSUER ||
    source.audience !== VECTOR_HUB_TARGET_HOST ||
    source.actorType !== "client" ||
    source.applicationKey !== VECTOR_HUB_APPLICATION_KEY ||
    source.applicationLabel !== VECTOR_HUB_APPLICATION_LABEL
  ) return null;
  if (
    !boundedText(source.subject, 128) ||
    !SCOPE_ID.test(source.subject) ||
    !boundedText(source.email, 320) ||
    source.email !== source.email.toLowerCase() ||
    !source.email.includes("@") ||
    /\s/.test(source.email) ||
    !boundedText(source.organisationId, 128) ||
    !SCOPE_ID.test(source.organisationId) ||
    !boundedText(source.organisationName, 160) ||
    !boundedText(source.workspaceId, 128) ||
    !WORKSPACE_ID.test(source.workspaceId) ||
    source.workspaceId !== source.workspaceId.toLowerCase() ||
    !boundedText(source.workspaceName, 160) ||
    !boundedText(source.sessionId, 96) ||
    !SESSION_ID.test(source.sessionId) ||
    !validEpoch(source.issuedAt) ||
    !validEpoch(source.expiresAt) ||
    source.expiresAt - source.issuedAt !== VECTOR_WORKSPACE_SESSION_TTL_SECONDS
  ) return null;
  return Object.freeze({
    version: VECTOR_WORKSPACE_SESSION_VERSION,
    issuer: VECTOR_WORKSPACE_SESSION_ISSUER,
    audience: VECTOR_HUB_TARGET_HOST,
    actorType: "client" as const,
    subject: source.subject,
    email: source.email,
    organisationId: source.organisationId,
    organisationName: source.organisationName,
    workspaceId: source.workspaceId,
    workspaceName: source.workspaceName,
    applicationKey: VECTOR_HUB_APPLICATION_KEY,
    applicationLabel: VECTOR_HUB_APPLICATION_LABEL,
    sessionId: source.sessionId,
    issuedAt: source.issuedAt,
    expiresAt: source.expiresAt,
  });
}

export function createVectorWorkspaceSessionToken(input: Readonly<{
  secret: string;
  launchClaims: VectorHubLaunchClaims;
  sessionId: string;
  now?: number;
}>): Readonly<{ token: string; claims: VectorWorkspaceSessionClaims }> {
  assertVectorHubSecret(input.secret, "EVAVO_VECTOR_PRIVATE_SIGNING_SECRET");
  if (!SESSION_ID.test(input.sessionId)) {
    throw new VectorHubAuthError(
      "VECTOR_HUB_SESSION_INVALID",
      "The Vector Studio session identifier is invalid.",
    );
  }
  const now = input.now ?? Math.floor(Date.now() / 1_000);
  if (!validEpoch(now)) {
    throw new VectorHubAuthError(
      "VECTOR_HUB_SESSION_INVALID",
      "The Vector Studio session issuance clock is invalid.",
    );
  }
  const claims: VectorWorkspaceSessionClaims = Object.freeze({
    version: VECTOR_WORKSPACE_SESSION_VERSION,
    issuer: VECTOR_WORKSPACE_SESSION_ISSUER,
    audience: VECTOR_HUB_TARGET_HOST,
    actorType: "client",
    subject: input.launchClaims.subject,
    email: input.launchClaims.email,
    organisationId: input.launchClaims.organisationId,
    organisationName: input.launchClaims.organisationName,
    workspaceId: input.launchClaims.workspaceId,
    workspaceName: input.launchClaims.workspaceName,
    applicationKey: VECTOR_HUB_APPLICATION_KEY,
    applicationLabel: VECTOR_HUB_APPLICATION_LABEL,
    sessionId: input.sessionId,
    issuedAt: now,
    expiresAt: now + VECTOR_WORKSPACE_SESSION_TTL_SECONDS,
  });
  if (!parseClaims(claims)) {
    throw new VectorHubAuthError(
      "VECTOR_HUB_SESSION_INVALID",
      "The launch claims cannot be converted into a Vector Studio session.",
    );
  }
  const payload = encode(JSON.stringify(claims));
  const token = `${payload}.${sign(payload, input.secret)}`;
  if (token.length > VECTOR_WORKSPACE_SESSION_MAX_TOKEN_LENGTH) {
    throw new VectorHubAuthError(
      "VECTOR_HUB_SESSION_INVALID",
      "The Vector Studio session token exceeds its byte limit.",
    );
  }
  return Object.freeze({ token, claims });
}

export function verifyVectorWorkspaceSessionToken(input: Readonly<{
  token: string;
  secret: string;
  now?: number;
}>): VectorWorkspaceSessionVerification {
  try {
    assertVectorHubSecret(input.secret, "EVAVO_VECTOR_PRIVATE_SIGNING_SECRET");
    const now = input.now ?? Math.floor(Date.now() / 1_000);
    if (!validEpoch(now)) return Object.freeze({ ok: false, reason: "VECTOR_HUB_SESSION_TIME_INVALID" });
    if (
      typeof input.token !== "string" ||
      input.token.length < 3 ||
      input.token.length > VECTOR_WORKSPACE_SESSION_MAX_TOKEN_LENGTH
    ) return Object.freeze({ ok: false, reason: "VECTOR_HUB_SESSION_SIZE_INVALID" });
    const parts = input.token.split(".");
    if (
      parts.length !== 2 ||
      !parts[0] ||
      !parts[1] ||
      !BASE64URL.test(parts[0]) ||
      !SIGNATURE.test(parts[1])
    ) return Object.freeze({ ok: false, reason: "VECTOR_HUB_SESSION_MALFORMED" });
    const [payload, signature] = parts;
    if (!safeEqual(sign(payload, input.secret), signature)) {
      return Object.freeze({ ok: false, reason: "VECTOR_HUB_SESSION_SIGNATURE_INVALID" });
    }
    const claims = parseClaims(JSON.parse(decode(payload)) as unknown);
    if (!claims) return Object.freeze({ ok: false, reason: "VECTOR_HUB_SESSION_CLAIMS_INVALID" });
    if (claims.issuedAt - VECTOR_WORKSPACE_SESSION_CLOCK_SKEW_SECONDS > now) {
      return Object.freeze({ ok: false, reason: "VECTOR_HUB_SESSION_NOT_YET_VALID" });
    }
    if (claims.expiresAt + VECTOR_WORKSPACE_SESSION_CLOCK_SKEW_SECONDS < now) {
      return Object.freeze({ ok: false, reason: "VECTOR_HUB_SESSION_EXPIRED" });
    }
    return Object.freeze({ ok: true, claims });
  } catch {
    return Object.freeze({ ok: false, reason: "VECTOR_HUB_SESSION_INVALID" });
  }
}

export function vectorWorkspaceContextFromClaims(
  claims: VectorWorkspaceSessionClaims,
): VectorWorkspaceContext {
  return Object.freeze({
    actorType: "client",
    subject: claims.subject,
    email: claims.email,
    organisation: Object.freeze({
      id: claims.organisationId,
      name: claims.organisationName,
    }),
    workspace: Object.freeze({
      id: claims.workspaceId,
      name: claims.workspaceName,
    }),
    application: Object.freeze({
      key: VECTOR_HUB_APPLICATION_KEY,
      label: VECTOR_HUB_APPLICATION_LABEL,
    }),
    expiresAt: new Date(claims.expiresAt * 1_000).toISOString(),
  });
}

export function localVectorWorkspaceContext(): VectorWorkspaceContext {
  return Object.freeze({
    actorType: "local-development",
    subject: "local-development",
    email: "local@evavo.invalid",
    organisation: Object.freeze({ id: "local", name: "EVAVO Studio" }),
    workspace: Object.freeze({ id: "local", name: "Local Vector Workspace" }),
    application: Object.freeze({
      key: VECTOR_HUB_APPLICATION_KEY,
      label: VECTOR_HUB_APPLICATION_LABEL,
    }),
    expiresAt: null,
  });
}
