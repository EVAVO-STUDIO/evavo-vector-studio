import type { NormalizedAnimatedSvgMotionSpec } from "@evavo/motion-engine";
import type { SvgInspection } from "@evavo/vector-core";

export const LOTTIE_CONTRACT_VERSION = "1.0" as const;
export const LOTTIE_GENERATOR_VERSION = "0.4.0" as const;
export const DEFAULT_LOTTIE_FRAME_RATE = 60;
export const MIN_LOTTIE_FRAME_RATE = 1;
export const MAX_LOTTIE_FRAME_RATE = 120;
export const DEFAULT_LOTTIE_PRECISION = 4;
export const MAX_LOTTIE_PRECISION = 6;
export const MAX_LOTTIE_CANVAS_DIMENSION = 8192;

export type LottiePoint = readonly [number, number];
export type LottieNumericValue = number | readonly number[];

export type LottieBezierPath = Readonly<{
  c: boolean;
  v: readonly LottiePoint[];
  i: readonly LottiePoint[];
  o: readonly LottiePoint[];
}>;

export type LottieStaticProperty<T extends LottieNumericValue> = Readonly<{
  a: 0;
  k: T;
}>;

export type LottieKeyframe = Readonly<{
  t: number;
  s: readonly number[];
  h?: 1;
  o?: Readonly<{ x: readonly number[]; y: readonly number[] }>;
  i?: Readonly<{ x: readonly number[]; y: readonly number[] }>;
}>;

export type LottieAnimatedProperty = Readonly<{
  a: 1;
  k: readonly LottieKeyframe[];
}>;

export type LottieProperty<T extends LottieNumericValue> = LottieStaticProperty<T> | LottieAnimatedProperty;

export type LottieLayerTransform = Readonly<{
  o: LottieProperty<number>;
  r: LottieProperty<number>;
  p: LottieProperty<readonly [number, number, number]>;
  a: LottieStaticProperty<readonly [number, number, number]>;
  s: LottieProperty<readonly [number, number, number]>;
}>;

export type LottieShapeLayer = Readonly<{
  ddd: 0;
  ind: number;
  ty: 4;
  nm: string;
  ln: string;
  sr: 1;
  ks: LottieLayerTransform;
  ao: 0;
  shapes: readonly Readonly<Record<string, unknown>>[];
  ip: 0;
  op: number;
  st: 0;
  bm: 0;
}>;

export type LottieAnimation = Readonly<{
  v: string;
  ver: number;
  fr: number;
  ip: 0;
  op: number;
  w: number;
  h: number;
  nm: string;
  ddd: 0;
  assets: readonly [];
  layers: readonly LottieShapeLayer[];
  meta: Readonly<{
    generator: string;
    contractVersion: "1.0";
    sourceSha256: string;
    motionName: string;
    reviewRequired: true;
  }>;
}>;

export type LottieExportOptions = Readonly<{
  frameRate?: number;
  precision?: number;
  name?: string;
}>;

export type LottieFindingSeverity = "error" | "warning" | "info";
export type LottieFinding = Readonly<{
  code: string;
  severity: LottieFindingSeverity;
  message: string;
  layerName?: string;
}>;

export type LottieInspection = Readonly<{
  valid: boolean;
  contractVersion: string | null;
  width: number | null;
  height: number | null;
  frameRate: number | null;
  inPoint: number | null;
  outPoint: number | null;
  layerCount: number;
  shapeLayerCount: number;
  pathShapeCount: number;
  fillShapeCount: number;
  strokeShapeCount: number;
  animatedPropertyCount: number;
  expressionCount: number;
  assetCount: number;
  imageLayerCount: number;
  textLayerCount: number;
  precompositionLayerCount: number;
  findings: readonly LottieFinding[];
}>;

export type LottieEvidence = Readonly<{
  contractVersion: "1.0";
  generator: Readonly<{
    name: "@evavo/lottie-engine";
    version: "0.4.0";
  }>;
  source: Readonly<{
    bytes: number;
    sha256: string;
    viewBox: readonly [number, number, number, number];
    inspection: SvgInspection;
    renderUnitCount: number;
    pathElementCount: number;
  }>;
  motion: Readonly<{
    normalized: NormalizedAnimatedSvgMotionSpec;
    animatedTargetCount: number;
    staticLayerCount: number;
  }>;
  output: Readonly<{
    mimeType: "video/lottie+json";
    extension: ".json";
    bytes: number;
    sha256: string;
    width: number;
    height: number;
    frameRate: number;
    durationFrames: number;
    layerCount: number;
    pathShapeCount: number;
  }>;
  subset: Readonly<{
    shapeLayersOnly: true;
    pathGeometry: true;
    solidFill: true;
    solidStroke: true;
    opacity: true;
    translation: true;
    uniformScale: true;
    rotation: true;
    gradients: false;
    text: false;
    images: false;
    masks: false;
    filters: false;
    expressions: false;
    precompositions: false;
    repeatedPlaybackEncoded: false;
  }>;
  compatibility: Readonly<{
    structuralInspection: "passed";
    playerRenderValidation: "not-yet-performed";
    dotLottiePackaging: "not-yet-available";
  }>;
  approval: "review-required";
  warnings: readonly LottieFinding[];
}>;

export type LottieResult = Readonly<{
  animation: LottieAnimation;
  json: string;
  inspection: LottieInspection;
  evidence: LottieEvidence;
}>;
