import { inspectSvg, type SvgInspection } from "./svg.js";

export const SVG_PRINT_PREFLIGHT_CONTRACT_VERSION = "1.0" as const;

export type SvgPrintProfile =
  | "commercial"
  | "large-format"
  | "cut-vinyl"
  | "screen-print";

export type SvgPrintFindingSeverity = "error" | "warning" | "info";

export type SvgPrintFinding = Readonly<{
  code: string;
  severity: SvgPrintFindingSeverity;
  message: string;
}>;

export type SvgPrintPreflightOptions = Readonly<{
  profile?: SvgPrintProfile;
  trimWidthMm?: number;
  trimHeightMm?: number;
  bleedMm?: number;
  dimensionToleranceMm?: number;
  minimumStrokePt?: number;
  maximumProcessColours?: number;
  allowText?: boolean;
  allowEmbeddedRaster?: boolean;
  allowTransparency?: boolean;
}>;

export type SvgPrintLengthUnit =
  | "mm"
  | "cm"
  | "in"
  | "pt"
  | "pc"
  | "px"
  | "unitless";

export type SvgPrintLength = Readonly<{
  raw: string;
  value: number;
  unit: SvgPrintLengthUnit;
  millimetres: number;
  explicitPhysicalUnit: boolean;
}>;

export type SvgPrintPreflightResult = Readonly<{
  contractVersion: typeof SVG_PRINT_PREFLIGHT_CONTRACT_VERSION;
  profile: SvgPrintProfile;
  passed: boolean;
  approval: "review-required";
  sourceInspection: SvgInspection;
  canvas: Readonly<{
    width: SvgPrintLength | null;
    height: SvgPrintLength | null;
    widthMm: number | null;
    heightMm: number | null;
    explicitPhysicalUnits: boolean;
    viewBox: readonly [number, number, number, number] | null;
    physicalAspectRatio: number | null;
    viewBoxAspectRatio: number | null;
    aspectRatioDelta: number | null;
  }>;
  target: Readonly<{
    trimWidthMm: number | null;
    trimHeightMm: number | null;
    bleedMm: number;
    expectedCanvasWidthMm: number | null;
    expectedCanvasHeightMm: number | null;
    dimensionToleranceMm: number;
    dimensionsMatched: boolean | null;
  }>;
  features: Readonly<{
    textElementCount: number;
    embeddedRasterCount: number;
    gradientCount: number;
    filterCount: number;
    maskCount: number;
    clipPathCount: number;
    patternCount: number;
    transparencyCount: number;
    blendModeCount: number;
    cssVariableCount: number;
    currentColorCount: number;
    nonScalingStrokeCount: number;
    uniqueProcessColourCount: number;
  }>;
  strokes: Readonly<{
    minimumRequestedPt: number;
    strokedElementCount: number;
    measuredStrokeCount: number;
    implicitStrokeWidthCount: number;
    transformedStrokeCount: number;
    minimumMeasuredPt: number | null;
    belowMinimumCount: number;
  }>;
  colour: Readonly<{
    maximumProcessColours: number;
    uniqueProcessColours: readonly string[];
    unresolvedPaintTokenCount: number;
    cmykOrSpotColourProofAvailable: false;
  }>;
  findings: readonly SvgPrintFinding[];
}>;

export class SvgPrintPreflightError extends Error {
  readonly code: string;
  readonly details?: Readonly<Record<string, unknown>>;

  constructor(
    code: string,
    message: string,
    details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = "SvgPrintPreflightError";
    this.code = code;
    this.details = details;
  }
}

const NUMBER = "[-+]?(?:(?:\\d+\\.?\\d*)|(?:\\.\\d+))(?:[eE][-+]?\\d+)?";
const LENGTH = new RegExp(`^\\s*(${NUMBER})\\s*(mm|cm|in|pt|pc|px)?\\s*$`, "i");
const PROFILES = new Set<SvgPrintProfile>([
  "commercial",
  "large-format",
  "cut-vinyl",
  "screen-print",
]);
const DEFAULT_MINIMUM_STROKE_PT = 0.25;
const DEFAULT_DIMENSION_TOLERANCE_MM = 0.25;
const DEFAULT_MAXIMUM_PROCESS_COLOURS = 6;
const MAXIMUM_OPTION_DIMENSION_MM = 100_000;
const MAXIMUM_BLEED_MM = 100;
const MAXIMUM_STROKE_PT = 100;
const MAXIMUM_PROCESS_COLOURS = 256;
const ASPECT_RATIO_TOLERANCE = 0.005;

function fail(
  code: string,
  message: string,
  details?: Readonly<Record<string, unknown>>,
): never {
  throw new SvgPrintPreflightError(code, message, details);
}

function finiteNumber(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  field: string,
): number {
  const resolved = value ?? fallback;
  if (!Number.isFinite(resolved) || resolved < minimum || resolved > maximum) {
    fail(
      "SVG_PRINT_PREFLIGHT_OPTIONS_INVALID",
      `${field} must be a finite number from ${minimum} to ${maximum}.`,
      { field, value: resolved, minimum, maximum },
    );
  }
  return resolved;
}

function positiveOptionalDimension(
  value: number | undefined,
  field: string,
): number | null {
  if (value === undefined) return null;
  if (!Number.isFinite(value) || value <= 0 || value > MAXIMUM_OPTION_DIMENSION_MM) {
    fail(
      "SVG_PRINT_PREFLIGHT_OPTIONS_INVALID",
      `${field} must be greater than zero and no more than ${MAXIMUM_OPTION_DIMENSION_MM} mm.`,
      { field, value },
    );
  }
  return value;
}

function resolveOptions(options: SvgPrintPreflightOptions) {
  const profile = options.profile ?? "commercial";
  if (!PROFILES.has(profile)) {
    fail(
      "SVG_PRINT_PREFLIGHT_OPTIONS_INVALID",
      "profile must be commercial, large-format, cut-vinyl or screen-print.",
      { profile },
    );
  }
  const trimWidthMm = positiveOptionalDimension(options.trimWidthMm, "trimWidthMm");
  const trimHeightMm = positiveOptionalDimension(options.trimHeightMm, "trimHeightMm");
  if ((trimWidthMm === null) !== (trimHeightMm === null)) {
    fail(
      "SVG_PRINT_PREFLIGHT_OPTIONS_INVALID",
      "trimWidthMm and trimHeightMm must be supplied together.",
    );
  }
  const bleedMm = finiteNumber(
    options.bleedMm,
    0,
    0,
    MAXIMUM_BLEED_MM,
    "bleedMm",
  );
  if (bleedMm > 0 && trimWidthMm === null) {
    fail(
      "SVG_PRINT_PREFLIGHT_OPTIONS_INVALID",
      "bleedMm requires trimWidthMm and trimHeightMm.",
    );
  }
  return Object.freeze({
    profile,
    trimWidthMm,
    trimHeightMm,
    bleedMm,
    dimensionToleranceMm: finiteNumber(
      options.dimensionToleranceMm,
      DEFAULT_DIMENSION_TOLERANCE_MM,
      0,
      10,
      "dimensionToleranceMm",
    ),
    minimumStrokePt: finiteNumber(
      options.minimumStrokePt,
      DEFAULT_MINIMUM_STROKE_PT,
      0.01,
      MAXIMUM_STROKE_PT,
      "minimumStrokePt",
    ),
    maximumProcessColours: Math.round(
      finiteNumber(
        options.maximumProcessColours,
        DEFAULT_MAXIMUM_PROCESS_COLOURS,
        1,
        MAXIMUM_PROCESS_COLOURS,
        "maximumProcessColours",
      ),
    ),
    allowText: options.allowText === true,
    allowEmbeddedRaster: options.allowEmbeddedRaster === true,
    allowTransparency: options.allowTransparency === true,
  });
}

function millimetres(value: number, unit: SvgPrintLengthUnit): number {
  if (unit === "mm") return value;
  if (unit === "cm") return value * 10;
  if (unit === "in") return value * 25.4;
  if (unit === "pt") return value * (25.4 / 72);
  if (unit === "pc") return value * (25.4 / 6);
  return value * (25.4 / 96);
}

function pointsFromMillimetres(value: number): number {
  return value * (72 / 25.4);
}

function parseLength(raw: string | null): SvgPrintLength | null {
  if (!raw) return null;
  const match = raw.match(LENGTH);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) return null;
  const unit = ((match[2]?.toLowerCase() ?? "unitless") as SvgPrintLengthUnit);
  return Object.freeze({
    raw,
    value,
    unit,
    millimetres: millimetres(value, unit),
    explicitPhysicalUnit: !["px", "unitless"].includes(unit),
  });
}

function rootAttribute(source: string, name: string): string | null {
  const root = source.match(/<svg\b[^>]*>/i)?.[0] ?? "";
  const match = root.match(new RegExp(`\\b${name}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, "i"));
  return match?.[2]?.trim() ?? null;
}

function count(source: string, expression: RegExp): number {
  return source.match(expression)?.length ?? 0;
}

function countTransparency(source: string): number {
  let total = count(source, /\btransparent\b/gi);
  for (const match of source.matchAll(
    /\b(?:opacity|fill-opacity|stroke-opacity|stop-opacity)\s*=\s*(["'])\s*([-+]?(?:\d+\.?\d*|\.\d+))\s*\1/gi,
  )) {
    const value = Number(match[2]);
    if (Number.isFinite(value) && value < 0.999) total += 1;
  }
  for (const match of source.matchAll(
    /(?:^|[;{])\s*(?:opacity|fill-opacity|stroke-opacity|stop-opacity)\s*:\s*([-+]?(?:\d+\.?\d*|\.\d+))/gim,
  )) {
    const value = Number(match[1]);
    if (Number.isFinite(value) && value < 0.999) total += 1;
  }
  for (const match of source.matchAll(/rgba\([^)]*,\s*([-+]?(?:\d+\.?\d*|\.\d+))\s*\)/gi)) {
    const alpha = Number(match[1]);
    if (Number.isFinite(alpha) && alpha < 0.999) total += 1;
  }
  for (const match of source.matchAll(/hsla\([^)]*,\s*([-+]?(?:\d+\.?\d*|\.\d+))\s*\)/gi)) {
    const alpha = Number(match[1]);
    if (Number.isFinite(alpha) && alpha < 0.999) total += 1;
  }
  return total + count(source, /<mask\b/gi);
}

function normaliseHex(value: string): string {
  const lower = value.toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(lower)) {
    const [, r1, r2, g1, g2, b1, b2] = lower;
    if (r1 === r2 && g1 === g2 && b1 === b2) return `#${r1}${g1}${b1}`;
  }
  return lower;
}

function processColours(source: string): readonly string[] {
  const colours = new Set<string>();
  for (const match of source.matchAll(/#[0-9a-f]{3,8}\b/gi)) {
    colours.add(normaliseHex(match[0]));
  }
  for (const match of source.matchAll(/\b(?:rgb|rgba|hsl|hsla)\([^)]*\)/gi)) {
    colours.add(match[0].replace(/\s+/g, "").toLowerCase());
  }
  return Object.freeze([...colours].sort());
}

function strokeWidthFromTag(
  tag: string,
  canvasWidthMm: number | null,
  canvasHeightMm: number | null,
  viewBox: readonly [number, number, number, number] | null,
): number | null {
  const attribute = tag.match(/\bstroke-width\s*=\s*(["'])([\s\S]*?)\1/i)?.[2]?.trim();
  const style = tag.match(/\bstyle\s*=\s*(["'])([\s\S]*?)\1/i)?.[2]
    ?.match(/(?:^|;)\s*stroke-width\s*:\s*([^;]+)/i)?.[1]?.trim();
  const raw = attribute ?? style ?? null;
  if (!raw) return null;
  const parsed = parseLength(raw);
  if (!parsed) return null;
  if (parsed.explicitPhysicalUnit) return pointsFromMillimetres(parsed.millimetres);
  if (canvasWidthMm && canvasHeightMm && viewBox) {
    const millimetresPerUnit = Math.min(
      canvasWidthMm / viewBox[2],
      canvasHeightMm / viewBox[3],
    );
    return pointsFromMillimetres(parsed.value * millimetresPerUnit);
  }
  return parsed.value * 0.75;
}

function inspectStrokes(
  source: string,
  minimumStrokePt: number,
  canvasWidthMm: number | null,
  canvasHeightMm: number | null,
  viewBox: readonly [number, number, number, number] | null,
) {
  const widths: number[] = [];
  let strokedElementCount = 0;
  let implicitStrokeWidthCount = 0;
  let transformedStrokeCount = 0;
  const tags = source.match(/<(?:path|line|polyline|polygon|rect|circle|ellipse)\b[^>]*>/gi) ?? [];
  for (const tag of tags) {
    const strokeAttribute = tag.match(/\bstroke\s*=\s*(["'])([\s\S]*?)\1/i)?.[2]?.trim();
    const styleStroke = tag.match(/\bstyle\s*=\s*(["'])([\s\S]*?)\1/i)?.[2]
      ?.match(/(?:^|;)\s*stroke\s*:\s*([^;]+)/i)?.[1]?.trim();
    const stroke = strokeAttribute ?? styleStroke ?? null;
    if (!stroke || stroke.toLowerCase() === "none") continue;
    strokedElementCount += 1;
    if (/\btransform\s*=|\bvector-effect\s*=/i.test(tag)) transformedStrokeCount += 1;
    const width = strokeWidthFromTag(
      tag,
      canvasWidthMm,
      canvasHeightMm,
      viewBox,
    );
    if (width === null) implicitStrokeWidthCount += 1;
    else widths.push(width);
  }
  return Object.freeze({
    minimumRequestedPt: minimumStrokePt,
    strokedElementCount,
    measuredStrokeCount: widths.length,
    implicitStrokeWidthCount,
    transformedStrokeCount,
    minimumMeasuredPt: widths.length > 0 ? Math.min(...widths) : null,
    belowMinimumCount: widths.filter((value) => value < minimumStrokePt).length,
  });
}

function addFinding(
  findings: SvgPrintFinding[],
  code: string,
  severity: SvgPrintFindingSeverity,
  message: string,
): void {
  findings.push(Object.freeze({ code, severity, message }));
}

function profileRejectsComplexPaint(profile: SvgPrintProfile): boolean {
  return profile === "cut-vinyl" || profile === "screen-print";
}

export function preflightSvgForPrint(
  source: string,
  options: SvgPrintPreflightOptions = {},
): SvgPrintPreflightResult {
  const resolved = resolveOptions(options);
  const findings: SvgPrintFinding[] = [];
  const inspection = inspectSvg(source);
  const width = parseLength(rootAttribute(source, "width"));
  const height = parseLength(rootAttribute(source, "height"));
  const widthMm = width?.millimetres ?? null;
  const heightMm = height?.millimetres ?? null;
  const explicitPhysicalUnits = Boolean(
    width?.explicitPhysicalUnit && height?.explicitPhysicalUnit,
  );
  const physicalAspectRatio = widthMm && heightMm ? widthMm / heightMm : null;
  const viewBoxAspectRatio = inspection.viewBox
    ? inspection.viewBox[2] / inspection.viewBox[3]
    : null;
  const aspectRatioDelta =
    physicalAspectRatio && viewBoxAspectRatio
      ? Math.abs(physicalAspectRatio - viewBoxAspectRatio) / viewBoxAspectRatio
      : null;

  const trimWidthMm = resolved.trimWidthMm;
  const trimHeightMm = resolved.trimHeightMm;
  const expectedCanvasWidthMm =
    trimWidthMm === null ? null : trimWidthMm + resolved.bleedMm * 2;
  const expectedCanvasHeightMm =
    trimHeightMm === null ? null : trimHeightMm + resolved.bleedMm * 2;
  const dimensionsMatched =
    expectedCanvasWidthMm === null || expectedCanvasHeightMm === null
      ? null
      : widthMm === null || heightMm === null
        ? false
        : Math.abs(widthMm - expectedCanvasWidthMm) <= resolved.dimensionToleranceMm &&
          Math.abs(heightMm - expectedCanvasHeightMm) <= resolved.dimensionToleranceMm;

  const maskCount = count(source, /<mask\b/gi);
  const clipPathCount = count(source, /<clipPath\b/gi);
  const patternCount = count(source, /<pattern\b/gi);
  const transparencyCount = countTransparency(source);
  const blendModeCount = count(source, /\bmix-blend-mode\s*[:=]/gi);
  const cssVariableCount = count(source, /\bvar\(\s*--/gi);
  const currentColorCount = count(source, /\bcurrentColor\b/gi);
  const nonScalingStrokeCount = count(
    source,
    /\bvector-effect\s*=\s*(["'])\s*non-scaling-stroke\s*\1/gi,
  );
  const uniqueProcessColours = processColours(source);
  const unresolvedPaintTokenCount = cssVariableCount + currentColorCount;
  const strokes = inspectStrokes(
    source,
    resolved.minimumStrokePt,
    widthMm,
    heightMm,
    inspection.viewBox,
  );

  if (!inspection.valid) {
    addFinding(
      findings,
      "PRINT_SOURCE_SVG_INVALID",
      "error",
      "The source SVG fails the governed safety or reference inspection.",
    );
  }
  if (!inspection.viewBox) {
    addFinding(
      findings,
      "PRINT_VIEWBOX_REQUIRED",
      "error",
      "Print preflight requires a valid viewBox for geometry and scale comparison.",
    );
  }
  if (!width || !height) {
    addFinding(
      findings,
      "PRINT_CANVAS_DIMENSIONS_REQUIRED",
      "error",
      "Print delivery requires explicit positive width and height values.",
    );
  } else if (!explicitPhysicalUnits) {
    addFinding(
      findings,
      "PRINT_PHYSICAL_UNITS_REQUIRED",
      resolved.profile === "large-format" ? "warning" : "error",
      "Use mm, cm, in, pt or pc root dimensions so the intended physical output size is explicit.",
    );
  }
  if (aspectRatioDelta !== null && aspectRatioDelta > ASPECT_RATIO_TOLERANCE) {
    addFinding(
      findings,
      "PRINT_ASPECT_RATIO_MISMATCH",
      "error",
      "The physical canvas aspect ratio does not match the SVG viewBox and may distort at output.",
    );
  }
  if (dimensionsMatched === false) {
    addFinding(
      findings,
      "PRINT_TRIM_BLEED_DIMENSIONS_MISMATCH",
      "error",
      `The canvas must measure ${expectedCanvasWidthMm} × ${expectedCanvasHeightMm} mm for the requested trim and bleed within ${resolved.dimensionToleranceMm} mm.`,
    );
  } else if (dimensionsMatched === true) {
    addFinding(
      findings,
      "PRINT_TRIM_BLEED_DIMENSIONS_MATCH",
      "info",
      "The physical canvas matches the requested trim and bleed dimensions.",
    );
  } else if (resolved.profile === "commercial" || resolved.profile === "large-format") {
    addFinding(
      findings,
      "PRINT_TRIM_BLEED_NOT_VERIFIED",
      "info",
      "No trim and bleed target was supplied; final imposition remains a production review step.",
    );
  }

  if (inspection.topology.textElementCount > 0 && !resolved.allowText) {
    addFinding(
      findings,
      "PRINT_TEXT_REMAINS",
      profileRejectsComplexPaint(resolved.profile) ? "error" : "warning",
      "Text elements remain and can substitute, reflow or depend on unavailable fonts; outline approved display text or explicitly allow live text.",
    );
  }
  if (inspection.embeddedRasterCount > 0) {
    if (!resolved.allowEmbeddedRaster) {
      addFinding(
        findings,
        "PRINT_EMBEDDED_RASTER_REVIEW",
        profileRejectsComplexPaint(resolved.profile) ? "error" : "warning",
        "Embedded raster imagery prevents a fully vector print deliverable unless explicitly allowed.",
      );
    }
    addFinding(
      findings,
      "PRINT_RASTER_RESOLUTION_UNVERIFIED",
      "warning",
      "Embedded raster effective resolution cannot be proven from this SVG preflight alone.",
    );
  }
  if (inspection.gradientCount > 0) {
    addFinding(
      findings,
      "PRINT_GRADIENT_PRESENT",
      profileRejectsComplexPaint(resolved.profile) ? "error" : "warning",
      "Gradients require renderer, colour-conversion and separation review for the selected print process.",
    );
  }
  if (inspection.filterCount > 0) {
    addFinding(
      findings,
      "PRINT_FILTER_PRESENT",
      profileRejectsComplexPaint(resolved.profile) ? "error" : "warning",
      "SVG filters can rasterise or render differently across print workflows.",
    );
  }
  if (transparencyCount > 0 && !resolved.allowTransparency) {
    addFinding(
      findings,
      "PRINT_TRANSPARENCY_PRESENT",
      profileRejectsComplexPaint(resolved.profile) ? "error" : "warning",
      "Transparency requires flattening and overprint review unless explicitly allowed.",
    );
  }
  if (blendModeCount > 0) {
    addFinding(
      findings,
      "PRINT_BLEND_MODE_PRESENT",
      profileRejectsComplexPaint(resolved.profile) ? "error" : "warning",
      "Blend modes require renderer-specific flattening and separation review.",
    );
  }
  if (patternCount > 0) {
    addFinding(
      findings,
      "PRINT_PATTERN_PRESENT",
      profileRejectsComplexPaint(resolved.profile) ? "error" : "warning",
      "Pattern paint can expand or rasterise differently across print renderers.",
    );
  }
  if (maskCount > 0) {
    addFinding(
      findings,
      "PRINT_MASK_PRESENT",
      profileRejectsComplexPaint(resolved.profile) ? "error" : "warning",
      "Masks introduce transparency and flattening requirements.",
    );
  }
  if (clipPathCount > 0) {
    addFinding(
      findings,
      "PRINT_CLIP_PATH_PRESENT",
      resolved.profile === "cut-vinyl" ? "error" : "info",
      "Clip paths should be expanded when the destination requires direct production geometry.",
    );
  }
  if (unresolvedPaintTokenCount > 0) {
    addFinding(
      findings,
      "PRINT_CONTEXTUAL_PAINT_PRESENT",
      profileRejectsComplexPaint(resolved.profile) ? "error" : "warning",
      "currentColor or CSS variable paint depends on an external cascade and is not a self-contained print colour.",
    );
  }
  if (
    resolved.profile === "screen-print" &&
    uniqueProcessColours.length > resolved.maximumProcessColours
  ) {
    addFinding(
      findings,
      "PRINT_PROCESS_COLOUR_LIMIT_EXCEEDED",
      "error",
      `The artwork exposes ${uniqueProcessColours.length} process colours, above the configured screen-print limit of ${resolved.maximumProcessColours}.`,
    );
  }
  if (strokes.belowMinimumCount > 0) {
    addFinding(
      findings,
      "PRINT_STROKE_BELOW_MINIMUM",
      resolved.profile === "cut-vinyl" ? "error" : "warning",
      `${strokes.belowMinimumCount} measured stroke${strokes.belowMinimumCount === 1 ? " is" : "s are"} below ${resolved.minimumStrokePt} pt.`,
    );
  }
  if (strokes.implicitStrokeWidthCount > 0) {
    addFinding(
      findings,
      "PRINT_STROKE_WIDTH_IMPLICIT",
      "warning",
      "One or more stroked elements rely on an implicit width and cannot be fully preflighted.",
    );
  }
  if (strokes.transformedStrokeCount > 0 || nonScalingStrokeCount > 0) {
    addFinding(
      findings,
      "PRINT_TRANSFORMED_STROKE_REVIEW",
      "warning",
      "Transformed or non-scaling strokes require rendered line-weight review at final size.",
    );
  }
  if (
    (resolved.profile === "cut-vinyl" || resolved.profile === "screen-print") &&
    inspection.pathCount < 1
  ) {
    addFinding(
      findings,
      "PRINT_DIRECT_PATH_GEOMETRY_REQUIRED",
      "error",
      "The selected production profile requires direct path geometry.",
    );
  }
  addFinding(
    findings,
    "PRINT_COLOUR_SPACE_REVIEW_REQUIRED",
    "info",
    "SVG paint is not independent CMYK, spot-colour or overprint proof; final colour separation remains required.",
  );

  return Object.freeze({
    contractVersion: SVG_PRINT_PREFLIGHT_CONTRACT_VERSION,
    profile: resolved.profile,
    passed: !findings.some((finding) => finding.severity === "error"),
    approval: "review-required",
    sourceInspection: inspection,
    canvas: Object.freeze({
      width,
      height,
      widthMm,
      heightMm,
      explicitPhysicalUnits,
      viewBox: inspection.viewBox,
      physicalAspectRatio,
      viewBoxAspectRatio,
      aspectRatioDelta,
    }),
    target: Object.freeze({
      trimWidthMm,
      trimHeightMm,
      bleedMm: resolved.bleedMm,
      expectedCanvasWidthMm,
      expectedCanvasHeightMm,
      dimensionToleranceMm: resolved.dimensionToleranceMm,
      dimensionsMatched,
    }),
    features: Object.freeze({
      textElementCount: inspection.topology.textElementCount,
      embeddedRasterCount: inspection.embeddedRasterCount,
      gradientCount: inspection.gradientCount,
      filterCount: inspection.filterCount,
      maskCount,
      clipPathCount,
      patternCount,
      transparencyCount,
      blendModeCount,
      cssVariableCount,
      currentColorCount,
      nonScalingStrokeCount,
      uniqueProcessColourCount: uniqueProcessColours.length,
    }),
    strokes,
    colour: Object.freeze({
      maximumProcessColours: resolved.maximumProcessColours,
      uniqueProcessColours,
      unresolvedPaintTokenCount,
      cmykOrSpotColourProofAvailable: false,
    }),
    findings: Object.freeze(findings),
  });
}
