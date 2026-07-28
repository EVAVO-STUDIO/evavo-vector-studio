import type {
  RasterCandidateMode,
  RasterRenderComparison,
  RasterComparisonQuality,
  TraceOutputEvidence,
  TraceSelectionEvidence,
} from "./types.js";

export const CANDIDATE_VISUAL_COST_TOLERANCE = 0.003;
export const CANDIDATE_MISMATCH_TOLERANCE = 0.015;
export const CANDIDATE_ASPECT_RATIO_TOLERANCE = 0.001;
export const THREE_CANDIDATE_MAXIMUM_PIXELS = 4_000_000;
export const TWO_CANDIDATE_MAXIMUM_PIXELS = 12_000_000;

export const VISUAL_COST_WEIGHTS = Object.freeze({
  visualMae: 1,
  mismatchFraction: 0.25,
  alphaMae: 0.1,
  aspectRatioDelta: 2,
});

export const GEOMETRY_COST_WEIGHTS = Object.freeze({
  estimatedAnchorCount: 1,
  pathCount: 2,
  commandCount: 0.25,
  byteDivisor: 512,
});

export type SelectableTraceCandidate = Readonly<{
  id: string;
  comparison: RasterRenderComparison;
  output: TraceOutputEvidence;
}>;

export type ScoredTraceCandidate = SelectableTraceCandidate & Readonly<{
  visualCost: number;
  geometryCost: number;
}>;

export type CandidateSelectionDecision = Readonly<{
  selectedCandidateId: string;
  bestVisualCandidateId: string;
  eligibleCandidateIds: readonly string[];
  reason: TraceSelectionEvidence["reason"];
  scored: readonly ScoredTraceCandidate[];
}>;

function round(value: number, digits = 8): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function qualityRank(quality: RasterComparisonQuality): number {
  if (quality === "excellent") return 0;
  if (quality === "good") return 1;
  return 2;
}

export function calculateCandidateVisualCost(comparison: RasterRenderComparison): number {
  const metrics = comparison.aggregate;
  return round(
    metrics.visualMae * VISUAL_COST_WEIGHTS.visualMae +
      metrics.mismatchFraction * VISUAL_COST_WEIGHTS.mismatchFraction +
      metrics.alphaMae * VISUAL_COST_WEIGHTS.alphaMae +
      metrics.aspectRatioDelta * VISUAL_COST_WEIGHTS.aspectRatioDelta,
  );
}

export function calculateCandidateGeometryCost(output: TraceOutputEvidence): number {
  return round(
    output.estimatedAnchorCount * GEOMETRY_COST_WEIGHTS.estimatedAnchorCount +
      output.pathCount * GEOMETRY_COST_WEIGHTS.pathCount +
      output.commandCount * GEOMETRY_COST_WEIGHTS.commandCount +
      output.bytes / GEOMETRY_COST_WEIGHTS.byteDivisor,
    4,
  );
}

function score(candidate: SelectableTraceCandidate): ScoredTraceCandidate {
  return Object.freeze({
    ...candidate,
    visualCost: calculateCandidateVisualCost(candidate.comparison),
    geometryCost: calculateCandidateGeometryCost(candidate.output),
  });
}

function compareVisual(left: ScoredTraceCandidate, right: ScoredTraceCandidate): number {
  return (
    qualityRank(left.comparison.quality) - qualityRank(right.comparison.quality) ||
    left.visualCost - right.visualCost ||
    left.comparison.aggregate.mismatchFraction - right.comparison.aggregate.mismatchFraction ||
    left.geometryCost - right.geometryCost ||
    left.id.localeCompare(right.id)
  );
}

function compareGeometry(left: ScoredTraceCandidate, right: ScoredTraceCandidate): number {
  return left.geometryCost - right.geometryCost || left.visualCost - right.visualCost || left.id.localeCompare(right.id);
}

export function selectTraceCandidate(candidates: readonly SelectableTraceCandidate[]): CandidateSelectionDecision {
  if (candidates.length === 0) throw new Error("TRACE_CANDIDATE_SELECTION_EMPTY");
  const scored = candidates.map(score);
  const visuallyOrdered = [...scored].sort(compareVisual);
  const bestVisual = visuallyOrdered[0];

  if (scored.length === 1) {
    return Object.freeze({
      selectedCandidateId: bestVisual.id,
      bestVisualCandidateId: bestVisual.id,
      eligibleCandidateIds: Object.freeze([bestVisual.id]),
      reason: "single-candidate",
      scored: Object.freeze(scored),
    });
  }

  if (bestVisual.comparison.quality === "review") {
    return Object.freeze({
      selectedCandidateId: bestVisual.id,
      bestVisualCandidateId: bestVisual.id,
      eligibleCandidateIds: Object.freeze([bestVisual.id]),
      reason: "best-visual-review-required",
      scored: Object.freeze(scored),
    });
  }

  const bestMetrics = bestVisual.comparison.aggregate;
  const bestQualityRank = qualityRank(bestVisual.comparison.quality);
  const eligible = scored.filter((candidate) => {
    const metrics = candidate.comparison.aggregate;
    return (
      qualityRank(candidate.comparison.quality) === bestQualityRank &&
      candidate.visualCost <= bestVisual.visualCost + CANDIDATE_VISUAL_COST_TOLERANCE &&
      metrics.mismatchFraction <= bestMetrics.mismatchFraction + CANDIDATE_MISMATCH_TOLERANCE &&
      metrics.aspectRatioDelta <= bestMetrics.aspectRatioDelta + CANDIDATE_ASPECT_RATIO_TOLERANCE
    );
  });
  const selected = [...eligible].sort(compareGeometry)[0] ?? bestVisual;
  return Object.freeze({
    selectedCandidateId: selected.id,
    bestVisualCandidateId: bestVisual.id,
    eligibleCandidateIds: Object.freeze(eligible.map((candidate) => candidate.id)),
    reason: "lowest-geometry-cost-within-visual-tolerance",
    scored: Object.freeze(scored),
  });
}

export function maximumCandidateCount(mode: RasterCandidateMode, sourcePixelCount: number): number {
  if (mode === "single") return 1;
  if (sourcePixelCount <= THREE_CANDIDATE_MAXIMUM_PIXELS) return 3;
  if (sourcePixelCount <= TWO_CANDIDATE_MAXIMUM_PIXELS) return 2;
  return 1;
}
