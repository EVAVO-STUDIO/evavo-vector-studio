import assert from "node:assert/strict";
import test from "node:test";
import { RasterEngineError } from "./errors.js";
import { inspectRasterHeader } from "./preflight.js";

function concat(...parts: readonly Uint8Array[]): Uint8Array {
  const output = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

function ascii(value: string): Uint8Array {
  return Uint8Array.from(value, (character) => character.charCodeAt(0));
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const chunk = new Uint8Array(12 + data.byteLength);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.byteLength, false);
  chunk.set(ascii(type), 4);
  chunk.set(data, 8);
  return chunk;
}

function animatedPng(): Uint8Array {
  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, 1, false);
  ihdrView.setUint32(4, 1, false);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const animation = new Uint8Array(8);
  const animationView = new DataView(animation.buffer);
  animationView.setUint32(0, 2, false);
  return concat(
    Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("acTL", animation),
    pngChunk("IEND", new Uint8Array()),
  );
}

function gifFrame(): Uint8Array {
  return Uint8Array.from([
    0x2c,
    0, 0, 0, 0,
    1, 0, 1, 0,
    0,
    2,
    2, 0x4c, 0x01,
    0,
  ]);
}

function gif(frameCount: number): Uint8Array {
  const frames = Array.from({ length: frameCount }, gifFrame);
  return concat(
    ascii("GIF89a"),
    Uint8Array.from([1, 0, 1, 0, 0, 0, 0]),
    ...frames,
    Uint8Array.from([0x3b]),
  );
}

function animatedWebp(): Uint8Array {
  const payload = new Uint8Array(10);
  payload[0] = 0x02;
  const chunk = new Uint8Array(18);
  chunk.set(ascii("VP8X"), 0);
  new DataView(chunk.buffer).setUint32(4, payload.byteLength, true);
  chunk.set(payload, 8);
  const output = new Uint8Array(12 + chunk.byteLength);
  output.set(ascii("RIFF"), 0);
  new DataView(output.buffer).setUint32(4, output.byteLength - 8, true);
  output.set(ascii("WEBP"), 8);
  output.set(chunk, 12);
  return output;
}

function multiPageTiff(): Uint8Array {
  const output = new Uint8Array(38);
  const view = new DataView(output.buffer);
  output.set(ascii("II"), 0);
  view.setUint16(2, 42, true);
  view.setUint32(4, 8, true);
  view.setUint16(8, 2, true);

  view.setUint16(10, 256, true);
  view.setUint16(12, 4, true);
  view.setUint32(14, 1, true);
  view.setUint32(18, 1, true);

  view.setUint16(22, 257, true);
  view.setUint16(24, 4, true);
  view.setUint32(26, 1, true);
  view.setUint32(30, 1, true);

  view.setUint32(34, 38, true);
  return output;
}

function mpoJpeg(): Uint8Array {
  return concat(
    Uint8Array.from([0xff, 0xd8]),
    Uint8Array.from([0xff, 0xe2, 0x00, 0x06]),
    ascii("MPF\0"),
    Uint8Array.from([0xff, 0xc0, 0x00, 0x07, 8, 0, 1, 0, 1]),
    Uint8Array.from([0xff, 0xd9]),
  );
}

function isMultiImageError(error: unknown): boolean {
  return error instanceof RasterEngineError && error.code === "RASTER_MULTI_IMAGE_UNSUPPORTED";
}

test("accepts a structurally bounded single-frame GIF", () => {
  const inspection = inspectRasterHeader(gif(1));
  assert.equal(inspection.format, "gif");
  assert.equal(inspection.width, 1);
  assert.equal(inspection.height, 1);
});

test("rejects animated PNG before native decoding", () => {
  assert.throws(() => inspectRasterHeader(animatedPng()), isMultiImageError);
});

test("rejects animated GIF before native decoding", () => {
  assert.throws(() => inspectRasterHeader(gif(2)), isMultiImageError);
});

test("rejects animated WebP before native decoding", () => {
  assert.throws(() => inspectRasterHeader(animatedWebp()), isMultiImageError);
});

test("rejects multi-page TIFF before native decoding", () => {
  assert.throws(() => inspectRasterHeader(multiPageTiff()), isMultiImageError);
});

test("rejects JPEG multi-picture containers before native decoding", () => {
  assert.throws(() => inspectRasterHeader(mpoJpeg()), isMultiImageError);
});
