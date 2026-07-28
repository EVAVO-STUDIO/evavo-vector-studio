import assert from "node:assert/strict";
import test from "node:test";
import { buildDifferenceHeatmapRgba, encodeRgbaPng } from "./difference.js";
import type { DecodedRaster } from "./types.js";

function image(width: number, height: number, rgba: readonly number[]): DecodedRaster {
  return Object.freeze({ width, height, pixels: Uint8Array.from(rgba) });
}

test("identical pixels render as white in the difference heatmap", () => {
  const source = image(1, 1, [32, 64, 128, 255]);
  assert.deepEqual([...buildDifferenceHeatmapRgba(source, source)], [255, 255, 255, 255]);
});

test("hidden RGB values remain equal when both pixels are transparent", () => {
  const source = image(1, 1, [255, 0, 0, 0]);
  const rendered = image(1, 1, [0, 255, 255, 0]);
  assert.deepEqual([...buildDifferenceHeatmapRgba(source, rendered)], [255, 255, 255, 255]);
});

test("complete opaque mismatch renders as full red", () => {
  const source = image(1, 1, [0, 0, 0, 255]);
  const rendered = image(1, 1, [255, 255, 255, 255]);
  assert.deepEqual([...buildDifferenceHeatmapRgba(source, rendered)], [255, 0, 0, 255]);
});

test("encodes a standards-shaped RGBA PNG with declared dimensions", () => {
  const png = encodeRgbaPng(2, 1, Uint8Array.from([255, 255, 255, 255, 255, 0, 0, 255]));
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(String.fromCharCode(...png.subarray(12, 16)), "IHDR");
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  assert.equal(view.getUint32(16, false), 2);
  assert.equal(view.getUint32(20, false), 1);
  assert.equal(png[png.length - 1], 130);
});
