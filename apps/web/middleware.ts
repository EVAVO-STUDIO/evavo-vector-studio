import { NextResponse, type NextRequest } from "next/server";

export const VECTOR_PRIVATE_RESPONSE_CONTRACT_VERSION = "1.0";

const PRIVATE_HEADERS = Object.freeze({
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-resource-policy": "same-origin",
  "origin-agent-cluster": "?1",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()",
  "referrer-policy": "no-referrer",
  "strict-transport-security": "max-age=63072000; includeSubDomains",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "x-robots-tag": "noindex, nofollow, noarchive, nosnippet, noimageindex",
} as const);

function applyPrivateHeaders(response: NextResponse): NextResponse {
  for (const [name, value] of Object.entries(PRIVATE_HEADERS)) {
    response.headers.set(name, value);
  }
  response.headers.set(
    "x-vector-private-response-contract",
    VECTOR_PRIVATE_RESPONSE_CONTRACT_VERSION,
  );
  return response;
}

export function middleware(request: NextRequest): NextResponse {
  const response = NextResponse.next();
  response.headers.set("vary", "authorization, cookie, origin");

  if (request.nextUrl.pathname.startsWith("/api/")) {
    response.headers.set("cache-control", "no-store, max-age=0");
  }

  return applyPrivateHeaders(response);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon.svg|manifest.webmanifest).*)",
  ],
};
