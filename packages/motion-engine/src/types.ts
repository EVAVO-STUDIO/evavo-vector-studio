import type { SvgInspection } from "@evavo/vector-core";

export const MOTION_CONTRACT_VERSION = "1.0" as const;

export type MotionDirection = "normal" | "reverse" | "alternate" | "alternate-reverse";
export type MotionFillMode = "none" | "forwards" | "backwards" | "both";
export type MotionTransformBox = "fill-box" | "view-box";
export type ReducedMotionStrategy = "source" | "first-frame" | "last-frame";
export type MotionEasingPreset = "linear" | "ease" | "ease-in" | "ease-out" | "ease-in-out";

export type MotionEasing = MotionEasingPreset | Readonly<{
  cubicBezier: readonly [number, number, number, number];
}>;

export type MotionKeyframe = Readonly<{
  offset: number;
  opacity?: number;
  translateX?: number;
  translateY?: number;
  scale?: number;
  rotateDeg?: number;
}>;

export type MotionTrack = Readonly<{
  targetId: string;
  transformBox?: MotionTransformBox;
  originXPercent?: number;
  originYPercent?: number;
  easing?: MotionEasing;
  keyframes: readonly MotionKeyframe[];
}>;

export type AnimatedSvgMotionSpec = Readonly<{
  version: "1.0";
  name: string;
  durationMs: number;
  delayMs?: number;
  iterations?: number | "infinite";
  direction?: MotionDirection;
  fillMode?: MotionFillMode;
  reducedMotion?: ReducedMotionStrategy;
  tracks: readonly MotionTrack[];
}>;

export type NormalizedMotionKeyframe = Readonly<{
  offset: number;
  opacity: number;
  translateX: number;
  translateY: number;
  scale: number;
  rotateDeg: number;
}>;

export type NormalizedMotionTrack = Readonly<{
  targetId: string;
  transformBox: MotionTransformBox;
  originXPercent: number;
  originYPercent: number;
  easing: MotionEasing;
  keyframes: readonly NormalizedMotionKeyframe[];
  animatesOpacity: boolean;
  animatesTransform: boolean;
}>;

export type NormalizedAnimatedSvgMotionSpec = Readonly<{
  version: "1.0";
  name: string;
  durationMs: number;
  delayMs: number;
  iterations: number | "infinite";
  direction: MotionDirection;
  fillMode: MotionFillMode;
  reducedMotion: ReducedMotionStrategy;
  tracks: readonly NormalizedMotionTrack[];
}>;

export type MotionFindingSeverity = "error" | "warning" | "info";
export type MotionFinding = Readonly<{
  code: string;
  severity: MotionFindingSeverity;
  message: string;
  targetId?: string;
}>;

export type AnimatedSvgInspection = Readonly<{
  valid: boolean;
  contractVersion: string | null;
  motionId: string | null;
  styleId: string | null;
  keyframeRuleCount: number;
  targetRuleCount: number;
  reducedMotionFallback: boolean;
  sourceInspection: SvgInspection;
  findings: readonly MotionFinding[];
}>;

export type AnimatedSvgEvidence = Readonly<{
  contractVersion: "1.0";
  generator: Readonly<{
    name: "@evavo/motion-engine";
    version: "0.4.0";
  }>;
  source: Readonly<{
    bytes: number;
    sha256: string;
    inspection: SvgInspection;
  }>;
  motion: Readonly<{
    id: string;
    name: string;
    durationMs: number;
    delayMs: number;
    iterations: number | "infinite";
    direction: MotionDirection;
    fillMode: MotionFillMode;
    reducedMotion: ReducedMotionStrategy;
    trackCount: number;
    keyframeCount: number;
    targets: readonly string[];
  }>;
  output: Readonly<{
    mimeType: "image/svg+xml";
    bytes: number;
    sha256: string;
    styleId: string;
    keyframeRuleCount: number;
  }>;
  safety: Readonly<{
    scriptsAdded: false;
    externalReferencesAdded: false;
    reducedMotionFallback: true;
    deterministicOutput: true;
  }>;
  approval: "review-required";
  warnings: readonly MotionFinding[];
}>;

export type AnimatedSvgResult = Readonly<{
  svg: string;
  inspection: AnimatedSvgInspection;
  evidence: AnimatedSvgEvidence;
}>;
