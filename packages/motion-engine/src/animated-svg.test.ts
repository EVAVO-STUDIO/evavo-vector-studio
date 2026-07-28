import assert from "node:assert/strict";
import test from "node:test";
import { createAnimatedSvg, inspectAnimatedSvg } from "./animated-svg.js";
import { MotionEngineError } from "./errors.js";
import { validateAnimatedSvgMotionSpec } from "./validation.js";

const SOURCE = '<svg viewBox="0 0 100 100"><title>Mark</title><g id="mark"><path id="accent" d="M0 0L100 100"/></g></svg>';
const SPEC = {
  version: "1.0",
  name: "Gentle entrance",
  durationMs: 1200,
  delayMs: 100,
  iterations: 1,
  direction: "normal",
  fillMode: "both",
  reducedMotion: "last-frame",
  tracks: [
    {
      targetId: "mark",
      originXPercent: 50,
      originYPercent: 50,
      easing: { cubicBezier: [0.2, 0.8, 0.2, 1] },
      keyframes: [
        { offset: 0, opacity: 0, translateY: 12, scale: 0.96 },
        { offset: 0.6, opacity: 1, translateY: -1, scale: 1.01 },
        { offset: 1, opacity: 1, translateY: 0, scale: 1 },
      ],
    },
  ],
} as const;

test("creates deterministic script-free CSS motion with reduced-motion fallback", () => {
  const first = createAnimatedSvg(SOURCE, SPEC);
  const second = createAnimatedSvg(SOURCE, SPEC);
  assert.equal(first.svg, second.svg);
  assert.equal(first.evidence.output.sha256, second.evidence.output.sha256);
  assert.equal(first.inspection.valid, true);
  assert.equal(first.inspection.keyframeRuleCount, 1);
  assert.equal(first.inspection.targetRuleCount, 1);
  assert.equal(first.inspection.reducedMotionFallback, true);
  assert.match(first.svg, /<title>Mark<\/title><style id="evavo-motion-/);
  assert.match(first.svg, /@keyframes evavo_/);
  assert.match(first.svg, /@media\(prefers-reduced-motion:reduce\)/);
  assert.match(first.svg, /cubic-bezier\(0\.2,0\.8,0\.2,1\)/);
  assert.doesNotMatch(first.svg, /<script\b/i);
  assert.equal(first.evidence.approval, "review-required");
});

test("normalises omitted playback and frame properties", () => {
  const spec = validateAnimatedSvgMotionSpec({
    version: "1.0",
    name: "Fade",
    durationMs: 500,
    tracks: [{ targetId: "accent", keyframes: [{ offset: 0, opacity: 0 }, { offset: 1, opacity: 1 }] }],
  });
  assert.equal(spec.delayMs, 0);
  assert.equal(spec.iterations, 1);
  assert.equal(spec.direction, "normal");
  assert.equal(spec.fillMode, "both");
  assert.equal(spec.reducedMotion, "source");
  assert.equal(spec.tracks[0]?.keyframes[0]?.scale, 1);
});

test("rejects duplicate target tracks and no-op motion", () => {
  assert.throws(
    () => validateAnimatedSvgMotionSpec({
      version: "1.0",
      name: "Duplicate",
      durationMs: 500,
      tracks: [
        { targetId: "mark", keyframes: [{ offset: 0, opacity: 0 }, { offset: 1, opacity: 1 }] },
        { targetId: "mark", keyframes: [{ offset: 0, translateX: 0 }, { offset: 1, translateX: 2 }] },
      ],
    }),
    (error: unknown) => error instanceof MotionEngineError && error.code === "MOTION_SPEC_INVALID",
  );
  assert.throws(
    () => validateAnimatedSvgMotionSpec({
      version: "1.0",
      name: "No-op",
      durationMs: 500,
      tracks: [{ targetId: "mark", keyframes: [{ offset: 0 }, { offset: 1 }] }],
    }),
    (error: unknown) => error instanceof MotionEngineError && error.code === "MOTION_SPEC_INVALID",
  );
});

test("rejects missing targets, unsafe SVG and previously animated revisions", () => {
  assert.throws(
    () => createAnimatedSvg(SOURCE, { ...SPEC, tracks: [{ ...SPEC.tracks[0], targetId: "missing" }] }),
    (error: unknown) => error instanceof MotionEngineError && error.code === "MOTION_TARGET_MISSING",
  );
  assert.throws(
    () => createAnimatedSvg('<svg viewBox="0 0 1 1"><script>alert(1)</script><g id="mark"/></svg>', SPEC),
    (error: unknown) => error instanceof MotionEngineError && error.code === "MOTION_SOURCE_INVALID",
  );
  const animated = createAnimatedSvg(SOURCE, SPEC).svg;
  assert.throws(
    () => createAnimatedSvg(animated, SPEC),
    (error: unknown) => error instanceof MotionEngineError && error.code === "MOTION_SOURCE_ALREADY_ANIMATED",
  );
});

test("rejects pre-existing motion and target transforms that would be replaced", () => {
  assert.throws(
    () => createAnimatedSvg('<svg viewBox="0 0 1 1"><g id="mark"><animate attributeName="opacity" values="0;1"/></g></svg>', SPEC),
    (error: unknown) => error instanceof MotionEngineError && error.code === "MOTION_SOURCE_ALREADY_ANIMATED",
  );
  assert.throws(
    () => createAnimatedSvg('<svg viewBox="0 0 1 1"><g id="mark" transform="translate(2 3)"/></svg>', SPEC),
    (error: unknown) => error instanceof MotionEngineError && error.code === "MOTION_TARGET_BASE_TRANSFORM_UNSUPPORTED",
  );
});

test("inspection rejects incomplete generated motion metadata", () => {
  const inspection = inspectAnimatedSvg('<svg data-evavo-motion-contract="1.0" viewBox="0 0 1 1"><g id="mark"/></svg>');
  assert.equal(inspection.valid, false);
  assert.ok(inspection.findings.some((finding) => finding.code === "MOTION_METADATA_INCOMPLETE"));
  assert.ok(inspection.findings.some((finding) => finding.code === "MOTION_REDUCED_FALLBACK_MISSING"));
});
