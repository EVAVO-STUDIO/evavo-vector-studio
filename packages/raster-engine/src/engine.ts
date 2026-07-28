import { performance } from "node:perf_hooks";
import {
  OptimizePreset,
  optimize,
  readImage,
  vectorizeRaw,
  type ImageData,
} from "@neplex/vectorizer";
import { inspectSvg, optimiseSvg } from "@evavo/vector-core";
import { analyseDecodedRaster } from "./analysis.js";
import { compareRasterToSvg } from "./comparison.js";
import { RasterEngineError, rasterFailure, throwIfAborted } from "./errors.js";
import { inspectRasterHeader } from "./preflight.js";
import { buildTraceConfiguration } from "./presets.js";
import type {
  DecodedRaster,
  RasterAnalysis,
  RasterInspectionOptions,
  RasterTraceEvidence,
  RasterTraceOptions,
  RasterTraceResult,
  RasterWarning,
} from "./types.js";

function encodedBuffer(source: Uint8Array): Buffer {
  return Buffer.from(source.buffer, source.byteOffset, source.byteLength);
}

function rawPixelBuffer(source: Uint8Array): Buffer {
  return Buffer.from(source.buffer, source.byteOffset, source.byteLength);
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function applyTitle(svg: string, title?: string): string {
  const cleanTitle = title?.trim().slice(0, 200);
  if (!cleanTitle) return svg;
  const element = `<title>${escapeXml(cleanTitle)}</title>`;
  if (/<title\b[^>]*>[\s\S]*?<\/title>/i.test(svg)) {
    return svg.replace(/<title\b[^>]*>[\s\S]*?<\/title>/i, element);
  }
  return svg.replace(/<svg\b[^>]*>/i, (root) => `${root}${element}`);
}

function roundedDuration(start: number, end: number): number {
  return Math.round((end - start) * 100) / 100;
}

async function decodeAndAnalyse(
  source: Uint8Array,
  options: RasterInspectionOptions,
): Promise<Readonly<{ analysis: RasterAnalysis; decoded: DecodedRaster }>> {
  const header = inspectRasterHeader(source, options);
  throwIfAborted(options.signal);
  let image: ImageData;
  try {
    image = await readImage(encodedBuffer(source), undefined, options.signal);
  } catch (error) {
    if (options.signal?.aborted) throw new RasterEngineError("RASTER_ABORTED", "Raster decoding was aborted.", 499);
    throw rasterFailure("RASTER_DECODE_FAILED", "The guarded raster could not be decoded by the vector engine.", error, 422);
  }
  const decoded: DecodedRaster = Object.freeze({ width: image.width, height: image.height, pixels: image.pixels });
  const analysis = analyseDecodedRaster(source, header, decoded, options);
  return Object.freeze({ analysis, decoded });
}

export async function inspectRaster(
  source: Uint8Array,
  options: RasterInspectionOptions = {},
): Promise<RasterAnalysis> {
  return (await decodeAndAnalyse(source, options)).analysis;
}

export async function traceRaster(
  source: Uint8Array,
  options: RasterTraceOptions = {},
): Promise<RasterTraceResult> {
  const totalStarted = performance.now();
  const decodeStarted = totalStarted;
  const prepared = await decodeAndAnalyse(source, options);
  const decodeFinished = performance.now();
  const traceConfiguration = buildTraceConfiguration(prepared.analysis, options);
  throwIfAborted(options.signal);

  const traceStarted = performance.now();
  let svg: string;
  try {
    svg = await vectorizeRaw(
      rawPixelBuffer(prepared.decoded.pixels),
      { width: prepared.decoded.width, height: prepared.decoded.height },
      traceConfiguration.config,
      options.signal,
    );
  } catch (error) {
    if (options.signal?.aborted) throw new RasterEngineError("RASTER_ABORTED", "Raster tracing was aborted.", 499);
    throw rasterFailure("RASTER_TRACE_FAILED", "The raster vectorization engine failed to reconstruct SVG geometry.", error, 422);
  }
  const traceFinished = performance.now();

  const optimiseStarted = traceFinished;
  if (options.optimise ?? true) {
    try {
      svg = await optimize(
        svg,
        { preset: OptimizePreset.Safe, multipass: true, multipassIterations: 4 },
        options.signal,
      );
    } catch (error) {
      if (options.signal?.aborted) throw new RasterEngineError("RASTER_ABORTED", "SVG optimisation was aborted.", 499);
      throw rasterFailure("RASTER_TRACE_FAILED", "The traced SVG could not be safely optimised.", error, 422);
    }
  }
  svg = applyTitle(optimiseSvg(svg).svg, options.title);
  const optimiseFinished = performance.now();
  const inspection = inspectSvg(svg);
  if (!inspection.valid) {
    throw new RasterEngineError("RASTER_OUTPUT_INVALID", "The tracing engine emitted SVG that failed the governed safety inspection.", 422, {
      findings: inspection.findings,
    });
  }

  const comparisonStarted = performance.now();
  const comparison = await compareRasterToSvg(prepared.decoded, svg, options.signal);
  const comparisonFinished = performance.now();
  const warnings: RasterWarning[] = [...prepared.analysis.warnings];
  if (comparison.quality === "review") {
    warnings.push({
      code: "TRACE_RENDER_MISMATCH_REVIEW",
      severity: "review",
      message: `The multi-scale render comparison requires review (visual MAE ${comparison.aggregate.visualMae}, mismatch fraction ${comparison.aggregate.mismatchFraction}).`,
    });
  } else {
    warnings.push({
      code: "TRACE_HUMAN_REVIEW_REQUIRED",
      severity: "review",
      message: `The measured render match is ${comparison.quality}, but a person must still inspect curves, negative space, layer logic and brand fidelity before production approval.`,
    });
  }
  if (comparison.aggregate.aspectRatioDelta > comparison.thresholds.good.aspectRatioDelta) {
    warnings.push({
      code: "TRACE_ASPECT_RATIO_MISMATCH",
      severity: "review",
      message: `The rendered SVG aspect ratio differs from the source by ${comparison.aggregate.aspectRatioDelta}.`,
    });
  }
  if (inspection.pathCount > 5_000) {
    warnings.push({
      code: "TRACE_HIGH_PATH_COUNT",
      severity: "review",
      message: "The trace contains more than 5,000 paths and should be simplified or manually reviewed before production use.",
    });
  }
  const outputBytes = Buffer.byteLength(svg, "utf8");
  if (outputBytes > 2 * 1024 * 1024) {
    warnings.push({
      code: "TRACE_LARGE_OUTPUT",
      severity: "review",
      message: "The SVG exceeds 2 MiB and may be unsuitable for direct web delivery without further reconstruction or simplification.",
    });
  }

  const totalFinished = performance.now();
  const evidence: RasterTraceEvidence = Object.freeze({
    contractVersion: "1.1",
    engine: Object.freeze({ name: "@neplex/vectorizer", adapterVersion: "0.2.0" }),
    analysis: prepared.analysis,
    trace: traceConfiguration.evidence,
    output: Object.freeze({
      mimeType: "image/svg+xml",
      bytes: outputBytes,
      pathCount: inspection.pathCount,
      groupCount: inspection.groupCount,
      gradientCount: inspection.gradientCount,
      viewBox: inspection.viewBox,
    }),
    comparison,
    qualityGates: Object.freeze({
      svgSafety: "passed",
      structuralValidation: "passed",
      renderComparison: comparison.quality === "review" ? "review-required" : "passed",
      visualEvidenceAvailable: true,
      productionApproval: "review-required",
      byteStableOutputGuaranteed: false,
    }),
    timingsMs: Object.freeze({
      decodeAndAnalyse: roundedDuration(decodeStarted, decodeFinished),
      trace: roundedDuration(traceStarted, traceFinished),
      optimise: roundedDuration(optimiseStarted, optimiseFinished),
      compare: roundedDuration(comparisonStarted, comparisonFinished),
      total: roundedDuration(totalStarted, totalFinished),
    }),
    warnings: Object.freeze(warnings),
  });
  return Object.freeze({ svg, inspection, evidence });
}
