import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  BatchEngineError,
  type BatchOperationContext,
  type BatchOperationDescriptor,
  type BatchOperationHandler,
  type BatchOperationRegistry,
  type BatchOutputReceipt,
} from "@evavo/job-engine";
import {
  DEFAULT_DIFFERENCE_MAX_DIMENSION,
  MAX_DIFFERENCE_DIMENSION,
  traceRaster,
  type RasterCandidateMode,
  type RasterTraceOptions,
  type RasterTraceProfileSelection,
} from "@evavo/raster-engine";
import {
  createAnimatedSvg,
} from "@evavo/motion-engine";
import {
  DEFAULT_LOTTIE_FRAME_RATE,
  DEFAULT_LOTTIE_PRECISION,
  MAX_LOTTIE_FRAME_RATE,
  MAX_LOTTIE_PRECISION,
  MIN_LOTTIE_FRAME_RATE,
  createDotLottiePackage,
  createLottieFromSvgMotion,
} from "@evavo/lottie-engine";
import { optimiseSvg } from "@evavo/vector-core";
import {
  commitNewOutputFiles,
  type CliOutputReceipt,
  type CliOutputWrite,
} from "./output-transaction.js";

const TRACE_PROFILES = new Set<RasterTraceProfileSelection>([
  "auto",
  "logo",
  "icon",
  "line-art",
  "illustration",
  "photo",
]);
const CANDIDATE_MODES = new Set<RasterCandidateMode>([
  "adaptive",
  "single",
]);

const TRACE_KEYS = new Set([
  "inputPath",
  "outputSvgPath",
  "differenceOutputPath",
  "evidenceOutputPath",
  "profile",
  "candidateMode",
  "maxColours",
  "preservePalette",
  "optimise",
  "title",
  "differenceMaxDimension",
]);
const OPTIMISE_KEYS = new Set([
  "inputPath",
  "outputPath",
  "evidenceOutputPath",
]);
const ANIMATE_KEYS = new Set([
  "inputPath",
  "motionPath",
  "outputPath",
  "evidenceOutputPath",
]);
const LOTTIE_KEYS = new Set([
  "inputPath",
  "motionPath",
  "outputPath",
  "evidenceOutputPath",
  "frameRate",
  "precision",
  "name",
]);
const DOTLOTTIE_KEYS = new Set([
  "inputPath",
  "outputPath",
  "evidenceOutputPath",
  "animationId",
]);

function fail(
  context: BatchOperationContext,
  message: string,
  details: Readonly<Record<string, unknown>> = {},
): never {
  throw new BatchEngineError("BATCH_OPERATION_FAILED", message, {
    details: { itemId: context.item.id, ...details },
  });
}

function assertKnownKeys(
  context: BatchOperationContext,
  allowed: ReadonlySet<string>,
): void {
  const unknownKeys = Object.keys(context.item.spec).filter(
    (key) => !allowed.has(key),
  );
  if (unknownKeys.length > 0) {
    fail(context, "The batch operation spec contains unsupported fields.", {
      unknownKeys,
    });
  }
}

function requiredString(
  context: BatchOperationContext,
  key: string,
  maximum = 4096,
): string {
  const value = context.item.spec[key];
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.length > maximum
  ) {
    fail(context, `${key} must contain 1 to ${maximum} characters.`, {
      key,
      value,
    });
  }
  return value.trim();
}

function optionalString(
  context: BatchOperationContext,
  key: string,
  maximum: number,
): string | undefined {
  const value = context.item.spec[key];
  if (value === undefined) return undefined;
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.length > maximum
  ) {
    fail(context, `${key} must contain 1 to ${maximum} characters.`, {
      key,
      value,
    });
  }
  return value.trim();
}

function optionalBoolean(
  context: BatchOperationContext,
  key: string,
): boolean | undefined {
  const value = context.item.spec[key];
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") {
    fail(context, `${key} must be a boolean.`, { key, value });
  }
  return value;
}

function optionalInteger(
  context: BatchOperationContext,
  key: string,
  minimum: number,
  maximum: number,
): number | undefined {
  const value = context.item.spec[key];
  if (value === undefined) return undefined;
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    fail(context, `${key} must be an integer from ${minimum} to ${maximum}.`, {
      key,
      value,
      minimum,
      maximum,
    });
  }
  return value;
}

function rootPath(
  context: BatchOperationContext,
  key: string,
): string {
  const requested = requiredString(context, key);
  const root = path.resolve(context.rootPath);
  const resolved = path.resolve(root, requested);
  const relative = path.relative(root, resolved);
  if (
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    fail(context, `${key} must stay inside the batch root.`, {
      key,
      requested,
      root,
      resolved,
    });
  }
  return resolved;
}

function assertExtension(
  context: BatchOperationContext,
  value: string,
  extension: string,
  key: string,
): void {
  if (!value.toLowerCase().endsWith(extension.toLowerCase())) {
    fail(context, `${key} must use the ${extension} extension.`, {
      key,
      value,
      extension,
    });
  }
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  const source = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(source)
      .sort()
      .map((key) => [key, stableValue(source[key])]),
  );
}

async function descriptor(
  context: BatchOperationContext,
  inputPaths: readonly string[],
  outputPaths: readonly string[],
): Promise<BatchOperationDescriptor> {
  const hash = createHash("sha256");
  hash.update(context.item.operation, "utf8");
  hash.update("\0", "utf8");
  hash.update(JSON.stringify(stableValue(context.item.spec)), "utf8");
  let totalInputBytes = 0;
  for (const inputPath of inputPaths) {
    const bytes = await readFile(inputPath);
    totalInputBytes += bytes.byteLength;
    hash.update("\0", "utf8");
    hash.update(path.relative(context.rootPath, inputPath), "utf8");
    hash.update("\0", "utf8");
    hash.update(bytes);
  }
  return Object.freeze({
    revision: hash.digest("hex"),
    inputPaths: Object.freeze([...inputPaths]),
    outputPaths: Object.freeze([...outputPaths]),
    summary: Object.freeze({ totalInputBytes }),
  });
}

function jsonEvidence(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function batchReceipts(
  receipts: readonly CliOutputReceipt[],
): readonly BatchOutputReceipt[] {
  return Object.freeze(
    receipts.map((receipt) => Object.freeze({ ...receipt })),
  );
}

async function commit(
  writes: readonly CliOutputWrite[],
): Promise<readonly BatchOutputReceipt[]> {
  return batchReceipts(await commitNewOutputFiles(writes));
}

function traceHandler(): BatchOperationHandler {
  return Object.freeze({
    async describe(context) {
      assertKnownKeys(context, TRACE_KEYS);
      const inputPath = rootPath(context, "inputPath");
      const outputSvgPath = rootPath(context, "outputSvgPath");
      const evidenceOutputPath = rootPath(context, "evidenceOutputPath");
      assertExtension(context, outputSvgPath, ".svg", "outputSvgPath");
      assertExtension(context, evidenceOutputPath, ".json", "evidenceOutputPath");
      const differenceOutputPath = context.item.spec.differenceOutputPath === undefined
        ? null
        : rootPath(context, "differenceOutputPath");
      if (differenceOutputPath) {
        assertExtension(context, differenceOutputPath, ".png", "differenceOutputPath");
      }
      return descriptor(
        context,
        [inputPath],
        [
          outputSvgPath,
          ...(differenceOutputPath ? [differenceOutputPath] : []),
          evidenceOutputPath,
        ],
      );
    },
    async execute(context, planned) {
      const inputPath = planned.inputPaths[0]!;
      const outputSvgPath = planned.outputPaths[0]!;
      const differenceRequested = context.item.spec.differenceOutputPath !== undefined;
      const evidenceOutputPath = planned.outputPaths.at(-1)!;
      const differenceOutputPath = differenceRequested
        ? planned.outputPaths[1]!
        : null;
      const rawProfile = context.item.spec.profile ?? "auto";
      if (
        typeof rawProfile !== "string" ||
        !TRACE_PROFILES.has(rawProfile as RasterTraceProfileSelection)
      ) {
        fail(context, "profile is not a supported trace profile.", {
          profile: rawProfile,
        });
      }
      const rawCandidateMode = context.item.spec.candidateMode ?? "adaptive";
      if (
        typeof rawCandidateMode !== "string" ||
        !CANDIDATE_MODES.has(rawCandidateMode as RasterCandidateMode)
      ) {
        fail(context, "candidateMode must be adaptive or single.", {
          candidateMode: rawCandidateMode,
        });
      }
      const differenceMaxDimension = optionalInteger(
        context,
        "differenceMaxDimension",
        32,
        MAX_DIFFERENCE_DIMENSION,
      );
      if (differenceMaxDimension !== undefined && !differenceOutputPath) {
        fail(
          context,
          "differenceMaxDimension requires differenceOutputPath.",
        );
      }
      const options: RasterTraceOptions = Object.freeze({
        sourceName: path.basename(inputPath),
        profile: rawProfile as RasterTraceProfileSelection,
        candidateMode: rawCandidateMode as RasterCandidateMode,
        maxColours: optionalInteger(context, "maxColours", 1, 256),
        preservePalette: optionalBoolean(context, "preservePalette"),
        optimise: optionalBoolean(context, "optimise"),
        title: optionalString(context, "title", 200),
        includeDifferenceArtifact: Boolean(differenceOutputPath),
        differenceMaxDimension:
          differenceMaxDimension ?? DEFAULT_DIFFERENCE_MAX_DIMENSION,
        signal: context.signal,
      });
      const source = await readFile(inputPath);
      const result = await traceRaster(source, options);
      const differencePng = result.artifacts.differencePng;
      if (differenceOutputPath && !differencePng) {
        fail(context, "The trace did not produce the requested difference PNG.");
      }
      const evidenceDocument = Object.freeze({
        operation: context.item.operation,
        batchContractVersion: context.manifest.version,
        jobId: context.manifest.id,
        itemId: context.item.id,
        attempt: context.attempt,
        revision: planned.revision,
        inputPath,
        outputSvgPath,
        differenceOutputPath,
        inspection: result.inspection,
        evidence: result.evidence,
      });
      const receipts = await commit([
        {
          path: outputSvgPath,
          data: result.svg,
          mimeType: "image/svg+xml",
        },
        ...(differenceOutputPath && differencePng
          ? [{
              path: differenceOutputPath,
              data: differencePng,
              mimeType: "image/png",
            }]
          : []),
        {
          path: evidenceOutputPath,
          data: jsonEvidence(evidenceDocument),
          mimeType: "application/json",
        },
      ]);
      return Object.freeze({
        revision: planned.revision,
        outputs: receipts,
        evidence: Object.freeze({
          approval: result.evidence.qualityGates.productionApproval,
          renderComparison: result.evidence.qualityGates.renderComparison,
          selectedCandidateId: result.evidence.selection.selectedCandidateId,
          candidateCount: result.evidence.selection.attemptedCandidateCount,
        }),
      });
    },
  });
}

function optimiseHandler(): BatchOperationHandler {
  return Object.freeze({
    async describe(context) {
      assertKnownKeys(context, OPTIMISE_KEYS);
      const inputPath = rootPath(context, "inputPath");
      const outputPath = rootPath(context, "outputPath");
      const evidenceOutputPath = rootPath(context, "evidenceOutputPath");
      assertExtension(context, inputPath, ".svg", "inputPath");
      assertExtension(context, outputPath, ".svg", "outputPath");
      assertExtension(context, evidenceOutputPath, ".json", "evidenceOutputPath");
      return descriptor(
        context,
        [inputPath],
        [outputPath, evidenceOutputPath],
      );
    },
    async execute(context, planned) {
      const [inputPath] = planned.inputPaths;
      const [outputPath, evidenceOutputPath] = planned.outputPaths;
      const source = await readFile(inputPath!, "utf8");
      const result = optimiseSvg(source);
      if (!result.inspection.valid) {
        fail(context, "The optimized SVG failed governed inspection.", {
          findings: result.inspection.findings,
        });
      }
      const evidenceDocument = Object.freeze({
        operation: context.item.operation,
        jobId: context.manifest.id,
        itemId: context.item.id,
        attempt: context.attempt,
        revision: planned.revision,
        inputPath,
        outputPath,
        beforeBytes: result.beforeBytes,
        afterBytes: result.afterBytes,
        bytesSaved: result.bytesSaved,
        inspection: result.inspection,
      });
      const receipts = await commit([
        { path: outputPath!, data: result.svg, mimeType: "image/svg+xml" },
        {
          path: evidenceOutputPath!,
          data: jsonEvidence(evidenceDocument),
          mimeType: "application/json",
        },
      ]);
      return Object.freeze({
        revision: planned.revision,
        outputs: receipts,
        evidence: Object.freeze({ bytesSaved: result.bytesSaved }),
      });
    },
  });
}

function animateHandler(): BatchOperationHandler {
  return Object.freeze({
    async describe(context) {
      assertKnownKeys(context, ANIMATE_KEYS);
      const inputPath = rootPath(context, "inputPath");
      const motionPath = rootPath(context, "motionPath");
      const outputPath = rootPath(context, "outputPath");
      const evidenceOutputPath = rootPath(context, "evidenceOutputPath");
      assertExtension(context, inputPath, ".svg", "inputPath");
      assertExtension(context, motionPath, ".json", "motionPath");
      assertExtension(context, outputPath, ".svg", "outputPath");
      assertExtension(context, evidenceOutputPath, ".json", "evidenceOutputPath");
      return descriptor(
        context,
        [inputPath, motionPath],
        [outputPath, evidenceOutputPath],
      );
    },
    async execute(context, planned) {
      const [inputPath, motionPath] = planned.inputPaths;
      const [outputPath, evidenceOutputPath] = planned.outputPaths;
      const [source, motionSource] = await Promise.all([
        readFile(inputPath!, "utf8"),
        readFile(motionPath!, "utf8"),
      ]);
      const motionPlan = JSON.parse(motionSource) as unknown;
      const result = createAnimatedSvg(source, motionPlan);
      const evidenceDocument = Object.freeze({
        operation: context.item.operation,
        jobId: context.manifest.id,
        itemId: context.item.id,
        attempt: context.attempt,
        revision: planned.revision,
        inputPath,
        motionPath,
        outputPath,
        inspection: result.inspection,
        evidence: result.evidence,
      });
      const receipts = await commit([
        { path: outputPath!, data: result.svg, mimeType: "image/svg+xml" },
        {
          path: evidenceOutputPath!,
          data: jsonEvidence(evidenceDocument),
          mimeType: "application/json",
        },
      ]);
      return Object.freeze({
        revision: planned.revision,
        outputs: receipts,
        evidence: Object.freeze({
          approval: result.evidence.approval,
          motionId: result.evidence.motion.id,
          reducedMotionFallback: result.inspection.reducedMotionFallback,
        }),
      });
    },
  });
}

function lottieHandler(): BatchOperationHandler {
  return Object.freeze({
    async describe(context) {
      assertKnownKeys(context, LOTTIE_KEYS);
      const inputPath = rootPath(context, "inputPath");
      const motionPath = rootPath(context, "motionPath");
      const outputPath = rootPath(context, "outputPath");
      const evidenceOutputPath = rootPath(context, "evidenceOutputPath");
      assertExtension(context, inputPath, ".svg", "inputPath");
      assertExtension(context, motionPath, ".json", "motionPath");
      assertExtension(context, outputPath, ".json", "outputPath");
      assertExtension(context, evidenceOutputPath, ".json", "evidenceOutputPath");
      return descriptor(
        context,
        [inputPath, motionPath],
        [outputPath, evidenceOutputPath],
      );
    },
    async execute(context, planned) {
      const [inputPath, motionPath] = planned.inputPaths;
      const [outputPath, evidenceOutputPath] = planned.outputPaths;
      const [source, motionSource] = await Promise.all([
        readFile(inputPath!, "utf8"),
        readFile(motionPath!, "utf8"),
      ]);
      const frameRate = optionalInteger(
        context,
        "frameRate",
        MIN_LOTTIE_FRAME_RATE,
        MAX_LOTTIE_FRAME_RATE,
      );
      const precision = optionalInteger(
        context,
        "precision",
        0,
        MAX_LOTTIE_PRECISION,
      );
      const result = createLottieFromSvgMotion(
        source,
        JSON.parse(motionSource) as unknown,
        {
          frameRate,
          precision,
          name: optionalString(context, "name", 120),
        },
      );
      const evidenceDocument = Object.freeze({
        operation: context.item.operation,
        jobId: context.manifest.id,
        itemId: context.item.id,
        attempt: context.attempt,
        revision: planned.revision,
        inputPath,
        motionPath,
        outputPath,
        options: Object.freeze({
          frameRate: frameRate ?? DEFAULT_LOTTIE_FRAME_RATE,
          precision: precision ?? DEFAULT_LOTTIE_PRECISION,
          name: optionalString(context, "name", 120) ?? null,
        }),
        inspection: result.inspection,
        evidence: result.evidence,
      });
      const receipts = await commit([
        {
          path: outputPath!,
          data: result.json,
          mimeType: "video/lottie+json",
        },
        {
          path: evidenceOutputPath!,
          data: jsonEvidence(evidenceDocument),
          mimeType: "application/json",
        },
      ]);
      return Object.freeze({
        revision: planned.revision,
        outputs: receipts,
        evidence: Object.freeze({
          approval: result.evidence.approval,
          compatibility: result.evidence.compatibility,
          layerCount: result.evidence.output.layerCount,
        }),
      });
    },
  });
}

function dotLottieHandler(): BatchOperationHandler {
  return Object.freeze({
    async describe(context) {
      assertKnownKeys(context, DOTLOTTIE_KEYS);
      const inputPath = rootPath(context, "inputPath");
      const outputPath = rootPath(context, "outputPath");
      const evidenceOutputPath = rootPath(context, "evidenceOutputPath");
      assertExtension(context, inputPath, ".json", "inputPath");
      assertExtension(context, outputPath, ".lottie", "outputPath");
      assertExtension(context, evidenceOutputPath, ".json", "evidenceOutputPath");
      return descriptor(
        context,
        [inputPath],
        [outputPath, evidenceOutputPath],
      );
    },
    async execute(context, planned) {
      const [inputPath] = planned.inputPaths;
      const [outputPath, evidenceOutputPath] = planned.outputPaths;
      const source = await readFile(inputPath!, "utf8");
      const result = createDotLottiePackage(source, {
        animationId: optionalString(context, "animationId", 64),
      });
      const evidenceDocument = Object.freeze({
        operation: context.item.operation,
        jobId: context.manifest.id,
        itemId: context.item.id,
        attempt: context.attempt,
        revision: planned.revision,
        inputPath,
        outputPath,
        manifest: result.manifest,
        inspection: result.inspection,
        evidence: result.evidence,
      });
      const receipts = await commit([
        {
          path: outputPath!,
          data: result.bytes,
          mimeType: "application/zip+dotlottie",
        },
        {
          path: evidenceOutputPath!,
          data: jsonEvidence(evidenceDocument),
          mimeType: "application/json",
        },
      ]);
      return Object.freeze({
        revision: planned.revision,
        outputs: receipts,
        evidence: Object.freeze({
          approval: result.evidence.approval,
          compatibility: result.evidence.compatibility,
          animationId: result.manifest.initial.animation,
        }),
      });
    },
  });
}

export const VECTOR_BATCH_OPERATION_NAMES = Object.freeze([
  "trace-raster",
  "optimise-svg",
  "animate-svg",
  "export-lottie",
  "package-dotlottie",
] as const);

export function createVectorBatchOperationRegistry(): BatchOperationRegistry {
  return Object.freeze({
    "trace-raster": traceHandler(),
    "optimise-svg": optimiseHandler(),
    "animate-svg": animateHandler(),
    "export-lottie": lottieHandler(),
    "package-dotlottie": dotLottieHandler(),
  });
}
