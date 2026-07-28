import { createHash } from "node:crypto";
import {
  validateAnimatedSvgMotionSpec,
  type MotionEasing,
  type NormalizedAnimatedSvgMotionSpec,
  type NormalizedMotionKeyframe,
  type NormalizedMotionTrack,
} from "@evavo/motion-engine";
import { LottieEngineError } from "./errors.js";
import { inspectLottie } from "./inspection.js";
import {
  prepareSvgSourceForLottie,
  type ExtractedSvgPath,
  type LottiePathBounds,
  type SvgRenderUnit,
} from "./svg-source.js";
import {
  DEFAULT_LOTTIE_FRAME_RATE,
  DEFAULT_LOTTIE_PRECISION,
  LOTTIE_CONTRACT_VERSION,
  LOTTIE_GENERATOR_VERSION,
  MAX_LOTTIE_FRAME_RATE,
  MAX_LOTTIE_PRECISION,
  MIN_LOTTIE_FRAME_RATE,
  type LottieAnimatedProperty,
  type LottieAnimation,
  type LottieEvidence,
  type LottieExportOptions,
  type LottieFinding,
  type LottieKeyframe,
  type LottieLayerTransform,
  type LottieNumericValue,
  type LottieProperty,
  type LottieResult,
  type LottieShapeLayer,
  type LottieStaticProperty,
} from "./types.js";

type Sample = Readonly<{
  t: number;
  value: readonly number[];
  hold?: true;
}>;

const EASING_PRESETS = Object.freeze<
  Record<string, readonly [number, number, number, number]>
>({
  linear: [0, 0, 1, 1],
  ease: [0.25, 0.1, 0.25, 1],
  "ease-in": [0.42, 0, 1, 1],
  "ease-out": [0, 0, 0.58, 1],
  "ease-in-out": [0.42, 0, 0.58, 1],
});

function round(value: number, precision: number): number {
  const factor = 10 ** precision;
  const rounded = Math.round(value * factor) / factor;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function clampPercentage(value: number, precision: number): number {
  return round(Math.min(100, Math.max(0, value * 100)), precision);
}

function freezeVector(values: readonly number[]): readonly number[] {
  return Object.freeze([...values]);
}

function staticProperty<T extends LottieNumericValue>(
  value: T,
): LottieStaticProperty<T> {
  return Object.freeze({ a: 0 as const, k: value });
}

function valuesEqual(
  left: readonly number[],
  right: readonly number[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function easingTuple(
  value: MotionEasing,
): readonly [number, number, number, number] {
  if (typeof value === "string") {
    return EASING_PRESETS[value] ?? EASING_PRESETS["ease-in-out"]!;
  }
  return value.cubicBezier;
}

function animatedProperty(
  samples: readonly Sample[],
  easing: MotionEasing,
  scalar: boolean,
): LottieProperty<number | readonly number[]> {
  const first = samples[0];
  if (!first) {
    throw new LottieEngineError(
      "LOTTIE_OUTPUT_INVALID",
      "An animated property requires at least one sample.",
    );
  }
  if (samples.every((sample) => valuesEqual(sample.value, first.value))) {
    return scalar
      ? staticProperty(first.value[0] ?? 0)
      : staticProperty(freezeVector(first.value));
  }
  if (samples.length < 2) {
    throw new LottieEngineError(
      "LOTTIE_OUTPUT_INVALID",
      "A changing Lottie property requires at least two samples.",
    );
  }

  const [x1, y1, x2, y2] = easingTuple(easing);
  const keyframes: LottieKeyframe[] = samples.map((sample, index) => {
    const base = {
      t: sample.t,
      s: freezeVector(sample.value),
    };
    if (index === samples.length - 1) return Object.freeze(base);
    if (sample.hold) {
      return Object.freeze({ ...base, h: 1 as const });
    }
    return Object.freeze({
      ...base,
      o: Object.freeze({
        x: Object.freeze([x1]),
        y: Object.freeze([y1]),
      }),
      i: Object.freeze({
        x: Object.freeze([x2]),
        y: Object.freeze([y2]),
      }),
    });
  });
  return Object.freeze({
    a: 1 as const,
    k: Object.freeze(keyframes),
  }) satisfies LottieAnimatedProperty;
}

function trackSamples(
  spec: NormalizedAnimatedSvgMotionSpec,
  track: NormalizedMotionTrack,
  frameRate: number,
  precision: number,
  baseValue: readonly number[],
  valueOf: (frame: NormalizedMotionKeyframe) => readonly number[],
): readonly Sample[] {
  const delayFrames = (spec.delayMs * frameRate) / 1000;
  const durationFrames = (spec.durationMs * frameRate) / 1000;
  const firstFrame = track.keyframes[0];
  if (!firstFrame) {
    throw new LottieEngineError(
      "LOTTIE_MOTION_UNSUPPORTED",
      `Motion target ${track.targetId} has no keyframes.`,
    );
  }

  const samples: Sample[] = [];
  if (delayFrames > 0) {
    const preValue =
      spec.fillMode === "both" ? valueOf(firstFrame) : baseValue;
    samples.push(
      Object.freeze({
        t: 0,
        value: freezeVector(preValue),
        hold: true as const,
      }),
    );
  }
  for (const frame of track.keyframes) {
    samples.push(
      Object.freeze({
        t: round(
          delayFrames + frame.offset * durationFrames,
          precision,
        ),
        value: freezeVector(valueOf(frame)),
      }),
    );
  }
  return Object.freeze(samples);
}

function motionOrigin(
  bounds: LottiePathBounds,
  width: number,
  height: number,
  track: NormalizedMotionTrack,
  precision: number,
): readonly [number, number] {
  if (track.transformBox === "view-box") {
    return Object.freeze([
      round((width * track.originXPercent) / 100, precision),
      round((height * track.originYPercent) / 100, precision),
    ]);
  }
  return Object.freeze([
    round(
      bounds.minX +
        ((bounds.maxX - bounds.minX) * track.originXPercent) / 100,
      precision,
    ),
    round(
      bounds.minY +
        ((bounds.maxY - bounds.minY) * track.originYPercent) / 100,
      precision,
    ),
  ]);
}

function layerTransform(
  unit: SvgRenderUnit,
  track: NormalizedMotionTrack | undefined,
  spec: NormalizedAnimatedSvgMotionSpec,
  frameRate: number,
  precision: number,
  width: number,
  height: number,
): LottieLayerTransform {
  if (!track) {
    return Object.freeze({
      o: staticProperty(100),
      r: staticProperty(0),
      p: staticProperty(
        Object.freeze([0, 0, 0]) as readonly [number, number, number],
      ),
      a: staticProperty(
        Object.freeze([0, 0, 0]) as readonly [number, number, number],
      ),
      s: staticProperty(
        Object.freeze([100, 100, 100]) as readonly [
          number,
          number,
          number,
        ],
      ),
    });
  }

  const [anchorX, anchorY] = motionOrigin(
    unit.bounds,
    width,
    height,
    track,
    precision,
  );
  const anchor = Object.freeze([anchorX, anchorY, 0]) as readonly [
    number,
    number,
    number,
  ];
  const positionSamples = trackSamples(
    spec,
    track,
    frameRate,
    precision,
    anchor,
    (frame) => [
      round(anchorX + frame.translateX, precision),
      round(anchorY + frame.translateY, precision),
      0,
    ],
  );
  const opacitySamples = trackSamples(
    spec,
    track,
    frameRate,
    precision,
    [100],
    (frame) => [clampPercentage(frame.opacity, precision)],
  );
  const rotationSamples = trackSamples(
    spec,
    track,
    frameRate,
    precision,
    [0],
    (frame) => [round(frame.rotateDeg, precision)],
  );
  const scaleSamples = trackSamples(
    spec,
    track,
    frameRate,
    precision,
    [100, 100, 100],
    (frame) => {
      const scale = round(frame.scale * 100, precision);
      return [scale, scale, 100];
    },
  );

  return Object.freeze({
    o: animatedProperty(
      opacitySamples,
      track.easing,
      true,
    ) as LottieProperty<number>,
    r: animatedProperty(
      rotationSamples,
      track.easing,
      true,
    ) as LottieProperty<number>,
    p: animatedProperty(
      positionSamples,
      track.easing,
      false,
    ) as LottieProperty<readonly [number, number, number]>,
    a: staticProperty(anchor),
    s: animatedProperty(
      scaleSamples,
      track.easing,
      false,
    ) as LottieProperty<readonly [number, number, number]>,
  });
}

function shapeTransform(): Readonly<Record<string, unknown>> {
  return Object.freeze({
    ty: "tr",
    nm: "Transform",
    a: staticProperty(Object.freeze([0, 0])),
    p: staticProperty(Object.freeze([0, 0])),
    s: staticProperty(Object.freeze([100, 100])),
    r: staticProperty(0),
    o: staticProperty(100),
    sk: staticProperty(0),
    sa: staticProperty(0),
    hd: false,
  });
}

function pathGroup(
  path: ExtractedSvgPath,
  precision: number,
): Readonly<Record<string, unknown>> {
  const items: Readonly<Record<string, unknown>>[] = path.subpaths.map(
    (subpath, index) =>
      Object.freeze({
        ty: "sh",
        d: 1,
        ks: Object.freeze({ a: 0, k: subpath.path }),
        nm: `${path.name} path ${index + 1}`,
        mn: "ADBE Vector Shape - Group",
        hd: false,
      }),
  );

  if (path.style.stroke) {
    items.push(
      Object.freeze({
        ty: "st",
        nm: `${path.name} stroke`,
        mn: "ADBE Vector Graphic - Stroke",
        c: staticProperty(freezeVector(path.style.stroke.colour)),
        o: staticProperty(
          clampPercentage(path.style.stroke.opacity, precision),
        ),
        w: staticProperty(round(path.style.stroke.width, precision)),
        lc: path.style.stroke.lineCap,
        lj: path.style.stroke.lineJoin,
        ml: 4,
        bm: 0,
        hd: false,
      }),
    );
  }
  if (path.style.fill) {
    items.push(
      Object.freeze({
        ty: "fl",
        nm: `${path.name} fill`,
        mn: "ADBE Vector Graphic - Fill",
        c: staticProperty(freezeVector(path.style.fill.colour)),
        o: staticProperty(
          clampPercentage(path.style.fill.opacity, precision),
        ),
        r: path.style.fillRule,
        bm: 0,
        hd: false,
      }),
    );
  }
  items.push(shapeTransform());

  return Object.freeze({
    ty: "gr",
    nm: path.name,
    ln: path.id ?? undefined,
    np: items.length,
    it: Object.freeze(items),
    bm: 0,
    hd: false,
  });
}

function shapeLayer(
  unit: SvgRenderUnit,
  index: number,
  track: NormalizedMotionTrack | undefined,
  spec: NormalizedAnimatedSvgMotionSpec,
  frameRate: number,
  precision: number,
  width: number,
  height: number,
  outPoint: number,
): LottieShapeLayer {
  const groups = [...unit.paths]
    .sort((left, right) => right.order - left.order)
    .map((path) => pathGroup(path, precision));
  return Object.freeze({
    ddd: 0,
    ind: index,
    ty: 4,
    nm: unit.name,
    ln: unit.id,
    sr: 1,
    ks: layerTransform(
      unit,
      track,
      spec,
      frameRate,
      precision,
      width,
      height,
    ),
    ao: 0,
    shapes: Object.freeze(groups),
    ip: 0,
    op: outPoint,
    st: 0,
    bm: 0,
  });
}

function validateOptions(
  options: LottieExportOptions,
): Readonly<{
  frameRate: number;
  precision: number;
  name: string | null;
}> {
  const frameRate = options.frameRate ?? DEFAULT_LOTTIE_FRAME_RATE;
  const precision = options.precision ?? DEFAULT_LOTTIE_PRECISION;
  if (
    !Number.isSafeInteger(frameRate) ||
    frameRate < MIN_LOTTIE_FRAME_RATE ||
    frameRate > MAX_LOTTIE_FRAME_RATE
  ) {
    throw new LottieEngineError(
      "LOTTIE_OPTIONS_INVALID",
      `frameRate must be an integer from ${MIN_LOTTIE_FRAME_RATE} to ${MAX_LOTTIE_FRAME_RATE}.`,
      { frameRate },
    );
  }
  if (
    !Number.isSafeInteger(precision) ||
    precision < 0 ||
    precision > MAX_LOTTIE_PRECISION
  ) {
    throw new LottieEngineError(
      "LOTTIE_OPTIONS_INVALID",
      `precision must be an integer from 0 to ${MAX_LOTTIE_PRECISION}.`,
      { precision },
    );
  }
  const name = options.name?.trim() ?? null;
  if (name !== null && (!name || name.length > 120)) {
    throw new LottieEngineError(
      "LOTTIE_OPTIONS_INVALID",
      "name must contain 1 to 120 characters.",
      { name: options.name },
    );
  }
  return Object.freeze({ frameRate, precision, name });
}

function validateMotionSubset(
  spec: NormalizedAnimatedSvgMotionSpec,
): void {
  if (spec.iterations !== 1) {
    throw new LottieEngineError(
      "LOTTIE_MOTION_UNSUPPORTED",
      "Lottie export v1 supports one motion cycle only.",
      { iterations: spec.iterations },
    );
  }
  if (spec.direction !== "normal") {
    throw new LottieEngineError(
      "LOTTIE_MOTION_UNSUPPORTED",
      "Lottie export v1 supports normal playback direction only.",
      { direction: spec.direction },
    );
  }
  if (spec.fillMode !== "both" && spec.fillMode !== "forwards") {
    throw new LottieEngineError(
      "LOTTIE_MOTION_UNSUPPORTED",
      "Lottie export v1 supports forwards or both fill modes.",
      { fillMode: spec.fillMode },
    );
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function warning(code: string, message: string): LottieFinding {
  return Object.freeze({ code, severity: "warning", message });
}

export function createLottieFromSvgMotion(
  source: string,
  motionInput: unknown,
  options: LottieExportOptions = {},
): LottieResult {
  const spec = validateAnimatedSvgMotionSpec(motionInput);
  validateMotionSubset(spec);
  const resolvedOptions = validateOptions(options);
  const prepared = prepareSvgSourceForLottie(
    source,
    spec.tracks.map((track) => track.targetId),
    resolvedOptions.precision,
  );
  const trackByTarget = new Map(
    spec.tracks.map((track) => [track.targetId, track]),
  );
  const durationFrames =
    (spec.durationMs * resolvedOptions.frameRate) / 1000;
  const delayFrames = (spec.delayMs * resolvedOptions.frameRate) / 1000;
  const outPoint = Math.max(1, Math.ceil(delayFrames + durationFrames));
  const layers = [...prepared.renderUnits]
    .sort((left, right) => right.order - left.order)
    .map((unit, index) =>
      shapeLayer(
        unit,
        index + 1,
        unit.animatedTargetId
          ? trackByTarget.get(unit.animatedTargetId)
          : undefined,
        spec,
        resolvedOptions.frameRate,
        resolvedOptions.precision,
        prepared.width,
        prepared.height,
        outPoint,
      ),
    );

  const sourceHash = sha256(source);
  const animation: LottieAnimation = Object.freeze({
    v: "5.12.2",
    ver: 10001,
    fr: resolvedOptions.frameRate,
    ip: 0,
    op: outPoint,
    w: prepared.width,
    h: prepared.height,
    nm: resolvedOptions.name ?? spec.name,
    ddd: 0,
    assets: Object.freeze([]) as readonly [],
    layers: Object.freeze(layers),
    meta: Object.freeze({
      generator: `@evavo/lottie-engine@${LOTTIE_GENERATOR_VERSION}`,
      contractVersion: LOTTIE_CONTRACT_VERSION,
      sourceSha256: sourceHash,
      motionName: spec.name,
      reviewRequired: true,
    }),
  });
  const json = `${JSON.stringify(animation, null, 2)}\n`;
  const inspection = inspectLottie(json);
  if (!inspection.valid) {
    throw new LottieEngineError(
      "LOTTIE_OUTPUT_INVALID",
      "Generated Lottie JSON failed governed structural inspection.",
      { findings: inspection.findings },
    );
  }

  const warnings = Object.freeze([
    warning(
      "LOTTIE_PLAYER_RENDER_VALIDATION_REQUIRED",
      "The generated JSON has passed structural inspection but has not yet been compared through independent Lottie players.",
    ),
    warning(
      "LOTTIE_REDUCED_MOTION_NOT_EMBEDDED",
      "Lottie JSON cannot carry the SVG prefers-reduced-motion fallback; the delivery surface must provide pause or static alternatives.",
    ),
    warning(
      "LOTTIE_HUMAN_REVIEW_REQUIRED",
      "Motion timing, path rendering, compositing and brand character require human review before production use.",
    ),
  ]);
  const evidence: LottieEvidence = Object.freeze({
    contractVersion: LOTTIE_CONTRACT_VERSION,
    generator: Object.freeze({
      name: "@evavo/lottie-engine",
      version: LOTTIE_GENERATOR_VERSION,
    }),
    source: Object.freeze({
      bytes: utf8Bytes(source),
      sha256: sourceHash,
      viewBox: prepared.viewBox,
      inspection: prepared.inspection,
      renderUnitCount: prepared.renderUnits.length,
      pathElementCount: prepared.pathElementCount,
    }),
    motion: Object.freeze({
      normalized: spec,
      animatedTargetCount: spec.tracks.length,
      staticLayerCount: prepared.renderUnits.filter(
        (unit) => unit.animatedTargetId === null,
      ).length,
    }),
    output: Object.freeze({
      mimeType: "video/lottie+json",
      extension: ".json",
      bytes: utf8Bytes(json),
      sha256: sha256(json),
      width: prepared.width,
      height: prepared.height,
      frameRate: resolvedOptions.frameRate,
      durationFrames: outPoint,
      layerCount: inspection.layerCount,
      pathShapeCount: inspection.pathShapeCount,
    }),
    subset: Object.freeze({
      shapeLayersOnly: true,
      pathGeometry: true,
      solidFill: true,
      solidStroke: true,
      opacity: true,
      translation: true,
      uniformScale: true,
      rotation: true,
      gradients: false,
      text: false,
      images: false,
      masks: false,
      filters: false,
      expressions: false,
      precompositions: false,
      repeatedPlaybackEncoded: false,
    }),
    compatibility: Object.freeze({
      structuralInspection: "passed",
      playerRenderValidation: "not-yet-performed",
      dotLottiePackaging: "not-yet-available",
    }),
    approval: "review-required",
    warnings,
  });

  return Object.freeze({ animation, json, inspection, evidence });
}
