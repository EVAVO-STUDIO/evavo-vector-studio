import assert from "node:assert/strict";
import test from "node:test";
import { compareRgbaImages } from "./comparison.js";
import type { DecodedRaster } from "./types.js";

function image(width: number, height: number, rgba: readonly number[]): DecodedRaster {
  return Object.freeze({ width, height, pixels: Uint8Array.from(rgba) });
}

test("identical RGBA images produce zero visual error", () => {
  const source = image(2, 1, [255, 0, 0, 255, 0, 0, 255, 128]);
  assert.deepEqual(compareRgbaImages(source, source), {
    visualMae: 0,
    premultipliedRgbMae: 0,
    alphaMae: 0,
    compositeBlackMae: 0,
    compositeWhiteMae: 0,
    rmsVisualError: 0,
    mismatchFraction: 0,
    aspectRatioDelta: 0,
  });
});

test("hidden RGB values do not create false differences when both pixels are transparent", () => {
  const source = image(1, 1, [255, 0, 0, 0]);
  const rendered = image(1, 1, [0, 255, 255, 0]);
  assert.equal(compareRgbaImages(source, rendered).visualMae, 0);
});

test("opaque black and white pixels produce a complete visual mismatch", () => {
  const source = image(1, 1, [0, 0, 0, 255]);
  const rendered = image(1, 1, [255, 255, 255, 255]);
  const result = compareRgbaImages(source, rendered);
  assert.equal(result.visualMae, 1);
  assert.equal(result.rmsVisualError, 1);
  assert.equal(result.mismatchFraction, 1);
});

test("source pixels are bilinearly sampled to the rendered grid", () => {
  const source = image(1, 1, [32, 64, 128, 255]);
  const rendered = image(2, 2, [32, 64, 128, 255, 32, 64, 128, 255, 32, 64, 128, 255, 32, 64, 128, 255]);
  assert.equal(compareRgbaImages(source, rendered).visualMae, 0);
});
