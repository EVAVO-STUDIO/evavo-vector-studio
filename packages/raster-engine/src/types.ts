import type { SvgInspection } from "@evavo/vector-core";

export const DEFAULT_MAX_INPUT_BYTES = 25 * 1024 * 1024;
export const DEFAULT_MAX_PIXELS = 40_000_000;
export const DEFAULT_ANALYSIS_DIMENSION = 384;

export type RasterFormat = "png" | "jpeg" | "webp" | "gif" | "bmp" | "tiff";
export type RasterTraceProfile = "logo" | "icon" | "line-art" | "illustration" | "photo";
export type RasterTraceProfileSelection = RasterTraceProfile | "auto";
export type RasterWarningSeverity = "warning" | "review";

export type RasterWarning = Readonly<{
  code: string;
  severity: RasterWarningSeverity;
  message: string;
}>;

export type RasterHeaderInspection = Readonly<{
  format: RasterFormat;
  mimeType: string;
  width: number;
  height: number;
  pixelCount: number;
  inputBytes: number;
}>;

export type DominantColour = Readonly<{
  hex: string;
  share: number;
}>;

export type RasterAnalysis = Readonly<{
  source: RasterHeaderInspection & Readonly<{ sha256: string }>;
  sampling: Readonly<{
    stride: number;
    sampleCount: number;
  }>;
  alpha: Readonly<{
    transparentCoverage: number;
    partialCoverage: number;
    opaqueCoverage: number;
  }>;
  tone: Readonly<{
    meanLuminance: number;
    percentile05: number;
    percentile95: number;
    contrastRange: number;
    luminanceEntropy: number;
  }>;
  colour: Readonly<{
    estimatedColours: number;
    meanSaturation: number;
    dominantColours: readonly DominantColour[];
  }>;
  detail: Readonly<{
    edgeDensity: number;
  }>;
  suggestedProfile: RasterTraceProfile;
  profileSignals: readonly string[];
  warnings: readonly RasterWarning[];
}>;

export type RasterInspectionOptions = Readonly<{
  maxInputBytes?: number;
  maxPixels?: number;
  analysisDimension?: number;
  signal?: AbortSignal;
}>;

export type RasterTraceOptions = RasterInspectionOptions & Readonly<{
  sourceName?: string;
  profile?: RasterTraceProfileSelection;
  preservePalette?: boolean;
  maxColours?: number;
  optimise?: boolean;
  title?: string;
}>;

export type TraceConfigurationEvidence = Readonly<{
  requestedProfile: RasterTraceProfileSelection;
  resolvedProfile: RasterTraceProfile;
  preservePalette: boolean;
  maxColoursTarget: number;
  hardPaletteLimitApplied: false;
  colourMode: "color" | "binary";
  hierarchy: "stacked" | "cutout";
  pathMode: "spline";
  filterSpeckle: number;
  colourPrecision: number;
  layerDifference: number;
  cornerThreshold: number;
  lengthThreshold: number;
  maxIterations: number;
  spliceThreshold: number;
  pathPrecision: number;
}>;

export type RasterTraceEvidence = Readonly<{
  contractVersion: "1.0";
  engine: Readonly<{
    name: "@neplex/vectorizer";
    adapterVersion: "0.1.0";
  }>;
  analysis: RasterAnalysis;
  trace: TraceConfigurationEvidence;
  output: Readonly<{
    mimeType: "image/svg+xml";
    bytes: number;
    pathCount: number;
    groupCount: number;
    gradientCount: number;
    viewBox: readonly [number, number, number, number] | null;
  }>;
  qualityGates: Readonly<{
    svgSafety: "passed";
    structuralValidation: "passed";
    renderComparison: "not-run";
    productionApproval: "withheld-pending-render-comparison";
    byteStableOutputGuaranteed: false;
  }>;
  timingsMs: Readonly<{
    decodeAndAnalyse: number;
    trace: number;
    optimise: number;
    total: number;
  }>;
  warnings: readonly RasterWarning[];
}>;

export type RasterTraceResult = Readonly<{
  svg: string;
  inspection: SvgInspection;
  evidence: RasterTraceEvidence;
}>;

export type DecodedRaster = Readonly<{
  width: number;
  height: number;
  pixels: Uint8Array;
}>;
