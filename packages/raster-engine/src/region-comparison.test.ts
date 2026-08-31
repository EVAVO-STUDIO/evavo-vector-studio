import assert from "node:assert/strict";
import test from "node:test";

import {
  REGION_COMPARISON_VERSION,
  compareRgbaImagesByRegion,
} from "./region-comparison.js";
import type { DecodedRaster } from "./types.js";

function raster(pixels: number[]): DecodedRaster {
  return Object.freeze({
    width: 2,
    height: 2,
    pixels: Uint8Array.from(pixels),
  });
}

const SOURCE = raster([
  0, 0, 0, 255,      10, 10, 10, 255,
  20, 20, 20, 255,   30, 30, 30, 255,
]);

const DEFINITIONS = Object.freeze([
  Object.freeze({ id: "face-core", index: 1, policy: "protected" as const }),
  Object.freeze({ id: "gesture-hand", index: 2, policy: "active" as const }),
]);
const REGIONS = Uint8Array.from([1, 1, 2, 2]);

test("region comparison attributes intended gesture change to the active region", () => {
  const rendered = raster([
    0, 0, 0, 255,      10, 10, 10, 255,
    220, 220, 220, 255, 230, 230, 230, 255,
  ]);
  const result = compareRgbaImagesByRegion(SOURCE, rendered, REGIONS, DEFINITIONS);
  assert.equal(result.schema, REGION_COMPARISON_VERSION);
  assert.equal(result.protectedErrorEnergy, 0);
  assert.ok(result.activeErrorEnergy > 0);
  assert.equal(result.motionContainmentScore, 1);
  assert.equal(result.protectedDriftFraction, 0);
});

test("region comparison exposes protected identity drift", () => {
  const rendered = raster([
    255, 255, 255, 255, 240, 240, 240, 255,
    20, 20, 20, 255,   30, 30, 30, 255,
  ]);
  const result = compareRgbaImagesByRegion(SOURCE, rendered, REGIONS, DEFINITIONS);
  assert.ok(result.protectedErrorEnergy > 0);
  assert.equal(result.activeErrorEnergy, 0);
  assert.equal(result.motionContainmentScore, 0);
  assert.equal(result.protectedDriftFraction, 1);
  assert.ok(result.regions.find((region) => region.id === "face-core")!.mismatchFraction > 0);
});

test("region comparison is alpha-aware and treats transparent-edge changes as visual error", () => {
  const source = raster([
    200, 100, 50, 0, 10, 10, 10, 255,
    20, 20, 20, 255, 30, 30, 30, 255,
  ]);
  const rendered = raster([
    200, 100, 50, 128, 10, 10, 10, 255,
    20, 20, 20, 255, 30, 30, 30, 255,
  ]);
  const result = compareRgbaImagesByRegion(source, rendered, REGIONS, DEFINITIONS);
  assert.ok(result.regions[0].visualMae > 0);
  assert.ok(result.protectedDriftFraction > 0);
});

test("region comparison fails closed on mismatched canvases and unknown region-map sizes", () => {
  const other: DecodedRaster = Object.freeze({
    width: 1,
    height: 1,
    pixels: Uint8Array.from([0, 0, 0, 255]),
  });
  assert.throws(
    () => compareRgbaImagesByRegion(SOURCE, other, REGIONS, DEFINITIONS),
    /RASTER_REGION_COMPARISON_CANVAS_MISMATCH/u,
  );
  assert.throws(
    () => compareRgbaImagesByRegion(SOURCE, SOURCE, Uint8Array.from([1]), DEFINITIONS),
    /RASTER_REGION_COMPARISON_MAP_INVALID/u,
  );
});
