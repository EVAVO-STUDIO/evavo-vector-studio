import { randomBytes } from "node:crypto";
import {
  VectorHubAuthError,
  createVectorWorkspaceSessionToken,
  verifyVectorHubLaunchToken,
} from "@evavo/hub-auth";
import { requireVectorHubAuthRuntime } from "../../lib/hub-runtime";
import { vectorWorkspaceSessionCookieHeader } from "../../lib/hub-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function redirectResponse(
  origin: string,
  pathname: string,
  status = 303,
  extraHeaders: HeadersInit = {},
): Response {
  const location = new URL(pathname, origin);
  const headers = new Headers(extraHeaders);
  headers.set("location", location.toString());
  headers.set("cache-control", "no-store, max-age=0");
  headers.set("pragma", "no-cache");
  headers.set("referrer-policy", "no-referrer");
  headers.set("x-content-type-options", "nosniff");
  return new Response(null, { status, headers });
}

function accessPath(reason: string): string {
  const url = new URL("/access", "https://vector.evavo.com.au");
  url.searchParams.set("reason", reason);
  return `${url.pathname}${url.search}`;
}

export async function GET(request: Request): Promise<Response> {
  let origin = process.env.NODE_ENV === "production"
    ? "https://vector.evavo.com.au"
    : new URL(request.url).origin;
  try {
    const runtimeValue = requireVectorHubAuthRuntime();
    origin = runtimeValue.publicOrigin;
    const url = new URL(request.url);
    const tokens = url.searchParams.getAll("token");
    const unknownParameters = [...url.searchParams.keys()]
      .filter((name) => name !== "token");
    if (
      tokens.length !== 1 ||
      !tokens[0] ||
      unknownParameters.length > 0
    ) {
      return redirectResponse(origin, accessPath("invalid"));
    }

    const now = Math.floor(Date.now() / 1_000);
    const verified = verifyVectorHubLaunchToken({
      token: tokens[0],
      secret: runtimeValue.launchSecret,
      now,
    });
    if (!verified.ok) {
      return redirectResponse(origin, accessPath("invalid"));
    }

    const preparedSession = createVectorWorkspaceSessionToken({
      secret: runtimeValue.privateSessionSecret,
      launchClaims: verified.claims,
      sessionId: randomBytes(24).toString("base64url"),
      now,
    });
    const replay = await runtimeValue.replayStore.consume(
      verified.replayKey,
      verified.replayTtlSeconds,
      { signal: request.signal },
    );
    if (replay === "replayed") {
      return redirectResponse(origin, accessPath("used"));
    }

    return redirectResponse(origin, "/", 303, {
      "set-cookie": vectorWorkspaceSessionCookieHeader({
        token: preparedSession.token,
        production: runtimeValue.production,
      }),
      "x-vector-hub-launch": "consumed",
      "x-vector-workspace-session": "created",
    });
  } catch (error) {
    const temporary = error instanceof VectorHubAuthError
      ? error.code === "VECTOR_HUB_AUTH_CONFIGURATION_INVALID" ||
        error.code === "VECTOR_HUB_LAUNCH_REPLAY_UNAVAILABLE"
      : true;
    return redirectResponse(
      origin,
      accessPath(temporary ? "temporarily-unavailable" : "invalid"),
    );
  }
}
