import {
  ColorMode,
  Hierarchical,
  PathSimplifyMode,
  type Config,
} from "@neplex/vectorizer";
import { RasterEngineError } from "./errors.js";
import type {
  RasterAnalysis,
  RasterTraceOptions,
  RasterTraceProfile,
  RasterTraceProfileSelection,
  TraceConfigurationEvidence,
} from "./types.js";

const DEFAULT_MAX_COLOURS: Readonly<Record<RasterTraceProfile, number>> = Object.freeze({
  logo: 12,
  icon: 24,
  "line-art": 2,
  illustration: 64,
  photo: 128,
});

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function colourPrecision(maxColours: number, preservePalette: boolean): number {
  const base = maxColours <= 4 ? 2 : maxColours <= 16 ? 3 : maxColours <= 48 ? 4 : maxColours <= 96 ? 5 : maxColours <= 160 ? 6 : 7;
  return clamp(base + (preservePalette ? 1 : 0), 2, 8);
}

function resolveProfile(requested: RasterTraceProfileSelection, analysis: RasterAnalysis): RasterTraceProfile {
  return requested === "auto" ? analysis.suggestedProfile : requested;
}

export function buildTraceConfiguration(
  analysis: RasterAnalysis,
  options: RasterTraceOptions = {},
): Readonly<{ config: Config; evidence: TraceConfigurationEvidence }> {
  const requestedProfile = options.profile ?? "auto";
  const resolvedProfile = resolveProfile(requestedProfile, analysis);
  const preservePalette = options.preservePalette ?? true;
  const maxColours = options.maxColours ?? DEFAULT_MAX_COLOURS[resolvedProfile];
  if (!Number.isInteger(maxColours) || maxColours < 1 || maxColours > 256) {
    throw new RasterEngineError("RASTER_OPTIONS_INVALID", "maxColours must be an integer from 1 to 256.", 400, { maxColours });
  }

  const precision = resolvedProfile === "line-art" ? 2 : colourPrecision(maxColours, preservePalette);
  const profileConfig: Readonly<Record<RasterTraceProfile, Omit<Config, "colorPrecision">>> = {
    logo: {
      colorMode: maxColours <= 2 ? ColorMode.Binary : ColorMode.Color,
      hierarchical: Hierarchical.Cutout,
      filterSpeckle: 2,
      layerDifference: preservePalette ? 3 : 5,
      mode: PathSimplifyMode.Spline,
      cornerThreshold: 50,
      lengthThreshold: 3,
      maxIterations: 4,
      spliceThreshold: 32,
      pathPrecision: 4,
      unusedColorIterations: 16,
      keyingThreshold: 0.08,
      smallCircle: 3,
    },
    icon: {
      colorMode: ColorMode.Color,
      hierarchical: Hierarchical.Cutout,
      filterSpeckle: 2,
      layerDifference: preservePalette ? 4 : 6,
      mode: PathSimplifyMode.Spline,
      cornerThreshold: 55,
      lengthThreshold: 3.5,
      maxIterations: 3,
      spliceThreshold: 38,
      pathPrecision: 4,
      unusedColorIterations: 16,
      keyingThreshold: 0.08,
      smallCircle: 3,
    },
    "line-art": {
      colorMode: ColorMode.Binary,
      hierarchical: Hierarchical.Cutout,
      filterSpeckle: 2,
      layerDifference: 2,
      mode: PathSimplifyMode.Spline,
      cornerThreshold: 45,
      lengthThreshold: 3,
      maxIterations: 4,
      spliceThreshold: 28,
      pathPrecision: 4,
      unusedColorIterations: 8,
      keyingThreshold: 0.06,
      smallCircle: 2,
    },
    illustration: {
      colorMode: ColorMode.Color,
      hierarchical: Hierarchical.Stacked,
      filterSpeckle: 4,
      layerDifference: preservePalette ? 5 : 7,
      mode: PathSimplifyMode.Spline,
      cornerThreshold: 60,
      lengthThreshold: 5,
      maxIterations: 3,
      spliceThreshold: 45,
      pathPrecision: 4,
      unusedColorIterations: 24,
      keyingThreshold: 0.1,
      smallCircle: 3,
    },
    photo: {
      colorMode: ColorMode.Color,
      hierarchical: Hierarchical.Stacked,
      filterSpeckle: 8,
      layerDifference: preservePalette ? 7 : 10,
      mode: PathSimplifyMode.Spline,
      cornerThreshold: 70,
      lengthThreshold: 6,
      maxIterations: 2,
      spliceThreshold: 60,
      pathPrecision: 3,
      unusedColorIterations: 32,
      keyingThreshold: 0.12,
      smallCircle: 4,
    },
  };
  const config: Config = Object.freeze({ ...profileConfig[resolvedProfile], colorPrecision: precision });
  const evidence: TraceConfigurationEvidence = Object.freeze({
    requestedProfile,
    resolvedProfile,
    preservePalette,
    maxColoursTarget: maxColours,
    hardPaletteLimitApplied: false,
    colourMode: config.colorMode === ColorMode.Binary ? "binary" : "color",
    hierarchy: config.hierarchical === Hierarchical.Cutout ? "cutout" : "stacked",
    pathMode: "spline",
    filterSpeckle: config.filterSpeckle,
    colourPrecision: config.colorPrecision,
    layerDifference: config.layerDifference,
    cornerThreshold: config.cornerThreshold,
    lengthThreshold: config.lengthThreshold,
    maxIterations: config.maxIterations,
    spliceThreshold: config.spliceThreshold,
    pathPrecision: config.pathPrecision ?? 4,
  });
  return Object.freeze({ config, evidence });
}
