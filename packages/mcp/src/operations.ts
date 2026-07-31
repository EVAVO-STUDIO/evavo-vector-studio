import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  createAnimatedSvg,
  inspectAnimatedSvg,
  validateAnimatedSvgMotionSpec,
  type NormalizedAnimatedSvgMotionSpec,
} from "@evavo/motion-engine";
import {
  DEFAULT_DIFFERENCE_MAX_DIMENSION,
  DEFAULT_MAX_INPUT_BYTES,
  DEFAULT_MAX_PIXELS,
  MAX_DIFFERENCE_DIMENSION,
  RASTER_INPUT_POLICY,
  createRasterRuntimeGuard,
  inspectRaster as inspectRasterEngine,
  resolveRasterRuntimeGuardConfigFromEnvironment,
  traceRaster as traceRasterEngine,
  type RasterCandidateMode,
  type RasterDeliveryProfile,
  type RasterRuntimeGuard,
  type RasterTraceProfileSelection,
  type RasterTraceResult,
} from "@evavo/raster-engine";
import { inspectSvg, optimiseSvg } from "@evavo/vector-core";
import { VectorMcpOperationError } from "./errors.js";
import { commitNewVectorFiles, type VectorMcpFileReceipt } from "./file-transaction.js";
import type { VectorMcpPathPolicy } from "./path-policy.js";

export const VECTOR_MCP_VERSION = "0.4.0";
export const VECTOR_MCP_CONTRACT_VERSION = "1.2";

export const VECTOR_MCP_TOOL_NAMES = Object.freeze([
  "vector_capabilities",
  "vector_input_policy",
  "vector_inspect_raster",
  "vector_trace_raster",
  "vector_inspect_svg",
  "vector_optimise_svg",
  "vector_validate_motion_plan",
  "vector_animate_svg",
  "vector_inspect_animated_svg",
] as const);

const DELIVERY_PROFILES = new Set<RasterDeliveryProfile>(["editable", "web", "motion", "print"]);
const STABLE_ID_PREFIX = /^[A-Za-z_][A-Za-z0-9_.-]{0,47}$/;

export type VectorMcpEvidenceLevel = "summary" | "full";

export type VectorMcpTraceRequest = Readonly<{
  inputPath: string;
  outputSvgPath: string;
  differenceOutputPath?: string;
  profile?: RasterTraceProfileSelection;
  candidateMode?: RasterCandidateMode;
  deliveryProfile?: RasterDeliveryProfile;
  stableIdPrefix?: string;
  maxColours?: number;
  preservePalette?: boolean;
  optimise?: boolean;
  title?: string;
  differenceMaxDimension?: number;
  evidenceLevel?: VectorMcpEvidenceLevel;
}>;

export type VectorMcpOptimiseRequest = Readonly<{
  inputPath: string;
  outputPath: string;
  deliveryProfile?: RasterDeliveryProfile;
  stableIdPrefix?: string;
}>;

export type VectorMcpMotionPlanSource = Readonly<{
  motionPath?: string;
  motionPlan?: unknown;
}>;

export type VectorMcpValidateMotionRequest = VectorMcpMotionPlanSource & Readonly<{
  normalizedOutputPath?: string;
}>;

export type VectorMcpAnimateSvgRequest = VectorMcpMotionPlanSource & Readonly<{
  inputPath: string;
  outputSvgPath: string;
  evidenceOutputPath?: string;
}>;

export type VectorMcpOperations = Readonly<{
  capabilities: () => Readonly<Record<string, unknown>>;
  inputPolicy: () => Readonly<Record<string, unknown>>;
  inspectRaster: (inputPath: string, signal?: AbortSignal) => Promise<Readonly<Record<string, unknown>>>;
  traceRaster: (request: VectorMcpTraceRequest, signal?: AbortSignal) => Promise<Readonly<Record<string, unknown>>>;
  inspectSvg: (inputPath: string) => Promise<Readonly<Record<string, unknown>>>;
  optimiseSvg: (request: VectorMcpOptimiseRequest) => Promise<Readonly<Record<string, unknown>>>;
  validateMotionPlan: (
    request: VectorMcpValidateMotionRequest,
    signal?: AbortSignal,
  ) => Promise<Readonly<Record<string, unknown>>>;
  animateSvg: (
    request: VectorMcpAnimateSvgRequest,
    signal?: AbortSignal,
  ) => Promise<Readonly<Record<string, unknown>>>;
  inspectAnimatedSvg: (inputPath: string) => Promise<Readonly<Record<string, unknown>>>;
}>;

export type VectorMcpOperationsOptions = Readonly<{
  pathPolicy: VectorMcpPathPolicy;
  runtimeGuard?: RasterRuntimeGuard;
}>;

type ResolvedMotionPlan = Readonly<{
  normalized: NormalizedAnimatedSvgMotionSpec;
  canonicalJson: string;
  sha256: string;
  source: Readonly<Record<string, unknown>>;
  resolvedPath: string | null;
}>;

type ResolvedDeliveryOptions = Readonly<{
  deliveryProfile: RasterDeliveryProfile;
  stableIdPrefix?: string;
}>;

function assertEvidenceLevel(value: VectorMcpEvidenceLevel | undefined): VectorMcpEvidenceLevel {
  if (value === undefined || value === "summary" || value === "full") return value ?? "summary";
  throw new VectorMcpOperationError(
    "VECTOR_MCP_OPTIONS_INVALID",
    "evidenceLevel must be summary or full.",
    { details: { evidenceLevel: value } },
  );
}

function resolveDeliveryOptions(
  deliveryProfile: RasterDeliveryProfile | undefined,
  stableIdPrefix: string | undefined,
): ResolvedDeliveryOptions {
  const resolvedProfile = deliveryProfile ?? "editable";
  if (!DELIVERY_PROFILES.has(resolvedProfile)) {
    throw new VectorMcpOperationError(
      "VECTOR_MCP_OPTIONS_INVALID",
      "deliveryProfile must be editable, web, motion or print.",
      { details: { deliveryProfile, allowed: [...DELIVERY_PROFILES] } },
    );
  }
  if (stableIdPrefix !== undefined && !STABLE_ID_PREFIX.test(stableIdPrefix)) {
    throw new VectorMcpOperationError(
      "VECTOR_MCP_OPTIONS_INVALID",
      "stableIdPrefix must begin with a letter or underscore and use only letters, numbers, underscores, periods or hyphens.",
      { details: { stableIdPrefix } },
    );
  }
  if (stableIdPrefix && resolvedProfile !== "editable" && resolvedProfile !== "motion") {
    throw new VectorMcpOperationError(
      "VECTOR_MCP_OPTIONS_INVALID",
      "stableIdPrefix is available only for editable or motion delivery profiles.",
      { details: { stableIdPrefix, deliveryProfile: resolvedProfile } },
    );
  }
  return Object.freeze({ deliveryProfile: resolvedProfile, stableIdPrefix });
}

function assertOutputExtension(requestedPath: string, extension: string, field: string): void {
  if (path.extname(requestedPath).toLowerCase() !== extension) {
    throw new VectorMcpOperationError(
      "VECTOR_MCP_OUTPUT_EXTENSION_INVALID",
      `${field} must use the ${extension} extension.`,
      { details: { field, requestedPath, expectedExtension: extension } },
    );
  }
}

function assertDifferenceOptions(request: VectorMcpTraceRequest): void {
  if (request.differenceMaxDimension !== undefined && !request.differenceOutputPath) {
    throw new VectorMcpOperationError(
      "VECTOR_MCP_OPTIONS_INVALID",
      "differenceMaxDimension requires differenceOutputPath.",
      { details: { differenceMaxDimension: request.differenceMaxDimension } },
    );
  }
  if (
    request.differenceMaxDimension !== undefined &&
    (!Number.isSafeInteger(request.differenceMaxDimension) ||
      request.differenceMaxDimension < 32 ||
      request.differenceMaxDimension > MAX_DIFFERENCE_DIMENSION)
  ) {
    throw new VectorMcpOperationError(
      "VECTOR_MCP_OPTIONS_INVALID",
      `differenceMaxDimension must be an integer from 32 to ${MAX_DIFFERENCE_DIMENSION}.`,
      { details: { differenceMaxDimension: request.differenceMaxDimension } },
    );
  }
}

function throwIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new VectorMcpOperationError(
      "VECTOR_MCP_CANCELLED",
      "The MCP operation was cancelled before completion.",
      { retryable: true },
    );
  }
}

function parseJson(source: string, inputPath: string): unknown {
  try {
    return JSON.parse(source) as unknown;
  } catch (error) {
    throw new VectorMcpOperationError(
      "VECTOR_MCP_JSON_INVALID",
      "The motion plan file is not valid JSON.",
      {
        details: {
          inputPath,
          cause: error instanceof Error ? error.message : String(error),
        },
      },
    );
  }
}

function selectedCandidateSummary(result: RasterTraceResult): Readonly<Record<string, unknown>> {
  return Object.freeze({
    selectedCandidateId: result.evidence.selection.selectedCandidateId,
    bestVisualCandidateId: result.evidence.selection.bestVisualCandidateId,
    attemptedCandidateCount: result.evidence.selection.attemptedCandidateCount,
    completedCandidateCount: result.evidence.selection.completedCandidateCount,
    eligibleCandidateIds: result.evidence.selection.eligibleCandidateIds,
    reason: result.evidence.selection.reason,
    mode: result.evidence.selection.mode,
  });
}

function candidateSummaries(result: RasterTraceResult): readonly Readonly<Record<string, unknown>>[] {
  return Object.freeze(
    result.evidence.candidates.map((candidate) => {
      if (candidate.status === "failed") {
        return Object.freeze({
          id: candidate.id,
          role: candidate.role,
          status: candidate.status,
          selected: false,
          errorCode: candidate.errorCode,
          message: candidate.message,
          elapsedMs: candidate.elapsedMs,
        });
      }
      return Object.freeze({
        id: candidate.id,
        role: candidate.role,
        status: candidate.status,
        selected: candidate.selected,
        output: Object.freeze({
          bytes: candidate.output.bytes,
          pathCount: candidate.output.pathCount,
          commandCount: candidate.output.commandCount,
          estimatedAnchorCount: candidate.output.estimatedAnchorCount,
          deliveryProfile: candidate.output.deliveryProfile,
          stablePathIdCount: candidate.output.stablePathIdCount,
          rootDimensions: candidate.output.rootDimensions,
        }),
        comparison: Object.freeze({
          quality: candidate.comparison.quality,
          visualMae: candidate.comparison.aggregate.visualMae,
          mismatchFraction: candidate.comparison.aggregate.mismatchFraction,
          aspectRatioDelta: candidate.comparison.aggregate.aspectRatioDelta,
        }),
        visualCost: candidate.visualCost,
        geometryCost: candidate.geometryCost,
        timingsMs: candidate.timingsMs,
      });
    }),
  );
}

function summariseTraceEvidence(result: RasterTraceResult): Readonly<Record<string, unknown>> {
  return Object.freeze({
    contractVersion: result.evidence.contractVersion,
    engine: result.evidence.engine,
    source: result.evidence.analysis.source,
    analysis: Object.freeze({
      sampling: result.evidence.analysis.sampling,
      content: result.evidence.analysis.content,
      alpha: result.evidence.analysis.alpha,
      tone: result.evidence.analysis.tone,
      colour: result.evidence.analysis.colour,
      detail: result.evidence.analysis.detail,
      suggestedProfile: result.evidence.analysis.suggestedProfile,
      profileSignals: result.evidence.analysis.profileSignals,
    }),
    trace: result.evidence.trace,
    output: result.evidence.output,
    comparison: Object.freeze({
      renderer: result.evidence.comparison.renderer,
      quality: result.evidence.comparison.quality,
      aggregate: result.evidence.comparison.aggregate,
      thresholds: result.evidence.comparison.thresholds,
    }),
    candidates: candidateSummaries(result),
    selection: selectedCandidateSummary(result),
    differenceArtifact: result.evidence.differenceArtifact,
    qualityGates: result.evidence.qualityGates,
    timingsMs: result.evidence.timingsMs,
    warnings: result.evidence.warnings,
  });
}

function pathKey(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function receiptByPath(
  receipts: readonly VectorMcpFileReceipt[],
  outputPath: string,
): VectorMcpFileReceipt {
  const key = pathKey(outputPath);
  const receipt = receipts.find((item) => pathKey(item.path) === key);
  if (!receipt) {
    throw new VectorMcpOperationError(
      "VECTOR_MCP_OUTPUT_RECEIPT_MISSING",
      "A committed output does not have a matching file receipt.",
      { details: { outputPath, receiptPaths: receipts.map((item) => item.path) } },
    );
  }
  return receipt;
}

export function createVectorMcpOperations(
  options: VectorMcpOperationsOptions,
): VectorMcpOperations {
  const pathPolicy = options.pathPolicy;
  const runtimeGuard = options.runtimeGuard ??
    createRasterRuntimeGuard(resolveRasterRuntimeGuardConfigFromEnvironment());

  async function withNativeLease<T>(
    operation: (signal: AbortSignal) => Promise<T>,
    requestSignal?: AbortSignal,
  ): Promise<T> {
    const lease = runtimeGuard.acquire(requestSignal);
    try {
      const result = await operation(lease.signal);
      if (lease.timedOut()) {
        throw new VectorMcpOperationError(
          "VECTOR_MCP_RUNTIME_TIMEOUT",
          "The bounded MCP raster operation exceeded its configured deadline.",
          {
            retryable: true,
            details: { timeoutMs: runtimeGuard.snapshot().timeoutMs },
          },
        );
      }
      return result;
    } catch (error) {
      if (lease.timedOut()) {
        throw new VectorMcpOperationError(
          "VECTOR_MCP_RUNTIME_TIMEOUT",
          "The bounded MCP raster operation exceeded its configured deadline.",
          {
            retryable: true,
            details: { timeoutMs: runtimeGuard.snapshot().timeoutMs },
          },
        );
      }
      throw error;
    } finally {
      lease.release();
    }
  }

  async function resolveMotionPlan(
    request: VectorMcpMotionPlanSource,
    signal?: AbortSignal,
  ): Promise<ResolvedMotionPlan> {
    throwIfCancelled(signal);
    const hasPath = typeof request.motionPath === "string" && request.motionPath.trim().length > 0;
    const hasInline = request.motionPlan !== undefined;
    if (hasPath === hasInline) {
      throw new VectorMcpOperationError(
        "VECTOR_MCP_OPTIONS_INVALID",
        "Provide exactly one of motionPath or motionPlan.",
        { details: { hasMotionPath: hasPath, hasInlineMotionPlan: hasInline } },
      );
    }

    let rawPlan: unknown;
    let resolvedPath: string | null = null;
    let source: Readonly<Record<string, unknown>>;
    if (hasPath) {
      resolvedPath = await pathPolicy.resolveInputFile(request.motionPath!);
      const json = await readFile(resolvedPath, "utf8");
      rawPlan = parseJson(json, resolvedPath);
      source = Object.freeze({ mode: "file", requestedPath: request.motionPath, path: resolvedPath });
    } else {
      rawPlan = request.motionPlan;
      source = Object.freeze({ mode: "inline" });
    }
    throwIfCancelled(signal);
    const normalized = validateAnimatedSvgMotionSpec(rawPlan);
    const canonicalJson = `${JSON.stringify(normalized, null, 2)}\n`;
    return Object.freeze({
      normalized,
      canonicalJson,
      sha256: createHash("sha256").update(canonicalJson, "utf8").digest("hex"),
      source,
      resolvedPath,
    });
  }

  function capabilities(): Readonly<Record<string, unknown>> {
    return Object.freeze({
      ok: true,
      service: "evavo-vector-studio",
      version: VECTOR_MCP_VERSION,
      mcpContractVersion: VECTOR_MCP_CONTRACT_VERSION,
      transport: "stdio",
      tools: VECTOR_MCP_TOOL_NAMES,
      filesystem: Object.freeze({
        allowedRoots: pathPolicy.roots,
        inputMode: "existing-regular-files-only",
        outputMode: "new-files-only",
        overwriteExistingFiles: false,
        atomicMultiFileCommit: true,
      }),
      raster: Object.freeze({
        inputPolicy: RASTER_INPUT_POLICY,
        supportedProfiles: Object.freeze(["auto", "logo", "icon", "line-art", "illustration", "photo"]),
        candidateModes: Object.freeze(["adaptive", "single"]),
        deliveryProfiles: Object.freeze(["editable", "web", "motion", "print"]),
        deliveryDefaults: Object.freeze({ profile: "editable", stablePathIds: true }),
        alphaAwareAnalysis: true,
        maxInputBytes: DEFAULT_MAX_INPUT_BYTES,
        maxDecodedPixels: DEFAULT_MAX_PIXELS,
        differenceArtifact: Object.freeze({
          available: true,
          defaultMaximumDimension: DEFAULT_DIFFERENCE_MAX_DIMENSION,
          maximumDimension: MAX_DIFFERENCE_DIMENSION,
        }),
      }),
      motion: Object.freeze({
        contractVersion: "1.0",
        schemaPath: "schemas/motion-v1.schema.json",
        inlinePlans: true,
        planFiles: true,
        supportedProperties: Object.freeze(["opacity", "translateX", "translateY", "scale", "rotateDeg"]),
        reducedMotionFallbackRequired: true,
        existingAnimationRejected: true,
        transformedTargetsRejectedForTransformTracks: true,
      }),
      runtime: runtimeGuard.snapshot(),
      outputs: Object.freeze({
        svg: true,
        editableMasterSvg: true,
        responsiveWebSvg: true,
        motionReadySvg: true,
        printSafeSvg: true,
        visualDifferencePng: true,
        animatedSvg: true,
        lottie: false,
      }),
      approval: "human-review-required",
      durableQueue: false,
    });
  }

  function inputPolicy(): Readonly<Record<string, unknown>> {
    return Object.freeze({
      ok: true,
      policy: RASTER_INPUT_POLICY,
      limits: Object.freeze({
        maxInputBytes: DEFAULT_MAX_INPUT_BYTES,
        maxDecodedPixels: DEFAULT_MAX_PIXELS,
      }),
      rejectionCode: "RASTER_MULTI_IMAGE_UNSUPPORTED",
    });
  }

  async function inspectRaster(
    inputPath: string,
    signal?: AbortSignal,
  ): Promise<Readonly<Record<string, unknown>>> {
    const resolvedInputPath = await pathPolicy.resolveInputFile(inputPath);
    const source = await readFile(resolvedInputPath);
    const analysis = await withNativeLease(
      (leaseSignal) => inspectRasterEngine(source, { signal: leaseSignal }),
      signal,
    );
    return Object.freeze({
      ok: true,
      operation: "inspect-raster",
      input: Object.freeze({ requestedPath: inputPath, path: resolvedInputPath }),
      analysis,
      runtime: runtimeGuard.snapshot(),
    });
  }

  async function traceRaster(
    request: VectorMcpTraceRequest,
    signal?: AbortSignal,
  ): Promise<Readonly<Record<string, unknown>>> {
    assertDifferenceOptions(request);
    const delivery = resolveDeliveryOptions(request.deliveryProfile, request.stableIdPrefix);
    assertOutputExtension(request.outputSvgPath, ".svg", "outputSvgPath");
    if (request.differenceOutputPath) {
      assertOutputExtension(request.differenceOutputPath, ".png", "differenceOutputPath");
    }
    const evidenceLevel = assertEvidenceLevel(request.evidenceLevel);
    const resolvedInputPath = await pathPolicy.resolveInputFile(request.inputPath);
    const resolvedSvgPath = await pathPolicy.resolveOutputFile(request.outputSvgPath);
    const resolvedDifferencePath = request.differenceOutputPath
      ? await pathPolicy.resolveOutputFile(request.differenceOutputPath)
      : null;
    pathPolicy.assertDistinct([
      resolvedInputPath,
      resolvedSvgPath,
      ...(resolvedDifferencePath ? [resolvedDifferencePath] : []),
    ]);

    const source = await readFile(resolvedInputPath);
    const result = await withNativeLease(
      (leaseSignal) => traceRasterEngine(source, {
        sourceName: path.basename(resolvedInputPath),
        profile: request.profile ?? "auto",
        candidateMode: request.candidateMode ?? "adaptive",
        ...delivery,
        maxColours: request.maxColours,
        preservePalette: request.preservePalette ?? true,
        optimise: request.optimise ?? true,
        title: request.title,
        includeDifferenceArtifact: Boolean(resolvedDifferencePath),
        differenceMaxDimension: request.differenceMaxDimension,
        signal: leaseSignal,
      }),
      signal,
    );

    const differencePng = result.artifacts.differencePng;
    if (resolvedDifferencePath && !differencePng) {
      throw new VectorMcpOperationError(
        "VECTOR_MCP_DIFFERENCE_ARTIFACT_MISSING",
        "The trace completed without the requested difference PNG.",
        { details: { differenceOutputPath: resolvedDifferencePath } },
      );
    }
    if (!resolvedDifferencePath && differencePng) {
      throw new VectorMcpOperationError(
        "VECTOR_MCP_DIFFERENCE_OUTPUT_PATH_MISSING",
        "The tracing engine produced a difference PNG without an approved output path.",
      );
    }

    const commitSvgPath = await pathPolicy.resolveOutputFile(resolvedSvgPath);
    const commitDifferencePath = resolvedDifferencePath
      ? await pathPolicy.resolveOutputFile(resolvedDifferencePath)
      : null;
    pathPolicy.assertDistinct([
      resolvedInputPath,
      commitSvgPath,
      ...(commitDifferencePath ? [commitDifferencePath] : []),
    ]);

    const receipts = await commitNewVectorFiles([
      { path: commitSvgPath, data: `${result.svg}\n`, mimeType: "image/svg+xml" },
      ...(commitDifferencePath && differencePng
        ? [{ path: commitDifferencePath, data: differencePng, mimeType: "image/png" }]
        : []),
    ]);

    return Object.freeze({
      ok: true,
      operation: "trace-raster",
      input: Object.freeze({ requestedPath: request.inputPath, path: resolvedInputPath }),
      outputs: Object.freeze({
        svg: receiptByPath(receipts, commitSvgPath),
        differencePng: commitDifferencePath ? receiptByPath(receipts, commitDifferencePath) : null,
      }),
      delivery: Object.freeze({
        deliveryProfile: result.evidence.output.deliveryProfile,
        stablePathIdCount: result.evidence.output.stablePathIdCount,
        stableIdPrefix: result.evidence.output.stableIdPrefix,
        rootDimensions: result.evidence.output.rootDimensions,
        optimisationPasses: result.evidence.output.optimisationPasses,
      }),
      inspection: result.inspection,
      evidenceLevel,
      evidence: evidenceLevel === "full" ? result.evidence : summariseTraceEvidence(result),
      runtime: runtimeGuard.snapshot(),
      approval: result.evidence.qualityGates.productionApproval,
    });
  }

  async function inspectSvgFile(inputPath: string): Promise<Readonly<Record<string, unknown>>> {
    const resolvedInputPath = await pathPolicy.resolveInputFile(inputPath);
    const source = await readFile(resolvedInputPath, "utf8");
    return Object.freeze({
      ok: true,
      operation: "inspect-svg",
      input: Object.freeze({ requestedPath: inputPath, path: resolvedInputPath }),
      bytes: Buffer.byteLength(source, "utf8"),
      inspection: inspectSvg(source),
    });
  }

  async function optimiseSvgFile(
    request: VectorMcpOptimiseRequest,
  ): Promise<Readonly<Record<string, unknown>>> {
    const delivery = resolveDeliveryOptions(request.deliveryProfile, request.stableIdPrefix);
    assertOutputExtension(request.outputPath, ".svg", "outputPath");
    const resolvedInputPath = await pathPolicy.resolveInputFile(request.inputPath);
    const resolvedOutputPath = await pathPolicy.resolveOutputFile(request.outputPath);
    pathPolicy.assertDistinct([resolvedInputPath, resolvedOutputPath]);
    const source = await readFile(resolvedInputPath, "utf8");
    const result = optimiseSvg(source, delivery);
    if (!result.inspection.valid) {
      throw new VectorMcpOperationError(
        "VECTOR_MCP_SVG_REJECTED",
        "The SVG failed governed safety inspection and was not written.",
        { details: { findings: result.inspection.findings } },
      );
    }

    const commitOutputPath = await pathPolicy.resolveOutputFile(resolvedOutputPath);
    pathPolicy.assertDistinct([resolvedInputPath, commitOutputPath]);
    const receipts = await commitNewVectorFiles([
      { path: commitOutputPath, data: `${result.svg}\n`, mimeType: "image/svg+xml" },
    ]);
    return Object.freeze({
      ok: true,
      operation: "optimise-svg",
      input: Object.freeze({ requestedPath: request.inputPath, path: resolvedInputPath }),
      output: receiptByPath(receipts, commitOutputPath),
      beforeBytes: result.beforeBytes,
      afterBytes: result.afterBytes,
      bytesSaved: result.bytesSaved,
      bytesDelta: result.bytesDelta,
      delivery: result.evidence,
      inspection: result.inspection,
    });
  }

  async function validateMotionPlan(
    request: VectorMcpValidateMotionRequest,
    signal?: AbortSignal,
  ): Promise<Readonly<Record<string, unknown>>> {
    const plan = await resolveMotionPlan(request, signal);
    const requestedOutputPath = request.normalizedOutputPath;
    let output: VectorMcpFileReceipt | null = null;
    if (requestedOutputPath) {
      assertOutputExtension(requestedOutputPath, ".json", "normalizedOutputPath");
      const resolvedOutputPath = await pathPolicy.resolveOutputFile(requestedOutputPath);
      pathPolicy.assertDistinct([
        ...(plan.resolvedPath ? [plan.resolvedPath] : []),
        resolvedOutputPath,
      ]);
      throwIfCancelled(signal);
      const commitOutputPath = await pathPolicy.resolveOutputFile(resolvedOutputPath);
      const receipts = await commitNewVectorFiles([
        { path: commitOutputPath, data: plan.canonicalJson, mimeType: "application/json" },
      ]);
      output = receiptByPath(receipts, commitOutputPath);
    }
    return Object.freeze({
      ok: true,
      operation: "validate-motion-plan",
      source: plan.source,
      motionContractVersion: "1.0",
      sha256: plan.sha256,
      normalized: plan.normalized,
      output,
    });
  }

  async function animateSvg(
    request: VectorMcpAnimateSvgRequest,
    signal?: AbortSignal,
  ): Promise<Readonly<Record<string, unknown>>> {
    assertOutputExtension(request.outputSvgPath, ".svg", "outputSvgPath");
    if (request.evidenceOutputPath) {
      assertOutputExtension(request.evidenceOutputPath, ".json", "evidenceOutputPath");
    }
    const resolvedInputPath = await pathPolicy.resolveInputFile(request.inputPath);
    const plan = await resolveMotionPlan(request, signal);
    const resolvedSvgPath = await pathPolicy.resolveOutputFile(request.outputSvgPath);
    const resolvedEvidencePath = request.evidenceOutputPath
      ? await pathPolicy.resolveOutputFile(request.evidenceOutputPath)
      : null;
    pathPolicy.assertDistinct([
      resolvedInputPath,
      ...(plan.resolvedPath ? [plan.resolvedPath] : []),
      resolvedSvgPath,
      ...(resolvedEvidencePath ? [resolvedEvidencePath] : []),
    ]);

    throwIfCancelled(signal);
    const source = await readFile(resolvedInputPath, "utf8");
    const result = createAnimatedSvg(source, plan.normalized);
    throwIfCancelled(signal);

    const commitSvgPath = await pathPolicy.resolveOutputFile(resolvedSvgPath);
    const commitEvidencePath = resolvedEvidencePath
      ? await pathPolicy.resolveOutputFile(resolvedEvidencePath)
      : null;
    pathPolicy.assertDistinct([
      resolvedInputPath,
      ...(plan.resolvedPath ? [plan.resolvedPath] : []),
      commitSvgPath,
      ...(commitEvidencePath ? [commitEvidencePath] : []),
    ]);
    const evidenceDocument = Object.freeze({
      operation: "animate-svg",
      motionContractVersion: "1.0",
      input: Object.freeze({ requestedPath: request.inputPath, path: resolvedInputPath }),
      motionPlan: Object.freeze({ ...plan.source, sha256: plan.sha256 }),
      outputPath: commitSvgPath,
      inspection: result.inspection,
      evidence: result.evidence,
    });
    const receipts = await commitNewVectorFiles([
      { path: commitSvgPath, data: `${result.svg}\n`, mimeType: "image/svg+xml" },
      ...(commitEvidencePath
        ? [{
            path: commitEvidencePath,
            data: `${JSON.stringify(evidenceDocument, null, 2)}\n`,
            mimeType: "application/json",
          }]
        : []),
    ]);

    return Object.freeze({
      ok: true,
      operation: "animate-svg",
      input: Object.freeze({ requestedPath: request.inputPath, path: resolvedInputPath }),
      motionPlan: Object.freeze({ ...plan.source, sha256: plan.sha256 }),
      outputs: Object.freeze({
        animatedSvg: receiptByPath(receipts, commitSvgPath),
        evidence: commitEvidencePath ? receiptByPath(receipts, commitEvidencePath) : null,
      }),
      inspection: result.inspection,
      evidence: result.evidence,
      approval: result.evidence.approval,
    });
  }

  async function inspectAnimatedSvgFile(inputPath: string): Promise<Readonly<Record<string, unknown>>> {
    const resolvedInputPath = await pathPolicy.resolveInputFile(inputPath);
    const source = await readFile(resolvedInputPath, "utf8");
    return Object.freeze({
      ok: true,
      operation: "inspect-animated-svg",
      input: Object.freeze({ requestedPath: inputPath, path: resolvedInputPath }),
      bytes: Buffer.byteLength(source, "utf8"),
      inspection: inspectAnimatedSvg(source),
    });
  }

  return Object.freeze({
    capabilities,
    inputPolicy,
    inspectRaster,
    traceRaster,
    inspectSvg: inspectSvgFile,
    optimiseSvg: optimiseSvgFile,
    validateMotionPlan,
    animateSvg,
    inspectAnimatedSvg: inspectAnimatedSvgFile,
  });
}
