import { timingSafeEqual } from "node:crypto";
import {
  DEFAULT_LOTTIE_FRAME_RATE,
  DEFAULT_LOTTIE_PRECISION,
  LOTTIE_CONTRACT_VERSION,
  LottieEngineError,
  MAX_LOTTIE_FRAME_RATE,
  MAX_LOTTIE_PRECISION,
  MIN_LOTTIE_FRAME_RATE,
  createLottieFromSvgMotion,
} from "@evavo/lottie-engine";
import { MotionEngineError } from "@evavo/motion-engine";
import { createJobId } from "@evavo/vector-core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_SVG_INPUT_BYTES = 5 * 1024 * 1024;
const MAX_MOTION_PLAN_BYTES = 256 * 1024;
const MAX_LOTTIE_OUTPUT_BYTES = 20 * 1024 * 1024;
const MULTIPART_OVERHEAD_ALLOWANCE = 1024 * 1024;
const MAX_REQUEST_BYTES =
  MAX_SVG_INPUT_BYTES +
  MAX_MOTION_PLAN_BYTES +
  MULTIPART_OVERHEAD_ALLOWANCE;
const ALLOWED_FORM_FIELDS = new Set([
  "file",
  "motion",
  "motionFile",
  "format",
  "frameRate",
  "precision",
  "name",
]);

const SUPPORTED_PROPERTIES = Object.freeze([
  "opacity",
  "translateX",
  "translateY",
  "scale",
  "rotateDeg",
]);

const SUPPORTED_SOURCE = Object.freeze([
  "path geometry",
  "compound subpaths",
  "solid fill",
  "solid stroke",
  "nonzero fill",
  "evenodd fill",
]);

const UNSUPPORTED_SOURCE = Object.freeze([
  "unflattened transforms",
  "group opacity",
  "gradients",
  "text",
  "images",
  "masks",
  "filters",
  "expressions",
  "precompositions",
  "dashed strokes",
]);

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

function json(
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
  return (
    expectedBytes.length === suppliedBytes.length &&
    timingSafeEqual(expectedBytes, suppliedBytes)
  );
}

function authorisationFailure(request: Request): Response | null {
  const configuredToken = process.env.VECTOR_API_TOKEN?.trim();
  if (!configuredToken) {
    return process.env.NODE_ENV === "production"
      ? json(
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
    : json({ error: "VECTOR_API_UNAUTHORISED" }, 401);
}

function stringField(form: FormData, name: string): string | undefined {
  const value = form.get(name);
  return typeof value === "string" && value.trim()
    ? value.trim()
    : undefined;
}

function integerField(form: FormData, name: string): number | undefined {
  const value = stringField(form, name);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new LottieEngineError(
      "LOTTIE_OPTIONS_INVALID",
      `${name} must be an integer.`,
      { field: name, value },
    );
  }
  return parsed;
}

function safeDownloadName(sourceName: string): string {
  const stem = sourceName
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/^-+|-+$/g, "");
  return `${stem || "vector"}.lottie.json`;
}

function validateFormShape(form: FormData): Response | null {
  const counts = new Map<string, number>();
  const unknownFields = new Set<string>();
  let actualFieldBytes = 0;

  for (const [name, value] of form.entries()) {
    counts.set(name, (counts.get(name) ?? 0) + 1);
    if (!ALLOWED_FORM_FIELDS.has(name)) unknownFields.add(name);
    actualFieldBytes +=
      typeof value === "string"
        ? Buffer.byteLength(value, "utf8")
        : value.size;
  }

  if (unknownFields.size > 0) {
    return json(
      {
        error: "LOTTIE_REQUEST_FIELD_UNSUPPORTED",
        fields: [...unknownFields].sort(),
        allowed: [...ALLOWED_FORM_FIELDS],
      },
      400,
    );
  }

  const duplicateFields = [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([name]) => name)
    .sort();
  if (duplicateFields.length > 0) {
    return json(
      {
        error: "LOTTIE_REQUEST_FIELD_DUPLICATE",
        fields: duplicateFields,
      },
      400,
    );
  }

  if (actualFieldBytes > MAX_REQUEST_BYTES) {
    return json(
      {
        error: "LOTTIE_REQUEST_TOO_LARGE",
        actualFieldBytes,
        maxRequestBytes: MAX_REQUEST_BYTES,
      },
      413,
    );
  }
  return null;
}

function decodeUtf8(
  bytes: ArrayBuffer,
  code: "LOTTIE_SOURCE_INVALID" | "LOTTIE_OPTIONS_INVALID",
  message: string,
  details: Readonly<Record<string, unknown>>,
): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    throw new LottieEngineError(code, message, {
      ...details,
      cause: error instanceof Error ? error.message : String(error),
    });
  }
}

function parsePlanJson(
  source: string,
  descriptor: Readonly<Record<string, unknown>>,
): unknown {
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
      {
        hasInlineMotion: Boolean(inline),
        hasMotionFile: Boolean(motionFile),
      },
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

  const buffer = await motionFile.arrayBuffer();
  const source = decodeUtf8(
    buffer,
    "LOTTIE_OPTIONS_INVALID",
    "The uploaded motion plan is not valid UTF-8.",
    { field: "motionFile", name: motionFile.name },
  );
  return Object.freeze({
    plan: parsePlanJson(source, {
      field: "motionFile",
      name: motionFile.name,
    }),
    descriptor: Object.freeze({
      mode: "file",
      name: motionFile.name,
      declaredType: motionFile.type || null,
      bytes: motionFile.size,
    }),
  });
}

function lottieStatus(error: LottieEngineError): number {
  if (error.code === "LOTTIE_OPTIONS_INVALID") return 400;
  if (error.code === "LOTTIE_OUTPUT_INVALID") return 500;
  return 422;
}

function motionStatus(error: MotionEngineError): number {
  return error.code === "MOTION_SPEC_INVALID" ? 400 : 422;
}

export function GET(): Response {
  return json({
    service: "evavo-vector-studio",
    version: "v1",
    contractVersion: LOTTIE_CONTRACT_VERSION,
    execution: "bounded-synchronous",
    endpoint: "/api/v1/motion/lottie",
    input: "multipart/form-data",
    fields: {
      file: "required governed path-based static SVG",
      motion: "inline motion v1 JSON; mutually exclusive with motionFile",
      motionFile: "motion v1 JSON file; mutually exclusive with motion",
      format: ["json", "lottie"],
      frameRate: {
        default: DEFAULT_LOTTIE_FRAME_RATE,
        range: [MIN_LOTTIE_FRAME_RATE, MAX_LOTTIE_FRAME_RATE],
      },
      precision: {
        default: DEFAULT_LOTTIE_PRECISION,
        range: [0, MAX_LOTTIE_PRECISION],
      },
      name: "optional composition name, 1 to 120 characters",
    },
    strictFieldSet: true,
    limits: {
      maxSvgInputBytes: MAX_SVG_INPUT_BYTES,
      maxMotionPlanBytes: MAX_MOTION_PLAN_BYTES,
      maxRequestBytes: MAX_REQUEST_BYTES,
      maxLottieOutputBytes: MAX_LOTTIE_OUTPUT_BYTES,
      maxTracks: 64,
      maxKeyframesPerTrack: 100,
    },
    sourceSubset: {
      supported: SUPPORTED_SOURCE,
      rejected: UNSUPPORTED_SOURCE,
    },
    motionSubset: {
      properties: SUPPORTED_PROPERTIES,
      iterations: 1,
      direction: "normal",
      fillModes: ["forwards", "both"],
    },
    output: {
      mimeType: "video/lottie+json",
      structuralInspection: true,
      playerRenderValidation: false,
      dotLottiePackaging: false,
    },
    authentication: "Bearer VECTOR_API_TOKEN in production",
    approval: "human review required",
  });
}

export async function POST(request: Request): Promise<Response> {
  const authFailure = authorisationFailure(request);
  if (authFailure) return authFailure;

  const contentType =
    request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("multipart/form-data")) {
    return json(
      {
        error: "LOTTIE_REQUEST_MEDIA_TYPE_UNSUPPORTED",
        message:
          "POST /api/v1/motion/lottie requires multipart/form-data.",
      },
      415,
    );
  }

  const contentLength = Number(
    request.headers.get("content-length") ?? 0,
  );
  if (
    Number.isFinite(contentLength) &&
    contentLength > MAX_REQUEST_BYTES
  ) {
    return json(
      {
        error: "LOTTIE_REQUEST_TOO_LARGE",
        maxRequestBytes: MAX_REQUEST_BYTES,
      },
      413,
    );
  }

  try {
    if (request.signal.aborted) {
      return json(
        { error: "LOTTIE_REQUEST_ABORTED", retryable: true },
        499,
      );
    }

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return json(
        {
          error: "LOTTIE_MULTIPART_INVALID",
          message: "The multipart request could not be parsed.",
        },
        400,
      );
    }
    const shapeFailure = validateFormShape(form);
    if (shapeFailure) return shapeFailure;

    const file = form.get("file");
    if (!(file instanceof File)) {
      return json(
        { error: "LOTTIE_SVG_FILE_REQUIRED", field: "file" },
        400,
      );
    }
    if (file.size === 0) {
      return json({ error: "LOTTIE_SVG_INPUT_EMPTY" }, 400);
    }
    if (file.size > MAX_SVG_INPUT_BYTES) {
      return json(
        {
          error: "LOTTIE_SVG_INPUT_TOO_LARGE",
          maxInputBytes: MAX_SVG_INPUT_BYTES,
        },
        413,
      );
    }

    const format = stringField(form, "format") ?? "json";
    if (format !== "json" && format !== "lottie") {
      return json(
        {
          error: "LOTTIE_FORMAT_INVALID",
          field: "format",
          allowed: ["json", "lottie"],
        },
        400,
      );
    }

    const frameRate = integerField(form, "frameRate");
    const precision = integerField(form, "precision");
    const name = stringField(form, "name");
    const [sourceBuffer, motionSource] = await Promise.all([
      file.arrayBuffer(),
      readMotionPlan(form),
    ]);
    const source = decodeUtf8(
      sourceBuffer,
      "LOTTIE_SOURCE_INVALID",
      "The SVG source is not valid UTF-8.",
      { field: "file", name: file.name },
    );
    if (source.includes("\0")) {
      return json(
        {
          error: "LOTTIE_SOURCE_INVALID",
          message: "The SVG contains null bytes.",
        },
        422,
      );
    }
    if (request.signal.aborted) {
      return json(
        { error: "LOTTIE_REQUEST_ABORTED", retryable: true },
        499,
      );
    }

    const result = createLottieFromSvgMotion(
      source,
      motionSource.plan,
      { frameRate, precision, name },
    );
    if (result.evidence.output.bytes > MAX_LOTTIE_OUTPUT_BYTES) {
      return json(
        {
          error: "LOTTIE_OUTPUT_TOO_LARGE",
          outputBytes: result.evidence.output.bytes,
          maxOutputBytes: MAX_LOTTIE_OUTPUT_BYTES,
        },
        413,
      );
    }
    if (request.signal.aborted) {
      return json(
        { error: "LOTTIE_REQUEST_ABORTED", retryable: true },
        499,
      );
    }

    const jobId = createJobId();
    if (format === "lottie") {
      return new Response(result.json, {
        status: 200,
        headers: noStoreHeaders({
          "content-type": "video/lottie+json; charset=utf-8",
          "content-disposition":
            `attachment; filename="${safeDownloadName(file.name)}"`,
          "x-vector-job-id": jobId,
          "x-vector-lottie-contract": LOTTIE_CONTRACT_VERSION,
          "x-vector-review-required": "true",
          "x-vector-source-sha256": result.evidence.source.sha256,
          "x-vector-output-sha256": result.evidence.output.sha256,
          "x-vector-lottie-structural-inspection": "passed",
          "x-vector-lottie-player-validation": "not-performed",
          "x-vector-dotlottie": "unavailable",
          "x-vector-lottie-layer-count":
            String(result.evidence.output.layerCount),
          "x-vector-lottie-path-count":
            String(result.evidence.output.pathShapeCount),
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
        normalized: result.evidence.motion.normalized,
      },
      lottie: {
        mimeType: result.evidence.output.mimeType,
        encoding: "utf8-json",
        data: result.json,
      },
      inspection: result.inspection,
      evidence: result.evidence,
    });
  } catch (error) {
    if (error instanceof MotionEngineError) {
      return json(
        {
          error: error.code,
          message: error.message,
          details: error.details,
        },
        motionStatus(error),
      );
    }
    if (error instanceof LottieEngineError) {
      return json(
        {
          error: error.code,
          message: error.message,
          details: error.details,
        },
        lottieStatus(error),
      );
    }
    return json(
      {
        error: "LOTTIE_API_FAILED",
        message:
          process.env.NODE_ENV === "production"
            ? "The Lottie JSON could not be created."
            : error instanceof Error
              ? error.message
              : String(error),
      },
      500,
    );
  }
}
