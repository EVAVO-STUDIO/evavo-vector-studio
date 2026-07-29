import { timingSafeEqual } from "node:crypto";

export function noStoreHeaders(extra: HeadersInit = {}): Headers {
  const headers = new Headers(extra);
  headers.set("cache-control", "no-store, max-age=0");
  headers.set("x-content-type-options", "nosniff");
  headers.set("vary", "authorization");
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

export function apiAuthorisationFailure(request: Request): Response | null {
  const configuredToken = process.env.VECTOR_API_TOKEN?.trim();
  if (!configuredToken) {
    return process.env.NODE_ENV === "production"
      ? apiJson(
          {
            error: "VECTOR_API_NOT_CONFIGURED",
            message: "VECTOR_API_TOKEN is required in production.",
          },
          503,
        )
      : null;
  }
  const header = request.headers.get("authorization") ?? "";
  const suppliedToken = header.startsWith("Bearer ")
    ? header.slice(7).trim()
    : "";
  return suppliedToken && secureEqual(configuredToken, suppliedToken)
    ? null
    : apiJson({ error: "VECTOR_API_UNAUTHORISED" }, 401);
}
