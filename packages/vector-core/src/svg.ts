import { inspectSvgTopology, type SvgTopologyInspection } from "./svg-topology.js";

export type SvgFindingSeverity = "error" | "warning" | "info";
export type SvgDeliveryProfile = "editable" | "web" | "motion" | "print";

export type SvgFinding = Readonly<{
  code: string;
  severity: SvgFindingSeverity;
  message: string;
}>;

export type SvgPathCommandCounts = Readonly<{
  move: number;
  line: number;
  horizontal: number;
  vertical: number;
  cubic: number;
  smoothCubic: number;
  quadratic: number;
  smoothQuadratic: number;
  arc: number;
  close: number;
}>;

export type SvgGeometryInspection = Readonly<{
  pathsWithData: number;
  pathsWithoutData: number;
  pathDataBytes: number;
  commandCount: number;
  estimatedAnchorCount: number;
  subpathCount: number;
  straightSegmentCount: number;
  curveSegmentCount: number;
  parseIssueCount: number;
  commands: SvgPathCommandCounts;
}>;

export type SvgInspection = Readonly<{
  valid: boolean;
  width: number | null;
  height: number | null;
  viewBox: readonly [number, number, number, number] | null;
  pathCount: number;
  groupCount: number;
  gradientCount: number;
  filterCount: number;
  embeddedRasterCount: number;
  externalRasterCount: number;
  scriptCount: number;
  foreignObjectCount: number;
  eventHandlerCount: number;
  javascriptHrefCount: number;
  externalStyleReferenceCount: number;
  geometry: SvgGeometryInspection;
  topology: SvgTopologyInspection;
  findings: readonly SvgFinding[];
}>;

export type SvgOptimisationOptions = Readonly<{
  profile?: SvgDeliveryProfile;
  stableIdPrefix?: string;
}>;

export type SvgOptimisationEvidence = Readonly<{
  profile: SvgDeliveryProfile;
  passes: readonly string[];
  stableIds: Readonly<{
    enabled: boolean;
    prefix: string | null;
    added: number;
    preserved: number;
    collisionSkips: number;
  }>;
  metadataElementsRemoved: number;
  paintValuesNormalised: number;
  rootDimensions: "preserved" | "removed-responsive" | "not-present";
  safetyRollbackApplied: boolean;
  inputValid: boolean;
  outputValid: boolean;
  localReferenceCountPreserved: boolean;
  unresolvedReferenceCountPreserved: boolean;
}>;

export type SvgOptimisationResult = Readonly<{
  svg: string;
  beforeBytes: number;
  afterBytes: number;
  bytesSaved: number;
  bytesDelta: number;
  inspection: SvgInspection;
  evidence: SvgOptimisationEvidence;
}>;

const NUMBER = "[-+]?(?:(?:\\d+\\.?\\d*)|(?:\\.\\d+))(?:[eE][-+]?\\d+)?";
const STABLE_ID_PREFIX = /^[A-Za-z_][A-Za-z0-9_.-]{0,47}$/;
const PATH_COMMAND_PARAMETERS: Readonly<Record<string, number>> = Object.freeze({
  M: 2,
  L: 2,
  H: 1,
  V: 1,
  C: 6,
  S: 4,
  Q: 4,
  T: 2,
  A: 7,
  Z: 0,
});

function parseDimension(source: string, name: "width" | "height"): number | null {
  const match = source.match(new RegExp(`\\b${name}=["'](${NUMBER})(?:px)?["']`, "i"));
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function count(source: string, expression: RegExp): number {
  return source.match(expression)?.length ?? 0;
}

function parseViewBox(source: string): readonly [number, number, number, number] | null {
  const match = source.match(new RegExp(`\\bviewBox=["']\\s*(${NUMBER})[ ,]+(${NUMBER})[ ,]+(${NUMBER})[ ,]+(${NUMBER})\\s*["']`, "i"));
  if (!match) return null;
  const values = match.slice(1).map(Number) as [number, number, number, number];
  return values.every(Number.isFinite) && values[2] > 0 && values[3] > 0 ? Object.freeze(values) : null;
}

type MutableCommands = {
  move: number;
  line: number;
  horizontal: number;
  vertical: number;
  cubic: number;
  smoothCubic: number;
  quadratic: number;
  smoothQuadratic: number;
  arc: number;
  close: number;
};

function emptyCommands(): MutableCommands {
  return {
    move: 0,
    line: 0,
    horizontal: 0,
    vertical: 0,
    cubic: 0,
    smoothCubic: 0,
    quadratic: 0,
    smoothQuadratic: 0,
    arc: 0,
    close: 0,
  };
}

function addCommand(commands: MutableCommands, command: string, segments: number): void {
  const upper = command.toUpperCase();
  if (upper === "M") commands.move += segments;
  else if (upper === "L") commands.line += segments;
  else if (upper === "H") commands.horizontal += segments;
  else if (upper === "V") commands.vertical += segments;
  else if (upper === "C") commands.cubic += segments;
  else if (upper === "S") commands.smoothCubic += segments;
  else if (upper === "Q") commands.quadratic += segments;
  else if (upper === "T") commands.smoothQuadratic += segments;
  else if (upper === "A") commands.arc += segments;
  else if (upper === "Z") commands.close += segments;
}

function inspectGeometry(source: string, pathCount: number): SvgGeometryInspection {
  const commands = emptyCommands();
  const pathExpression = /<path\b[^>]*\bd\s*=\s*(["'])([\s\S]*?)\1/gi;
  const commandExpression = /([AaCcHhLlMmQqSsTtVvZz])([^AaCcHhLlMmQqSsTtVvZz]*)/g;
  const numberExpression = new RegExp(NUMBER, "g");
  let pathsWithData = 0;
  let pathDataBytes = 0;
  let commandCount = 0;
  let estimatedAnchorCount = 0;
  let parseIssueCount = 0;

  for (const pathMatch of source.matchAll(pathExpression)) {
    pathsWithData += 1;
    const pathData = pathMatch[2] ?? "";
    pathDataBytes += Buffer.byteLength(pathData, "utf8");
    let foundCommand = false;
    for (const commandMatch of pathData.matchAll(commandExpression)) {
      foundCommand = true;
      const command = commandMatch[1] ?? "";
      const upper = command.toUpperCase();
      const parameterCount = PATH_COMMAND_PARAMETERS[upper];
      if (parameterCount === undefined) {
        parseIssueCount += 1;
        continue;
      }
      if (parameterCount === 0) {
        addCommand(commands, command, 1);
        commandCount += 1;
        continue;
      }
      const numericArguments = commandMatch[2]?.match(numberExpression)?.length ?? 0;
      const segmentCount = Math.floor(numericArguments / parameterCount);
      if (segmentCount === 0 || numericArguments % parameterCount !== 0) parseIssueCount += 1;
      if (upper === "M" && segmentCount > 0) {
        addCommand(commands, command, 1);
        if (segmentCount > 1) commands.line += segmentCount - 1;
        commandCount += segmentCount;
        estimatedAnchorCount += segmentCount;
      } else {
        addCommand(commands, command, segmentCount);
        commandCount += segmentCount;
        estimatedAnchorCount += segmentCount;
      }
    }
    if (!foundCommand && pathData.trim()) parseIssueCount += 1;
  }

  const straightSegmentCount = commands.line + commands.horizontal + commands.vertical;
  const curveSegmentCount = commands.cubic + commands.smoothCubic + commands.quadratic + commands.smoothQuadratic + commands.arc;
  return Object.freeze({
    pathsWithData,
    pathsWithoutData: Math.max(0, pathCount - pathsWithData),
    pathDataBytes,
    commandCount,
    estimatedAnchorCount,
    subpathCount: commands.move,
    straightSegmentCount,
    curveSegmentCount,
    parseIssueCount,
    commands: Object.freeze(commands),
  });
}

export function inspectSvg(source: string): SvgInspection {
  const findings: SvgFinding[] = [];
  const trimmed = source.trim();
  const hasRoot = /^<svg\b/i.test(trimmed) && /<\/svg>\s*$/i.test(trimmed);
  const viewBox = parseViewBox(trimmed);
  const width = parseDimension(trimmed, "width");
  const height = parseDimension(trimmed, "height");
  const pathCount = count(trimmed, /<path\b/gi);
  const scriptCount = count(trimmed, /<script\b/gi);
  const foreignObjectCount = count(trimmed, /<foreignObject\b/gi);
  const embeddedRasterCount = count(trimmed, /<image\b[^>]+(?:href|xlink:href)=["']data:image\/(?:png|jpeg|webp|gif)/gi);
  const externalRasterCount = count(trimmed, /<image\b[^>]+(?:href|xlink:href)=["'](?!data:|#)[^"']+/gi);
  const eventHandlerCount = count(trimmed, /\son[a-z][a-z0-9:_-]*\s*=/gi);
  const javascriptHrefCount = count(trimmed, /(?:href|xlink:href)=["']\s*javascript:/gi);
  const externalStyleReferenceCount = count(trimmed, /(?:@import\s+|url\(\s*["']?https?:\/\/)/gi);
  const geometry = inspectGeometry(trimmed, pathCount);
  const topology = inspectSvgTopology(trimmed);

  if (!hasRoot) findings.push({ code: "SVG_ROOT_INVALID", severity: "error", message: "The document must contain one complete SVG root element." });
  if (!viewBox) findings.push({ code: "SVG_VIEWBOX_MISSING", severity: "warning", message: "A valid viewBox is required for reliable responsive scaling." });
  if (scriptCount > 0) findings.push({ code: "SVG_SCRIPT_PRESENT", severity: "error", message: "Scripts are not permitted in production vector assets." });
  if (foreignObjectCount > 0) findings.push({ code: "SVG_FOREIGN_OBJECT_PRESENT", severity: "error", message: "foreignObject content is not portable or safe for the governed output profile." });
  if (eventHandlerCount > 0) findings.push({ code: "SVG_EVENT_HANDLER_PRESENT", severity: "error", message: "Inline event handlers are not permitted in governed SVG output." });
  if (javascriptHrefCount > 0) findings.push({ code: "SVG_JAVASCRIPT_HREF_PRESENT", severity: "error", message: "javascript: references are not permitted in governed SVG output." });
  if (externalRasterCount > 0) findings.push({ code: "SVG_EXTERNAL_RASTER", severity: "error", message: "External raster references make the asset network-dependent and are not permitted." });
  if (externalStyleReferenceCount > 0) findings.push({ code: "SVG_EXTERNAL_STYLE_REFERENCE", severity: "error", message: "External stylesheet and URL references are not permitted in governed SVG output." });
  if (topology.duplicateIdCount > 0) findings.push({ code: "SVG_DUPLICATE_ID", severity: "error", message: `${topology.duplicateIdCount} duplicate ID occurrence${topology.duplicateIdCount === 1 ? "" : "s"} can make references ambiguous.` });
  if (topology.unresolvedReferenceCount > 0) findings.push({ code: "SVG_LOCAL_REFERENCE_UNRESOLVED", severity: "error", message: `${topology.unresolvedReferenceCount} local reference${topology.unresolvedReferenceCount === 1 ? "" : "s"} do not resolve to an element ID.` });
  if (embeddedRasterCount > 0) findings.push({ code: "SVG_EMBEDDED_RASTER", severity: "warning", message: "The SVG embeds raster imagery and is not a fully reconstructed vector asset." });
  if (geometry.pathsWithoutData > 0) findings.push({ code: "SVG_PATH_DATA_MISSING", severity: "warning", message: "One or more path elements do not contain path data." });
  if (geometry.parseIssueCount > 0) findings.push({ code: "SVG_PATH_PARSE_ISSUE", severity: "warning", message: "One or more path command sequences could not be counted exactly." });
  if (geometry.estimatedAnchorCount > 25_000) findings.push({ code: "SVG_ANCHOR_COUNT_HIGH", severity: "warning", message: "The estimated anchor count is high enough to impair editing and web delivery." });
  if (topology.textElementCount > 0) findings.push({ code: "SVG_TEXT_NOT_OUTLINED", severity: "warning", message: "Text elements remain in the SVG and may depend on unavailable fonts or change across renderers." });
  if (topology.duplicatePathDataCount > 0) findings.push({ code: "SVG_DUPLICATE_PATH_DATA", severity: "warning", message: `${topology.duplicatePathDataCount} path occurrence${topology.duplicatePathDataCount === 1 ? "" : "s"} duplicate existing path data and may be redundant.` });
  if (topology.potentialOpenFilledPathCount > 0) findings.push({ code: "SVG_OPEN_FILLED_SUBPATH", severity: "info", message: `${topology.potentialOpenFilledPathCount} path${topology.potentialOpenFilledPathCount === 1 ? "" : "s"} contain open subpaths with a potential fill; inspect implicit closing edges before approval.` });
  if (topology.useElementCount > 0) findings.push({ code: "SVG_USE_INSTANCE_PRESENT", severity: "info", message: "The SVG contains use instances; expand them when direct per-shape editing is required." });
  if (topology.styleElementCount > 0) findings.push({ code: "SVG_STYLE_BLOCK_PRESENT", severity: "info", message: "The SVG contains a style block; verify that editing and target renderers preserve its cascade." });
  if (!/<title\b/i.test(trimmed)) findings.push({ code: "SVG_TITLE_MISSING", severity: "info", message: "Add a concise title when the asset conveys meaning." });

  return Object.freeze({
    valid: !findings.some((finding) => finding.severity === "error"),
    width,
    height,
    viewBox,
    pathCount,
    groupCount: count(trimmed, /<g\b/gi),
    gradientCount: count(trimmed, /<(?:linearGradient|radialGradient)\b/gi),
    filterCount: count(trimmed, /<filter\b/gi),
    embeddedRasterCount,
    externalRasterCount,
    scriptCount,
    foreignObjectCount,
    eventHandlerCount,
    javascriptHrefCount,
    externalStyleReferenceCount,
    geometry,
    topology,
    findings: Object.freeze(findings),
  });
}

function normaliseDocument(source: string): string {
  return source
    .replace(/^\uFEFF/, "")
    .replace(/<\?xml[^>]*>\s*/gi, "")
    .replace(/<!--(?!\[if)[\s\S]*?-->/g, "")
    .replace(/>\s+</g, "><")
    .replace(/\s+\/>/g, "/>")
    .trim();
}

function profileAddsStableIds(profile: SvgDeliveryProfile): boolean {
  return profile === "editable" || profile === "motion";
}

function resolveStableIdPrefix(profile: SvgDeliveryProfile, requested?: string): string {
  const prefix = requested?.trim() || (profile === "motion" ? "motion-shape" : "vector-shape");
  if (!STABLE_ID_PREFIX.test(prefix)) {
    throw new Error("SVG_STABLE_ID_PREFIX_INVALID");
  }
  return prefix;
}

function addStablePathIds(
  source: string,
  enabled: boolean,
  prefix: string | null,
): Readonly<{ svg: string; added: number; preserved: number; collisionSkips: number }> {
  const existingIds = new Set<string>();
  for (const match of source.matchAll(/\sid\s*=\s*(["'])([\s\S]*?)\1/gi)) {
    const id = match[2]?.trim();
    if (id) existingIds.add(id);
  }

  let added = 0;
  let preserved = 0;
  let collisionSkips = 0;
  let pathPosition = 0;
  const svg = source.replace(/<path\b[^>]*>/gi, (tag) => {
    pathPosition += 1;
    if (/\sid\s*=\s*(["'])/i.test(tag)) {
      preserved += 1;
      return tag;
    }
    if (!enabled || !prefix) return tag;

    const base = `${prefix}-${String(pathPosition).padStart(4, "0")}`;
    let candidate = base;
    let suffix = 2;
    while (existingIds.has(candidate)) {
      collisionSkips += 1;
      candidate = `${base}-${suffix}`;
      suffix += 1;
    }
    existingIds.add(candidate);
    added += 1;
    return tag.replace(/^<path\b/i, `<path id="${candidate}"`);
  });

  return Object.freeze({ svg, added, preserved, collisionSkips });
}

function canonicalHex(value: string): string {
  const lower = value.toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(lower)) {
    const [, r1, r2, g1, g2, b1, b2] = lower;
    if (r1 === r2 && g1 === g2 && b1 === b2) return `#${r1}${g1}${b1}`;
  }
  return lower;
}

function normalisePaintValues(source: string): Readonly<{ svg: string; count: number }> {
  let normalised = 0;
  const svg = source.replace(
    /(\s)(fill|stroke|stop-color|flood-color|lighting-color|color)\s*=\s*(["'])(#[0-9a-fA-F]{3,8})\3/gi,
    (_match, whitespace: string, name: string, quote: string, value: string) => {
      const canonical = canonicalHex(value);
      if (canonical !== value) normalised += 1;
      return `${whitespace}${name.toLowerCase()}=${quote}${canonical}${quote}`;
    },
  );
  return Object.freeze({ svg, count: normalised });
}

function removeMetadata(source: string): Readonly<{ svg: string; count: number }> {
  let removed = 0;
  const svg = source.replace(/<metadata\b[^>]*\/>|<metadata\b[^>]*>[\s\S]*?<\/metadata>/gi, () => {
    removed += 1;
    return "";
  });
  return Object.freeze({ svg, count: removed });
}

function removeResponsiveRootDimensions(source: string): Readonly<{
  svg: string;
  state: "preserved" | "removed-responsive" | "not-present";
}> {
  const root = source.match(/^<svg\b[^>]*>/i)?.[0] ?? "";
  const hasWidthOrHeight = /\s(?:width|height)\s*=\s*(["'])/i.test(root);
  if (!hasWidthOrHeight) return Object.freeze({ svg: source, state: "not-present" });
  const updatedRoot = root.replace(/\s(?:width|height)\s*=\s*(["'])[^"']*\1/gi, "");
  return Object.freeze({
    svg: source.replace(root, updatedRoot),
    state: updatedRoot === root ? "preserved" : "removed-responsive",
  });
}

export function optimiseSvg(
  source: string,
  options: SvgOptimisationOptions = {},
): SvgOptimisationResult {
  const beforeBytes = Buffer.byteLength(source, "utf8");
  const profile = options.profile ?? "editable";
  const inputInspection = inspectSvg(source);
  const passes: string[] = ["document-normalisation"];
  let svg = normaliseDocument(source);

  const stableIdsEnabled = profileAddsStableIds(profile);
  const stableIdPrefix = stableIdsEnabled ? resolveStableIdPrefix(profile, options.stableIdPrefix) : null;
  const stable = addStablePathIds(svg, stableIdsEnabled, stableIdPrefix);
  svg = stable.svg;
  if (stableIdsEnabled) passes.push("stable-path-ids");

  let metadataElementsRemoved = 0;
  let paintValuesNormalised = 0;
  let rootDimensions: SvgOptimisationEvidence["rootDimensions"] = /\s(?:width|height)\s*=\s*(["'])/i.test(svg.match(/^<svg\b[^>]*>/i)?.[0] ?? "")
    ? "preserved"
    : "not-present";
  const stableInspection = inspectSvg(svg);

  if (profile === "web" || profile === "motion") {
    const metadata = removeMetadata(svg);
    svg = metadata.svg;
    metadataElementsRemoved = metadata.count;
    if (metadata.count > 0) passes.push("metadata-removal");
  }

  const paint = normalisePaintValues(svg);
  svg = paint.svg;
  paintValuesNormalised = paint.count;
  if (paint.count > 0) passes.push("paint-value-normalisation");

  if ((profile === "web" || profile === "motion") && stableInspection.viewBox) {
    const dimensions = removeResponsiveRootDimensions(svg);
    svg = dimensions.svg;
    rootDimensions = dimensions.state;
    if (dimensions.state === "removed-responsive") passes.push("responsive-root-dimensions");
  }

  let inspection = inspectSvg(svg);
  let safetyRollbackApplied = false;
  if (stableInspection.valid && !inspection.valid) {
    svg = stable.svg;
    inspection = stableInspection;
    metadataElementsRemoved = 0;
    paintValuesNormalised = 0;
    rootDimensions = /\s(?:width|height)\s*=\s*(["'])/i.test(svg.match(/^<svg\b[^>]*>/i)?.[0] ?? "")
      ? "preserved"
      : "not-present";
    passes.splice(stableIdsEnabled ? 2 : 1);
    passes.push("safety-rollback");
    safetyRollbackApplied = true;
  }

  const afterBytes = Buffer.byteLength(svg, "utf8");
  return Object.freeze({
    svg,
    beforeBytes,
    afterBytes,
    bytesSaved: Math.max(0, beforeBytes - afterBytes),
    bytesDelta: afterBytes - beforeBytes,
    inspection,
    evidence: Object.freeze({
      profile,
      passes: Object.freeze(passes),
      stableIds: Object.freeze({
        enabled: stableIdsEnabled,
        prefix: stableIdPrefix,
        added: stable.added,
        preserved: stable.preserved,
        collisionSkips: stable.collisionSkips,
      }),
      metadataElementsRemoved,
      paintValuesNormalised,
      rootDimensions,
      safetyRollbackApplied,
      inputValid: inputInspection.valid,
      outputValid: inspection.valid,
      localReferenceCountPreserved:
        inputInspection.topology.localReferenceCount === inspection.topology.localReferenceCount,
      unresolvedReferenceCountPreserved:
        inputInspection.topology.unresolvedReferenceCount === inspection.topology.unresolvedReferenceCount,
    }),
  });
}
