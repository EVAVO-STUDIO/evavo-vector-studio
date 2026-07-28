import { createHash } from "node:crypto";
import { inspectSvg } from "@evavo/vector-core";
import { MotionEngineError } from "./errors.js";
import {
  MOTION_CONTRACT_VERSION,
  type AnimatedSvgInspection,
  type AnimatedSvgMotionSpec,
  type AnimatedSvgResult,
  type MotionEasing,
  type MotionFinding,
  type NormalizedAnimatedSvgMotionSpec,
  type NormalizedMotionKeyframe,
  type NormalizedMotionTrack,
} from "./types.js";
import { validateAnimatedSvgMotionSpec } from "./validation.js";

const GENERATOR_VERSION = "0.4.0" as const;
const MOTION_MARKER = "data-evavo-motion-contract";

function bytes(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function count(source: string, expression: RegExp): number {
  return source.match(expression)?.length ?? 0;
}

function formatNumber(value: number, precision = 6): string {
  const rounded = Math.round(value * 10 ** precision) / 10 ** precision;
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

function formatOffset(value: number): string {
  return `${formatNumber(value * 100, 4)}%`;
}

function easingCss(value: MotionEasing): string {
  if (typeof value === "string") return value;
  return `cubic-bezier(${value.cubicBezier.map((item) => formatNumber(item)).join(",")})`;
}

function selector(targetId: string): string {
  return `[id="${targetId.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"]`;
}

function transform(frame: NormalizedMotionKeyframe): string {
  return [
    `translate(${formatNumber(frame.translateX)}px,${formatNumber(frame.translateY)}px)`,
    `rotate(${formatNumber(frame.rotateDeg)}deg)`,
    `scale(${formatNumber(frame.scale)})`,
  ].join(" ");
}

function frameDeclarations(track: NormalizedMotionTrack, frame: NormalizedMotionKeyframe): string {
  const declarations: string[] = [];
  if (track.animatesOpacity) declarations.push(`opacity:${formatNumber(frame.opacity)}`);
  if (track.animatesTransform) declarations.push(`transform:${transform(frame)}`);
  return declarations.join(";");
}

function animationRule(
  motionId: string,
  index: number,
  track: NormalizedMotionTrack,
  spec: NormalizedAnimatedSvgMotionSpec,
): string {
  const name = `evavo_${motionId}_${index}`;
  const properties = [
    `animation-name:${name}`,
    `animation-duration:${spec.durationMs}ms`,
    `animation-delay:${spec.delayMs}ms`,
    `animation-iteration-count:${spec.iterations}`,
    `animation-direction:${spec.direction}`,
    `animation-fill-mode:${spec.fillMode}`,
    `animation-timing-function:${easingCss(track.easing)}`,
  ];
  if (track.animatesTransform) {
    properties.push(`transform-box:${track.transformBox}`);
    properties.push(
      `transform-origin:${formatNumber(track.originXPercent)}% ${formatNumber(track.originYPercent)}%`,
    );
  }
  return `${selector(track.targetId)}{${properties.join(";")}}`;
}

function keyframesRule(motionId: string, index: number, track: NormalizedMotionTrack): string {
  const name = `evavo_${motionId}_${index}`;
  const frames = track.keyframes
    .map((frame) => `${formatOffset(frame.offset)}{${frameDeclarations(track, frame)}}`)
    .join("");
  return `@keyframes ${name}{${frames}}`;
}

function reducedRule(track: NormalizedMotionTrack, spec: NormalizedAnimatedSvgMotionSpec): string {
  const properties = ["animation:none!important"];
  if (spec.reducedMotion !== "source") {
    const frame = spec.reducedMotion === "first-frame"
      ? track.keyframes[0]!
      : track.keyframes[track.keyframes.length - 1]!;
    if (track.animatesOpacity) properties.push(`opacity:${formatNumber(frame.opacity)}!important`);
    if (track.animatesTransform) properties.push(`transform:${transform(frame)}!important`);
  }
  return `${selector(track.targetId)}{${properties.join(";")}}`;
}

function targetOpeningTags(source: string, targetId: string): readonly string[] {
  const tags: string[] = [];
  for (const match of source.matchAll(/<([A-Za-z][^<>]*?)>/g)) {
    const tag = match[0] ?? "";
    const id = tag.match(/\bid\s*=\s*(["'])(.*?)\1/i)?.[2];
    if (id === targetId) tags.push(tag);
  }
  return Object.freeze(tags);
}

function hasBaseTransform(tag: string): boolean {
  if (/\stransform\s*=/i.test(tag)) return true;
  const style = tag.match(/\sstyle\s*=\s*(["'])(.*?)\1/i)?.[2] ?? "";
  return /(?:^|;)\s*transform\s*:/i.test(style);
}

function assertSource(source: string, spec: NormalizedAnimatedSvgMotionSpec): void {
  const inspection = inspectSvg(source);
  if (!inspection.valid) {
    throw new MotionEngineError(
      "MOTION_SOURCE_INVALID",
      "Animated SVG generation requires a governed, structurally valid SVG source.",
      { findings: inspection.findings },
    );
  }
  if (
    new RegExp(`\\b${MOTION_MARKER}\\s*=`, "i").test(source) ||
    /<animate(?:Transform|Motion)?\b|<set\b|@keyframes\s+|\banimation(?:-name)?\s*:/i.test(source)
  ) {
    throw new MotionEngineError(
      "MOTION_SOURCE_ALREADY_ANIMATED",
      "The source already contains animation metadata or animation elements. Animate a clean governed SVG revision instead.",
    );
  }
  for (const track of spec.tracks) {
    const tags = targetOpeningTags(source, track.targetId);
    const occurrences = tags.length;
    if (occurrences === 0) {
      throw new MotionEngineError(
        "MOTION_TARGET_MISSING",
        `Motion target ${track.targetId} does not exist in the SVG.`,
        { targetId: track.targetId },
      );
    }
    if (occurrences !== 1) {
      throw new MotionEngineError(
        "MOTION_TARGET_DUPLICATE",
        `Motion target ${track.targetId} must resolve to exactly one SVG element.`,
        { targetId: track.targetId, occurrences },
      );
    }
    if (track.animatesTransform && hasBaseTransform(tags[0]!)) {
      throw new MotionEngineError(
        "MOTION_TARGET_BASE_TRANSFORM_UNSUPPORTED",
        `Motion target ${track.targetId} already has a base transform that CSS keyframes would replace.`,
        { targetId: track.targetId },
      );
    }
  }
}

function motionIdentity(source: string, spec: NormalizedAnimatedSvgMotionSpec): string {
  return createHash("sha256")
    .update(source, "utf8")
    .update("\0", "utf8")
    .update(JSON.stringify(spec), "utf8")
    .digest("hex")
    .slice(0, 16);
}

function injectMotion(source: string, motionId: string, styleId: string, css: string): string {
  const root = source.match(/<svg\b[^>]*>/i)?.[0];
  if (!root) {
    throw new MotionEngineError("MOTION_SOURCE_INVALID", "The SVG root element could not be located.");
  }
  if (new RegExp(`\\bid=["']${styleId}["']`, "i").test(source)) {
    throw new MotionEngineError(
      "MOTION_OUTPUT_INVALID",
      "The deterministic motion style identifier already exists in the source SVG.",
      { styleId },
    );
  }
  const decoratedRoot = root.replace(
    />$/,
    ` ${MOTION_MARKER}="${MOTION_CONTRACT_VERSION}" data-evavo-motion-id="${motionId}">`,
  );
  const decorated = source.replace(root, decoratedRoot);
  const rootEnd = decorated.indexOf(decoratedRoot) + decoratedRoot.length;
  const tail = decorated.slice(rootEnd);
  const metadataPrefix = tail.match(
    /^(?:\s*(?:<title\b[^>]*>[\s\S]*?<\/title>|<desc\b[^>]*>[\s\S]*?<\/desc>))*/i,
  )?.[0] ?? "";
  const insertionPoint = rootEnd + metadataPrefix.length;
  const style = `<style id="${styleId}" type="text/css">${css}</style>`;
  return `${decorated.slice(0, insertionPoint)}${style}${decorated.slice(insertionPoint)}`;
}

export function inspectAnimatedSvg(source: string): AnimatedSvgInspection {
  const sourceInspection = inspectSvg(source);
  const contractVersion = source.match(/\bdata-evavo-motion-contract=["']([^"']+)["']/i)?.[1] ?? null;
  const motionId = source.match(/\bdata-evavo-motion-id=["']([^"']+)["']/i)?.[1] ?? null;
  const styleId = source.match(/<style\b[^>]*\bid=["'](evavo-motion-[^"']+)["'][^>]*>/i)?.[1] ?? null;
  const keyframeRuleCount = count(source, /@keyframes\s+evavo_[A-Za-z0-9_]+/g);
  const targetRuleCount = count(source, /\[id="[A-Za-z_][A-Za-z0-9_.:-]*"\]\{animation-name:/g);
  const reducedMotionFallback = /@media\(prefers-reduced-motion:reduce\)\{/.test(source);
  const findings: MotionFinding[] = [];
  if (!sourceInspection.valid) {
    findings.push({
      code: "MOTION_SVG_INVALID",
      severity: "error",
      message: "The SVG fails governed structural inspection.",
    });
  }
  if (contractVersion !== MOTION_CONTRACT_VERSION) {
    findings.push({
      code: "MOTION_CONTRACT_MISSING",
      severity: "error",
      message: "EVAVO motion contract metadata is missing or unsupported.",
    });
  }
  if (!motionId || !styleId) {
    findings.push({
      code: "MOTION_METADATA_INCOMPLETE",
      severity: "error",
      message: "Motion identity or style metadata is incomplete.",
    });
  } else if (styleId !== `evavo-motion-${motionId}`) {
    findings.push({
      code: "MOTION_IDENTITY_MISMATCH",
      severity: "error",
      message: "The motion style identifier does not match the declared motion identity.",
    });
  }
  if (keyframeRuleCount < 1 || targetRuleCount < 1) {
    findings.push({
      code: "MOTION_RULES_MISSING",
      severity: "error",
      message: "Animation target or keyframe rules are missing.",
    });
  }
  if (!reducedMotionFallback) {
    findings.push({
      code: "MOTION_REDUCED_FALLBACK_MISSING",
      severity: "error",
      message: "A prefers-reduced-motion fallback is required.",
    });
  }
  if (/<script\b/i.test(source)) {
    findings.push({
      code: "MOTION_SCRIPT_PRESENT",
      severity: "error",
      message: "Generated motion must remain script-free.",
    });
  }
  return Object.freeze({
    valid: !findings.some((finding) => finding.severity === "error"),
    contractVersion,
    motionId,
    styleId,
    keyframeRuleCount,
    targetRuleCount,
    reducedMotionFallback,
    sourceInspection,
    findings: Object.freeze(findings),
  });
}

export function createAnimatedSvg(
  source: string,
  input: AnimatedSvgMotionSpec | unknown,
): AnimatedSvgResult {
  const spec = validateAnimatedSvgMotionSpec(input);
  assertSource(source, spec);
  const motionId = motionIdentity(source, spec);
  const styleId = `evavo-motion-${motionId}`;
  const animationRules = spec.tracks.map((track, index) => animationRule(motionId, index, track, spec));
  const keyframeRules = spec.tracks.map((track, index) => keyframesRule(motionId, index, track));
  const reducedRules = spec.tracks.map((track) => reducedRule(track, spec));
  const css = `${animationRules.join("")}${keyframeRules.join("")}@media(prefers-reduced-motion:reduce){${reducedRules.join("")}}`;
  const svg = injectMotion(source, motionId, styleId, css);
  const inspection = inspectAnimatedSvg(svg);
  if (!inspection.valid) {
    throw new MotionEngineError(
      "MOTION_OUTPUT_INVALID",
      "The generated animated SVG failed the governed motion inspection.",
      { findings: inspection.findings },
    );
  }
  const sourceInspection = inspectSvg(source);
  const warnings: MotionFinding[] = [
    ...(/<style\b/i.test(source)
      ? [{
          code: "MOTION_SOURCE_STYLE_REVIEW",
          severity: "warning" as const,
          message: "The source contains style rules that may affect motion targets and require compatibility review.",
        }]
      : []),
    {
      code: "MOTION_HUMAN_REVIEW_REQUIRED",
      severity: "warning",
      message: "Playback timing, transform origins, visual rhythm and brand character require human review before production use.",
    },
  ];
  return Object.freeze({
    svg,
    inspection,
    evidence: Object.freeze({
      contractVersion: MOTION_CONTRACT_VERSION,
      generator: Object.freeze({ name: "@evavo/motion-engine", version: GENERATOR_VERSION }),
      source: Object.freeze({
        bytes: bytes(source),
        sha256: sha256(source),
        inspection: sourceInspection,
      }),
      motion: Object.freeze({
        id: motionId,
        name: spec.name,
        durationMs: spec.durationMs,
        delayMs: spec.delayMs,
        iterations: spec.iterations,
        direction: spec.direction,
        fillMode: spec.fillMode,
        reducedMotion: spec.reducedMotion,
        trackCount: spec.tracks.length,
        keyframeCount: spec.tracks.reduce((total, track) => total + track.keyframes.length, 0),
        targets: Object.freeze(spec.tracks.map((track) => track.targetId)),
      }),
      output: Object.freeze({
        mimeType: "image/svg+xml",
        bytes: bytes(svg),
        sha256: sha256(svg),
        styleId,
        keyframeRuleCount: inspection.keyframeRuleCount,
      }),
      safety: Object.freeze({
        scriptsAdded: false,
        externalReferencesAdded: false,
        reducedMotionFallback: true,
        deterministicOutput: true,
      }),
      approval: "review-required",
      warnings: Object.freeze(warnings),
    }),
  });
}
