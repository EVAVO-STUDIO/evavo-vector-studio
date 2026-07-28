import { timingSafeEqual } from "node:crypto";
import { createJobId } from "@evavo/vector-core";
import {
  DEFAULT_MAX_INPUT_BYTES,
  RasterEngineError,
  traceRaster,
  type RasterTraceProfileSelection,
} from "@evavo/raster-engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PROFILES = new Set<RasterTraceProfileSelection>(["auto", "logo", "icon", "line-art", "illustration", "photo"]);
const MULTIPART_OVERHEAD_ALLOWANCE = 1024 * 1024;

function noStoreHeaders(extra: HeadersInit = {}): Headers {
  const headers = new Headers(extra);
  headers.set("cache-control", "no-store, max-age=0");
  headers.set("x-content-type-options", "nosniff");
  headers.set("vary", "authorization");
  return headers;
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: noStoreHeaders() });
}

function secureEqual(expected: string, supplied: string): boolean {
  const expectedBytes = Buffer.from(expected, "utf8");
  const suppliedBytes = Buffer.from(supplied, "utf8");
  return expectedBytes.length === suppliedBytes.length && timingSafeEqual(expectedBytes, suppliedBytes);
}

function authorisationFailure(request: Request): Response | null {
  const configuredToken = process.env.VECTOR_API_TOKEN?.trim();
  if (!configuredToken) {
    return process.env.NODE_ENV === "production"
      ? json({ error: "VECTOR_API_NOT_CONFIGURED", message: "VECTOR_API_TOKEN is required in production." }, 503)
      : null;
  }
  const header = request.headers.get("authorization") ?? "";
  const suppliedToken = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  return suppliedToken && secureEqual(configuredToken, suppliedToken)
    ? null
    : json({ error: "VECTOR_API_UNAUTHORISED" }, 401);
}

function stringField(form: FormData, name: string): string | undefined {
  const value = form.get(name);
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function booleanField(form: FormData, name: string, fallback: boolean): boolean {
  const value = stringField(form, name);
  if (value === undefined) return fallback;
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  throw new RasterEngineError("RASTER_OPTIONS_INVALID", `${name} must be true or false.`, 400);
}

function integerField(form: FormData, name: string): number | undefined {
  const value = stringField(form, name);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new RasterEngineError("RASTER_OPTIONS_INVALID", `${name} must be an integer.`, 400);
  return parsed;
}

function safeDownloadName(sourceName: string): string {
  const stem = sourceName.replace(/\.[^.]+$/, "").replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "");
  return `${stem || "vector"}.svg`;
}

export function GET(): Response {
  return json({
    service: "evavo-vector-studio",
    version: "v1",
    execution: "bounded-synchronous",
    endpoint: "/api/v1/trace",
    input: "multipart/form-data with a file field",
    supportedProfiles: [...PROFILES],
    limits: { maxInputBytes: DEFAULT_MAX_INPUT_BYTES, maxDecodedPixels: 40_000_000 },
    authentication: "Bearer VECTOR_API_TOKEN in production",
    approval: "withheld until render-comparison evidence is implemented",
  });
}

export async function POST(request: Request): Promise<Response> {
  const authFailure = authorisationFailure(request);
  if (authFailure) return authFailure;

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > DEFAULT_MAX_INPUT_BYTES + MULTIPART_OVERHEAD_ALLOWANCE) {
    return json({ error: "RASTER_INPUT_TOO_LARGE", maxInputBytes: DEFAULT_MAX_INPUT_BYTES }, 413);
  }

  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return json({ error: "VECTOR_FILE_REQUIRED", field: "file" }, 400);
    if (file.size === 0) return json({ error: "RASTER_INPUT_EMPTY" }, 400);
    if (file.size > DEFAULT_MAX_INPUT_BYTES) return json({ error: "RASTER_INPUT_TOO_LARGE", maxInputBytes: DEFAULT_MAX_INPUT_BYTES }, 413);

    const rawProfile = stringField(form, "profile") ?? "auto";
    if (!PROFILES.has(rawProfile as RasterTraceProfileSelection)) {
      return json({ error: "RASTER_OPTIONS_INVALID", field: "profile", allowed: [...PROFILES] }, 400);
    }
    const format = stringField(form, "format") ?? "json";
    if (format !== "json" && format !== "svg") {
      return json({ error: "RASTER_OPTIONS_INVALID", field: "format", allowed: ["json", "svg"] }, 400);
    }
    const maxColours = integerField(form, "maxColours");
    if (maxColours !== undefined && (maxColours < 1 || maxColours > 256)) {
      return json({ error: "RASTER_OPTIONS_INVALID", field: "maxColours", range: [1, 256] }, 400);
    }

    const jobId = createJobId();
    const source = new Uint8Array(await file.arrayBuffer());
    const result = await traceRaster(source, {
      sourceName: file.name,
      profile: rawProfile as RasterTraceProfileSelection,
      maxColours,
      preservePalette: booleanField(form, "preservePalette", true),
      optimise: booleanField(form, "optimise", true),
      title: stringField(form, "title"),
      signal: request.signal,
    });

    if (format === "svg") {
      return new Response(`${result.svg}\n`, {
        status: 200,
        headers: noStoreHeaders({
          "content-type": "image/svg+xml; charset=utf-8",
          "content-disposition": `attachment; filename="${safeDownloadName(file.name)}"`,
          "x-vector-job-id": jobId,
          "x-vector-review-required": "true",
        }),
      });
    }

    return json({
      id: jobId,
      status: "complete",
      approval: "review-required",
      source: {
        name: file.name,
        declaredType: file.type || null,
        detectedType: result.evidence.analysis.source.mimeType,
        bytes: file.size,
      },
      svg: result.svg,
      inspection: result.inspection,
      evidence: result.evidence,
    });
  } catch (error) {
    if (error instanceof RasterEngineError) {
      return json({ error: error.code, message: error.message, details: error.details }, error.status);
    }
    return json(
      {
        error: "VECTOR_TRACE_FAILED",
        message: process.env.NODE_ENV === "production" ? "The vector trace could not be completed." : error instanceof Error ? error.message : String(error),
      },
      500,
    );
  }
}
