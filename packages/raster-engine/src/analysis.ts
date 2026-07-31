import { createHash } from "node:crypto";
import { RasterEngineError, throwIfAborted } from "./errors.js";
import {
  DEFAULT_ANALYSIS_DIMENSION,
  type DecodedRaster,
  type DominantColour,
  type RasterAnalysis,
  type RasterContentBounds,
  type RasterHeaderInspection,
  type RasterInspectionOptions,
  type RasterTraceProfile,
  type RasterWarning,
} from "./types.js";

const TRANSPARENT_ALPHA_MAXIMUM = 7;
const OPAQUE_ALPHA_MINIMUM = 248;
const STRONG_EDGE_THRESHOLD = 28;

function round(value: number, digits = 4): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function luminance(red: number, green: number, blue: number): number {
  return Math.max(0, Math.min(255, Math.round(red * 0.2126 + green * 0.7152 + blue * 0.0722)));
}

function percentile(histogram: readonly number[], totalWeight: number, percentileValue: number): number {
  const target = totalWeight * percentileValue;
  let cumulative = 0;
  for (let index = 0; index < histogram.length; index += 1) {
    cumulative += histogram[index] ?? 0;
    if (cumulative >= target) return index;
  }
  return histogram.length - 1;
}

function entropy(histogram: readonly number[], totalWeight: number): number {
  if (totalWeight <= 0) return 0;
  let result = 0;
  for (const weight of histogram) {
    if (weight <= 0) continue;
    const probability = weight / totalWeight;
    result -= probability * Math.log2(probability);
  }
  return result;
}

function hex(red: number, green: number, blue: number): string {
  return `#${[red, green, blue].map((value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0")).join("")}`;
}

type QuantisedColour = {
  weight: number;
  red: number;
  green: number;
  blue: number;
};

type AlphaScan = Readonly<{
  transparent: number;
  partial: number;
  opaque: number;
  visiblePixelCount: number;
  bounds: RasterContentBounds;
}>;

function scanAlphaBounds(decoded: DecodedRaster, signal?: AbortSignal): AlphaScan {
  let transparent = 0;
  let partial = 0;
  let opaque = 0;
  let visiblePixelCount = 0;
  let minimumX = decoded.width;
  let minimumY = decoded.height;
  let maximumX = -1;
  let maximumY = -1;

  for (let y = 0; y < decoded.height; y += 1) {
    throwIfAborted(signal);
    for (let x = 0; x < decoded.width; x += 1) {
      const alpha = decoded.pixels[(y * decoded.width + x) * 4 + 3];
      if (alpha <= TRANSPARENT_ALPHA_MAXIMUM) {
        transparent += 1;
        continue;
      }
      visiblePixelCount += 1;
      if (alpha < OPAQUE_ALPHA_MINIMUM) partial += 1;
      else opaque += 1;
      minimumX = Math.min(minimumX, x);
      minimumY = Math.min(minimumY, y);
      maximumX = Math.max(maximumX, x);
      maximumY = Math.max(maximumY, y);
    }
  }

  if (visiblePixelCount === 0) {
    throw new RasterEngineError(
      "RASTER_NO_VISIBLE_CONTENT",
      "The raster contains no visible pixels after the guarded alpha threshold is applied.",
      422,
      { alphaThreshold: TRANSPARENT_ALPHA_MAXIMUM },
    );
  }

  return Object.freeze({
    transparent,
    partial,
    opaque,
    visiblePixelCount,
    bounds: Object.freeze({
      x: minimumX,
      y: minimumY,
      width: maximumX - minimumX + 1,
      height: maximumY - minimumY + 1,
    }),
  });
}

function visualLuminance(decoded: DecodedRaster, x: number, y: number): readonly [number, number] {
  const offset = (y * decoded.width + x) * 4;
  const alpha = decoded.pixels[offset + 3] / 255;
  const source = luminance(decoded.pixels[offset], decoded.pixels[offset + 1], decoded.pixels[offset + 2]);
  const compositeBlack = source * alpha;
  const compositeWhite = compositeBlack + 255 * (1 - alpha);
  return [compositeBlack, compositeWhite];
}

function visualDifference(
  left: readonly [number, number],
  right: readonly [number, number],
): number {
  return Math.max(Math.abs(left[0] - right[0]), Math.abs(left[1] - right[1]));
}

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
  const compactContent = input.width <= 768 && input.height <= 768;
  const hasTransparency = input.transparentCoverage + input.partialCoverage >= 0.025;
  const mostlyMonochrome = input.meanSaturation < 0.13;

  if (mostlyMonochrome && input.estimatedColours <= 24 && input.edgeDensity >= 0.08) {
    signals.push("low visible-pixel saturation", "limited visible colour structure", "strong composited contour density");
    return Object.freeze({ profile: "line-art", signals: Object.freeze(signals) });
  }
  if (input.estimatedColours <= 16 && input.edgeDensity >= 0.035) {
    signals.push("small visible quantised palette", "clear composited silhouette boundaries");
    if (hasTransparency) signals.push("meaningful transparent background");
    return Object.freeze({ profile: "logo", signals: Object.freeze(signals) });
  }
  if (compactContent && hasTransparency && input.estimatedColours <= 96) {
    signals.push("compact visible-content dimensions", "transparent canvas", "bounded visible palette complexity");
    return Object.freeze({ profile: "icon", signals: Object.freeze(signals) });
  }
  if (input.estimatedColours >= 384 || (input.luminanceEntropy >= 6.8 && input.edgeDensity >= 0.16)) {
    signals.push("high visible colour variation", "broad visible tonal distribution", "dense composited local detail");
    return Object.freeze({ profile: "photo", signals: Object.freeze(signals) });
  }
  signals.push("moderate visible palette complexity", "mixed curves and filled regions");
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

  const alphaScan = scanAlphaBounds(decoded, options.signal);
  const maximumSamples = analysisDimension * analysisDimension;
  const stride = Math.max(1, Math.ceil(alphaScan.visiblePixelCount / maximumSamples));
  const luminanceHistogram = Array.from({ length: 256 }, () => 0);
  const colourHistogram = new Map<number, QuantisedColour>();
  let visibleIndex = 0;
  let sampleCount = 0;
  let alphaWeight = 0;
  let luminanceTotal = 0;
  let saturationTotal = 0;
  let edgeComparisons = 0;
  let strongEdges = 0;

  for (let y = alphaScan.bounds.y; y < alphaScan.bounds.y + alphaScan.bounds.height; y += 1) {
    throwIfAborted(options.signal);
    for (let x = alphaScan.bounds.x; x < alphaScan.bounds.x + alphaScan.bounds.width; x += 1) {
      const offset = (y * decoded.width + x) * 4;
      const alphaByte = decoded.pixels[offset + 3];
      if (alphaByte <= TRANSPARENT_ALPHA_MAXIMUM) continue;
      const shouldSample = visibleIndex % stride === 0;
      visibleIndex += 1;
      if (!shouldSample) continue;

      const red = decoded.pixels[offset];
      const green = decoded.pixels[offset + 1];
      const blue = decoded.pixels[offset + 2];
      const weight = alphaByte / 255;
      const lightness = luminance(red, green, blue);
      sampleCount += 1;
      alphaWeight += weight;
      luminanceTotal += lightness * weight;
      luminanceHistogram[lightness] = (luminanceHistogram[lightness] ?? 0) + weight;

      const maximum = Math.max(red, green, blue);
      const minimum = Math.min(red, green, blue);
      saturationTotal += (maximum === 0 ? 0 : (maximum - minimum) / maximum) * weight;

      const colourKey = ((red >> 3) << 10) | ((green >> 3) << 5) | (blue >> 3);
      const colour = colourHistogram.get(colourKey);
      if (colour) {
        colour.weight += weight;
        colour.red += red * weight;
        colour.green += green * weight;
        colour.blue += blue * weight;
      } else {
        colourHistogram.set(colourKey, {
          weight,
          red: red * weight,
          green: green * weight,
          blue: blue * weight,
        });
      }

      const currentVisual = visualLuminance(decoded, x, y);
      if (x + 1 < decoded.width) {
        edgeComparisons += 1;
        if (visualDifference(currentVisual, visualLuminance(decoded, x + 1, y)) >= STRONG_EDGE_THRESHOLD) strongEdges += 1;
      }
      if (y + 1 < decoded.height) {
        edgeComparisons += 1;
        if (visualDifference(currentVisual, visualLuminance(decoded, x, y + 1)) >= STRONG_EDGE_THRESHOLD) strongEdges += 1;
      }
    }
  }

  if (sampleCount === 0 || alphaWeight <= 0) {
    throw new RasterEngineError("RASTER_NO_VISIBLE_CONTENT", "The visible raster content could not be sampled safely.", 422);
  }

  const dominantColours: DominantColour[] = [...colourHistogram.values()]
    .sort((left, right) => right.weight - left.weight)
    .slice(0, 8)
    .map((colour) =>
      Object.freeze({
        hex: hex(colour.red / colour.weight, colour.green / colour.weight, colour.blue / colour.weight),
        share: round(colour.weight / alphaWeight),
      }),
    );

  const canvasPixelCount = header.pixelCount;
  const transparentCoverage = alphaScan.transparent / canvasPixelCount;
  const partialCoverage = alphaScan.partial / canvasPixelCount;
  const opaqueCoverage = alphaScan.opaque / canvasPixelCount;
  const visibleCoverage = alphaScan.visiblePixelCount / canvasPixelCount;
  const boundingBoxPixelCount = alphaScan.bounds.width * alphaScan.bounds.height;
  const boundingBoxCoverage = boundingBoxPixelCount / canvasPixelCount;
  const contentAspectRatio = alphaScan.bounds.width / alphaScan.bounds.height;
  const meanSaturation = saturationTotal / alphaWeight;
  const edgeDensity = edgeComparisons === 0 ? 0 : strongEdges / edgeComparisons;
  const percentile05 = percentile(luminanceHistogram, alphaWeight, 0.05);
  const percentile95 = percentile(luminanceHistogram, alphaWeight, 0.95);
  const luminanceEntropy = entropy(luminanceHistogram, alphaWeight);
  const classification = classify({
    width: alphaScan.bounds.width,
    height: alphaScan.bounds.height,
    estimatedColours: colourHistogram.size,
    meanSaturation,
    edgeDensity,
    transparentCoverage,
    partialCoverage,
    luminanceEntropy,
  });
  const warnings: RasterWarning[] = [];
  if (alphaScan.bounds.width < 64 || alphaScan.bounds.height < 64) {
    warnings.push({ code: "RASTER_LOW_RESOLUTION", severity: "review", message: "At least one visible-content dimension is below 64 pixels; inferred curves may need manual correction." });
  }
  if (partialCoverage >= 0.01) {
    warnings.push({ code: "RASTER_PARTIAL_ALPHA", severity: "warning", message: "Partial-alpha pixels may represent intentional antialiasing or a raster halo; inspect traced edges before approval." });
  }
  if (boundingBoxCoverage <= 0.25 && transparentCoverage >= 0.25) {
    warnings.push({ code: "RASTER_TRANSPARENT_PADDING", severity: "warning", message: `Visible content occupies ${(boundingBoxCoverage * 100).toFixed(1)}% of the canvas bounds; excessive transparent padding can reduce effective reconstruction resolution.` });
  }
  if (visibleCoverage <= 0.005) {
    warnings.push({ code: "RASTER_SPARSE_VISIBLE_CONTENT", severity: "review", message: `Only ${(visibleCoverage * 100).toFixed(2)}% of source pixels are visibly occupied; verify that the intended artwork was supplied and not reduced to a tiny or sparse fragment.` });
  }
  if (contentAspectRatio >= 32 || contentAspectRatio <= 1 / 32) {
    warnings.push({ code: "RASTER_EXTREME_CONTENT_ASPECT_RATIO", severity: "warning", message: `Visible content has an extreme ${round(contentAspectRatio, 3)}:1 aspect ratio; inspect framing, strokes and end caps before approval.` });
  }
  if (colourHistogram.size >= 512 || classification.profile === "photo") {
    warnings.push({ code: "RASTER_HIGH_COLOUR_COMPLEXITY", severity: "review", message: "The visible source content has photo-like colour complexity; output may be large and should not be treated as hand-reconstructed artwork without review." });
  }
  if (edgeDensity >= 0.4 && colourHistogram.size >= 128) {
    warnings.push({ code: "RASTER_DENSE_DETAIL", severity: "review", message: "Dense composited detail may create excessive path and anchor counts." });
  }
  if (percentile95 - percentile05 < 16) {
    warnings.push({ code: "RASTER_LOW_CONTRAST", severity: "warning", message: "The visible source content has a narrow tonal range, which can make region boundaries ambiguous." });
  }
  if (header.pixelCount >= 16_000_000) {
    warnings.push({ code: "RASTER_LARGE_CANVAS", severity: "warning", message: "The source is within limits but large enough to require careful runtime and output-size review." });
  }

  return Object.freeze({
    source: Object.freeze({ ...header, sha256: createHash("sha256").update(encodedSource).digest("hex") }),
    sampling: Object.freeze({
      strategy: "alpha-aware-visible-pixel-stride",
      stride,
      sampleCount,
      alphaWeight: round(alphaWeight),
    }),
    content: Object.freeze({
      bounds: alphaScan.bounds,
      visiblePixelCount: alphaScan.visiblePixelCount,
      visibleCoverage: round(visibleCoverage),
      boundingBoxCoverage: round(boundingBoxCoverage),
      aspectRatio: round(contentAspectRatio),
    }),
    alpha: Object.freeze({
      transparentCoverage: round(transparentCoverage),
      partialCoverage: round(partialCoverage),
      opaqueCoverage: round(opaqueCoverage),
    }),
    tone: Object.freeze({
      meanLuminance: round(luminanceTotal / alphaWeight, 2),
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
