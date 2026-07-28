import type { SvgInspection } from "@evavo/vector-core";

export const DEFAULT_MAX_INPUT_BYTES = 25 * 1024 * 1024;
export const DEFAULT_MAX_PIXELS = 40_000_000;
export const DEFAULT_ANALYSIS_DIMENSION = 384;

export type RasterFormat = "png" | "jpeg" | "webp" | "gif" | "bmp" | "tiff";
export type RasterTraceProfile = "logo" | "icon" | "line-art" | "illustration" | "photo";
export type RasterTraceProfileSelection = RasterTraceProfile | "auto";
export type RasterCandidateMode = "single" | "adaptive";
export type TraceCandidateRole = "base" | "fidelity" | "economy";
export type RasterWarningSeverity = "warning" | "review";
export type RasterComparisonQuality = "excellent" | "good" | "review";

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
  candidateMode?: RasterCandidateMode;
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

export type RasterComparisonMetrics = Readonly<{
  visualMae: number;
  premultipliedRgbMae: number;
  alphaMae: number;
  compositeBlackMae: number;
  compositeWhiteMae: number;
  rmsVisualError: number;
  mismatchFraction: number;
  aspectRatioDelta: number;
}>;

export type RasterComparisonScale = RasterComparisonMetrics & Readonly<{
  requestedMaxDimension: number;
  width: number;
  height: number;
  pixelCount: number;
}>;

export type RasterRenderComparison = Readonly<{
  renderer: Readonly<{
    name: "@resvg/resvg-js";
    version: "2.6.2";
    systemFontsLoaded: false;
    shapeRendering: "geometricPrecision";
  }>;
  scales: readonly RasterComparisonScale[];
  aggregate: RasterComparisonMetrics & Readonly<{
    comparedPixelCount: number;
    largestComparedDimension: number;
  }>;
  quality: RasterComparisonQuality;
  thresholds: Readonly<{
    mismatchPixelError: number;
    excellent: Readonly<{
      visualMae: number;
      mismatchFraction: number;
      aspectRatioDelta: number;
    }>;
    good: Readonly<{
      visualMae: number;
      mismatchFraction: number;
      aspectRatioDelta: number;
    }>;
  }>;
}>;

export type TraceOutputEvidence = Readonly<{
  mimeType: "image/svg+xml";
  bytes: number;
  pathCount: number;
  groupCount: number;
  gradientCount: number;
  viewBox: readonly [number, number, number, number] | null;
  pathDataBytes: number;
  commandCount: number;
  estimatedAnchorCount: number;
  subpathCount: number;
  straightSegmentCount: number;
  curveSegmentCount: number;
}>;

export type TraceCandidateTimings = Readonly<{
  trace: number;
  optimise: number;
  compare: number;
  total: number;
}>;

export type TraceCandidateCompleteEvidence = Readonly<{
  id: string;
  role: TraceCandidateRole;
  status: "complete";
  selected: boolean;
  trace: TraceConfigurationEvidence;
  output: TraceOutputEvidence;
  comparison: RasterRenderComparison;
  visualCost: number;
  geometryCost: number;
  timingsMs: TraceCandidateTimings;
}>;

export type TraceCandidateFailedEvidence = Readonly<{
  id: string;
  role: TraceCandidateRole;
  status: "failed";
  selected: false;
  trace: TraceConfigurationEvidence;
  errorCode: string;
  message: string;
  elapsedMs: number;
}>;

export type TraceCandidateEvidence = TraceCandidateCompleteEvidence | TraceCandidateFailedEvidence;

export type TraceSelectionEvidence = Readonly<{
  mode: RasterCandidateMode;
  maximumCandidateCount: number;
  attemptedCandidateCount: number;
  completedCandidateCount: number;
  selectedCandidateId: string;
  bestVisualCandidateId: string;
  eligibleCandidateIds: readonly string[];
  reason: "single-candidate" | "best-visual-review-required" | "lowest-geometry-cost-within-visual-tolerance";
  visualTolerance: Readonly<{
    visualCost: number;
    mismatchFraction: number;
    aspectRatioDelta: number;
  }>;
  costModel: Readonly<{
    visual: Readonly<{
      visualMaeWeight: number;
      mismatchFractionWeight: number;
      alphaMaeWeight: number;
      aspectRatioDeltaWeight: number;
    }>;
    geometry: Readonly<{
      estimatedAnchorCountWeight: number;
      pathCountWeight: number;
      commandCountWeight: number;
      byteDivisor: number;
    }>;
  }>;
  pixelBudgetPolicy: Readonly<{
    threeCandidateMaximumPixels: number;
    twoCandidateMaximumPixels: number;
  }>;
}>;

export type RasterTraceEvidence = Readonly<{
  contractVersion: "1.3";
  engine: Readonly<{
    name: "@neplex/vectorizer";
    adapterVersion: "0.3.1";
  }>;
  analysis: RasterAnalysis;
  trace: TraceConfigurationEvidence;
  output: TraceOutputEvidence;
  comparison: RasterRenderComparison;
  candidates: readonly TraceCandidateEvidence[];
  selection: TraceSelectionEvidence;
  qualityGates: Readonly<{
    svgSafety: "passed";
    structuralValidation: "passed";
    renderComparison: "passed" | "review-required";
    visualEvidenceAvailable: true;
    productionApproval: "review-required";
    byteStableOutputGuaranteed: false;
  }>;
  timingsMs: Readonly<{
    decodeAndAnalyse: number;
    trace: number;
    optimise: number;
    compare: number;
    candidateSelection: number;
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
