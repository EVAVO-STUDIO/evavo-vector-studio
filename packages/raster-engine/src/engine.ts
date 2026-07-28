import { performance } from "node:perf_hooks";
import {
  OptimizePreset,
  optimize,
  readImage,
  vectorizeRaw,
  type ImageData,
} from "@neplex/vectorizer";
import { inspectSvg, optimiseSvg, type SvgInspection } from "@evavo/vector-core";
import { analyseDecodedRaster } from "./analysis.js";
import { compareRasterToSvg } from "./comparison.js";
import { RasterEngineError, rasterFailure, throwIfAborted } from "./errors.js";
import { inspectRasterHeader } from "./preflight.js";
import { buildTraceCandidates, type TraceCandidateDefinition } from "./presets.js";
import {
  CANDIDATE_MISMATCH_TOLERANCE,
  CANDIDATE_VISUAL_COST_TOLERANCE,
  THREE_CANDIDATE_MAXIMUM_PIXELS,
  TWO_CANDIDATE_MAXIMUM_PIXELS,
  maximumCandidateCount,
  selectTraceCandidate,
} from "./selection.js";
import type {
  DecodedRaster,
  RasterAnalysis,
  RasterCandidateMode,
  RasterInspectionOptions,
  RasterRenderComparison,
  RasterTraceEvidence,
  RasterTraceOptions,
  RasterTraceResult,
  RasterWarning,
  TraceCandidateCompleteEvidence,
  TraceCandidateEvidence,
  TraceCandidateFailedEvidence,
  TraceCandidateTimings,
  TraceOutputEvidence,
} from "./types.js";

function encodedBuffer(source: Uint8Array): Buffer {
  return Buffer.from(source.buffer, source.byteOffset, source.byteLength);
}

function rawPixelBuffer(source: Uint8Array): Buffer {
  return Buffer.from(source);
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function applyTitle(svg: string, title?: string): string {
  const cleanTitle = title?.trim().slice(0, 200);
  if (!cleanTitle) return svg;
  const element = `<title>${escapeXml(cleanTitle)}</title>`;
  if (/<title\b[^>]*>[\s\S]*?<\/title>/i.test(svg)) {
    return svg.replace(/<title\b[^>]*>[\s\S]*?<\/title>/i, element);
  }
  return svg.replace(/<svg\b[^>]*>/i, (root) => `${root}${element}`);
}

function roundedDuration(start: number, end: number): number {
  return Math.round((end - start) * 100) / 100;
}

function outputEvidence(svg: string, inspection: SvgInspection): TraceOutputEvidence {
  return Object.freeze({
    mimeType: "image/svg+xml",
    bytes: Buffer.byteLength(svg, "utf8"),
    pathCount: inspection.pathCount,
    groupCount: inspection.groupCount,
    gradientCount: inspection.gradientCount,
    viewBox: inspection.viewBox,
    pathDataBytes: inspection.geometry.pathDataBytes,
    commandCount: inspection.geometry.commandCount,
    estimatedAnchorCount: inspection.geometry.estimatedAnchorCount,
    subpathCount: inspection.geometry.subpathCount,
    straightSegmentCount: inspection.geometry.straightSegmentCount,
    curveSegmentCount: inspection.geometry.curveSegmentCount,
  });
}

async function decodeAndAnalyse(
  source: Uint8Array,
  options: RasterInspectionOptions,
): Promise<Readonly<{ analysis: RasterAnalysis; decoded: DecodedRaster }>> {
  const header = inspectRasterHeader(source, options);
  throwIfAborted(options.signal);
  let image: ImageData;
  try {
    image = await readImage(encodedBuffer(source), undefined, options.signal);
  } catch (error) {
    if (options.signal?.aborted) throw new RasterEngineError("RASTER_ABORTED", "Raster decoding was aborted.", 499);
    throw rasterFailure("RASTER_DECODE_FAILED", "The guarded raster could not be decoded by the vector engine.", error, 422);
  }
  const decoded: DecodedRaster = Object.freeze({ width: image.width, height: image.height, pixels: image.pixels });
  const analysis = analyseDecodedRaster(source, header, decoded, options);
  return Object.freeze({ analysis, decoded });
}

export async function inspectRaster(
  source: Uint8Array,
  options: RasterInspectionOptions = {},
): Promise<RasterAnalysis> {
  return (await decodeAndAnalyse(source, options)).analysis;
}

type CompletedCandidate = Readonly<{
  definition: TraceCandidateDefinition;
  svg: string;
  inspection: SvgInspection;
  output: TraceOutputEvidence;
  comparison: RasterRenderComparison;
  timingsMs: TraceCandidateTimings;
}>;

type FailedCandidate = Readonly<{
  definition: TraceCandidateDefinition;
  errorCode: string;
  message: string;
  elapsedMs: number;
}>;

async function executeCandidate(
  decoded: DecodedRaster,
  definition: TraceCandidateDefinition,
  options: RasterTraceOptions,
): Promise<CompletedCandidate> {
  const candidateStarted = performance.now();
  const traceStarted = candidateStarted;
  let svg: string;
  try {
    svg = await vectorizeRaw(
      rawPixelBuffer(decoded.pixels),
      { width: decoded.width, height: decoded.height },
      definition.config,
      options.signal,
    );
  } catch (error) {
    if (options.signal?.aborted) throw new RasterEngineError("RASTER_ABORTED", "Raster tracing was aborted.", 499);
    throw rasterFailure("RASTER_TRACE_FAILED", `Trace candidate ${definition.id} failed during geometry reconstruction.`, error, 422);
  }
  const traceFinished = performance.now();

  const optimiseStarted = traceFinished;
  if (options.optimise ?? true) {
    try {
      svg = await optimize(
        svg,
        { preset: OptimizePreset.Safe, multipass: true, multipassIterations: 4 },
        options.signal,
      );
    } catch (error) {
      if (options.signal?.aborted) throw new RasterEngineError("RASTER_ABORTED", "SVG optimisation was aborted.", 499);
      throw rasterFailure("RASTER_TRACE_FAILED", `Trace candidate ${definition.id} failed during safe optimisation.`, error, 422);
    }
  }
  svg = applyTitle(optimiseSvg(svg).svg, options.title);
  const optimiseFinished = performance.now();
  const inspection = inspectSvg(svg);
  if (!inspection.valid) {
    throw new RasterEngineError("RASTER_OUTPUT_INVALID", `Trace candidate ${definition.id} failed the governed SVG safety inspection.`, 422, {
      findings: inspection.findings,
    });
  }

  const comparisonStarted = performance.now();
  const comparison = await compareRasterToSvg(decoded, svg, options.signal);
  const comparisonFinished = performance.now();
  return Object.freeze({
    definition,
    svg,
    inspection,
    output: outputEvidence(svg, inspection),
    comparison,
    timingsMs: Object.freeze({
      trace: roundedDuration(traceStarted, traceFinished),
      optimise: roundedDuration(optimiseStarted, optimiseFinished),
      compare: roundedDuration(comparisonStarted, comparisonFinished),
      total: roundedDuration(candidateStarted, comparisonFinished),
    }),
  });
}

function failedCandidate(definition: TraceCandidateDefinition, error: unknown, started: number): FailedCandidate {
  return Object.freeze({
    definition,
    errorCode: error instanceof RasterEngineError ? error.code : "TRACE_CANDIDATE_FAILED",
    message: error instanceof Error ? error.message : String(error),
    elapsedMs: roundedDuration(started, performance.now()),
  });
}

function alternativeDefinitions(
  definitions: readonly TraceCandidateDefinition[],
  base: CompletedCandidate,
  maximum: number,
): readonly TraceCandidateDefinition[] {
  if (maximum <= 1) return Object.freeze([]);
  const alternatives = definitions.slice(1);
  if (maximum >= 3) return Object.freeze(alternatives.slice(0, maximum - 1));
  const fidelity = alternatives.find((definition) => definition.role === "fidelity");
  const economy = alternatives.find((definition) => definition.role === "economy");
  const preferred = base.comparison.quality === "review" ? fidelity ?? economy : economy ?? fidelity;
  return Object.freeze(preferred ? [preferred] : []);
}

function completeEvidence(
  candidate: CompletedCandidate,
  selectedCandidateId: string,
  visualCost: number,
  geometryCost: number,
): TraceCandidateCompleteEvidence {
  return Object.freeze({
    id: candidate.definition.id,
    role: candidate.definition.role,
    status: "complete",
    selected: candidate.definition.id === selectedCandidateId,
    trace: candidate.definition.evidence,
    output: candidate.output,
    comparison: candidate.comparison,
    visualCost,
    geometryCost,
    timingsMs: candidate.timingsMs,
  });
}

function failureEvidence(candidate: FailedCandidate): TraceCandidateFailedEvidence {
  return Object.freeze({
    id: candidate.definition.id,
    role: candidate.definition.role,
    status: "failed",
    selected: false,
    trace: candidate.definition.evidence,
    errorCode: candidate.errorCode,
    message: candidate.message,
    elapsedMs: candidate.elapsedMs,
  });
}

function sumTimings(candidates: readonly CompletedCandidate[], field: keyof TraceCandidateTimings): number {
  return Math.round(candidates.reduce((total, candidate) => total + candidate.timingsMs[field], 0) * 100) / 100;
}

export async function traceRaster(
  source: Uint8Array,
  options: RasterTraceOptions = {},
): Promise<RasterTraceResult> {
  const totalStarted = performance.now();
  const decodeStarted = totalStarted;
  const prepared = await decodeAndAnalyse(source, options);
  const decodeFinished = performance.now();
  const candidateMode: RasterCandidateMode = options.candidateMode ?? "adaptive";
  const definitions = buildTraceCandidates(prepared.analysis, options);
  const maximum = Math.min(definitions.length, maximumCandidateCount(candidateMode, prepared.analysis.source.pixelCount));
  const completed: CompletedCandidate[] = [];
  const failed: FailedCandidate[] = [];

  const baseDefinition = definitions[0];
  const base = await executeCandidate(prepared.decoded, baseDefinition, options);
  completed.push(base);
  for (const definition of alternativeDefinitions(definitions, base, maximum)) {
    throwIfAborted(options.signal);
    const started = performance.now();
    try {
      completed.push(await executeCandidate(prepared.decoded, definition, options));
    } catch (error) {
      if (error instanceof RasterEngineError && error.code === "RASTER_ABORTED") throw error;
      failed.push(failedCandidate(definition, error, started));
    }
  }

  const selectionStarted = performance.now();
  const decision = selectTraceCandidate(completed.map((candidate) => ({
    id: candidate.definition.id,
    comparison: candidate.comparison,
    output: candidate.output,
  })));
  const selectionFinished = performance.now();
  const selected = completed.find((candidate) => candidate.definition.id === decision.selectedCandidateId);
  if (!selected) throw new RasterEngineError("RASTER_OUTPUT_INVALID", "The selected trace candidate is unavailable.", 500);
  const scoreById = new Map(decision.scored.map((candidate) => [candidate.id, candidate]));
  const candidates: TraceCandidateEvidence[] = [
    ...completed.map((candidate) => {
      const scored = scoreById.get(candidate.definition.id);
      if (!scored) throw new RasterEngineError("RASTER_OUTPUT_INVALID", "Candidate scoring evidence is incomplete.", 500);
      return completeEvidence(candidate, selected.definition.id, scored.visualCost, scored.geometryCost);
    }),
    ...failed.map(failureEvidence),
  ];

  const warnings: RasterWarning[] = [...prepared.analysis.warnings];
  if (selected.definition.id !== "base") {
    warnings.push({
      code: "TRACE_ADAPTIVE_CANDIDATE_SELECTED",
      severity: "warning",
      message: `Adaptive selection chose the ${selected.definition.role} candidate because it provided the preferred measured balance of visual fidelity and geometry cost.`,
    });
  }
  if (failed.length > 0) {
    warnings.push({
      code: "TRACE_ALTERNATIVE_CANDIDATE_FAILED",
      severity: "warning",
      message: `${failed.length} alternative trace candidate${failed.length === 1 ? "" : "s"} failed; selection continued from the completed bounded candidates.`,
    });
  }
  if (candidateMode === "adaptive" && maximum === 1 && definitions.length > 1) {
    warnings.push({
      code: "TRACE_CANDIDATE_BUDGET_BOUNDED",
      severity: "warning",
      message: "Adaptive retries were limited to one candidate because the decoded source exceeds the multi-candidate pixel budget.",
    });
  }
  if (selected.comparison.quality === "review") {
    warnings.push({
      code: "TRACE_RENDER_MISMATCH_REVIEW",
      severity: "review",
      message: `The selected multi-scale render comparison requires review (visual MAE ${selected.comparison.aggregate.visualMae}, mismatch fraction ${selected.comparison.aggregate.mismatchFraction}).`,
    });
  } else {
    warnings.push({
      code: "TRACE_HUMAN_REVIEW_REQUIRED",
      severity: "review",
      message: `The selected measured render match is ${selected.comparison.quality}, but a person must still inspect curves, negative space, layer logic and brand fidelity before production approval.`,
    });
  }
  if (selected.comparison.aggregate.aspectRatioDelta > selected.comparison.thresholds.good.aspectRatioDelta) {
    warnings.push({
      code: "TRACE_ASPECT_RATIO_MISMATCH",
      severity: "review",
      message: `The selected SVG aspect ratio differs from the source by ${selected.comparison.aggregate.aspectRatioDelta}.`,
    });
  }
  if (selected.output.pathCount > 5_000 || selected.output.estimatedAnchorCount > 25_000) {
    warnings.push({
      code: "TRACE_GEOMETRY_COMPLEXITY_HIGH",
      severity: "review",
      message: `The selected SVG contains ${selected.output.pathCount.toLocaleString()} paths and an estimated ${selected.output.estimatedAnchorCount.toLocaleString()} anchors.`,
    });
  }
  if (selected.output.bytes > 2 * 1024 * 1024) {
    warnings.push({
      code: "TRACE_LARGE_OUTPUT",
      severity: "review",
      message: "The selected SVG exceeds 2 MiB and may be unsuitable for direct web delivery without further reconstruction or simplification.",
    });
  }

  const totalFinished = performance.now();
  const evidence: RasterTraceEvidence = Object.freeze({
    contractVersion: "1.2",
    engine: Object.freeze({ name: "@neplex/vectorizer", adapterVersion: "0.3.0" }),
    analysis: prepared.analysis,
    trace: selected.definition.evidence,
    output: selected.output,
    comparison: selected.comparison,
    candidates: Object.freeze(candidates),
    selection: Object.freeze({
      mode: candidateMode,
      maximumCandidateCount: maximum,
      attemptedCandidateCount: completed.length + failed.length,
      completedCandidateCount: completed.length,
      selectedCandidateId: selected.definition.id,
      bestVisualCandidateId: decision.bestVisualCandidateId,
      eligibleCandidateIds: decision.eligibleCandidateIds,
      reason: decision.reason,
      visualTolerance: Object.freeze({
        visualCost: CANDIDATE_VISUAL_COST_TOLERANCE,
        mismatchFraction: CANDIDATE_MISMATCH_TOLERANCE,
      }),
      pixelBudgetPolicy: Object.freeze({
        threeCandidateMaximumPixels: THREE_CANDIDATE_MAXIMUM_PIXELS,
        twoCandidateMaximumPixels: TWO_CANDIDATE_MAXIMUM_PIXELS,
      }),
    }),
    qualityGates: Object.freeze({
      svgSafety: "passed",
      structuralValidation: "passed",
      renderComparison: selected.comparison.quality === "review" ? "review-required" : "passed",
      visualEvidenceAvailable: true,
      productionApproval: "review-required",
      byteStableOutputGuaranteed: false,
    }),
    timingsMs: Object.freeze({
      decodeAndAnalyse: roundedDuration(decodeStarted, decodeFinished),
      trace: sumTimings(completed, "trace"),
      optimise: sumTimings(completed, "optimise"),
      compare: sumTimings(completed, "compare"),
      candidateSelection: roundedDuration(selectionStarted, selectionFinished),
      total: roundedDuration(totalStarted, totalFinished),
    }),
    warnings: Object.freeze(warnings),
  });
  return Object.freeze({ svg: selected.svg, inspection: selected.inspection, evidence });
}
