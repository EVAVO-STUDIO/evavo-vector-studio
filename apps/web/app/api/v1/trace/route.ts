import { createJobId } from "@evavo/vector-core";
import { apiAuthorisationFailure } from "../../../../lib/api-security";
import {
  encodedJsonBytes,
  encodedTextBytes,
  resolveVectorInteractivePayloadPolicy,
} from "../../../../lib/deployment-profile";
import {
  DEFAULT_DIFFERENCE_MAX_DIMENSION,
  DEFAULT_MAX_INPUT_BYTES,
  MAX_DIFFERENCE_DIMENSION,
  RasterEngineError,
  RasterRuntimeGuardError,
  createRasterRuntimeGuard,
  resolveRasterRuntimeGuardConfigFromEnvironment,
  traceRaster,
  type RasterCandidateMode,
  type RasterTraceProfileSelection,
} from "@evavo/raster-engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PROFILES = new Set<RasterTraceProfileSelection>(["auto", "logo", "icon", "line-art", "illustration", "photo"]);
const CANDIDATE_MODES = new Set<RasterCandidateMode>(["adaptive", "single"]);
const MULTIPART_OVERHEAD_ALLOWANCE = 1024 * 1024;
const TRACE_RUNTIME_GUARD = createRasterRuntimeGuard(resolveRasterRuntimeGuardConfigFromEnvironment());
const TRACE_PAYLOAD_POLICY = resolveVectorInteractivePayloadPolicy({
  localMaxFileBytes: DEFAULT_MAX_INPUT_BYTES,
  localMaxRequestBytes: DEFAULT_MAX_INPUT_BYTES + MULTIPART_OVERHEAD_ALLOWANCE,
});

function noStoreHeaders(extra: HeadersInit = {}): Headers {
  const headers = new Headers(extra);
  headers.set("cache-control", "no-store, max-age=0");
  headers.set("x-content-type-options", "nosniff");
  headers.set("vary", "authorization, cookie, origin");
  return headers;
}

function json(value: unknown, status = 200, extraHeaders: HeadersInit = {}): Response {
  return Response.json(value, { status, headers: noStoreHeaders(extraHeaders) });
}

function payloadLimitResponse(
  kind: "request" | "file" | "svg-response" | "json-response",
  actualBytes: number,
): Response {
  return json(
    {
      error: kind === "request" || kind === "file"
        ? "VECTOR_INTERACTIVE_PAYLOAD_TOO_LARGE"
        : "VECTOR_INTERACTIVE_RESPONSE_TOO_LARGE",
      message:
        "This synchronous hosted transfer exceeds the current interactive payload boundary. Use the local CLI or MCP surface, a self-hosted worker, or a provider-direct private object upload once configured.",
      kind,
      actualBytes,
      limits: TRACE_PAYLOAD_POLICY,
      retryable: false,
      recommendedTransports: [
        "evavo-vector CLI",
        "EVAVO Vector Studio MCP",
        "self-hosted HTTP worker",
        "provider-direct private object upload",
      ],
    },
    413,
  );
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

function runtimeTimeoutResponse(): Response {
  const runtimeState = TRACE_RUNTIME_GUARD.snapshot();
  return json(
    {
      error: "RASTER_RUNTIME_TIMEOUT",
      message: "The bounded raster operation exceeded its configured execution deadline.",
      timeoutMs: runtimeState.timeoutMs,
      retryable: true,
    },
    504,
  );
}

export function GET(): Response {
  return json({
    service: "evavo-vector-studio",
    version: "v1",
    contractVersion: "1.4",
    execution: "bounded-synchronous",
    endpoint: "/api/v1/trace",
    input: "multipart/form-data with a file field",
    supportedProfiles: [...PROFILES],
    candidateModes: [...CANDIDATE_MODES],
    adaptiveCandidateBudget: { threeCandidatesThroughPixels: 4_000_000, twoCandidatesThroughPixels: 12_000_000, otherwise: 1 },
    limits: {
      maxInputBytes: DEFAULT_MAX_INPUT_BYTES,
      maxInteractiveInputBytes: TRACE_PAYLOAD_POLICY.maxFileBytes,
      maxInteractiveRequestBytes: TRACE_PAYLOAD_POLICY.maxRequestBytes,
      maxInteractiveResponseBytes: TRACE_PAYLOAD_POLICY.maxResponseBytes,
      maxDecodedPixels: 40_000_000,
    },
    hosting: TRACE_PAYLOAD_POLICY,
    runtimeGuard: TRACE_RUNTIME_GUARD.snapshot(),
    differenceArtifacts: {
      available: true,
      requestField: "includeDifference",
      maximumDimensionField: "differenceMaxDimension",
      defaultMaximumDimension: DEFAULT_DIFFERENCE_MAX_DIMENSION,
      maximumDimension: MAX_DIFFERENCE_DIMENSION,
      transport: "base64-encoded PNG in JSON responses within the active response boundary",
    },
    authentication: "same-origin Vector workspace session or Bearer VECTOR_API_TOKEN",
    largeObjectTransport: "local CLI, MCP, self-hosted worker, or provider-direct private storage",
    visualEvidence: "alpha-aware multi-scale source-versus-SVG render comparison",
    approval: "human review required even when render comparison passes",
  });
}

export async function POST(request: Request): Promise<Response> {
  const authFailure = apiAuthorisationFailure(request, { allowWorkspaceSession: true });
  if (authFailure) return authFailure;

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > TRACE_PAYLOAD_POLICY.maxRequestBytes) {
    return payloadLimitResponse("request", contentLength);
  }

  let lease;
  try {
    lease = TRACE_RUNTIME_GUARD.acquire(request.signal);
  } catch (error) {
    if (error instanceof RasterRuntimeGuardError) {
      const headers = new Headers();
      if (error.retryAfterSeconds !== undefined) {
        headers.set("retry-after", String(error.retryAfterSeconds));
      }
      return json(
        {
          error: error.code,
          message: error.message,
          details: error.details,
          retryable: error.code === "RASTER_RUNTIME_BUSY",
        },
        error.status,
        headers,
      );
    }
    throw error;
  }

  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return json({ error: "VECTOR_FILE_REQUIRED", field: "file" }, 400);
    if (file.size === 0) return json({ error: "RASTER_INPUT_EMPTY" }, 400);
    if (file.size > TRACE_PAYLOAD_POLICY.maxFileBytes) return payloadLimitResponse("file", file.size);

    const rawProfile = stringField(form, "profile") ?? "auto";
    if (!PROFILES.has(rawProfile as RasterTraceProfileSelection)) {
      return json({ error: "RASTER_OPTIONS_INVALID", field: "profile", allowed: [...PROFILES] }, 400);
    }
    const rawCandidateMode = stringField(form, "candidateMode") ?? "adaptive";
    if (!CANDIDATE_MODES.has(rawCandidateMode as RasterCandidateMode)) {
      return json({ error: "RASTER_OPTIONS_INVALID", field: "candidateMode", allowed: [...CANDIDATE_MODES] }, 400);
    }
    const format = stringField(form, "format") ?? "json";
    if (format !== "json" && format !== "svg") {
      return json({ error: "RASTER_OPTIONS_INVALID", field: "format", allowed: ["json", "svg"] }, 400);
    }
    const maxColours = integerField(form, "maxColours");
    if (maxColours !== undefined && (maxColours < 1 || maxColours > 256)) {
      return json({ error: "RASTER_OPTIONS_INVALID", field: "maxColours", range: [1, 256] }, 400);
    }

    const includeDifference = booleanField(form, "includeDifference", false);
    const differenceMaxDimension = integerField(form, "differenceMaxDimension");
    if (differenceMaxDimension !== undefined && !includeDifference) {
      return json({ error: "RASTER_OPTIONS_INVALID", field: "differenceMaxDimension", message: "includeDifference must be true." }, 400);
    }
    if (
      differenceMaxDimension !== undefined &&
      (differenceMaxDimension < 32 || differenceMaxDimension > MAX_DIFFERENCE_DIMENSION)
    ) {
      return json({ error: "RASTER_OPTIONS_INVALID", field: "differenceMaxDimension", range: [32, MAX_DIFFERENCE_DIMENSION] }, 400);
    }
    if (format === "svg" && includeDifference) {
      return json({
        error: "RASTER_OPTIONS_INVALID",
        field: "includeDifference",
        message: "Difference PNG artefacts require format=json so both outputs can be returned without discarding evidence.",
      }, 400);
    }

    const jobId = createJobId();
    const source = new Uint8Array(await file.arrayBuffer());
    const result = await traceRaster(source, {
      sourceName: file.name,
      profile: rawProfile as RasterTraceProfileSelection,
      candidateMode: rawCandidateMode as RasterCandidateMode,
      maxColours,
      preservePalette: booleanField(form, "preservePalette", true),
      optimise: booleanField(form, "optimise", true),
      title: stringField(form, "title"),
      includeDifferenceArtifact: includeDifference,
      differenceMaxDimension,
      signal: lease.signal,
    });
    if (lease.timedOut()) return runtimeTimeoutResponse();

    const runtimeState = TRACE_RUNTIME_GUARD.snapshot();
    if (format === "svg") {
      const body = `${result.svg}\n`;
      const responseBytes = encodedTextBytes(body);
      if (responseBytes > TRACE_PAYLOAD_POLICY.maxResponseBytes) {
        return payloadLimitResponse("svg-response", responseBytes);
      }
      return new Response(body, {
        status: 200,
        headers: noStoreHeaders({
          "content-type": "image/svg+xml; charset=utf-8",
          "content-disposition": `attachment; filename="${safeDownloadName(file.name)}"`,
          "x-vector-job-id": jobId,
          "x-vector-review-required": "true",
          "x-vector-render-quality": result.evidence.comparison.quality,
          "x-vector-visual-mae": String(result.evidence.comparison.aggregate.visualMae),
          "x-vector-mismatch-fraction": String(result.evidence.comparison.aggregate.mismatchFraction),
          "x-vector-selected-candidate": result.evidence.selection.selectedCandidateId,
          "x-vector-candidate-count": String(result.evidence.selection.attemptedCandidateCount),
          "x-vector-runtime-timeout-ms": String(runtimeState.timeoutMs),
          "x-vector-runtime-max-concurrent": String(runtimeState.maxConcurrent),
          "x-vector-response-bytes": String(responseBytes),
        }),
      });
    }

    const differenceEvidence = result.evidence.differenceArtifact;
    const differencePng = result.artifacts.differencePng;
    if ((differenceEvidence && !differencePng) || (!differenceEvidence && differencePng)) {
      throw new RasterEngineError(
        "RASTER_DIFFERENCE_ARTIFACT_FAILED",
        "Difference artefact bytes and evidence are inconsistent.",
        500,
      );
    }
    const artifacts = differenceEvidence && differencePng
      ? {
          difference: {
            ...differenceEvidence,
            encoding: "base64" as const,
            data: Buffer.from(differencePng).toString("base64"),
          },
        }
      : {};

    const payload = {
      id: jobId,
      status: "complete" as const,
      approval: "review-required" as const,
      runtime: {
        timeoutMs: runtimeState.timeoutMs,
        maxConcurrent: runtimeState.maxConcurrent,
      },
      source: {
        name: file.name,
        declaredType: file.type || null,
        detectedType: result.evidence.analysis.source.mimeType,
        bytes: file.size,
      },
      svg: result.svg,
      inspection: result.inspection,
      evidence: result.evidence,
      artifacts,
    };
    const responseBytes = encodedJsonBytes(payload);
    if (responseBytes > TRACE_PAYLOAD_POLICY.maxResponseBytes) {
      return payloadLimitResponse("json-response", responseBytes);
    }
    return json(payload, 200, { "x-vector-response-bytes": String(responseBytes) });
  } catch (error) {
    if (lease.timedOut()) return runtimeTimeoutResponse();
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
  } finally {
    lease.release();
  }
}
