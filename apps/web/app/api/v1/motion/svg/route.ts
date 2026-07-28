import { timingSafeEqual } from "node:crypto";
import {
  MOTION_CONTRACT_VERSION,
  MotionEngineError,
  createAnimatedSvg,
  validateAnimatedSvgMotionSpec,
} from "@evavo/motion-engine";
import { createJobId } from "@evavo/vector-core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_SVG_INPUT_BYTES = 5 * 1024 * 1024;
const MAX_MOTION_PLAN_BYTES = 256 * 1024;
const MULTIPART_OVERHEAD_ALLOWANCE = 1024 * 1024;
const MAX_REQUEST_BYTES = MAX_SVG_INPUT_BYTES + MAX_MOTION_PLAN_BYTES + MULTIPART_OVERHEAD_ALLOWANCE;
const ALLOWED_FORM_FIELDS = new Set(["file", "motion", "motionFile", "format"]);

type MotionPlanSource = Readonly<{
  plan: unknown;
  descriptor: Readonly<{
    mode: "inline" | "file";
    name: string | null;
    declaredType: string | null;
    bytes: number;
  }>;
}>;

function noStoreHeaders(extra: HeadersInit = {}): Headers {
  const headers = new Headers(extra);
  headers.set("cache-control", "no-store, max-age=0");
  headers.set("x-content-type-options", "nosniff");
  headers.set("vary", "authorization");
  return headers;
}

function json(value: unknown, status = 200, extraHeaders: HeadersInit = {}): Response {
  return Response.json(value, { status, headers: noStoreHeaders(extraHeaders) });
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

function safeDownloadName(sourceName: string): string {
  const stem = sourceName
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/^-+|-+$/g, "");
  return `${stem || "vector"}.animated.svg`;
}

function validateFormShape(form: FormData): Response | null {
  const counts = new Map<string, number>();
  const unknownFields = new Set<string>();
  let actualFieldBytes = 0;

  for (const [name, value] of form.entries()) {
    counts.set(name, (counts.get(name) ?? 0) + 1);
    if (!ALLOWED_FORM_FIELDS.has(name)) unknownFields.add(name);
    actualFieldBytes += typeof value === "string"
      ? Buffer.byteLength(value, "utf8")
      : value.size;
  }

  if (unknownFields.size > 0) {
    return json({
      error: "MOTION_REQUEST_FIELD_UNSUPPORTED",
      fields: [...unknownFields].sort(),
      allowed: [...ALLOWED_FORM_FIELDS],
    }, 400);
  }

  const duplicateFields = [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([name]) => name)
    .sort();
  if (duplicateFields.length > 0) {
    return json({
      error: "MOTION_REQUEST_FIELD_DUPLICATE",
      fields: duplicateFields,
    }, 400);
  }

  if (actualFieldBytes > MAX_REQUEST_BYTES) {
    return json({
      error: "MOTION_REQUEST_TOO_LARGE",
      actualFieldBytes,
      maxRequestBytes: MAX_REQUEST_BYTES,
    }, 413);
  }
  return null;
}

function parsePlanJson(source: string, descriptor: Readonly<Record<string, unknown>>): unknown {
  try {
    return JSON.parse(source) as unknown;
  } catch (error) {
    throw new MotionEngineError(
      "MOTION_SPEC_INVALID",
      "The motion plan is not valid JSON.",
      {
        ...descriptor,
        cause: error instanceof Error ? error.message : String(error),
      },
    );
  }
}

async function readMotionPlan(form: FormData): Promise<MotionPlanSource> {
  const inline = stringField(form, "motion");
  const rawFile = form.get("motionFile");
  const motionFile = rawFile instanceof File ? rawFile : null;
  if (rawFile !== null && !motionFile) {
    throw new MotionEngineError(
      "MOTION_SPEC_INVALID",
      "motionFile must be an uploaded JSON file.",
      { field: "motionFile" },
    );
  }
  if (Boolean(inline) === Boolean(motionFile)) {
    throw new MotionEngineError(
      "MOTION_SPEC_INVALID",
      "Provide exactly one of motion or motionFile.",
      { hasInlineMotion: Boolean(inline), hasMotionFile: Boolean(motionFile) },
    );
  }

  if (inline) {
    const bytes = Buffer.byteLength(inline, "utf8");
    if (bytes > MAX_MOTION_PLAN_BYTES) {
      throw new MotionEngineError(
        "MOTION_SPEC_INVALID",
        "The inline motion plan exceeds the configured byte limit.",
        { bytes, maxBytes: MAX_MOTION_PLAN_BYTES },
      );
    }
    return Object.freeze({
      plan: parsePlanJson(inline, { field: "motion" }),
      descriptor: Object.freeze({
        mode: "inline",
        name: null,
        declaredType: "application/json",
        bytes,
      }),
    });
  }

  if (!motionFile || motionFile.size === 0) {
    throw new MotionEngineError(
      "MOTION_SPEC_INVALID",
      "The uploaded motion plan is empty.",
      { field: "motionFile" },
    );
  }
  if (motionFile.size > MAX_MOTION_PLAN_BYTES) {
    throw new MotionEngineError(
      "MOTION_SPEC_INVALID",
      "The uploaded motion plan exceeds the configured byte limit.",
      { bytes: motionFile.size, maxBytes: MAX_MOTION_PLAN_BYTES },
    );
  }
  const source = await motionFile.text();
  return Object.freeze({
    plan: parsePlanJson(source, { field: "motionFile", name: motionFile.name }),
    descriptor: Object.freeze({
      mode: "file",
      name: motionFile.name,
      declaredType: motionFile.type || null,
      bytes: motionFile.size,
    }),
  });
}

function motionStatus(error: MotionEngineError): number {
  if (error.code === "MOTION_SPEC_INVALID") return 400;
  if (error.code === "MOTION_OUTPUT_INVALID") return 500;
  return 422;
}

export function GET(): Response {
  return json({
    service: "evavo-vector-studio",
    version: "v1",
    contractVersion: MOTION_CONTRACT_VERSION,
    execution: "bounded-synchronous",
    endpoint: "/api/v1/motion/svg",
    input: "multipart/form-data",
    fields: {
      file: "required governed static SVG",
      motion: "inline motion v1 JSON; mutually exclusive with motionFile",
      motionFile: "motion v1 JSON file; mutually exclusive with motion",
      format: ["json", "svg"],
    },
    strictFieldSet: true,
    limits: {
      maxSvgInputBytes: MAX_SVG_INPUT_BYTES,
      maxMotionPlanBytes: MAX_MOTION_PLAN_BYTES,
      maxRequestBytes: MAX_REQUEST_BYTES,
      maxTracks: 64,
      maxKeyframesPerTrack: 100,
    },
    supportedProperties: ["opacity", "translateX", "translateY", "scale", "rotateDeg"],
    reducedMotionFallbackRequired: true,
    lottieAvailable: false,
    authentication: "Bearer VECTOR_API_TOKEN in production",
    approval: "human review required",
  });
}

export async function POST(request: Request): Promise<Response> {
  const authFailure = authorisationFailure(request);
  if (authFailure) return authFailure;

  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("multipart/form-data")) {
    return json({
      error: "MOTION_REQUEST_MEDIA_TYPE_UNSUPPORTED",
      message: "POST /api/v1/motion/svg requires multipart/form-data.",
    }, 415);
  }

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    return json({ error: "MOTION_REQUEST_TOO_LARGE", maxRequestBytes: MAX_REQUEST_BYTES }, 413);
  }

  try {
    if (request.signal.aborted) {
      return json({ error: "MOTION_REQUEST_ABORTED", retryable: true }, 499);
    }

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return json({
        error: "MOTION_MULTIPART_INVALID",
        message: "The multipart request could not be parsed.",
      }, 400);
    }
    const shapeFailure = validateFormShape(form);
    if (shapeFailure) return shapeFailure;

    const file = form.get("file");
    if (!(file instanceof File)) {
      return json({ error: "MOTION_SVG_FILE_REQUIRED", field: "file" }, 400);
    }
    if (file.size === 0) return json({ error: "MOTION_SVG_INPUT_EMPTY" }, 400);
    if (file.size > MAX_SVG_INPUT_BYTES) {
      return json({ error: "MOTION_SVG_INPUT_TOO_LARGE", maxInputBytes: MAX_SVG_INPUT_BYTES }, 413);
    }

    const format = stringField(form, "format") ?? "json";
    if (format !== "json" && format !== "svg") {
      return json({ error: "MOTION_FORMAT_INVALID", field: "format", allowed: ["json", "svg"] }, 400);
    }

    const [source, motionSource] = await Promise.all([
      file.text(),
      readMotionPlan(form),
    ]);
    if (source.includes("\0")) {
      return json({ error: "MOTION_SVG_INPUT_INVALID", message: "The SVG contains null bytes." }, 422);
    }
    if (request.signal.aborted) {
      return json({ error: "MOTION_REQUEST_ABORTED", retryable: true }, 499);
    }

    const normalizedMotion = validateAnimatedSvgMotionSpec(motionSource.plan);
    const result = createAnimatedSvg(source, normalizedMotion);
    if (request.signal.aborted) {
      return json({ error: "MOTION_REQUEST_ABORTED", retryable: true }, 499);
    }

    const jobId = createJobId();
    if (format === "svg") {
      return new Response(`${result.svg}\n`, {
        status: 200,
        headers: noStoreHeaders({
          "content-type": "image/svg+xml; charset=utf-8",
          "content-disposition": `attachment; filename="${safeDownloadName(file.name)}"`,
          "x-vector-job-id": jobId,
          "x-vector-motion-contract": MOTION_CONTRACT_VERSION,
          "x-vector-motion-id": result.evidence.motion.id,
          "x-vector-review-required": "true",
          "x-vector-source-sha256": result.evidence.source.sha256,
          "x-vector-output-sha256": result.evidence.output.sha256,
          "x-vector-reduced-motion": "true",
        }),
      });
    }

    return json({
      id: jobId,
      status: "complete",
      approval: result.evidence.approval,
      source: {
        name: file.name,
        declaredType: file.type || null,
        bytes: file.size,
        sha256: result.evidence.source.sha256,
      },
      motionPlan: {
        ...motionSource.descriptor,
        normalized: normalizedMotion,
      },
      svg: result.svg,
      inspection: result.inspection,
      evidence: result.evidence,
    });
  } catch (error) {
    if (error instanceof MotionEngineError) {
      return json(
        { error: error.code, message: error.message, details: error.details },
        motionStatus(error),
      );
    }
    return json(
      {
        error: "MOTION_API_FAILED",
        message: process.env.NODE_ENV === "production"
          ? "The animated SVG could not be created."
          : error instanceof Error
            ? error.message
            : String(error),
      },
      500,
    );
  }
}
