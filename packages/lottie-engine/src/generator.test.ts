import assert from "node:assert/strict";
import test from "node:test";
import { LottieEngineError } from "./errors.js";
import { createLottieFromSvgMotion } from "./generator.js";
import { inspectLottie } from "./inspection.js";

const SOURCE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180">
  <title>Motion fixture mark</title>
  <path id="background" fill="#ffffff" d="M0 0h320v180H0z"/>
  <g id="mark">
    <path id="mark-body" fill="#111111" d="M64 36h192v108H64z"/>
    <path id="accent" fill="#ff244e" d="M96 70h128v40H96z"/>
  </g>
</svg>`;

const MOTION = {
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
      transformBox: "fill-box",
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

test("creates deterministic shape-layer Lottie JSON with audited evidence", () => {
  const first = createLottieFromSvgMotion(SOURCE, MOTION);
  const second = createLottieFromSvgMotion(SOURCE, MOTION);

  assert.equal(first.json, second.json);
  assert.equal(first.evidence.output.sha256, second.evidence.output.sha256);
  assert.equal(first.inspection.valid, true);
  assert.equal(first.animation.ver, 10001);
  assert.equal(first.animation.fr, 60);
  assert.equal(first.animation.op, 78);
  assert.equal(first.animation.w, 320);
  assert.equal(first.animation.h, 180);
  assert.equal(first.animation.assets.length, 0);
  assert.equal(first.animation.layers.length, 2);
  assert.equal(first.animation.layers[0]?.nm, "mark");
  assert.equal(first.animation.layers[1]?.nm, "background");
  assert.equal(first.animation.layers[0]?.shapes[0]?.nm, "accent");
  assert.equal(first.animation.layers[0]?.shapes[1]?.nm, "mark-body");
  assert.equal(first.inspection.pathShapeCount, 3);
  assert.equal(first.inspection.fillShapeCount, 3);
  assert.equal(first.inspection.strokeShapeCount, 0);
  assert.equal(first.inspection.animatedPropertyCount, 3);
  assert.equal(first.inspection.expressionCount, 0);
  assert.equal(first.evidence.motion.animatedTargetCount, 1);
  assert.equal(first.evidence.motion.staticLayerCount, 1);
  assert.equal(first.evidence.compatibility.structuralInspection, "passed");
  assert.equal(first.evidence.compatibility.playerRenderValidation, "not-yet-performed");
  assert.equal(first.evidence.approval, "review-required");
  assert.match(first.evidence.output.sha256, /^[a-f0-9]{64}$/);
  assert.equal(new TextEncoder().encode(first.json).byteLength, first.evidence.output.bytes);

  const position = first.animation.layers[0]?.ks.p;
  assert.equal(position?.a, 1);
  if (position?.a === 1) {
    assert.equal(position.k[0]?.t, 0);
    assert.equal(position.k[0]?.h, 1);
    assert.equal(position.k.at(-1)?.t, 78);
  }
});

test("structural inspection rejects expressions, assets and unsupported layers", () => {
  const valid = createLottieFromSvgMotion(SOURCE, MOTION);
  const expression = JSON.parse(valid.json) as Record<string, unknown>;
  const expressionLayers = expression.layers as Array<Record<string, unknown>>;
  const firstLayer = expressionLayers[0]!;
  const transform = firstLayer.ks as Record<string, unknown>;
  transform.o = { a: 0, k: 100, x: "time * 100" };
  const expressionInspection = inspectLottie(expression);
  assert.equal(expressionInspection.valid, false);
  assert.equal(expressionInspection.expressionCount, 1);
  assert.ok(expressionInspection.findings.some((finding) => finding.code === "LOTTIE_EXPRESSIONS_UNSUPPORTED"));

  const unsupported = JSON.parse(valid.json) as Record<string, unknown>;
  unsupported.assets = [{ id: "image_0" }];
  unsupported.layers = [{ ty: 2, nm: "Image layer", ip: 0, op: 78 }];
  const unsupportedInspection = inspectLottie(unsupported);
  assert.equal(unsupportedInspection.valid, false);
  assert.equal(unsupportedInspection.assetCount, 1);
  assert.equal(unsupportedInspection.imageLayerCount, 1);
  assert.ok(unsupportedInspection.findings.some((finding) => finding.code === "LOTTIE_ASSETS_UNSUPPORTED"));
  assert.ok(unsupportedInspection.findings.some((finding) => finding.code === "LOTTIE_LAYER_UNSUPPORTED"));
});

test("rejects playback and SVG features outside the governed v1 subset", () => {
  for (const motion of [
    { ...MOTION, iterations: "infinite" as const },
    { ...MOTION, direction: "alternate" as const },
    { ...MOTION, fillMode: "none" as const },
  ]) {
    assert.throws(
      () => createLottieFromSvgMotion(SOURCE, motion),
      (error: unknown) =>
        error instanceof LottieEngineError &&
        error.code === "LOTTIE_MOTION_UNSUPPORTED",
    );
  }

  assert.throws(
    () => createLottieFromSvgMotion(
      `<svg viewBox="0 0 20 20"><rect id="mark" width="10" height="10"/></svg>`,
      { ...MOTION, tracks: [{ ...MOTION.tracks[0], targetId: "mark" }] },
    ),
    (error: unknown) =>
      error instanceof LottieEngineError &&
      error.code === "LOTTIE_SOURCE_UNSUPPORTED",
  );
});

test("rejects malformed JSON through the independent inspector", () => {
  const inspection = inspectLottie("{not-json");
  assert.equal(inspection.valid, false);
  assert.ok(inspection.findings.some((finding) => finding.code === "LOTTIE_JSON_INVALID"));
});
