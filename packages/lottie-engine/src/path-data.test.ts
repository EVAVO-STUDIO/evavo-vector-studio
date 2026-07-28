import assert from "node:assert/strict";
import test from "node:test";
import { LottieEngineError } from "./errors.js";
import { parseSvgPathDataToLottie } from "./path-data.js";

test("converts relative closed geometry with offset-normalised bounds", () => {
  const result = parseSvgPathDataToLottie(
    "M10 20h30v20h-30z",
    { offsetX: 10, offsetY: 20, precision: 4 },
  );

  assert.equal(result.subpaths.length, 1);
  assert.equal(result.segmentCount, 4);
  assert.deepEqual(result.subpaths[0]?.path.v, [
    [0, 0],
    [30, 0],
    [30, 20],
    [0, 20],
  ]);
  assert.equal(result.subpaths[0]?.path.c, true);
  assert.deepEqual(result.subpaths[0]?.bounds, {
    minX: 0,
    minY: 0,
    maxX: 30,
    maxY: 20,
  });
});

test("converts quadratic, smooth and elliptical arc commands to cubic tangents", () => {
  const quadratic = parseSvgPathDataToLottie(
    "M0 0 Q50 100 100 0 T200 0",
  );
  assert.equal(quadratic.segmentCount, 2);
  assert.equal(quadratic.subpaths[0]?.path.v.length, 3);
  assert.notDeepEqual(quadratic.subpaths[0]?.path.o[0], [0, 0]);
  assert.notDeepEqual(quadratic.subpaths[0]?.path.i[1], [0, 0]);

  const arc = parseSvgPathDataToLottie(
    "M0 0 A50 50 0 0 1 100 0",
  );
  assert.equal(arc.segmentCount, 2);
  assert.equal(arc.subpaths[0]?.path.v.length, 3);
  assert.notDeepEqual(arc.subpaths[0]?.path.o[0], [0, 0]);
  assert.ok((arc.subpaths[0]?.bounds.maxY ?? 0) - (arc.subpaths[0]?.bounds.minY ?? 0) > 49);
});

test("preserves multiple subpaths and exact cubic extrema", () => {
  const result = parseSvgPathDataToLottie(
    "M0 0 C0 100 100 100 100 0 M120 0 L140 20",
    { precision: 6 },
  );
  assert.equal(result.subpaths.length, 2);
  assert.equal(result.segmentCount, 2);
  assert.equal(result.subpaths[0]?.bounds.maxY, 75);
  assert.deepEqual(result.subpaths[1]?.bounds, {
    minX: 120,
    minY: 0,
    maxX: 140,
    maxY: 20,
  });
});

test("rejects malformed path tokens, invalid flags and empty geometry", () => {
  for (const source of [
    "M0 0 R10 10",
    "M0 0 A10 10 0 2 0 20 20",
    "M0 0",
    "L10 10",
  ]) {
    assert.throws(
      () => parseSvgPathDataToLottie(source),
      (error: unknown) =>
        error instanceof LottieEngineError &&
        error.code === "LOTTIE_PATH_INVALID",
    );
  }
});
