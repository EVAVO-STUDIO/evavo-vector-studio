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

function parsePng(source: Uint8Array): Dimensions | null {
  if (!startsWith(source, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return null;
  if (source.length < 24 || ascii(source, 12, 4) !== "IHDR") {
    throw new RasterEngineError("RASTER_HEADER_INVALID", "The PNG is missing a complete IHDR chunk.", 422);
  }
  const view = viewFor(source);
  return positiveDimensions("png", "image/png", view.getUint32(16, false), view.getUint32(20, false));
}

const JPEG_START_OF_FRAME = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

function parseJpeg(source: Uint8Array): Dimensions | null {
  if (!startsWith(source, [0xff, 0xd8])) return null;
  const view = viewFor(source);
  let offset = 2;
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
    if (JPEG_START_OF_FRAME.has(marker)) {
      if (segmentLength < 7) {
        throw new RasterEngineError("RASTER_HEADER_INVALID", "The JPEG start-of-frame segment is incomplete.", 422);
      }
      const height = view.getUint16(offset + 3, false);
      const width = view.getUint16(offset + 5, false);
      return positiveDimensions("jpeg", "image/jpeg", width, height);
    }
    offset += segmentLength;
  }
  throw new RasterEngineError("RASTER_HEADER_INVALID", "The JPEG does not contain a supported start-of-frame marker.", 422);
}

function parseGif(source: Uint8Array): Dimensions | null {
  const signature = source.length >= 6 ? ascii(source, 0, 6) : "";
  if (signature !== "GIF87a" && signature !== "GIF89a") return null;
  if (source.length < 10) throw new RasterEngineError("RASTER_HEADER_INVALID", "The GIF header is incomplete.", 422);
  const view = viewFor(source);
  return positiveDimensions("gif", "image/gif", view.getUint16(6, true), view.getUint16(8, true));
}

function readUint24LE(source: Uint8Array, offset: number): number {
  if (offset + 3 > source.length) return 0;
  return source[offset] | (source[offset + 1] << 8) | (source[offset + 2] << 16);
}

function parseWebp(source: Uint8Array): Dimensions | null {
  if (source.length < 12 || ascii(source, 0, 4) !== "RIFF" || ascii(source, 8, 4) !== "WEBP") return null;
  const view = viewFor(source);
  let offset = 12;
  while (offset + 8 <= source.length) {
    const chunkType = ascii(source, offset, 4);
    const chunkLength = view.getUint32(offset + 4, true);
    const payload = offset + 8;
    if (payload + chunkLength > source.length) {
      throw new RasterEngineError("RASTER_HEADER_INVALID", "The WebP contains a truncated chunk.", 422, { chunkType });
    }
    if (chunkType === "VP8X" && chunkLength >= 10) {
      return positiveDimensions(
        "webp",
        "image/webp",
        readUint24LE(source, payload + 4) + 1,
        readUint24LE(source, payload + 7) + 1,
      );
    }
    if (chunkType === "VP8L" && chunkLength >= 5 && source[payload] === 0x2f) {
      const b1 = source[payload + 1];
      const b2 = source[payload + 2];
      const b3 = source[payload + 3];
      const b4 = source[payload + 4];
      const width = 1 + ((b1 | (b2 << 8)) & 0x3fff);
      const height = 1 + (((b2 >> 6) | (b3 << 2) | (b4 << 10)) & 0x3fff);
      return positiveDimensions("webp", "image/webp", width, height);
    }
    if (
      chunkType === "VP8 " &&
      chunkLength >= 10 &&
      source[payload + 3] === 0x9d &&
      source[payload + 4] === 0x01 &&
      source[payload + 5] === 0x2a
    ) {
      const width = view.getUint16(payload + 6, true) & 0x3fff;
      const height = view.getUint16(payload + 8, true) & 0x3fff;
      return positiveDimensions("webp", "image/webp", width, height);
    }
    offset = payload + chunkLength + (chunkLength % 2);
  }
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
  const width = view.getInt32(18, true);
  const height = Math.abs(view.getInt32(22, true));
  return positiveDimensions("bmp", "image/bmp", width, height);
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
        "Supported raster inputs are PNG, JPEG, WebP, GIF, BMP and classic TIFF.",
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
