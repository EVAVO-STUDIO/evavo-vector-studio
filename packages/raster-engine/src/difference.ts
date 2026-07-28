import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import { renderAsync, type ResvgRenderOptions } from "@resvg/resvg-js";
import { RasterEngineError, rasterFailure, throwIfAborted } from "./errors.js";
import {
  DEFAULT_DIFFERENCE_MAX_DIMENSION,
  MAX_DIFFERENCE_DIMENSION,
  type DecodedRaster,
  type DifferenceArtifactEvidence,
} from "./types.js";

const PNG_SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
const DISPLAY_AMPLIFICATION = 4;

export type DifferenceArtifactResult = Readonly<{
  png: Uint8Array;
  evidence: DifferenceArtifactEvidence;
}>;

type AxisSampling = Readonly<{
  lower: Int32Array;
  upper: Int32Array;
  weight: Float64Array;
}>;

function assertRgbaImage(image: DecodedRaster, label: string): void {
  if (!Number.isSafeInteger(image.width) || !Number.isSafeInteger(image.height) || image.width < 1 || image.height < 1) {
    throw new RasterEngineError("RASTER_DIFFERENCE_ARTIFACT_FAILED", `${label} has invalid dimensions.`, 422, {
      width: image.width,
      height: image.height,
    });
  }
  const expectedBytes = image.width * image.height * 4;
  if (image.pixels.byteLength !== expectedBytes) {
    throw new RasterEngineError("RASTER_DIFFERENCE_ARTIFACT_FAILED", `${label} is not a complete RGBA image.`, 422, {
      expectedBytes,
      actualBytes: image.pixels.byteLength,
    });
  }
}

function buildAxisSampling(sourceSize: number, targetSize: number): AxisSampling {
  const lower = new Int32Array(targetSize);
  const upper = new Int32Array(targetSize);
  const weight = new Float64Array(targetSize);
  for (let target = 0; target < targetSize; target += 1) {
    const sourcePosition = (target + 0.5) * sourceSize / targetSize - 0.5;
    const clamped = Math.max(0, Math.min(sourceSize - 1, sourcePosition));
    const low = Math.floor(clamped);
    lower[target] = low;
    upper[target] = Math.min(sourceSize - 1, low + 1);
    weight[target] = clamped - low;
  }
  return Object.freeze({ lower, upper, weight });
}

function sampledChannel(
  source: DecodedRaster,
  xSampling: AxisSampling,
  ySampling: AxisSampling,
  targetX: number,
  targetY: number,
  channel: number,
): number {
  const x0 = xSampling.lower[targetX];
  const x1 = xSampling.upper[targetX];
  const y0 = ySampling.lower[targetY];
  const y1 = ySampling.upper[targetY];
  const xWeight = xSampling.weight[targetX];
  const yWeight = ySampling.weight[targetY];
  const row0 = y0 * source.width;
  const row1 = y1 * source.width;
  const topLeft = source.pixels[(row0 + x0) * 4 + channel];
  const topRight = source.pixels[(row0 + x1) * 4 + channel];
  const bottomLeft = source.pixels[(row1 + x0) * 4 + channel];
  const bottomRight = source.pixels[(row1 + x1) * 4 + channel];
  const top = topLeft + (topRight - topLeft) * xWeight;
  const bottom = bottomLeft + (bottomRight - bottomLeft) * xWeight;
  return top + (bottom - top) * yWeight;
}

export function buildDifferenceHeatmapRgba(
  source: DecodedRaster,
  rendered: DecodedRaster,
  displayAmplification = DISPLAY_AMPLIFICATION,
): Uint8Array {
  assertRgbaImage(source, "Source raster");
  assertRgbaImage(rendered, "Rendered SVG");
  if (!Number.isFinite(displayAmplification) || displayAmplification <= 0 || displayAmplification > 32) {
    throw new RasterEngineError("RASTER_OPTIONS_INVALID", "displayAmplification must be greater than 0 and no more than 32.", 400);
  }

  const output = new Uint8Array(rendered.width * rendered.height * 4);
  const xSampling = buildAxisSampling(source.width, rendered.width);
  const ySampling = buildAxisSampling(source.height, rendered.height);

  for (let y = 0; y < rendered.height; y += 1) {
    for (let x = 0; x < rendered.width; x += 1) {
      const offset = (y * rendered.width + x) * 4;
      const sourceAlpha = sampledChannel(source, xSampling, ySampling, x, y, 3) / 255;
      const renderedAlpha = rendered.pixels[offset + 3] / 255;
      const alphaError = Math.abs(sourceAlpha - renderedAlpha);
      let blackError = 0;
      let whiteError = 0;

      for (let channel = 0; channel < 3; channel += 1) {
        const sourceChannel = sampledChannel(source, xSampling, ySampling, x, y, channel) / 255;
        const renderedChannel = rendered.pixels[offset + channel] / 255;
        const sourcePremultiplied = sourceChannel * sourceAlpha;
        const renderedPremultiplied = renderedChannel * renderedAlpha;
        blackError += Math.abs(sourcePremultiplied - renderedPremultiplied);
        whiteError += Math.abs(
          sourcePremultiplied + 1 - sourceAlpha - (renderedPremultiplied + 1 - renderedAlpha),
        );
      }

      const visualError = Math.max(alphaError, blackError / 3, whiteError / 3);
      const amplified = Math.min(1, visualError * displayAmplification);
      output[offset] = 255;
      output[offset + 1] = Math.round(255 * (1 - amplified));
      output[offset + 2] = Math.round(255 * (1 - amplified));
      output[offset + 3] = 255;
    }
  }

  return output;
}

function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

function uint32BigEndian(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value >>> 0, false);
  return bytes;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let value = 0; value < 256; value += 1) {
    let current = value;
    for (let bit = 0; bit < 8; bit += 1) {
      current = (current & 1) !== 0 ? 0xedb88320 ^ (current >>> 1) : current >>> 1;
    }
    table[value] = current >>> 0;
  }
  return table;
})();

function crc32(source: Uint8Array): number {
  let crc = 0xffffffff;
  for (const value of source) {
    crc = CRC_TABLE[(crc ^ value) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  if (!/^[A-Za-z]{4}$/.test(type)) throw new Error(`PNG_CHUNK_TYPE_INVALID:${type}`);
  const typeBytes = new TextEncoder().encode(type);
  const payload = concatBytes([typeBytes, data]);
  return concatBytes([uint32BigEndian(data.byteLength), payload, uint32BigEndian(crc32(payload))]);
}

export function encodeRgbaPng(width: number, height: number, pixels: Uint8Array): Uint8Array {
  assertRgbaImage(Object.freeze({ width, height, pixels }), "Difference heatmap");
  const header = new Uint8Array(13);
  const headerView = new DataView(header.buffer);
  headerView.setUint32(0, width, false);
  headerView.setUint32(4, height, false);
  header[8] = 8;
  header[9] = 6;
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;

  const stride = width * 4;
  const scanlines = new Uint8Array(height * (stride + 1));
  for (let row = 0; row < height; row += 1) {
    const outputOffset = row * (stride + 1);
    scanlines[outputOffset] = 0;
    scanlines.set(pixels.subarray(row * stride, (row + 1) * stride), outputOffset + 1);
  }

  const compressed = new Uint8Array(deflateSync(scanlines, { level: 9 }));
  return concatBytes([
    PNG_SIGNATURE,
    pngChunk("IHDR", header),
    pngChunk("IDAT", compressed),
    pngChunk("IEND", new Uint8Array()),
  ]);
}

export async function createDifferenceArtifact(
  source: DecodedRaster,
  svg: string,
  selectedCandidateId: string,
  options: Readonly<{ maxDimension?: number; signal?: AbortSignal }> = {},
): Promise<DifferenceArtifactResult> {
  assertRgbaImage(source, "Source raster");
  throwIfAborted(options.signal);
  const requestedMaxDimension = options.maxDimension ?? DEFAULT_DIFFERENCE_MAX_DIMENSION;
  if (!Number.isSafeInteger(requestedMaxDimension) || requestedMaxDimension < 32 || requestedMaxDimension > MAX_DIFFERENCE_DIMENSION) {
    throw new RasterEngineError(
      "RASTER_OPTIONS_INVALID",
      `differenceMaxDimension must be an integer from 32 to ${MAX_DIFFERENCE_DIMENSION}.`,
      400,
      { requestedMaxDimension },
    );
  }

  const sourceMaximum = Math.max(source.width, source.height);
  const renderDimension = Math.min(requestedMaxDimension, sourceMaximum);
  const fitMode = source.width >= source.height ? "width" : "height";
  const fitTo: ResvgRenderOptions["fitTo"] = { mode: fitMode, value: renderDimension };

  try {
    const rendered = await renderAsync(
      svg,
      {
        fitTo,
        font: { loadSystemFonts: false },
        shapeRendering: 2,
        textRendering: 2,
        imageRendering: 0,
        logLevel: "off",
      },
      options.signal,
    );
    throwIfAborted(options.signal);
    const renderedRaster: DecodedRaster = Object.freeze({
      width: rendered.width,
      height: rendered.height,
      pixels: rendered.pixels,
    });
    const heatmap = buildDifferenceHeatmapRgba(source, renderedRaster, DISPLAY_AMPLIFICATION);
    const png = encodeRgbaPng(rendered.width, rendered.height, heatmap);
    return Object.freeze({
      png,
      evidence: Object.freeze({
        kind: "visual-difference-heatmap",
        mimeType: "image/png",
        width: rendered.width,
        height: rendered.height,
        bytes: png.byteLength,
        sha256: createHash("sha256").update(png).digest("hex"),
        requestedMaxDimension,
        displayAmplification: DISPLAY_AMPLIFICATION,
        colourMap: "white-to-red",
        sourceSampling: "bilinear",
        selectedCandidateId,
      }),
    });
  } catch (error) {
    if (options.signal?.aborted) throw new RasterEngineError("RASTER_ABORTED", "Difference artefact generation was aborted.", 499);
    throw rasterFailure(
      "RASTER_DIFFERENCE_ARTIFACT_FAILED",
      "The selected trace could not be rendered into a visual difference artefact.",
      error,
      422,
    );
  }
}
