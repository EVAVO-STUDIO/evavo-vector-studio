import {
  VECTOR_WORKSPACE_SESSION_TTL_SECONDS,
  localVectorWorkspaceContext,
  vectorWorkspaceContextFromClaims,
  verifyVectorWorkspaceSessionToken,
  type VectorWorkspaceContext,
} from "@evavo/hub-auth";
import { getVectorHubAuthRuntime } from "./hub-runtime";

export const VECTOR_WORKSPACE_SESSION_COOKIE = "__Host-evavo-vector-session";
export const VECTOR_WORKSPACE_SESSION_COOKIE_DEVELOPMENT = "evavo-vector-session";

function parseCookies(header: string): ReadonlyMap<string, string> {
  const values = new Map<string, string>();
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 1) continue;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (!name || values.has(name)) continue;
    try {
      values.set(name, decodeURIComponent(value));
    } catch {
      continue;
    }
  }
  return values;
}

export function vectorWorkspaceSessionCookieName(production: boolean): string {
  return production
    ? VECTOR_WORKSPACE_SESSION_COOKIE
    : VECTOR_WORKSPACE_SESSION_COOKIE_DEVELOPMENT;
}

export function vectorWorkspaceSessionCookieHeader(input: Readonly<{
  token: string;
  production: boolean;
}>): string {
  const name = vectorWorkspaceSessionCookieName(input.production);
  const attributes = [
    `${name}=${encodeURIComponent(input.token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${VECTOR_WORKSPACE_SESSION_TTL_SECONDS}`,
  ];
  if (input.production) attributes.push("Secure");
  return attributes.join("; ");
}

export function clearVectorWorkspaceSessionCookieHeader(
  production: boolean,
): string {
  const name = vectorWorkspaceSessionCookieName(production);
  const attributes = [
    `${name}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
  ];
  if (production) attributes.push("Secure");
  return attributes.join("; ");
}

export function vectorWorkspaceContextFromToken(
  token: string | null | undefined,
): VectorWorkspaceContext | null {
  if (!token) return null;
  const runtime = getVectorHubAuthRuntime();
  if (!runtime.privateSessionSecret) return null;
  const verified = verifyVectorWorkspaceSessionToken({
    token,
    secret: runtime.privateSessionSecret,
  });
  return verified.ok ? vectorWorkspaceContextFromClaims(verified.claims) : null;
}

export function vectorWorkspaceContextFromCookieHeader(
  cookieHeader: string | null | undefined,
): VectorWorkspaceContext | null {
  if (!cookieHeader) return null;
  const runtime = getVectorHubAuthRuntime();
  const cookies = parseCookies(cookieHeader);
  const token = cookies.get(vectorWorkspaceSessionCookieName(runtime.production));
  return vectorWorkspaceContextFromToken(token);
}

export function vectorWorkspaceContextFromRequest(
  request: Request,
): VectorWorkspaceContext | null {
  return vectorWorkspaceContextFromCookieHeader(request.headers.get("cookie"));
}

export function localOrSignedVectorWorkspaceContext(
  token: string | null | undefined,
): VectorWorkspaceContext | null {
  const signed = vectorWorkspaceContextFromToken(token);
  if (signed) return signed;
  return process.env.NODE_ENV === "production"
    ? null
    : localVectorWorkspaceContext();
}

export function vectorWorkspaceSessionMutationAllowed(request: Request): boolean {
  const method = request.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return true;
  const runtime = getVectorHubAuthRuntime();
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  return origin === runtime.publicOrigin &&
    (fetchSite === null || fetchSite === "same-origin");
}
