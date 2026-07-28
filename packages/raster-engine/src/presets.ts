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
  TraceCandidateRole,
  TraceConfigurationEvidence,
} from "./types.js";

const DEFAULT_MAX_COLOURS: Readonly<Record<RasterTraceProfile, number>> = Object.freeze({
  logo: 12,
  icon: 24,
  "line-art": 2,
  illustration: 64,
  photo: 128,
});

export type TraceCandidateDefinition = Readonly<{
  id: string;
  role: TraceCandidateRole;
  config: Config;
  evidence: TraceConfigurationEvidence;
}>;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function rounded(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function colourPrecision(maxColours: number, preservePalette: boolean): number {
  const base = maxColours <= 4 ? 2 : maxColours <= 16 ? 3 : maxColours <= 48 ? 4 : maxColours <= 96 ? 5 : maxColours <= 160 ? 6 : 7;
  return clamp(base + (preservePalette ? 1 : 0), 2, 8);
}

function resolveProfile(requested: RasterTraceProfileSelection, analysis: RasterAnalysis): RasterTraceProfile {
  return requested === "auto" ? analysis.suggestedProfile : requested;
}

function configurationEvidence(
  config: Config,
  requestedProfile: RasterTraceProfileSelection,
  resolvedProfile: RasterTraceProfile,
  preservePalette: boolean,
  maxColours: number,
): TraceConfigurationEvidence {
  return Object.freeze({
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
}

function candidate(
  id: string,
  role: TraceCandidateRole,
  config: Config,
  requestedProfile: RasterTraceProfileSelection,
  resolvedProfile: RasterTraceProfile,
  preservePalette: boolean,
  maxColours: number,
): TraceCandidateDefinition {
  const frozenConfig = Object.freeze(config);
  return Object.freeze({
    id,
    role,
    config: frozenConfig,
    evidence: configurationEvidence(frozenConfig, requestedProfile, resolvedProfile, preservePalette, maxColours),
  });
}

function baseConfig(
  resolvedProfile: RasterTraceProfile,
  preservePalette: boolean,
  maxColours: number,
): Config {
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
  return { ...profileConfig[resolvedProfile], colorPrecision: precision };
}

function fidelityConfig(base: Config): Config {
  return {
    ...base,
    filterSpeckle: clamp(base.filterSpeckle - 1, 0, 16),
    layerDifference: clamp(base.layerDifference - 2, 1, 20),
    cornerThreshold: clamp(base.cornerThreshold - 8, 20, 90),
    lengthThreshold: rounded(clamp(base.lengthThreshold * 0.72, 1, 12)),
    maxIterations: clamp(base.maxIterations + 1, 1, 6),
    spliceThreshold: clamp(base.spliceThreshold - 8, 12, 90),
    pathPrecision: clamp((base.pathPrecision ?? 4) + 1, 2, 6),
    colorPrecision: clamp(base.colorPrecision + 1, 2, 8),
    unusedColorIterations: clamp(base.unusedColorIterations + 8, 4, 48),
    keyingThreshold: rounded(clamp(base.keyingThreshold - 0.02, 0.03, 0.2)),
    smallCircle: clamp(base.smallCircle - 1, 1, 8),
  };
}

function economyConfig(base: Config, preservePalette: boolean): Config {
  return {
    ...base,
    filterSpeckle: clamp(base.filterSpeckle + 2, 0, 16),
    layerDifference: clamp(base.layerDifference + 3, 1, 20),
    cornerThreshold: clamp(base.cornerThreshold + 10, 20, 90),
    lengthThreshold: rounded(clamp(base.lengthThreshold * 1.35, 1, 12)),
    maxIterations: clamp(base.maxIterations - 1, 1, 6),
    spliceThreshold: clamp(base.spliceThreshold + 12, 12, 90),
    pathPrecision: clamp((base.pathPrecision ?? 4) - 1, 2, 6),
    colorPrecision: preservePalette ? base.colorPrecision : clamp(base.colorPrecision - 1, 2, 8),
    unusedColorIterations: clamp(base.unusedColorIterations - 8, 4, 48),
    keyingThreshold: rounded(clamp(base.keyingThreshold + 0.03, 0.03, 0.2)),
    smallCircle: clamp(base.smallCircle + 1, 1, 8),
  };
}

export function buildTraceCandidates(
  analysis: RasterAnalysis,
  options: RasterTraceOptions = {},
): readonly TraceCandidateDefinition[] {
  const requestedProfile = options.profile ?? "auto";
  const resolvedProfile = resolveProfile(requestedProfile, analysis);
  const preservePalette = options.preservePalette ?? true;
  const maxColours = options.maxColours ?? DEFAULT_MAX_COLOURS[resolvedProfile];
  if (!Number.isInteger(maxColours) || maxColours < 1 || maxColours > 256) {
    throw new RasterEngineError("RASTER_OPTIONS_INVALID", "maxColours must be an integer from 1 to 256.", 400, { maxColours });
  }

  const base = baseConfig(resolvedProfile, preservePalette, maxColours);
  const candidates: TraceCandidateDefinition[] = [
    candidate("base", "base", base, requestedProfile, resolvedProfile, preservePalette, maxColours),
  ];
  if (resolvedProfile !== "photo") {
    candidates.push(candidate("fidelity", "fidelity", fidelityConfig(base), requestedProfile, resolvedProfile, preservePalette, maxColours));
  }
  candidates.push(candidate("economy", "economy", economyConfig(base, preservePalette), requestedProfile, resolvedProfile, preservePalette, maxColours));
  return Object.freeze(candidates);
}

export function buildTraceConfiguration(
  analysis: RasterAnalysis,
  options: RasterTraceOptions = {},
): Readonly<{ config: Config; evidence: TraceConfigurationEvidence }> {
  const definition = buildTraceCandidates(analysis, options)[0];
  return Object.freeze({ config: definition.config, evidence: definition.evidence });
}
