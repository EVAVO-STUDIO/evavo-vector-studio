import { MotionEngineError } from "./errors.js";
import {
  MOTION_CONTRACT_VERSION,
  type AnimatedSvgMotionSpec,
  type MotionDirection,
  type MotionEasing,
  type MotionFillMode,
  type MotionKeyframe,
  type MotionTrack,
  type MotionTransformBox,
  type NormalizedAnimatedSvgMotionSpec,
  type NormalizedMotionKeyframe,
  type NormalizedMotionTrack,
  type ReducedMotionStrategy,
} from "./types.js";

const DIRECTIONS = new Set<MotionDirection>(["normal", "reverse", "alternate", "alternate-reverse"]);
const FILL_MODES = new Set<MotionFillMode>(["none", "forwards", "backwards", "both"]);
const TRANSFORM_BOXES = new Set<MotionTransformBox>(["fill-box", "view-box"]);
const REDUCED_MOTION = new Set<ReducedMotionStrategy>(["source", "first-frame", "last-frame"]);
const EASING_PRESETS = new Set(["linear", "ease", "ease-in", "ease-out", "ease-in-out"]);
const SAFE_ID = /^[A-Za-z_][A-Za-z0-9_.:-]{0,255}$/;
const ROOT_KEYS = new Set([
  "$schema",
  "version",
  "name",
  "durationMs",
  "delayMs",
  "iterations",
  "direction",
  "fillMode",
  "reducedMotion",
  "tracks",
]);
const TRACK_KEYS = new Set([
  "targetId",
  "transformBox",
  "originXPercent",
  "originYPercent",
  "easing",
  "keyframes",
]);
const KEYFRAME_KEYS = new Set([
  "offset",
  "opacity",
  "translateX",
  "translateY",
  "scale",
  "rotateDeg",
]);
const EASING_KEYS = new Set(["cubicBezier"]);

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw invalid(`${path} must be an object.`, { path, value });
  }
  return value as Record<string, unknown>;
}

function invalid(message: string, details?: Readonly<Record<string, unknown>>): MotionEngineError {
  return new MotionEngineError("MOTION_SPEC_INVALID", message, details);
}

function assertKnownKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  path: string,
): void {
  const unknownKeys = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknownKeys.length > 0) {
    throw invalid(`${path} contains unsupported properties.`, {
      path,
      unknownKeys: Object.freeze(unknownKeys),
      allowedKeys: Object.freeze([...allowed]),
    });
  }
}

function finite(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
  path: string,
): number {
  const resolved = value === undefined ? fallback : value;
  if (typeof resolved !== "number" || !Number.isFinite(resolved) || resolved < minimum || resolved > maximum) {
    throw invalid(`${path} must be a finite number from ${minimum} to ${maximum}.`, { path, value });
  }
  return resolved;
}

function integer(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
  path: string,
): number {
  const resolved = value === undefined ? fallback : value;
  if (!Number.isSafeInteger(resolved) || Number(resolved) < minimum || Number(resolved) > maximum) {
    throw invalid(`${path} must be an integer from ${minimum} to ${maximum}.`, { path, value });
  }
  return Number(resolved);
}

function enumValue<T extends string>(
  value: unknown,
  fallback: T,
  allowed: ReadonlySet<T>,
  path: string,
): T {
  const resolved = value === undefined ? fallback : value;
  if (typeof resolved !== "string" || !allowed.has(resolved as T)) {
    throw invalid(`${path} is invalid.`, { path, value, allowed: [...allowed] });
  }
  return resolved as T;
}

function easing(value: unknown, path: string): MotionEasing {
  if (value === undefined) return "ease-in-out";
  if (typeof value === "string") {
    if (!EASING_PRESETS.has(value)) {
      throw invalid(`${path} uses an unsupported easing preset.`, { path, value });
    }
    return value as MotionEasing;
  }
  const input = record(value, path);
  assertKnownKeys(input, EASING_KEYS, path);
  const tuple = input.cubicBezier;
  if (!Array.isArray(tuple) || tuple.length !== 4) {
    throw invalid(`${path}.cubicBezier must contain four numbers.`, { path, value });
  }
  const numbers = tuple.map((item, index) =>
    finite(
      item,
      0,
      index === 0 || index === 2 ? 0 : -10,
      index === 0 || index === 2 ? 1 : 10,
      `${path}.cubicBezier[${index}]`,
    ),
  );
  return Object.freeze({ cubicBezier: Object.freeze(numbers as [number, number, number, number]) });
}

function keyframe(value: unknown, path: string): NormalizedMotionKeyframe {
  const input = record(value, path) as MotionKeyframe & Record<string, unknown>;
  assertKnownKeys(input, KEYFRAME_KEYS, path);
  return Object.freeze({
    offset: finite(input.offset, Number.NaN, 0, 1, `${path}.offset`),
    opacity: finite(input.opacity, 1, 0, 1, `${path}.opacity`),
    translateX: finite(input.translateX, 0, -100000, 100000, `${path}.translateX`),
    translateY: finite(input.translateY, 0, -100000, 100000, `${path}.translateY`),
    scale: finite(input.scale, 1, 0.001, 1000, `${path}.scale`),
    rotateDeg: finite(input.rotateDeg, 0, -36000, 36000, `${path}.rotateDeg`),
  });
}

function differs(
  keyframes: readonly NormalizedMotionKeyframe[],
  property: keyof Omit<NormalizedMotionKeyframe, "offset">,
): boolean {
  const first = keyframes[0]?.[property];
  return keyframes.some((frame) => frame[property] !== first);
}

function track(value: unknown, index: number): NormalizedMotionTrack {
  const path = `tracks[${index}]`;
  const input = record(value, path) as MotionTrack & Record<string, unknown>;
  assertKnownKeys(input, TRACK_KEYS, path);
  if (typeof input.targetId !== "string" || !SAFE_ID.test(input.targetId)) {
    throw invalid(`${path}.targetId must be a portable XML/CSS identifier.`, {
      path: `${path}.targetId`,
      value: input.targetId,
    });
  }
  if (!Array.isArray(input.keyframes) || input.keyframes.length < 2 || input.keyframes.length > 100) {
    throw invalid(`${path}.keyframes must contain 2 to 100 keyframes.`, { path: `${path}.keyframes` });
  }
  const keyframes = Object.freeze(
    input.keyframes.map((item, frameIndex) => keyframe(item, `${path}.keyframes[${frameIndex}]`)),
  );
  if (keyframes[0]?.offset !== 0 || keyframes[keyframes.length - 1]?.offset !== 1) {
    throw invalid(`${path}.keyframes must begin at offset 0 and end at offset 1.`, {
      targetId: input.targetId,
    });
  }
  for (let frameIndex = 1; frameIndex < keyframes.length; frameIndex += 1) {
    if (keyframes[frameIndex]!.offset <= keyframes[frameIndex - 1]!.offset) {
      throw invalid(`${path}.keyframe offsets must be strictly increasing.`, {
        targetId: input.targetId,
        frameIndex,
      });
    }
  }
  const animatesOpacity = differs(keyframes, "opacity");
  const animatesTransform = ["translateX", "translateY", "scale", "rotateDeg"].some((property) =>
    differs(keyframes, property as keyof Omit<NormalizedMotionKeyframe, "offset">),
  );
  if (!animatesOpacity && !animatesTransform) {
    throw invalid(`${path} does not change opacity or transform values.`, { targetId: input.targetId });
  }
  return Object.freeze({
    targetId: input.targetId,
    transformBox: enumValue(input.transformBox, "fill-box", TRANSFORM_BOXES, `${path}.transformBox`),
    originXPercent: finite(input.originXPercent, 50, -1000, 1000, `${path}.originXPercent`),
    originYPercent: finite(input.originYPercent, 50, -1000, 1000, `${path}.originYPercent`),
    easing: easing(input.easing, `${path}.easing`),
    keyframes,
    animatesOpacity,
    animatesTransform,
  });
}

export function validateAnimatedSvgMotionSpec(input: unknown): NormalizedAnimatedSvgMotionSpec {
  const source = record(input, "motion");
  assertKnownKeys(source, ROOT_KEYS, "motion");
  if (source.$schema !== undefined && (typeof source.$schema !== "string" || source.$schema.length > 2048)) {
    throw invalid("motion.$schema must be a string no longer than 2048 characters.", {
      value: source.$schema,
    });
  }
  if (source.version !== MOTION_CONTRACT_VERSION) {
    throw invalid(`motion.version must be ${MOTION_CONTRACT_VERSION}.`, { version: source.version });
  }
  if (typeof source.name !== "string" || !source.name.trim() || source.name.trim().length > 120) {
    throw invalid("motion.name must contain 1 to 120 characters.", { name: source.name });
  }
  if (!Array.isArray(source.tracks) || source.tracks.length < 1 || source.tracks.length > 64) {
    throw invalid("motion.tracks must contain 1 to 64 tracks.", {
      trackCount: Array.isArray(source.tracks) ? source.tracks.length : null,
    });
  }
  const tracks = Object.freeze(source.tracks.map(track));
  const seen = new Set<string>();
  for (const item of tracks) {
    if (seen.has(item.targetId)) {
      throw invalid("Each motion target may appear in only one track.", { targetId: item.targetId });
    }
    seen.add(item.targetId);
  }
  const rawIterations = source.iterations;
  const iterations = rawIterations === "infinite"
    ? "infinite"
    : integer(rawIterations, 1, 1, 10000, "motion.iterations");
  return Object.freeze({
    version: MOTION_CONTRACT_VERSION,
    name: source.name.trim(),
    durationMs: integer(source.durationMs, Number.NaN, 16, 3_600_000, "motion.durationMs"),
    delayMs: integer(source.delayMs, 0, 0, 600_000, "motion.delayMs"),
    iterations,
    direction: enumValue(source.direction, "normal", DIRECTIONS, "motion.direction"),
    fillMode: enumValue(source.fillMode, "both", FILL_MODES, "motion.fillMode"),
    reducedMotion: enumValue(source.reducedMotion, "source", REDUCED_MOTION, "motion.reducedMotion"),
    tracks,
  });
}

export function isAnimatedSvgMotionSpec(value: unknown): value is AnimatedSvgMotionSpec {
  try {
    validateAnimatedSvgMotionSpec(value);
    return true;
  } catch {
    return false;
  }
}
