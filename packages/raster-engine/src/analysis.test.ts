import assert from "node:assert/strict";
import test from "node:test";
import { analyseDecodedRaster } from "./analysis.js";
import { RasterEngineError } from "./errors.js";
import type { DecodedRaster, RasterHeaderInspection } from "./types.js";

function header(width: number, height: number): RasterHeaderInspection {
  return {
    format: "png",
    mimeType: "image/png",
    width,
    height,
    pixelCount: width * height,
    inputBytes: 16,
  };
}

function decoded(width: number, height: number, rgba: readonly number[]): DecodedRaster {
  return {
    width,
    height,
    pixels: Uint8Array.from(rgba),
  };
}

test("ignores hidden RGB beneath fully transparent pixels", () => {
  const analysis = analyseDecodedRaster(
    Uint8Array.from([1, 2, 3]),
    header(4, 1),
    decoded(4, 1, [
      255, 0, 0, 255,
      0, 255, 0, 0,
      0, 0, 255, 0,
      255, 255, 255, 0,
    ]),
  );

  assert.equal(analysis.colour.estimatedColours, 1);
  assert.deepEqual(analysis.colour.dominantColours, [{ hex: "#ff0000", share: 1 }]);
  assert.equal(analysis.content.visiblePixelCount, 1);
  assert.deepEqual(analysis.content.bounds, { x: 0, y: 0, width: 1, height: 1 });
  assert.equal(analysis.alpha.transparentCoverage, 0.75);
  assert.equal(analysis.suggestedProfile, "logo");
});

test("weights partially transparent colours by visible alpha", () => {
  const analysis = analyseDecodedRaster(
    Uint8Array.from([4, 5, 6]),
    header(2, 1),
    decoded(2, 1, [
      255, 0, 0, 255,
      0, 0, 255, 128,
    ]),
  );

  assert.equal(analysis.colour.estimatedColours, 2);
  assert.equal(analysis.colour.dominantColours[0]?.hex, "#ff0000");
  assert.equal(analysis.colour.dominantColours[0]?.share, 0.6658);
  assert.equal(analysis.colour.dominantColours[1]?.hex, "#0000ff");
  assert.equal(analysis.colour.dominantColours[1]?.share, 0.3342);
  assert.equal(analysis.sampling.alphaWeight, 1.502);
});

test("records exact visible bounds and warns about excessive transparent padding", () => {
  const pixels = new Uint8Array(10 * 10 * 4);
  for (const [x, y] of [[4, 3], [5, 3], [4, 4], [5, 4]] as const) {
    const offset = (y * 10 + x) * 4;
    pixels.set([20, 30, 40, 255], offset);
  }

  const analysis = analyseDecodedRaster(
    Uint8Array.from([7, 8, 9]),
    header(10, 10),
    { width: 10, height: 10, pixels },
  );

  assert.deepEqual(analysis.content.bounds, { x: 4, y: 3, width: 2, height: 2 });
  assert.equal(analysis.content.visiblePixelCount, 4);
  assert.equal(analysis.content.visibleCoverage, 0.04);
  assert.equal(analysis.content.boundingBoxCoverage, 0.04);
  assert.ok(analysis.warnings.some((warning) => warning.code === "RASTER_TRANSPARENT_PADDING"));
});

test("rejects a decoded source with no visible content", () => {
  assert.throws(
    () => analyseDecodedRaster(
      Uint8Array.from([10, 11, 12]),
      header(2, 2),
      decoded(2, 2, [
        255, 0, 0, 0,
        0, 255, 0, 0,
        0, 0, 255, 0,
        255, 255, 255, 0,
      ]),
    ),
    (error: unknown) => error instanceof RasterEngineError && error.code === "RASTER_NO_VISIBLE_CONTENT",
  );
});
