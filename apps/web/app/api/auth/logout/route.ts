import { getVectorHubAuthRuntime } from "../../../../lib/hub-runtime";
import { clearVectorWorkspaceSessionCookieHeader } from "../../../../lib/hub-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(): Response {
  const runtimeValue = getVectorHubAuthRuntime();
  const location = new URL("/access", runtimeValue.publicOrigin);
  const headers = new Headers({
    location: location.toString(),
    "cache-control": "no-store, max-age=0",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "set-cookie": clearVectorWorkspaceSessionCookieHeader(
      runtimeValue.production,
    ),
  });
  return new Response(null, { status: 303, headers });
}
