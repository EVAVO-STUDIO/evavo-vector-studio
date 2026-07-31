import { createHash } from "node:crypto";
import {
  SVG_PRINT_PREFLIGHT_CONTRACT_VERSION,
  SvgPrintPreflightError,
  createJobId,
  preflightSvgForPrint,
  type SvgPrintPreflightOptions,
  type SvgPrintProfile,
} from "@evavo/vector-core";
import {
  apiAuthorisationFailure,
  apiJson,
} from "../../../../../lib/api-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_SVG_INPUT_BYTES = 5 * 1024 * 1024;
const MULTIPART_OVERHEAD_ALLOWANCE = 512 * 1024;
const MAX_REQUEST_BYTES = MAX_SVG_INPUT_BYTES + MULTIPART_OVERHEAD_ALLOWANCE;
const PROFILES = new Set<SvgPrintProfile>([
  "commercial",
  "large-format",
  "cut-vinyl",
  "screen-print",
]);
const ALLOWED_FORM_FIELDS = new Set([
  "file",
  "profile",
  "trimWidthMm",
  "trimHeightMm",
  "bleedMm",
  "dimensionToleranceMm",
  "minimumStrokePt",
  "maximumProcessColours",
  "allowText",
  "allowEmbeddedRaster",
  "allowTransparency",
]);

type FormShape = Readonly<{
  counts: ReadonlyMap<string, number>;
  actualFieldBytes: number;
}>;

function stringField(form: FormData, name: string): string | undefined {
  const value = form.get(name);
  return typeof value === "string" && value.trim()
    ? value.trim()
    : undefined;
}

function numberField(form: FormData, name: string): number | undefined {
  const raw = stringField(form, name);
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new SvgPrintPreflightError(
      "SVG_PRINT_PREFLIGHT_OPTIONS_INVALID",
      `${name} must be a finite number.`,
      { field: name, value: raw },
    );
  }
  return value;
}

function booleanField(form: FormData, name: string): boolean | undefined {
  const raw = stringField(form, name);
  if (raw === undefined) return undefined;
  const normalized = raw.toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "off"].includes(normalized)) return false;
  throw new SvgPrintPreflightError(
    "SVG_PRINT_PREFLIGHT_OPTIONS_INVALID",
    `${name} must be true or false.`,
    { field: name, value: raw },
  );
}

function inspectFormShape(form: FormData): FormShape | Response {
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
    return apiJson(
      {
        error: "VECTOR_PRINT_PREFLIGHT_FIELD_UNSUPPORTED",
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
    return apiJson(
      {
        error: "VECTOR_PRINT_PREFLIGHT_FIELD_DUPLICATE",
        fields: duplicateFields,
      },
      400,
    );
  }

  if (actualFieldBytes > MAX_REQUEST_BYTES) {
    return apiJson(
      {
        error: "VECTOR_PRINT_PREFLIGHT_REQUEST_TOO_LARGE",
        actualFieldBytes,
        maxRequestBytes: MAX_REQUEST_BYTES,
      },
      413,
    );
  }

  return Object.freeze({ counts, actualFieldBytes });
}

function decodeSvg(file: File, bytes: ArrayBuffer): string {
  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new SvgPrintPreflightError(
      "SVG_PRINT_PREFLIGHT_SOURCE_INVALID",
      "The uploaded SVG is not valid UTF-8.",
      { field: "file", name: file.name },
    );
  }
  if (source.includes("\0")) {
    throw new SvgPrintPreflightError(
      "SVG_PRINT_PREFLIGHT_SOURCE_INVALID",
      "The uploaded SVG contains null bytes.",
      { field: "file", name: file.name },
    );
  }
  return source;
}

function optionsFromForm(form: FormData): SvgPrintPreflightOptions {
  const rawProfile = stringField(form, "profile") ?? "commercial";
  if (!PROFILES.has(rawProfile as SvgPrintProfile)) {
    throw new SvgPrintPreflightError(
      "SVG_PRINT_PREFLIGHT_OPTIONS_INVALID",
      "profile must be commercial, large-format, cut-vinyl or screen-print.",
      { profile: rawProfile, allowed: [...PROFILES] },
    );
  }

  return Object.freeze({
    profile: rawProfile as SvgPrintProfile,
    trimWidthMm: numberField(form, "trimWidthMm"),
    trimHeightMm: numberField(form, "trimHeightMm"),
    bleedMm: numberField(form, "bleedMm"),
    dimensionToleranceMm: numberField(form, "dimensionToleranceMm"),
    minimumStrokePt: numberField(form, "minimumStrokePt"),
    maximumProcessColours: numberField(form, "maximumProcessColours"),
    allowText: booleanField(form, "allowText"),
    allowEmbeddedRaster: booleanField(form, "allowEmbeddedRaster"),
    allowTransparency: booleanField(form, "allowTransparency"),
  });
}

function statusFor(error: SvgPrintPreflightError): number {
  if (error.code === "SVG_PRINT_PREFLIGHT_OPTIONS_INVALID") return 400;
  if (error.code === "SVG_PRINT_PREFLIGHT_SOURCE_INVALID") return 422;
  return 422;
}

export function GET(): Response {
  return apiJson({
    service: "evavo-vector-studio",
    version: "v1",
    contractVersion: SVG_PRINT_PREFLIGHT_CONTRACT_VERSION,
    endpoint: "/api/v1/print/preflight",
    execution: "bounded-synchronous-read-only",
    input: "multipart/form-data",
    fields: Object.freeze({
      file: "required UTF-8 SVG",
      profile: Object.freeze([
        "commercial",
        "large-format",
        "cut-vinyl",
        "screen-print",
      ]),
      trimWidthMm: "optional positive physical trim width",
      trimHeightMm: "optional positive physical trim height",
      bleedMm: "optional non-negative bleed; requires both trim dimensions",
      dimensionToleranceMm: "optional physical-dimension tolerance",
      minimumStrokePt: "optional minimum printable line weight",
      maximumProcessColours: "optional maximum resolved process-colour count",
      allowText: "optional explicit live-text override",
      allowEmbeddedRaster: "optional explicit embedded-raster override",
      allowTransparency: "optional explicit transparency override",
    }),
    strictFieldSet: true,
    limits: Object.freeze({
      maxSvgInputBytes: MAX_SVG_INPUT_BYTES,
      maxRequestBytes: MAX_REQUEST_BYTES,
    }),
    checks: Object.freeze([
      "physical-dimensions",
      "viewbox-scale",
      "aspect-ratio",
      "trim-and-bleed",
      "live-text",
      "embedded-raster",
      "gradients-and-filters",
      "transparency-and-blend-modes",
      "patterns-masks-and-clip-paths",
      "contextual-paint",
      "process-colour-count",
      "minimum-line-weight",
      "transformed-strokes",
      "colour-space-review",
    ]),
    colourBoundary: Object.freeze({
      processColourTokenInspection: true,
      cmykOrSpotColourProofAvailable: false,
    }),
    authentication:
      "same-origin Vector workspace session or Bearer VECTOR_API_TOKEN",
    approval: "review-required",
  });
}

export async function POST(request: Request): Promise<Response> {
  const authFailure = apiAuthorisationFailure(request, {
    allowWorkspaceSession: true,
  });
  if (authFailure) return authFailure;

  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("multipart/form-data")) {
    return apiJson(
      {
        error: "VECTOR_PRINT_PREFLIGHT_MEDIA_TYPE_UNSUPPORTED",
        message:
          "POST /api/v1/print/preflight requires multipart/form-data.",
      },
      415,
    );
  }

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    return apiJson(
      {
        error: "VECTOR_PRINT_PREFLIGHT_REQUEST_TOO_LARGE",
        maxRequestBytes: MAX_REQUEST_BYTES,
      },
      413,
    );
  }

  try {
    if (request.signal.aborted) {
      return apiJson(
        { error: "VECTOR_PRINT_PREFLIGHT_REQUEST_ABORTED", retryable: true },
        499,
      );
    }

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return apiJson(
        {
          error: "VECTOR_PRINT_PREFLIGHT_MULTIPART_INVALID",
          message: "The multipart request could not be parsed.",
        },
        400,
      );
    }

    const shape = inspectFormShape(form);
    if (shape instanceof Response) return shape;

    const file = form.get("file");
    if (!(file instanceof File)) {
      return apiJson(
        { error: "VECTOR_PRINT_PREFLIGHT_SVG_REQUIRED", field: "file" },
        400,
      );
    }
    if (file.size === 0) {
      return apiJson({ error: "VECTOR_PRINT_PREFLIGHT_SVG_EMPTY" }, 400);
    }
    if (file.size > MAX_SVG_INPUT_BYTES) {
      return apiJson(
        {
          error: "VECTOR_PRINT_PREFLIGHT_SVG_TOO_LARGE",
          maxInputBytes: MAX_SVG_INPUT_BYTES,
        },
        413,
      );
    }
    if (!file.name.toLowerCase().endsWith(".svg")) {
      return apiJson(
        {
          error: "VECTOR_PRINT_PREFLIGHT_EXTENSION_INVALID",
          expectedExtension: ".svg",
        },
        400,
      );
    }

    const bytes = await file.arrayBuffer();
    const source = decodeSvg(file, bytes);
    if (request.signal.aborted) {
      return apiJson(
        { error: "VECTOR_PRINT_PREFLIGHT_REQUEST_ABORTED", retryable: true },
        499,
      );
    }

    const result = preflightSvgForPrint(source, optionsFromForm(form));
    const sourceSha256 = createHash("sha256")
      .update(new Uint8Array(bytes))
      .digest("hex");
    const jobId = createJobId();

    return apiJson(
      {
        ok: true,
        jobId,
        operation: "print-preflight",
        contractVersion: SVG_PRINT_PREFLIGHT_CONTRACT_VERSION,
        source: Object.freeze({
          name: file.name,
          declaredType: file.type || null,
          bytes: file.size,
          sha256: sourceSha256,
        }),
        result,
        generatedBodiesIncluded: false,
        productionApproval: false,
      },
      200,
      {
        "x-vector-job-id": jobId,
        "x-vector-print-preflight-contract":
          SVG_PRINT_PREFLIGHT_CONTRACT_VERSION,
        "x-vector-print-profile": result.profile,
        "x-vector-print-passed": String(result.passed),
        "x-vector-review-required": "true",
        "x-vector-source-sha256": sourceSha256,
      },
    );
  } catch (error) {
    if (error instanceof SvgPrintPreflightError) {
      return apiJson(
        {
          error: error.code,
          message: error.message,
          details: error.details,
          productionApproval: false,
        },
        statusFor(error),
      );
    }
    return apiJson(
      {
        error: "VECTOR_PRINT_PREFLIGHT_FAILED",
        message: "Print preflight failed without producing review evidence.",
        productionApproval: false,
      },
      500,
    );
  }
}
