import { RasterEngineError, throwIfAborted } from "./errors.js";
import {
  DEFAULT_MAX_INPUT_BYTES,
  DEFAULT_MAX_PIXELS,
  type RasterFormat,
  type RasterHeaderInspection,
  type RasterInspectionOptions,
} from "./types.js";

type Dimensions = Readonly<{ format: RasterFormat; mimeType: string; width: number; height: number }>;

function startsWith(source: Uint8Array, signature: readonly number[], offset = 0): boolean {
  if (source.length < offset + signature.length) return false;
  return signature.every((value, index) => source[offset + index] === value);
}

function ascii(source: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...source.subarray(start, start + length));
}

function viewFor(source: Uint8Array): DataView {
  return new DataView(source.buffer, source.byteOffset, source.byteLength);
}

function positiveDimensions(format: RasterFormat, mimeType: string, width: number, height: number): Dimensions {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    throw new RasterEngineError("RASTER_HEADER_INVALID", `The ${format.toUpperCase()} header contains invalid dimensions.`, 422, {
      width,
      height,
    });
  }
  return Object.freeze({ format, mimeType, width, height });
}

function rejectMultiImage(
  format: RasterFormat,
  container: string,
  frameOrPageCount: number | null,
): never {
  throw new RasterEngineError(
    "RASTER_MULTI_IMAGE_UNSUPPORTED",
    `The ${format.toUpperCase()} contains multiple frames or pages. Vector Studio currently accepts one static image per trace so it cannot silently discard motion or pages.`,
    422,
    { format, container, frameOrPageCount, policy: "one-static-image-per-trace" },
  );
}

function inspectPngAnimation(source: Uint8Array, view: DataView): void {
  if (source.length < 33 || view.getUint32(8, false) !== 13 || ascii(source, 12, 4) !== "IHDR") return;
  let offset = 8;
  while (offset + 12 <= source.length) {
    const chunkLength = view.getUint32(offset, false);
    const chunkType = ascii(source, offset + 4, 4);
    const payload = offset + 8;
    const next = payload + chunkLength + 4;
    if (!Number.isSafeInteger(next) || next > source.length) {
      throw new RasterEngineError("RASTER_HEADER_INVALID", "The PNG contains a truncated chunk.", 422, { chunkType });
    }
    if (chunkType === "acTL") {
      if (chunkLength < 8) throw new RasterEngineError("RASTER_HEADER_INVALID", "The APNG animation-control chunk is incomplete.", 422);
      const frameCount = view.getUint32(payload, false);
      if (frameCount < 1) throw new RasterEngineError("RASTER_HEADER_INVALID", "The APNG declares an invalid frame count.", 422, { frameCount });
      if (frameCount > 1) rejectMultiImage("png", "apng", frameCount);
    }
    if (chunkType === "IEND") return;
    offset = next;
  }
}

function parsePng(source: Uint8Array): Dimensions | null {
  if (!startsWith(source, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return null;
  if (source.length < 24 || ascii(source, 12, 4) !== "IHDR") {
    throw new RasterEngineError("RASTER_HEADER_INVALID", "The PNG is missing a complete IHDR chunk.", 422);
  }
  const view = viewFor(source);
  inspectPngAnimation(source, view);
  return positiveDimensions("png", "image/png", view.getUint32(16, false), view.getUint32(20, false));
}

const JPEG_START_OF_FRAME = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

function parseJpeg(source: Uint8Array): Dimensions | null {
  if (!startsWith(source, [0xff, 0xd8])) return null;
  const view = viewFor(source);
  let offset = 2;
  let dimensions: Dimensions | null = null;
  while (offset + 3 < source.length) {
    while (offset < source.length && source[offset] !== 0xff) offset += 1;
    while (offset < source.length && source[offset] === 0xff) offset += 1;
    if (offset >= source.length) break;
    const marker = source[offset];
    offset += 1;
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > source.length) break;
    const segmentLength = view.getUint16(offset, false);
    if (segmentLength < 2 || offset + segmentLength > source.length) {
      throw new RasterEngineError("RASTER_HEADER_INVALID", "The JPEG contains an invalid marker segment.", 422);
    }
    const payload = offset + 2;
    if (marker === 0xe2 && segmentLength >= 6 && ascii(source, payload, 4) === "MPF\0") {
      rejectMultiImage("jpeg", "mpo", null);
    }
    if (JPEG_START_OF_FRAME.has(marker)) {
      if (segmentLength < 7) {
        throw new RasterEngineError("RASTER_HEADER_INVALID", "The JPEG start-of-frame segment is incomplete.", 422);
      }
      dimensions = positiveDimensions("jpeg", "image/jpeg", view.getUint16(offset + 5, false), view.getUint16(offset + 3, false));
    }
    offset += segmentLength;
  }
  if (dimensions) return dimensions;
  throw new RasterEngineError("RASTER_HEADER_INVALID", "The JPEG does not contain a supported start-of-frame marker.", 422);
}

function skipGifSubBlocks(source: Uint8Array, start: number): number {
  let offset = start;
  while (offset < source.length) {
    const length = source[offset];
    offset += 1;
    if (length === 0) return offset;
    if (offset + length > source.length) throw new RasterEngineError("RASTER_HEADER_INVALID", "The GIF contains a truncated data sub-block.", 422);
    offset += length;
  }
  throw new RasterEngineError("RASTER_HEADER_INVALID", "The GIF data sub-blocks are not terminated.", 422);
}

function gifColourTableBytes(packed: number): number {
  return (packed & 0x80) === 0 ? 0 : 3 * 2 ** ((packed & 0x07) + 1);
}

function parseGif(source: Uint8Array): Dimensions | null {
  const signature = source.length >= 6 ? ascii(source, 0, 6) : "";
  if (signature !== "GIF87a" && signature !== "GIF89a") return null;
  if (source.length < 13) throw new RasterEngineError("RASTER_HEADER_INVALID", "The GIF header is incomplete.", 422);
  const view = viewFor(source);
  const dimensions = positiveDimensions("gif", "image/gif", view.getUint16(6, true), view.getUint16(8, true));
  let offset = 13 + gifColourTableBytes(source[10]);
  if (offset > source.length) throw new RasterEngineError("RASTER_HEADER_INVALID", "The GIF global colour table is truncated.", 422);
  let frameCount = 0;

  while (offset < source.length) {
    const blockType = source[offset];
    offset += 1;
    if (blockType === 0x3b) break;
    if (blockType === 0x21) {
      if (offset >= source.length) throw new RasterEngineError("RASTER_HEADER_INVALID", "The GIF extension block is incomplete.", 422);
      offset += 1;
      offset = skipGifSubBlocks(source, offset);
      continue;
    }
    if (blockType === 0x2c) {
      frameCount += 1;
      if (frameCount > 1) rejectMultiImage("gif", "animated-gif", frameCount);
      if (offset + 9 > source.length) throw new RasterEngineError("RASTER_HEADER_INVALID", "The GIF image descriptor is incomplete.", 422);
      const packed = source[offset + 8];
      offset += 9 + gifColourTableBytes(packed);
      if (offset >= source.length) throw new RasterEngineError("RASTER_HEADER_INVALID", "The GIF image data is incomplete.", 422);
      offset += 1;
      offset = skipGifSubBlocks(source, offset);
      continue;
    }
    throw new RasterEngineError("RASTER_HEADER_INVALID", "The GIF contains an unknown top-level block.", 422, { blockType });
  }

  if (frameCount === 0) throw new RasterEngineError("RASTER_HEADER_INVALID", "The GIF does not contain an image frame.", 422);
  return dimensions;
}

function readUint24LE(source: Uint8Array, offset: number): number {
  if (offset + 3 > source.length) return 0;
  return source[offset] | (source[offset + 1] << 8) | (source[offset + 2] << 16);
}

function parseWebp(source: Uint8Array): Dimensions | null {
  if (source.length < 12 || ascii(source, 0, 4) !== "RIFF" || ascii(source, 8, 4) !== "WEBP") return null;
  const view = viewFor(source);
  const declaredEnd = view.getUint32(4, true) + 8;
  if (declaredEnd > source.length) throw new RasterEngineError("RASTER_HEADER_INVALID", "The WebP RIFF container is truncated.", 422, { declaredEnd, inputBytes: source.length });

  let offset = 12;
  let dimensions: Dimensions | null = null;
  let animationFlag = false;
  let animationControlPresent = false;
  let frameCount = 0;

  while (offset + 8 <= source.length) {
    const chunkType = ascii(source, offset, 4);
    const chunkLength = view.getUint32(offset + 4, true);
    const payload = offset + 8;
    if (payload + chunkLength > source.length) {
      throw new RasterEngineError("RASTER_HEADER_INVALID", "The WebP contains a truncated chunk.", 422, { chunkType });
    }
    if (chunkType === "VP8X" && chunkLength >= 10) {
      animationFlag = (source[payload] & 0x02) !== 0;
      dimensions = positiveDimensions(
        "webp",
        "image/webp",
        readUint24LE(source, payload + 4) + 1,
        readUint24LE(source, payload + 7) + 1,
      );
    } else if (chunkType === "ANIM") {
      animationControlPresent = true;
    } else if (chunkType === "ANMF") {
      frameCount += 1;
    } else if (chunkType === "VP8L" && !dimensions && chunkLength >= 5 && source[payload] === 0x2f) {
      const b1 = source[payload + 1];
      const b2 = source[payload + 2];
      const b3 = source[payload + 3];
      const b4 = source[payload + 4];
      dimensions = positiveDimensions(
        "webp",
        "image/webp",
        1 + ((b1 | (b2 << 8)) & 0x3fff),
        1 + (((b2 >> 6) | (b3 << 2) | (b4 << 10)) & 0x3fff),
      );
    } else if (
      chunkType === "VP8 " &&
      !dimensions &&
      chunkLength >= 10 &&
      source[payload + 3] === 0x9d &&
      source[payload + 4] === 0x01 &&
      source[payload + 5] === 0x2a
    ) {
      dimensions = positiveDimensions(
        "webp",
        "image/webp",
        view.getUint16(payload + 6, true) & 0x3fff,
        view.getUint16(payload + 8, true) & 0x3fff,
      );
    }
    offset = payload + chunkLength + (chunkLength % 2);
  }

  if (animationFlag || animationControlPresent || frameCount > 0) {
    rejectMultiImage("webp", "animated-webp", frameCount > 0 ? frameCount : null);
  }
  if (dimensions) return dimensions;
  throw new RasterEngineError("RASTER_HEADER_INVALID", "The WebP does not contain a supported image chunk.", 422);
}

function parseBmp(source: Uint8Array): Dimensions | null {
  if (!startsWith(source, [0x42, 0x4d])) return null;
  if (source.length < 26) throw new RasterEngineError("RASTER_HEADER_INVALID", "The BMP header is incomplete.", 422);
  const view = viewFor(source);
  const dibSize = view.getUint32(14, true);
  if (dibSize === 12) {
    return positiveDimensions("bmp", "image/bmp", view.getUint16(18, true), view.getUint16(20, true));
  }
  if (dibSize < 40) {
    throw new RasterEngineError("RASTER_HEADER_INVALID", "The BMP uses an unsupported DIB header.", 422, { dibSize });
  }
  return positiveDimensions("bmp", "image/bmp", view.getInt32(18, true), Math.abs(view.getInt32(22, true)));
}

function parseTiff(source: Uint8Array): Dimensions | null {
  if (source.length < 8) return null;
  const byteOrder = ascii(source, 0, 2);
  if (byteOrder !== "II" && byteOrder !== "MM") return null;
  const littleEndian = byteOrder === "II";
  const view = viewFor(source);
  const read16 = (offset: number): number => view.getUint16(offset, littleEndian);
  const read32 = (offset: number): number => view.getUint32(offset, littleEndian);
  if (read16(2) !== 42) {
    throw new RasterEngineError("RASTER_HEADER_INVALID", "Only classic TIFF headers are supported by the bounded preflight parser.", 422);
  }
  const ifdOffset = read32(4);
  if (ifdOffset + 2 > source.length) throw new RasterEngineError("RASTER_HEADER_INVALID", "The TIFF IFD offset is invalid.", 422);
  const entryCount = read16(ifdOffset);
  let width: number | null = null;
  let height: number | null = null;
  for (let index = 0; index < entryCount; index += 1) {
    const entry = ifdOffset + 2 + index * 12;
    if (entry + 12 > source.length) throw new RasterEngineError("RASTER_HEADER_INVALID", "The TIFF IFD is truncated.", 422);
    const tag = read16(entry);
    if (tag !== 256 && tag !== 257) continue;
    const type = read16(entry + 2);
    const count = read32(entry + 4);
    if (count !== 1 || (type !== 3 && type !== 4)) continue;
    const value = type === 3 ? read16(entry + 8) : read32(entry + 8);
    if (tag === 256) width = value;
    if (tag === 257) height = value;
  }
  const nextIfdPosition = ifdOffset + 2 + entryCount * 12;
  if (nextIfdPosition + 4 > source.length) throw new RasterEngineError("RASTER_HEADER_INVALID", "The TIFF IFD terminator is truncated.", 422);
  const nextIfdOffset = read32(nextIfdPosition);
  if (nextIfdOffset !== 0) rejectMultiImage("tiff", "multi-page-tiff", null);
  if (width === null || height === null) {
    throw new RasterEngineError("RASTER_HEADER_INVALID", "The TIFF does not expose scalar width and height tags in its first IFD.", 422);
  }
  return positiveDimensions("tiff", "image/tiff", width, height);
}

function parseDimensions(source: Uint8Array): Dimensions {
  return (
    parsePng(source) ??
    parseJpeg(source) ??
    parseWebp(source) ??
    parseGif(source) ??
    parseBmp(source) ??
    parseTiff(source) ??
    (() => {
      throw new RasterEngineError(
        "RASTER_FORMAT_UNSUPPORTED",
        "Supported raster inputs are static PNG, JPEG, WebP, GIF, BMP and single-page classic TIFF.",
        415,
      );
    })()
  );
}

export function inspectRasterHeader(source: Uint8Array, options: RasterInspectionOptions = {}): RasterHeaderInspection {
  throwIfAborted(options.signal);
  const maxInputBytes = options.maxInputBytes ?? DEFAULT_MAX_INPUT_BYTES;
  const maxPixels = options.maxPixels ?? DEFAULT_MAX_PIXELS;
  if (source.byteLength === 0) throw new RasterEngineError("RASTER_INPUT_EMPTY", "The raster input is empty.", 400);
  if (!Number.isSafeInteger(maxInputBytes) || maxInputBytes < 1 || !Number.isSafeInteger(maxPixels) || maxPixels < 1) {
    throw new RasterEngineError("RASTER_OPTIONS_INVALID", "Raster safety limits must be positive safe integers.", 500);
  }
  if (source.byteLength > maxInputBytes) {
    throw new RasterEngineError("RASTER_INPUT_TOO_LARGE", "The raster input exceeds the configured byte limit.", 413, {
      inputBytes: source.byteLength,
      maxInputBytes,
    });
  }
  const dimensions = parseDimensions(source);
  const pixelCount = dimensions.width * dimensions.height;
  if (!Number.isSafeInteger(pixelCount) || pixelCount > maxPixels) {
    throw new RasterEngineError("RASTER_PIXEL_LIMIT_EXCEEDED", "The raster dimensions exceed the configured decoded-pixel limit.", 413, {
      width: dimensions.width,
      height: dimensions.height,
      pixelCount,
      maxPixels,
    });
  }
  return Object.freeze({ ...dimensions, pixelCount, inputBytes: source.byteLength });
}
