import { timingSafeEqual } from "node:crypto";
import {
  vectorWorkspaceContextFromRequest,
  vectorWorkspaceSessionMutationAllowed,
} from "./hub-session";

export function noStoreHeaders(extra: HeadersInit = {}): Headers {
  const headers = new Headers(extra);
  headers.set("cache-control", "no-store, max-age=0");
  headers.set("x-content-type-options", "nosniff");
  headers.set("vary", "authorization, cookie, origin");
  return headers;
}

export function apiJson(
  value: unknown,
  status = 200,
  extraHeaders: HeadersInit = {},
): Response {
  return Response.json(value, {
    status,
    headers: noStoreHeaders(extraHeaders),
  });
}

function secureEqual(expected: string, supplied: string): boolean {
  const expectedBytes = Buffer.from(expected, "utf8");
  const suppliedBytes = Buffer.from(supplied, "utf8");
  return expectedBytes.length === suppliedBytes.length &&
    timingSafeEqual(expectedBytes, suppliedBytes);
}

function bearerToken(request: Request): string {
  const header = request.headers.get("authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}

export function apiAuthorisationFailure(
  request: Request,
  options: Readonly<{ allowWorkspaceSession?: boolean }> = {},
): Response | null {
  const configuredToken = process.env.VECTOR_API_TOKEN?.trim();
  const suppliedToken = bearerToken(request);
  if (suppliedToken) {
    return configuredToken && secureEqual(configuredToken, suppliedToken)
      ? null
      : apiJson({ error: "VECTOR_API_UNAUTHORISED" }, 401);
  }

  if (options.allowWorkspaceSession) {
    const workspace = vectorWorkspaceContextFromRequest(request);
    if (workspace) {
      return vectorWorkspaceSessionMutationAllowed(request)
        ? null
        : apiJson(
            {
              error: "VECTOR_WORKSPACE_ORIGIN_REJECTED",
              message: "Workspace-session mutations require exact same-origin evidence.",
            },
            403,
          );
    }
  }

  if (!configuredToken && process.env.NODE_ENV !== "production") return null;
  if (!configuredToken && !options.allowWorkspaceSession) {
    return apiJson(
      {
        error: "VECTOR_API_NOT_CONFIGURED",
        message: "VECTOR_API_TOKEN is required for this production API surface.",
      },
      503,
    );
  }
  return apiJson({ error: "VECTOR_API_UNAUTHORISED" }, 401);
}

export function workerApiAuthorisationFailure(
  request: Request,
): Response | null {
  const configuredToken = process.env.VECTOR_WORKER_API_TOKEN?.trim();
  if (!configuredToken) {
    return apiJson(
      {
        error: "VECTOR_WORKER_API_NOT_CONFIGURED",
        message:
          "VECTOR_WORKER_API_TOKEN is required before worker control endpoints can be used.",
      },
      503,
    );
  }
  const suppliedToken = bearerToken(request);
  return suppliedToken && secureEqual(configuredToken, suppliedToken)
    ? null
    : apiJson({ error: "VECTOR_WORKER_API_UNAUTHORISED" }, 401);
}
