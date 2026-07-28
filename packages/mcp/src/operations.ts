import { readFile } from "node:fs/promises";
import path from "node:path";
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
  type RasterRuntimeGuard,
  type RasterTraceProfileSelection,
  type RasterTraceResult,
} from "@evavo/raster-engine";
import { inspectSvg, optimiseSvg } from "@evavo/vector-core";
import { VectorMcpOperationError } from "./errors.js";
import { commitNewVectorFiles, type VectorMcpFileReceipt } from "./file-transaction.js";
import type { VectorMcpPathPolicy } from "./path-policy.js";

export const VECTOR_MCP_VERSION = "0.4.0";
export const VECTOR_MCP_CONTRACT_VERSION = "1.0";

export const VECTOR_MCP_TOOL_NAMES = Object.freeze([
  "vector_capabilities",
  "vector_input_policy",
  "vector_inspect_raster",
  "vector_trace_raster",
  "vector_inspect_svg",
  "vector_optimise_svg",
] as const);

export type VectorMcpEvidenceLevel = "summary" | "full";

export type VectorMcpTraceRequest = Readonly<{
  inputPath: string;
  outputSvgPath: string;
  differenceOutputPath?: string;
  profile?: RasterTraceProfileSelection;
  candidateMode?: RasterCandidateMode;
  maxColours?: number;
  preservePalette?: boolean;
  optimise?: boolean;
  title?: string;
  differenceMaxDimension?: number;
  evidenceLevel?: VectorMcpEvidenceLevel;
}>;

export type VectorMcpOperations = Readonly<{
  capabilities: () => Readonly<Record<string, unknown>>;
  inputPolicy: () => Readonly<Record<string, unknown>>;
  inspectRaster: (inputPath: string, signal?: AbortSignal) => Promise<Readonly<Record<string, unknown>>>;
  traceRaster: (request: VectorMcpTraceRequest, signal?: AbortSignal) => Promise<Readonly<Record<string, unknown>>>;
  inspectSvg: (inputPath: string) => Promise<Readonly<Record<string, unknown>>>;
  optimiseSvg: (
    inputPath: string,
    outputPath: string,
  ) => Promise<Readonly<Record<string, unknown>>>;
}>;

export type VectorMcpOperationsOptions = Readonly<{
  pathPolicy: VectorMcpPathPolicy;
  runtimeGuard?: RasterRuntimeGuard;
}>;

function assertEvidenceLevel(value: VectorMcpEvidenceLevel | undefined): VectorMcpEvidenceLevel {
  if (value === undefined || value === "summary" || value === "full") return value ?? "summary";
  throw new VectorMcpOperationError(
    "VECTOR_MCP_OPTIONS_INVALID",
    "evidenceLevel must be summary or full.",
    { details: { evidenceLevel: value } },
  );
}

function assertOutputExtension(requestedPath: string, extension: ".svg" | ".png", field: string): void {
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

function receiptByPath(
  receipts: readonly VectorMcpFileReceipt[],
  outputPath: string,
): VectorMcpFileReceipt {
  const resolved = path.resolve(outputPath);
  const receipt = receipts.find((item) => path.resolve(item.path) === resolved);
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
        maxInputBytes: DEFAULT_MAX_INPUT_BYTES,
        maxDecodedPixels: DEFAULT_MAX_PIXELS,
        differenceArtifact: Object.freeze({
          available: true,
          defaultMaximumDimension: DEFAULT_DIFFERENCE_MAX_DIMENSION,
          maximumDimension: MAX_DIFFERENCE_DIMENSION,
        }),
      }),
      runtime: runtimeGuard.snapshot(),
      outputs: Object.freeze({
        svg: true,
        visualDifferencePng: true,
        animatedSvg: false,
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

    const svgReceipt = receiptByPath(receipts, commitSvgPath);
    const differenceReceipt = commitDifferencePath
      ? receiptByPath(receipts, commitDifferencePath)
      : null;

    return Object.freeze({
      ok: true,
      operation: "trace-raster",
      input: Object.freeze({ requestedPath: request.inputPath, path: resolvedInputPath }),
      outputs: Object.freeze({
        svg: svgReceipt,
        differencePng: differenceReceipt,
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
    inputPath: string,
    outputPath: string,
  ): Promise<Readonly<Record<string, unknown>>> {
    assertOutputExtension(outputPath, ".svg", "outputPath");
    const resolvedInputPath = await pathPolicy.resolveInputFile(inputPath);
    const resolvedOutputPath = await pathPolicy.resolveOutputFile(outputPath);
    pathPolicy.assertDistinct([resolvedInputPath, resolvedOutputPath]);
    const source = await readFile(resolvedInputPath, "utf8");
    const result = optimiseSvg(source);
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
      input: Object.freeze({ requestedPath: inputPath, path: resolvedInputPath }),
      output: receiptByPath(receipts, commitOutputPath),
      beforeBytes: result.beforeBytes,
      afterBytes: result.afterBytes,
      bytesSaved: result.bytesSaved,
      inspection: result.inspection,
    });
  }

  return Object.freeze({
    capabilities,
    inputPolicy,
    inspectRaster,
    traceRaster,
    inspectSvg: inspectSvgFile,
    optimiseSvg: optimiseSvgFile,
  });
}
