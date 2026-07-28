import assert from "node:assert/strict";
import test from "node:test";
import {
  maximumCandidateCount,
  selectTraceCandidate,
  type SelectableTraceCandidate,
} from "./selection.js";
import type { RasterComparisonQuality, RasterRenderComparison, TraceOutputEvidence } from "./types.js";

function comparison(quality: RasterComparisonQuality, visualMae: number, mismatchFraction: number): RasterRenderComparison {
  return {
    renderer: { name: "@resvg/resvg-js", version: "2.6.2", systemFontsLoaded: false, shapeRendering: "geometricPrecision" },
    scales: [],
    aggregate: {
      visualMae,
      premultipliedRgbMae: visualMae,
      alphaMae: 0,
      compositeBlackMae: visualMae,
      compositeWhiteMae: visualMae,
      rmsVisualError: visualMae,
      mismatchFraction,
      aspectRatioDelta: 0,
      comparedPixelCount: 1,
      largestComparedDimension: 1,
    },
    quality,
    thresholds: {
      mismatchPixelError: 0.1,
      excellent: { visualMae: 0.02, mismatchFraction: 0.04, aspectRatioDelta: 0.001 },
      good: { visualMae: 0.04, mismatchFraction: 0.12, aspectRatioDelta: 0.005 },
    },
  };
}

function output(anchors: number, bytes = 1024): TraceOutputEvidence {
  return {
    mimeType: "image/svg+xml",
    bytes,
    pathCount: Math.max(1, Math.round(anchors / 4)),
    groupCount: 1,
    gradientCount: 0,
    viewBox: [0, 0, 10, 10],
    pathDataBytes: bytes / 2,
    commandCount: anchors,
    estimatedAnchorCount: anchors,
    subpathCount: 1,
    straightSegmentCount: anchors,
    curveSegmentCount: 0,
  };
}

function candidate(id: string, quality: RasterComparisonQuality, visualMae: number, mismatch: number, anchors: number): SelectableTraceCandidate {
  return { id, comparison: comparison(quality, visualMae, mismatch), output: output(anchors) };
}

test("selects lower geometry cost when visual evidence remains within tolerance", () => {
  const result = selectTraceCandidate([
    candidate("fidelity", "good", 0.02, 0.04, 500),
    candidate("economy", "good", 0.021, 0.045, 80),
  ]);
  assert.equal(result.bestVisualCandidateId, "fidelity");
  assert.equal(result.selectedCandidateId, "economy");
  assert.deepEqual([...result.eligibleCandidateIds].sort(), ["economy", "fidelity"]);
  assert.equal(result.reason, "lowest-geometry-cost-within-visual-tolerance");
});

test("does not trade away visual quality when all candidates require review", () => {
  const result = selectTraceCandidate([
    candidate("fidelity", "review", 0.06, 0.2, 500),
    candidate("economy", "review", 0.08, 0.3, 30),
  ]);
  assert.equal(result.selectedCandidateId, "fidelity");
  assert.equal(result.reason, "best-visual-review-required");
});

test("excludes a much simpler candidate outside visual tolerance", () => {
  const result = selectTraceCandidate([
    candidate("base", "good", 0.02, 0.04, 400),
    candidate("economy", "good", 0.03, 0.08, 10),
  ]);
  assert.equal(result.selectedCandidateId, "base");
  assert.deepEqual(result.eligibleCandidateIds, ["base"]);
});

test("candidate count is bounded by mode and decoded source pixels", () => {
  assert.equal(maximumCandidateCount("single", 1), 1);
  assert.equal(maximumCandidateCount("adaptive", 4_000_000), 3);
  assert.equal(maximumCandidateCount("adaptive", 4_000_001), 2);
  assert.equal(maximumCandidateCount("adaptive", 12_000_001), 1);
});
