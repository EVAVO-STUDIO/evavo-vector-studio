import { createHash } from "node:crypto";
import { RasterEngineError, throwIfAborted } from "./errors.js";
import {
  DEFAULT_ANALYSIS_DIMENSION,
  type DecodedRaster,
  type DominantColour,
  type RasterAnalysis,
  type RasterHeaderInspection,
  type RasterInspectionOptions,
  type RasterTraceProfile,
  type RasterWarning,
} from "./types.js";

function round(value: number, digits = 4): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function luminance(red: number, green: number, blue: number): number {
  return Math.max(0, Math.min(255, Math.round(red * 0.2126 + green * 0.7152 + blue * 0.0722)));
}

function percentile(histogram: readonly number[], sampleCount: number, percentileValue: number): number {
  const target = Math.max(1, Math.ceil(sampleCount * percentileValue));
  let cumulative = 0;
  for (let index = 0; index < histogram.length; index += 1) {
    cumulative += histogram[index] ?? 0;
    if (cumulative >= target) return index;
  }
  return histogram.length - 1;
}

function entropy(histogram: readonly number[], sampleCount: number): number {
  if (sampleCount === 0) return 0;
  let result = 0;
  for (const count of histogram) {
    if (count === 0) continue;
    const probability = count / sampleCount;
    result -= probability * Math.log2(probability);
  }
  return result;
}

function hex(red: number, green: number, blue: number): string {
  return `#${[red, green, blue].map((value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0")).join("")}`;
}

type QuantisedColour = {
  count: number;
  red: number;
  green: number;
  blue: number;
};

function classify(input: {
  width: number;
  height: number;
  estimatedColours: number;
  meanSaturation: number;
  edgeDensity: number;
  transparentCoverage: number;
  partialCoverage: number;
  luminanceEntropy: number;
}): Readonly<{ profile: RasterTraceProfile; signals: readonly string[] }> {
  const signals: string[] = [];
  const compactCanvas = input.width <= 768 && input.height <= 768;
  const hasTransparency = input.transparentCoverage + input.partialCoverage >= 0.025;
  const mostlyMonochrome = input.meanSaturation < 0.13;

  if (mostlyMonochrome && input.estimatedColours <= 24 && input.edgeDensity >= 0.08) {
    signals.push("low saturation", "limited colour structure", "strong contour density");
    return Object.freeze({ profile: "line-art", signals: Object.freeze(signals) });
  }
  if (input.estimatedColours <= 16 && input.edgeDensity >= 0.035) {
    signals.push("small quantised palette", "clear silhouette boundaries");
    if (hasTransparency) signals.push("meaningful transparent background");
    return Object.freeze({ profile: "logo", signals: Object.freeze(signals) });
  }
  if (compactCanvas && hasTransparency && input.estimatedColours <= 96) {
    signals.push("compact source dimensions", "transparent canvas", "bounded palette complexity");
    return Object.freeze({ profile: "icon", signals: Object.freeze(signals) });
  }
  if (input.estimatedColours >= 384 || (input.luminanceEntropy >= 6.8 && input.edgeDensity >= 0.16)) {
    signals.push("high colour variation", "broad tonal distribution", "dense local detail");
    return Object.freeze({ profile: "photo", signals: Object.freeze(signals) });
  }
  signals.push("moderate palette complexity", "mixed curves and filled regions");
  return Object.freeze({ profile: "illustration", signals: Object.freeze(signals) });
}

export function analyseDecodedRaster(
  encodedSource: Uint8Array,
  header: RasterHeaderInspection,
  decoded: DecodedRaster,
  options: RasterInspectionOptions = {},
): RasterAnalysis {
  throwIfAborted(options.signal);
  const analysisDimension = options.analysisDimension ?? DEFAULT_ANALYSIS_DIMENSION;
  if (!Number.isSafeInteger(analysisDimension) || analysisDimension < 32 || analysisDimension > 2048) {
    throw new RasterEngineError("RASTER_OPTIONS_INVALID", "analysisDimension must be an integer from 32 to 2048.", 400);
  }
  if (decoded.width !== header.width || decoded.height !== header.height) {
    throw new RasterEngineError("RASTER_DECODE_MISMATCH", "Decoded dimensions do not match the guarded source header.", 422, {
      headerWidth: header.width,
      headerHeight: header.height,
      decodedWidth: decoded.width,
      decodedHeight: decoded.height,
    });
  }
  const expectedBytes = decoded.width * decoded.height * 4;
  if (decoded.pixels.byteLength !== expectedBytes) {
    throw new RasterEngineError("RASTER_DECODE_MISMATCH", "Decoded raster data is not a complete RGBA pixel buffer.", 422, {
      expectedBytes,
      decodedBytes: decoded.pixels.byteLength,
    });
  }

  const maximumSamples = analysisDimension * analysisDimension;
  const stride = Math.max(1, Math.ceil(Math.sqrt(header.pixelCount / maximumSamples)));
  const luminanceHistogram = Array.from({ length: 256 }, () => 0);
  const colourHistogram = new Map<number, QuantisedColour>();
  let sampleCount = 0;
  let transparent = 0;
  let partial = 0;
  let opaque = 0;
  let luminanceTotal = 0;
  let saturationTotal = 0;
  let edgeComparisons = 0;
  let strongEdges = 0;

  const pixelLuminance = (x: number, y: number): number => {
    const offset = (y * decoded.width + x) * 4;
    return luminance(decoded.pixels[offset], decoded.pixels[offset + 1], decoded.pixels[offset + 2]);
  };

  for (let y = 0; y < decoded.height; y += stride) {
    throwIfAborted(options.signal);
    for (let x = 0; x < decoded.width; x += stride) {
      const offset = (y * decoded.width + x) * 4;
      const red = decoded.pixels[offset];
      const green = decoded.pixels[offset + 1];
      const blue = decoded.pixels[offset + 2];
      const alpha = decoded.pixels[offset + 3];
      const lightness = luminance(red, green, blue);
      sampleCount += 1;
      luminanceTotal += lightness;
      luminanceHistogram[lightness] += 1;
      if (alpha <= 7) transparent += 1;
      else if (alpha < 248) partial += 1;
      else opaque += 1;

      const maximum = Math.max(red, green, blue);
      const minimum = Math.min(red, green, blue);
      saturationTotal += maximum === 0 ? 0 : (maximum - minimum) / maximum;

      const colourKey = ((red >> 3) << 10) | ((green >> 3) << 5) | (blue >> 3);
      const colour = colourHistogram.get(colourKey);
      if (colour) {
        colour.count += 1;
        colour.red += red;
        colour.green += green;
        colour.blue += blue;
      } else {
        colourHistogram.set(colourKey, { count: 1, red, green, blue });
      }

      if (x + stride < decoded.width) {
        edgeComparisons += 1;
        if (Math.abs(lightness - pixelLuminance(x + stride, y)) >= 28) strongEdges += 1;
      }
      if (y + stride < decoded.height) {
        edgeComparisons += 1;
        if (Math.abs(lightness - pixelLuminance(x, y + stride)) >= 28) strongEdges += 1;
      }
    }
  }

  const dominantColours: DominantColour[] = [...colourHistogram.values()]
    .sort((left, right) => right.count - left.count)
    .slice(0, 8)
    .map((colour) =>
      Object.freeze({
        hex: hex(colour.red / colour.count, colour.green / colour.count, colour.blue / colour.count),
        share: round(colour.count / sampleCount),
      }),
    );

  const transparentCoverage = transparent / sampleCount;
  const partialCoverage = partial / sampleCount;
  const opaqueCoverage = opaque / sampleCount;
  const meanSaturation = saturationTotal / sampleCount;
  const edgeDensity = edgeComparisons === 0 ? 0 : strongEdges / edgeComparisons;
  const percentile05 = percentile(luminanceHistogram, sampleCount, 0.05);
  const percentile95 = percentile(luminanceHistogram, sampleCount, 0.95);
  const luminanceEntropy = entropy(luminanceHistogram, sampleCount);
  const classification = classify({
    width: header.width,
    height: header.height,
    estimatedColours: colourHistogram.size,
    meanSaturation,
    edgeDensity,
    transparentCoverage,
    partialCoverage,
    luminanceEntropy,
  });
  const warnings: RasterWarning[] = [];
  if (header.width < 64 || header.height < 64) {
    warnings.push({ code: "RASTER_LOW_RESOLUTION", severity: "review", message: "At least one source dimension is below 64 pixels; inferred curves may need manual correction." });
  }
  if (partialCoverage >= 0.01) {
    warnings.push({ code: "RASTER_PARTIAL_ALPHA", severity: "warning", message: "Partial-alpha pixels may represent intentional antialiasing or a raster halo; inspect traced edges before approval." });
  }
  if (colourHistogram.size >= 512 || classification.profile === "photo") {
    warnings.push({ code: "RASTER_HIGH_COLOUR_COMPLEXITY", severity: "review", message: "The source has photo-like colour complexity; output may be large and should not be treated as hand-reconstructed artwork without review." });
  }
  if (edgeDensity >= 0.4 && colourHistogram.size >= 128) {
    warnings.push({ code: "RASTER_DENSE_DETAIL", severity: "review", message: "Dense local detail may create excessive path and anchor counts." });
  }
  if (percentile95 - percentile05 < 16) {
    warnings.push({ code: "RASTER_LOW_CONTRAST", severity: "warning", message: "The source has a narrow tonal range, which can make region boundaries ambiguous." });
  }
  if (header.pixelCount >= 16_000_000) {
    warnings.push({ code: "RASTER_LARGE_CANVAS", severity: "warning", message: "The source is within limits but large enough to require careful runtime and output-size review." });
  }

  return Object.freeze({
    source: Object.freeze({ ...header, sha256: createHash("sha256").update(encodedSource).digest("hex") }),
    sampling: Object.freeze({ stride, sampleCount }),
    alpha: Object.freeze({
      transparentCoverage: round(transparentCoverage),
      partialCoverage: round(partialCoverage),
      opaqueCoverage: round(opaqueCoverage),
    }),
    tone: Object.freeze({
      meanLuminance: round(luminanceTotal / sampleCount, 2),
      percentile05,
      percentile95,
      contrastRange: percentile95 - percentile05,
      luminanceEntropy: round(luminanceEntropy),
    }),
    colour: Object.freeze({
      estimatedColours: colourHistogram.size,
      meanSaturation: round(meanSaturation),
      dominantColours: Object.freeze(dominantColours),
    }),
    detail: Object.freeze({ edgeDensity: round(edgeDensity) }),
    suggestedProfile: classification.profile,
    profileSignals: classification.signals,
    warnings: Object.freeze(warnings),
  });
}
