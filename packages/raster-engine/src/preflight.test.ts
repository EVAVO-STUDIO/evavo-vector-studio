import assert from "node:assert/strict";
import test from "node:test";
import { RasterEngineError } from "./errors.js";
import { inspectRasterHeader } from "./preflight.js";

function png(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width, false);
  view.setUint32(20, height, false);
  return bytes;
}

test("reads guarded PNG dimensions", () => {
  assert.deepEqual(inspectRasterHeader(png(512, 256)), {
    format: "png",
    mimeType: "image/png",
    width: 512,
    height: 256,
    pixelCount: 131072,
    inputBytes: 24,
  });
});

test("rejects decoded-pixel bombs before decoding", () => {
  assert.throws(
    () => inspectRasterHeader(png(20_000, 20_000), { maxPixels: 40_000_000 }),
    (error: unknown) => error instanceof RasterEngineError && error.code === "RASTER_PIXEL_LIMIT_EXCEEDED",
  );
});

test("rejects unknown input signatures", () => {
  assert.throws(
    () => inspectRasterHeader(new Uint8Array([1, 2, 3, 4])),
    (error: unknown) => error instanceof RasterEngineError && error.code === "RASTER_FORMAT_UNSUPPORTED",
  );
});
