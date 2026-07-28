import { renderAsync, type ResvgRenderOptions } from "@resvg/resvg-js";
import { RasterEngineError, rasterFailure, throwIfAborted } from "./errors.js";
import type {
  DecodedRaster,
  RasterComparisonMetrics,
  RasterComparisonQuality,
  RasterComparisonScale,
  RasterRenderComparison,
} from "./types.js";

const MISMATCH_PIXEL_ERROR = 0.1;
const EXCELLENT_THRESHOLDS = Object.freeze({
  visualMae: 0.02,
  mismatchFraction: 0.04,
  aspectRatioDelta: 0.001,
});
const GOOD_THRESHOLDS = Object.freeze({
  visualMae: 0.04,
  mismatchFraction: 0.12,
  aspectRatioDelta: 0.005,
});

const THRESHOLDS = Object.freeze({
  mismatchPixelError: MISMATCH_PIXEL_ERROR,
  excellent: EXCELLENT_THRESHOLDS,
  good: GOOD_THRESHOLDS,
});

type AxisSampling = Readonly<{
  lower: Int32Array;
  upper: Int32Array;
  weight: Float64Array;
}>;

function round(value: number, digits = 6): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function assertRgbaImage(image: DecodedRaster, label: string): void {
  if (!Number.isSafeInteger(image.width) || !Number.isSafeInteger(image.height) || image.width < 1 || image.height < 1) {
    throw new RasterEngineError("RASTER_RENDER_COMPARISON_FAILED", `${label} has invalid dimensions.`, 422, {
      width: image.width,
      height: image.height,
    });
  }
  const expectedBytes = image.width * image.height * 4;
  if (image.pixels.byteLength !== expectedBytes) {
    throw new RasterEngineError("RASTER_RENDER_COMPARISON_FAILED", `${label} is not a complete RGBA image.`, 422, {
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

export function compareRgbaImages(source: DecodedRaster, rendered: DecodedRaster): RasterComparisonMetrics {
  assertRgbaImage(source, "Source raster");
  assertRgbaImage(rendered, "Rendered SVG");
  const xSampling = buildAxisSampling(source.width, rendered.width);
  const ySampling = buildAxisSampling(source.height, rendered.height);
  const pixelCount = rendered.width * rendered.height;
  let premultipliedRgbTotal = 0;
  let alphaTotal = 0;
  let compositeBlackTotal = 0;
  let compositeWhiteTotal = 0;
  let visualTotal = 0;
  let visualSquaredTotal = 0;
  let mismatchCount = 0;

  for (let y = 0; y < rendered.height; y += 1) {
    for (let x = 0; x < rendered.width; x += 1) {
      const outputOffset = (y * rendered.width + x) * 4;
      const sourceAlpha = sampledChannel(source, xSampling, ySampling, x, y, 3) / 255;
      const outputAlpha = rendered.pixels[outputOffset + 3] / 255;
      const alphaError = Math.abs(sourceAlpha - outputAlpha);
      let blackError = 0;
      let whiteError = 0;

      for (let channel = 0; channel < 3; channel += 1) {
        const sourceChannel = sampledChannel(source, xSampling, ySampling, x, y, channel) / 255;
        const outputChannel = rendered.pixels[outputOffset + channel] / 255;
        const sourcePremultiplied = sourceChannel * sourceAlpha;
        const outputPremultiplied = outputChannel * outputAlpha;
        blackError += Math.abs(sourcePremultiplied - outputPremultiplied);
        whiteError += Math.abs(
          sourcePremultiplied + 1 - sourceAlpha - (outputPremultiplied + 1 - outputAlpha),
        );
      }

      blackError /= 3;
      whiteError /= 3;
      const visualError = Math.max(alphaError, blackError, whiteError);
      premultipliedRgbTotal += blackError;
      alphaTotal += alphaError;
      compositeBlackTotal += blackError;
      compositeWhiteTotal += whiteError;
      visualTotal += visualError;
      visualSquaredTotal += visualError * visualError;
      if (visualError >= MISMATCH_PIXEL_ERROR) mismatchCount += 1;
    }
  }

  const sourceAspect = source.width / source.height;
  const renderedAspect = rendered.width / rendered.height;
  return Object.freeze({
    visualMae: round(visualTotal / pixelCount),
    premultipliedRgbMae: round(premultipliedRgbTotal / pixelCount),
    alphaMae: round(alphaTotal / pixelCount),
    compositeBlackMae: round(compositeBlackTotal / pixelCount),
    compositeWhiteMae: round(compositeWhiteTotal / pixelCount),
    rmsVisualError: round(Math.sqrt(visualSquaredTotal / pixelCount)),
    mismatchFraction: round(mismatchCount / pixelCount),
    aspectRatioDelta: round(Math.abs(sourceAspect - renderedAspect) / sourceAspect),
  });
}

function comparisonDimensions(source: DecodedRaster): readonly number[] {
  const sourceMaximum = Math.max(source.width, source.height);
  return Object.freeze(
    [...new Set([64, 256, 1024].map((dimension) => Math.min(dimension, sourceMaximum)))]
      .filter((dimension) => dimension >= 1)
      .sort((left, right) => left - right),
  );
}

function classify(metrics: RasterComparisonMetrics): RasterComparisonQuality {
  if (
    metrics.visualMae <= EXCELLENT_THRESHOLDS.visualMae &&
    metrics.mismatchFraction <= EXCELLENT_THRESHOLDS.mismatchFraction &&
    metrics.aspectRatioDelta <= EXCELLENT_THRESHOLDS.aspectRatioDelta
  ) {
    return "excellent";
  }
  if (
    metrics.visualMae <= GOOD_THRESHOLDS.visualMae &&
    metrics.mismatchFraction <= GOOD_THRESHOLDS.mismatchFraction &&
    metrics.aspectRatioDelta <= GOOD_THRESHOLDS.aspectRatioDelta
  ) {
    return "good";
  }
  return "review";
}

function aggregate(scales: readonly RasterComparisonScale[]): RasterRenderComparison["aggregate"] {
  const comparedPixelCount = scales.reduce((total, scale) => total + scale.pixelCount, 0);
  const weighted = (field: keyof RasterComparisonMetrics): number =>
    scales.reduce((total, scale) => total + scale[field] * scale.pixelCount, 0) / comparedPixelCount;
  return Object.freeze({
    visualMae: round(weighted("visualMae")),
    premultipliedRgbMae: round(weighted("premultipliedRgbMae")),
    alphaMae: round(weighted("alphaMae")),
    compositeBlackMae: round(weighted("compositeBlackMae")),
    compositeWhiteMae: round(weighted("compositeWhiteMae")),
    rmsVisualError: round(weighted("rmsVisualError")),
    mismatchFraction: round(weighted("mismatchFraction")),
    aspectRatioDelta: round(Math.max(...scales.map((scale) => scale.aspectRatioDelta))),
    comparedPixelCount,
    largestComparedDimension: Math.max(...scales.map((scale) => Math.max(scale.width, scale.height))),
  });
}

export async function compareRasterToSvg(
  source: DecodedRaster,
  svg: string,
  signal?: AbortSignal,
): Promise<RasterRenderComparison> {
  assertRgbaImage(source, "Source raster");
  throwIfAborted(signal);
  const scales: RasterComparisonScale[] = [];
  const fitMode = source.width >= source.height ? "width" : "height";

  for (const requestedMaxDimension of comparisonDimensions(source)) {
    throwIfAborted(signal);
    const fitTo: ResvgRenderOptions["fitTo"] = { mode: fitMode, value: requestedMaxDimension };
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
        signal,
      );
      const renderedRaster: DecodedRaster = Object.freeze({
        width: rendered.width,
        height: rendered.height,
        pixels: rendered.pixels,
      });
      const metrics = compareRgbaImages(source, renderedRaster);
      scales.push(Object.freeze({
        requestedMaxDimension,
        width: rendered.width,
        height: rendered.height,
        pixelCount: rendered.width * rendered.height,
        ...metrics,
      }));
    } catch (error) {
      if (signal?.aborted) throw new RasterEngineError("RASTER_ABORTED", "SVG render comparison was aborted.", 499);
      throw rasterFailure(
        "RASTER_RENDER_COMPARISON_FAILED",
        "The generated SVG could not be rasterised for visual comparison.",
        error,
        422,
      );
    }
  }

  if (scales.length === 0) {
    throw new RasterEngineError("RASTER_RENDER_COMPARISON_FAILED", "No render-comparison scale was produced.", 422);
  }
  const aggregateMetrics = aggregate(scales);
  return Object.freeze({
    renderer: Object.freeze({
      name: "@resvg/resvg-js",
      version: "2.6.2",
      systemFontsLoaded: false,
      shapeRendering: "geometricPrecision",
    }),
    scales: Object.freeze(scales),
    aggregate: aggregateMetrics,
    quality: classify(aggregateMetrics),
    thresholds: THRESHOLDS,
  });
}
