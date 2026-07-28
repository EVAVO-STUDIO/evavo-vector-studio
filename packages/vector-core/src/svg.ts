export type SvgFindingSeverity = "error" | "warning" | "info";

export type SvgFinding = Readonly<{
  code: string;
  severity: SvgFindingSeverity;
  message: string;
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
  scriptCount: number;
  foreignObjectCount: number;
  findings: readonly SvgFinding[];
}>;

export type SvgOptimisationResult = Readonly<{
  svg: string;
  beforeBytes: number;
  afterBytes: number;
  bytesSaved: number;
  inspection: SvgInspection;
}>;

const NUMBER = "[-+]?(?:\\d*\\.)?\\d+(?:[eE][-+]?\\d+)?";

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

export function inspectSvg(source: string): SvgInspection {
  const findings: SvgFinding[] = [];
  const trimmed = source.trim();
  const hasRoot = /^<svg\b/i.test(trimmed) && /<\/svg>\s*$/i.test(trimmed);
  const viewBox = parseViewBox(trimmed);
  const width = parseDimension(trimmed, "width");
  const height = parseDimension(trimmed, "height");
  const scriptCount = count(trimmed, /<script\b/gi);
  const foreignObjectCount = count(trimmed, /<foreignObject\b/gi);
  const embeddedRasterCount = count(trimmed, /<image\b[^>]+(?:href|xlink:href)=["']data:image\/(?:png|jpeg|webp|gif)/gi);

  if (!hasRoot) findings.push({ code: "SVG_ROOT_INVALID", severity: "error", message: "The document must contain one complete SVG root element." });
  if (!viewBox) findings.push({ code: "SVG_VIEWBOX_MISSING", severity: "warning", message: "A valid viewBox is required for reliable responsive scaling." });
  if (scriptCount > 0) findings.push({ code: "SVG_SCRIPT_PRESENT", severity: "error", message: "Scripts are not permitted in production vector assets." });
  if (foreignObjectCount > 0) findings.push({ code: "SVG_FOREIGN_OBJECT_PRESENT", severity: "error", message: "foreignObject content is not portable or safe for the governed output profile." });
  if (embeddedRasterCount > 0) findings.push({ code: "SVG_EMBEDDED_RASTER", severity: "warning", message: "The SVG embeds raster imagery and is not a fully reconstructed vector asset." });
  if (!/<title\b/i.test(trimmed)) findings.push({ code: "SVG_TITLE_MISSING", severity: "info", message: "Add a concise title when the asset conveys meaning." });

  return Object.freeze({
    valid: !findings.some((finding) => finding.severity === "error"),
    width,
    height,
    viewBox,
    pathCount: count(trimmed, /<path\b/gi),
    groupCount: count(trimmed, /<g\b/gi),
    gradientCount: count(trimmed, /<(?:linearGradient|radialGradient)\b/gi),
    filterCount: count(trimmed, /<filter\b/gi),
    embeddedRasterCount,
    scriptCount,
    foreignObjectCount,
    findings: Object.freeze(findings),
  });
}

export function optimiseSvg(source: string): SvgOptimisationResult {
  const beforeBytes = Buffer.byteLength(source, "utf8");
  const svg = source
    .replace(/^\uFEFF/, "")
    .replace(/<\?xml[^>]*>\s*/gi, "")
    .replace(/<!--(?!\[if)[\s\S]*?-->/g, "")
    .replace(/>\s+</g, "><")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+\/>/g, "/>")
    .trim();
  const afterBytes = Buffer.byteLength(svg, "utf8");
  return Object.freeze({
    svg,
    beforeBytes,
    afterBytes,
    bytesSaved: Math.max(0, beforeBytes - afterBytes),
    inspection: inspectSvg(svg),
  });
}
