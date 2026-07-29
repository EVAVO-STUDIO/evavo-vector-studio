import type {
  RasterCandidateMode,
  RasterTraceProfileSelection,
} from "@evavo/raster-engine";
import { VectorWorkerError } from "./errors.js";
import type {
  ObjectSourceReference,
  VectorWorkerOperation,
} from "./types.js";

const SHA256 = /^[a-f0-9]{64}$/;
const PORTABLE_ANIMATION_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const TRACE_PROFILES = new Set<RasterTraceProfileSelection>([
  "auto",
  "logo",
  "icon",
  "line-art",
  "illustration",
  "photo",
]);
const CANDIDATE_MODES = new Set<RasterCandidateMode>(["adaptive", "single"]);

export type TraceRasterWorkerPayload = Readonly<{
  source: ObjectSourceReference;
  outputs: Readonly<{
    svgObjectKey: string;
    evidenceObjectKey: string;
    differenceObjectKey?: string;
  }>;
  options: Readonly<{
    profile?: RasterTraceProfileSelection;
    candidateMode?: RasterCandidateMode;
    maxColours?: number;
    preservePalette?: boolean;
    optimise?: boolean;
    title?: string;
    differenceMaxDimension?: number;
  }>;
}>;

export type OptimiseSvgWorkerPayload = Readonly<{
  source: ObjectSourceReference;
  outputs: Readonly<{
    svgObjectKey: string;
    evidenceObjectKey: string;
  }>;
}>;

export type AnimateSvgWorkerPayload = Readonly<{
  source: ObjectSourceReference;
  motion: Readonly<Record<string, unknown>>;
  outputs: Readonly<{
    svgObjectKey: string;
    evidenceObjectKey: string;
  }>;
}>;

export type ExportLottieWorkerPayload = Readonly<{
  source: ObjectSourceReference;
  motion: Readonly<Record<string, unknown>>;
  outputs: Readonly<{
    lottieObjectKey: string;
    evidenceObjectKey: string;
  }>;
  options: Readonly<{
    frameRate?: number;
    precision?: number;
    name?: string;
  }>;
}>;

export type PackageDotLottieWorkerPayload = Readonly<{
  source: ObjectSourceReference;
  outputs: Readonly<{
    archiveObjectKey: string;
    evidenceObjectKey: string;
  }>;
  animationId?: string;
}>;

export type VectorWorkerPayload =
  | Readonly<{ operation: "trace-raster"; value: TraceRasterWorkerPayload }>
  | Readonly<{ operation: "optimise-svg"; value: OptimiseSvgWorkerPayload }>
  | Readonly<{ operation: "animate-svg"; value: AnimateSvgWorkerPayload }>
  | Readonly<{ operation: "export-lottie"; value: ExportLottieWorkerPayload }>
  | Readonly<{ operation: "package-dotlottie"; value: PackageDotLottieWorkerPayload }>;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function fail(
  message: string,
  details: Readonly<Record<string, unknown>> = {},
): never {
  throw new VectorWorkerError(
    "VECTOR_WORKER_PAYLOAD_INVALID",
    message,
    { details },
  );
}

function knownKeys(
  source: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
): void {
  const allowedSet = new Set(allowed);
  const unknownKeys = Object.keys(source).filter((key) => !allowedSet.has(key));
  if (unknownKeys.length > 0) {
    fail(`${label} contains unsupported fields.`, { label, unknownKeys });
  }
}

function requiredObject(
  source: Record<string, unknown>,
  key: string,
  label: string,
): Record<string, unknown> {
  const value = record(source[key]);
  if (!value) fail(`${label}.${key} must be an object.`, { label, key });
  return value;
}

function requiredString(
  source: Record<string, unknown>,
  key: string,
  label: string,
  maximum = 1024,
): string {
  const value = source[key];
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.length > maximum
  ) {
    fail(`${label}.${key} must contain 1 to ${maximum} characters.`, {
      label,
      key,
      value,
    });
  }
  return value.trim();
}

function optionalString(
  source: Record<string, unknown>,
  key: string,
  label: string,
  maximum: number,
): string | undefined {
  if (source[key] === undefined) return undefined;
  return requiredString(source, key, label, maximum);
}

function optionalBoolean(
  source: Record<string, unknown>,
  key: string,
  label: string,
): boolean | undefined {
  const value = source[key];
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") fail(`${label}.${key} must be boolean.`, { value });
  return value;
}

function optionalInteger(
  source: Record<string, unknown>,
  key: string,
  label: string,
  minimum: number,
  maximum: number,
): number | undefined {
  const value = source[key];
  if (value === undefined) return undefined;
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    fail(`${label}.${key} must be an integer from ${minimum} to ${maximum}.`, {
      value,
    });
  }
  return value;
}

function sourceReference(
  source: Record<string, unknown>,
  label: string,
): ObjectSourceReference {
  knownKeys(source, ["objectKey", "sha256"], label);
  const objectKey = requiredString(source, "objectKey", label);
  const sha256 = requiredString(source, "sha256", label, 64);
  if (!SHA256.test(sha256)) {
    fail(`${label}.sha256 must be lowercase hexadecimal SHA-256.`, { sha256 });
  }
  return Object.freeze({ objectKey, sha256 });
}

function motionPlan(value: unknown, label: string): Readonly<Record<string, unknown>> {
  const source = record(value);
  if (!source) fail(`${label} must be a motion-v1 object.`);
  return Object.freeze({ ...source });
}

function parseTrace(source: Record<string, unknown>): TraceRasterWorkerPayload {
  knownKeys(source, ["source", "outputs", "options"], "payload");
  const outputs = requiredObject(source, "outputs", "payload");
  knownKeys(
    outputs,
    ["svgObjectKey", "evidenceObjectKey", "differenceObjectKey"],
    "payload.outputs",
  );
  const options = source.options === undefined
    ? {}
    : requiredObject(source, "options", "payload");
  knownKeys(
    options,
    [
      "profile",
      "candidateMode",
      "maxColours",
      "preservePalette",
      "optimise",
      "title",
      "differenceMaxDimension",
    ],
    "payload.options",
  );
  const profile = optionalString(options, "profile", "payload.options", 32);
  if (profile !== undefined && !TRACE_PROFILES.has(profile as RasterTraceProfileSelection)) {
    fail("payload.options.profile is unsupported.", { profile });
  }
  const candidateMode = optionalString(
    options,
    "candidateMode",
    "payload.options",
    32,
  );
  if (
    candidateMode !== undefined &&
    !CANDIDATE_MODES.has(candidateMode as RasterCandidateMode)
  ) {
    fail("payload.options.candidateMode is unsupported.", { candidateMode });
  }
  const differenceObjectKey = optionalString(
    outputs,
    "differenceObjectKey",
    "payload.outputs",
    1024,
  );
  const differenceMaxDimension = optionalInteger(
    options,
    "differenceMaxDimension",
    "payload.options",
    32,
    1024,
  );
  if (differenceMaxDimension !== undefined && differenceObjectKey === undefined) {
    fail("differenceMaxDimension requires differenceObjectKey.");
  }
  return Object.freeze({
    source: sourceReference(
      requiredObject(source, "source", "payload"),
      "payload.source",
    ),
    outputs: Object.freeze({
      svgObjectKey: requiredString(
        outputs,
        "svgObjectKey",
        "payload.outputs",
      ),
      evidenceObjectKey: requiredString(
        outputs,
        "evidenceObjectKey",
        "payload.outputs",
      ),
      ...(differenceObjectKey ? { differenceObjectKey } : {}),
    }),
    options: Object.freeze({
      ...(profile ? { profile: profile as RasterTraceProfileSelection } : {}),
      ...(candidateMode
        ? { candidateMode: candidateMode as RasterCandidateMode }
        : {}),
      ...(optionalInteger(
        options,
        "maxColours",
        "payload.options",
        1,
        256,
      ) !== undefined
        ? {
            maxColours: optionalInteger(
              options,
              "maxColours",
              "payload.options",
              1,
              256,
            ),
          }
        : {}),
      ...(optionalBoolean(
        options,
        "preservePalette",
        "payload.options",
      ) !== undefined
        ? {
            preservePalette: optionalBoolean(
              options,
              "preservePalette",
              "payload.options",
            ),
          }
        : {}),
      ...(optionalBoolean(options, "optimise", "payload.options") !== undefined
        ? { optimise: optionalBoolean(options, "optimise", "payload.options") }
        : {}),
      ...(optionalString(options, "title", "payload.options", 200)
        ? { title: optionalString(options, "title", "payload.options", 200) }
        : {}),
      ...(differenceMaxDimension !== undefined ? { differenceMaxDimension } : {}),
    }),
  });
}

function parseOptimise(source: Record<string, unknown>): OptimiseSvgWorkerPayload {
  knownKeys(source, ["source", "outputs"], "payload");
  const outputs = requiredObject(source, "outputs", "payload");
  knownKeys(outputs, ["svgObjectKey", "evidenceObjectKey"], "payload.outputs");
  return Object.freeze({
    source: sourceReference(
      requiredObject(source, "source", "payload"),
      "payload.source",
    ),
    outputs: Object.freeze({
      svgObjectKey: requiredString(outputs, "svgObjectKey", "payload.outputs"),
      evidenceObjectKey: requiredString(
        outputs,
        "evidenceObjectKey",
        "payload.outputs",
      ),
    }),
  });
}

function parseAnimate(source: Record<string, unknown>): AnimateSvgWorkerPayload {
  knownKeys(source, ["source", "motion", "outputs"], "payload");
  const outputs = requiredObject(source, "outputs", "payload");
  knownKeys(outputs, ["svgObjectKey", "evidenceObjectKey"], "payload.outputs");
  return Object.freeze({
    source: sourceReference(
      requiredObject(source, "source", "payload"),
      "payload.source",
    ),
    motion: motionPlan(source.motion, "payload.motion"),
    outputs: Object.freeze({
      svgObjectKey: requiredString(outputs, "svgObjectKey", "payload.outputs"),
      evidenceObjectKey: requiredString(
        outputs,
        "evidenceObjectKey",
        "payload.outputs",
      ),
    }),
  });
}

function parseLottie(source: Record<string, unknown>): ExportLottieWorkerPayload {
  knownKeys(source, ["source", "motion", "outputs", "options"], "payload");
  const outputs = requiredObject(source, "outputs", "payload");
  knownKeys(
    outputs,
    ["lottieObjectKey", "evidenceObjectKey"],
    "payload.outputs",
  );
  const options = source.options === undefined
    ? {}
    : requiredObject(source, "options", "payload");
  knownKeys(options, ["frameRate", "precision", "name"], "payload.options");
  const frameRate = optionalInteger(
    options,
    "frameRate",
    "payload.options",
    1,
    120,
  );
  const precision = optionalInteger(
    options,
    "precision",
    "payload.options",
    0,
    6,
  );
  const name = optionalString(options, "name", "payload.options", 120);
  return Object.freeze({
    source: sourceReference(
      requiredObject(source, "source", "payload"),
      "payload.source",
    ),
    motion: motionPlan(source.motion, "payload.motion"),
    outputs: Object.freeze({
      lottieObjectKey: requiredString(
        outputs,
        "lottieObjectKey",
        "payload.outputs",
      ),
      evidenceObjectKey: requiredString(
        outputs,
        "evidenceObjectKey",
        "payload.outputs",
      ),
    }),
    options: Object.freeze({
      ...(frameRate !== undefined ? { frameRate } : {}),
      ...(precision !== undefined ? { precision } : {}),
      ...(name ? { name } : {}),
    }),
  });
}

function parseDotLottie(
  source: Record<string, unknown>,
): PackageDotLottieWorkerPayload {
  knownKeys(source, ["source", "outputs", "animationId"], "payload");
  const outputs = requiredObject(source, "outputs", "payload");
  knownKeys(
    outputs,
    ["archiveObjectKey", "evidenceObjectKey"],
    "payload.outputs",
  );
  const animationId = optionalString(source, "animationId", "payload", 64);
  if (animationId !== undefined && !PORTABLE_ANIMATION_ID.test(animationId)) {
    fail("payload.animationId is not portable.", { animationId });
  }
  return Object.freeze({
    source: sourceReference(
      requiredObject(source, "source", "payload"),
      "payload.source",
    ),
    outputs: Object.freeze({
      archiveObjectKey: requiredString(
        outputs,
        "archiveObjectKey",
        "payload.outputs",
      ),
      evidenceObjectKey: requiredString(
        outputs,
        "evidenceObjectKey",
        "payload.outputs",
      ),
    }),
    ...(animationId ? { animationId } : {}),
  });
}

export function validateVectorWorkerPayload(
  operation: string,
  payload: unknown,
): VectorWorkerPayload {
  const source = record(payload);
  if (!source) fail("The vector worker payload must be an object.");
  switch (operation as VectorWorkerOperation) {
    case "trace-raster":
      return Object.freeze({ operation: "trace-raster", value: parseTrace(source) });
    case "optimise-svg":
      return Object.freeze({ operation: "optimise-svg", value: parseOptimise(source) });
    case "animate-svg":
      return Object.freeze({ operation: "animate-svg", value: parseAnimate(source) });
    case "export-lottie":
      return Object.freeze({ operation: "export-lottie", value: parseLottie(source) });
    case "package-dotlottie":
      return Object.freeze({ operation: "package-dotlottie", value: parseDotLottie(source) });
    default:
      throw new VectorWorkerError(
        "VECTOR_WORKER_OPERATION_UNSUPPORTED",
        "The hosted job operation is not supported by this vector worker.",
        { details: { operation } },
      );
  }
}
