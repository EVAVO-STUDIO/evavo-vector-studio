export const MOTION_SOURCE_MAX_BYTES = 5 * 1024 * 1024;
export const MOTION_SCHEMA_URL = "https://evavo.com.au/schemas/vector-studio/motion-v1.schema.json";

export type MotionPreset = "fade" | "rise" | "slide-left" | "pop" | "rotate" | "drift" | "custom";
export type MotionDirection = "normal" | "reverse" | "alternate" | "alternate-reverse";
export type MotionFillMode = "none" | "forwards" | "backwards" | "both";
export type ReducedMotionStrategy = "source" | "first-frame" | "last-frame";
export type MotionEasing = "linear" | "ease" | "ease-in" | "ease-out" | "ease-in-out";

export type MotionTarget = Readonly<{
  id: string;
  tag: string;
  hasBaseTransform: boolean;
}>;

export type ParsedMotionSource = Readonly<{
  targets: readonly MotionTarget[];
  viewBox: string | null;
  width: string | null;
  height: string | null;
  ignoredIdCount: number;
}>;

export type KeyframeDraft = Readonly<{
  id: string;
  offset: number;
  opacity: number;
  translateX: number;
  translateY: number;
  scale: number;
  rotateDeg: number;
}>;

export type TrackDraft = Readonly<{
  id: string;
  targetId: string;
  preset: MotionPreset;
  transformBox: "fill-box" | "view-box";
  originXPercent: number;
  originYPercent: number;
  easing: MotionEasing;
  keyframes: readonly KeyframeDraft[];
}>;

export type MotionPlan = Readonly<{
  $schema: string;
  version: "1.0";
  name: string;
  durationMs: number;
  delayMs: number;
  iterations: number | "infinite";
  direction: MotionDirection;
  fillMode: MotionFillMode;
  reducedMotion: ReducedMotionStrategy;
  tracks: readonly Readonly<{
    targetId: string;
    transformBox: "fill-box" | "view-box";
    originXPercent: number;
    originYPercent: number;
    easing: MotionEasing;
    keyframes: readonly Readonly<{
      offset: number;
      opacity: number;
      translateX: number;
      translateY: number;
      scale: number;
      rotateDeg: number;
    }>[];
  }>[];
}>;

export const MOTION_PRESETS: readonly Readonly<{
  id: MotionPreset;
  label: string;
  description: string;
}>[] = Object.freeze([
  { id: "fade", label: "Fade", description: "Opacity only, suitable for restrained reveals." },
  { id: "rise", label: "Rise", description: "Small upward settle with a restrained scale correction." },
  { id: "slide-left", label: "Slide left", description: "Horizontal entrance without overshoot." },
  { id: "pop", label: "Soft pop", description: "Three-frame scale overshoot for icons and marks." },
  { id: "rotate", label: "Rotate settle", description: "Subtle rotation and scale correction." },
  { id: "drift", label: "Drift loop", description: "Return-to-origin movement for looping ambience." },
  { id: "custom", label: "Custom", description: "Keep the current keyframes and edit every value." },
]);

const GRAPHIC_ELEMENTS = new Set([
  "g",
  "path",
  "rect",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
  "use",
  "image",
  "text",
]);
const SAFE_ID = /^[A-Za-z_][A-Za-z0-9_.:-]{0,255}$/;

function draftId(prefix: string): string {
  return `${prefix}_${globalThis.crypto.randomUUID()}`;
}

function frame(
  offset: number,
  values: Partial<Omit<KeyframeDraft, "id" | "offset">> = {},
): KeyframeDraft {
  return Object.freeze({
    id: draftId("frame"),
    offset,
    opacity: values.opacity ?? 1,
    translateX: values.translateX ?? 0,
    translateY: values.translateY ?? 0,
    scale: values.scale ?? 1,
    rotateDeg: values.rotateDeg ?? 0,
  });
}

export function presetKeyframes(preset: MotionPreset): readonly KeyframeDraft[] {
  if (preset === "fade") {
    return Object.freeze([frame(0, { opacity: 0 }), frame(1, { opacity: 1 })]);
  }
  if (preset === "slide-left") {
    return Object.freeze([
      frame(0, { opacity: 0, translateX: -24 }),
      frame(1, { opacity: 1, translateX: 0 }),
    ]);
  }
  if (preset === "pop") {
    return Object.freeze([
      frame(0, { opacity: 0, scale: 0.82 }),
      frame(0.68, { opacity: 1, scale: 1.045 }),
      frame(1, { opacity: 1, scale: 1 }),
    ]);
  }
  if (preset === "rotate") {
    return Object.freeze([
      frame(0, { opacity: 0, scale: 0.96, rotateDeg: -8 }),
      frame(1, { opacity: 1, scale: 1, rotateDeg: 0 }),
    ]);
  }
  if (preset === "drift") {
    return Object.freeze([
      frame(0),
      frame(0.5, { translateX: 8, translateY: -3, rotateDeg: 1.5 }),
      frame(1),
    ]);
  }
  if (preset === "custom") {
    return Object.freeze([frame(0, { opacity: 0 }), frame(1)]);
  }
  return Object.freeze([
    frame(0, { opacity: 0, translateY: 12, scale: 0.97 }),
    frame(1, { opacity: 1, translateY: 0, scale: 1 }),
  ]);
}

export function createTrack(targetId: string, preset: MotionPreset = "rise"): TrackDraft {
  return Object.freeze({
    id: draftId("track"),
    targetId,
    preset,
    transformBox: "fill-box",
    originXPercent: 50,
    originYPercent: 50,
    easing: "ease-in-out",
    keyframes: presetKeyframes(preset),
  });
}

export function applyPreset(track: TrackDraft, preset: MotionPreset): TrackDraft {
  if (preset === "custom") return Object.freeze({ ...track, preset });
  return Object.freeze({ ...track, preset, keyframes: presetKeyframes(preset) });
}

function interpolatedFrame(left: KeyframeDraft, right: KeyframeDraft): KeyframeDraft {
  const average = (a: number, b: number): number => Math.round(((a + b) / 2) * 10000) / 10000;
  return frame(average(left.offset, right.offset), {
    opacity: average(left.opacity, right.opacity),
    translateX: average(left.translateX, right.translateX),
    translateY: average(left.translateY, right.translateY),
    scale: average(left.scale, right.scale),
    rotateDeg: average(left.rotateDeg, right.rotateDeg),
  });
}

export function addInterpolatedKeyframe(track: TrackDraft): TrackDraft {
  if (track.keyframes.length >= 100) throw new Error("A track cannot exceed 100 keyframes.");
  let gapIndex = 0;
  let gapSize = -1;
  for (let index = 0; index < track.keyframes.length - 1; index += 1) {
    const gap = track.keyframes[index + 1]!.offset - track.keyframes[index]!.offset;
    if (gap > gapSize) {
      gapIndex = index;
      gapSize = gap;
    }
  }
  if (gapSize <= 0.0001) throw new Error("There is no remaining offset space for another keyframe.");
  const left = track.keyframes[gapIndex]!;
  const right = track.keyframes[gapIndex + 1]!;
  const next = [
    ...track.keyframes.slice(0, gapIndex + 1),
    interpolatedFrame(left, right),
    ...track.keyframes.slice(gapIndex + 1),
  ];
  return Object.freeze({ ...track, preset: "custom", keyframes: Object.freeze(next) });
}

export function inspectSvgForMotion(source: string): ParsedMotionSource {
  if (source.includes("\0")) throw new Error("The SVG contains null bytes.");
  if (/<script\b/i.test(source)) throw new Error("Scripts are not permitted in a motion source.");
  if (/<foreignObject\b/i.test(source)) throw new Error("foreignObject is not permitted in a motion source.");
  if (/\son[a-z][a-z0-9:_-]*\s*=/i.test(source)) throw new Error("Inline event handlers are not permitted.");
  if (/(?:href|xlink:href)=["']\s*javascript:/i.test(source)) throw new Error("javascript: references are not permitted.");
  if (/(?:@import\s+|url\(\s*["']?https?:\/\/)/i.test(source)) throw new Error("External style references are not permitted.");
  if (/<animate(?:Transform|Motion)?\b|<set\b|@keyframes\s+|\banimation(?:-name)?\s*:/i.test(source)) {
    throw new Error("Use a clean static SVG revision; existing animation was detected.");
  }

  const parser = new DOMParser();
  const document = parser.parseFromString(source, "image/svg+xml");
  if (document.querySelector("parsererror") || document.documentElement.localName.toLowerCase() !== "svg") {
    throw new Error("The selected file is not a well-formed SVG document.");
  }

  const counts = new Map<string, number>();
  for (const element of Array.from(document.querySelectorAll("[id]"))) {
    const id = element.getAttribute("id")?.trim();
    if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const duplicates = [...counts.entries()].filter(([, count]) => count > 1).map(([id]) => id);
  if (duplicates.length > 0) {
    throw new Error(`Duplicate SVG IDs must be resolved before motion authoring: ${duplicates.join(", ")}.`);
  }

  for (const element of Array.from(document.querySelectorAll("[href], [xlink\\:href]"))) {
    const href = element.getAttribute("href") ?? element.getAttribute("xlink:href") ?? "";
    if (href && !href.startsWith("#") && !href.startsWith("data:")) {
      throw new Error("External asset references are not permitted in a motion source.");
    }
  }

  const targets: MotionTarget[] = [];
  let ignoredIdCount = 0;
  for (const element of Array.from(document.querySelectorAll("[id]"))) {
    const id = element.getAttribute("id")?.trim() ?? "";
    const tag = element.localName.toLowerCase();
    if (!SAFE_ID.test(id) || !GRAPHIC_ELEMENTS.has(tag)) {
      ignoredIdCount += 1;
      continue;
    }
    const inlineStyle = element.getAttribute("style") ?? "";
    targets.push(Object.freeze({
      id,
      tag,
      hasBaseTransform: element.hasAttribute("transform") || /(?:^|;)\s*transform\s*:/i.test(inlineStyle),
    }));
  }
  if (targets.length === 0) {
    throw new Error("The SVG needs at least one portable ID on a graphic element before motion can be authored.");
  }
  targets.sort((left, right) => left.id.localeCompare(right.id));
  const root = document.documentElement;
  return Object.freeze({
    targets: Object.freeze(targets),
    viewBox: root.getAttribute("viewBox"),
    width: root.getAttribute("width"),
    height: root.getAttribute("height"),
    ignoredIdCount,
  });
}

function assertInteger(value: number, minimum: number, maximum: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} to ${maximum}.`);
  }
}

function assertFinite(value: number, minimum: number, maximum: number, label: string): void {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be from ${minimum} to ${maximum}.`);
  }
}

function changed(frames: readonly KeyframeDraft[], property: keyof Omit<KeyframeDraft, "id" | "offset">): boolean {
  const first = frames[0]?.[property];
  return frames.some((item) => item[property] !== first);
}

export function buildMotionPlan(input: Readonly<{
  name: string;
  durationMs: number;
  delayMs: number;
  iterations: number | "infinite";
  direction: MotionDirection;
  fillMode: MotionFillMode;
  reducedMotion: ReducedMotionStrategy;
  tracks: readonly TrackDraft[];
  targets: readonly MotionTarget[];
}>): MotionPlan {
  const name = input.name.trim();
  if (!name || name.length > 120) throw new Error("Motion name must contain 1 to 120 characters.");
  assertInteger(input.durationMs, 16, 3_600_000, "Duration");
  assertInteger(input.delayMs, 0, 600_000, "Delay");
  if (input.iterations !== "infinite") assertInteger(input.iterations, 1, 10_000, "Iterations");
  if (input.tracks.length < 1 || input.tracks.length > 64) throw new Error("Add 1 to 64 motion tracks.");

  const targetById = new Map(input.targets.map((target) => [target.id, target]));
  const seenTargets = new Set<string>();
  const tracks = input.tracks.map((track, trackIndex) => {
    if (!targetById.has(track.targetId)) throw new Error(`Track ${trackIndex + 1} has no valid SVG target.`);
    if (seenTargets.has(track.targetId)) throw new Error(`Target #${track.targetId} is used by more than one track.`);
    seenTargets.add(track.targetId);
    assertFinite(track.originXPercent, -1000, 1000, `Track ${trackIndex + 1} origin X`);
    assertFinite(track.originYPercent, -1000, 1000, `Track ${trackIndex + 1} origin Y`);
    if (track.keyframes.length < 2 || track.keyframes.length > 100) {
      throw new Error(`Track ${trackIndex + 1} must contain 2 to 100 keyframes.`);
    }
    const frames = track.keyframes.map((item, frameIndex) => {
      assertFinite(item.offset, 0, 1, `Track ${trackIndex + 1}, frame ${frameIndex + 1} offset`);
      assertFinite(item.opacity, 0, 1, `Track ${trackIndex + 1}, frame ${frameIndex + 1} opacity`);
      assertFinite(item.translateX, -100000, 100000, `Track ${trackIndex + 1}, frame ${frameIndex + 1} translate X`);
      assertFinite(item.translateY, -100000, 100000, `Track ${trackIndex + 1}, frame ${frameIndex + 1} translate Y`);
      assertFinite(item.scale, 0.001, 1000, `Track ${trackIndex + 1}, frame ${frameIndex + 1} scale`);
      assertFinite(item.rotateDeg, -36000, 36000, `Track ${trackIndex + 1}, frame ${frameIndex + 1} rotation`);
      if (frameIndex > 0 && item.offset <= track.keyframes[frameIndex - 1]!.offset) {
        throw new Error(`Track ${trackIndex + 1} keyframe offsets must be strictly increasing.`);
      }
      return Object.freeze({
        offset: item.offset,
        opacity: item.opacity,
        translateX: item.translateX,
        translateY: item.translateY,
        scale: item.scale,
        rotateDeg: item.rotateDeg,
      });
    });
    if (frames[0]?.offset !== 0 || frames[frames.length - 1]?.offset !== 1) {
      throw new Error(`Track ${trackIndex + 1} must begin at offset 0 and end at offset 1.`);
    }
    const opacityChanged = changed(track.keyframes, "opacity");
    const transformChanged = ["translateX", "translateY", "scale", "rotateDeg"].some((property) =>
      changed(track.keyframes, property as keyof Omit<KeyframeDraft, "id" | "offset">),
    );
    if (!opacityChanged && !transformChanged) throw new Error(`Track ${trackIndex + 1} does not animate any value.`);
    if (transformChanged && targetById.get(track.targetId)?.hasBaseTransform) {
      throw new Error(`Target #${track.targetId} already has a base transform. Wrap it in a new ID-targeted group or animate opacity only.`);
    }
    return Object.freeze({
      targetId: track.targetId,
      transformBox: track.transformBox,
      originXPercent: track.originXPercent,
      originYPercent: track.originYPercent,
      easing: track.easing,
      keyframes: Object.freeze(frames),
    });
  });

  return Object.freeze({
    $schema: MOTION_SCHEMA_URL,
    version: "1.0",
    name,
    durationMs: input.durationMs,
    delayMs: input.delayMs,
    iterations: input.iterations,
    direction: input.direction,
    fillMode: input.fillMode,
    reducedMotion: input.reducedMotion,
    tracks: Object.freeze(tracks),
  });
}
