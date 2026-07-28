import { inspectSvg, type SvgInspection } from "@evavo/vector-core";
import { LottieEngineError } from "./errors.js";
import {
  parseSvgPathDataToLottie,
  type LottiePathBounds,
  type ParsedLottieSubpath,
} from "./path-data.js";

export type { LottiePathBounds } from "./path-data.js";

export type LottieSolidPaint = Readonly<{
  colour: readonly [number, number, number];
  opacity: number;
}>;

export type LottiePathStyle = Readonly<{
  fill: LottieSolidPaint | null;
  fillRule: 1 | 2;
  stroke: (LottieSolidPaint & Readonly<{
    width: number;
    lineCap: 1 | 2 | 3;
    lineJoin: 1 | 2 | 3;
  }>) | null;
}>;

export type ExtractedSvgPath = Readonly<{
  id: string | null;
  name: string;
  order: number;
  subpaths: readonly ParsedLottieSubpath[];
  bounds: LottiePathBounds;
  style: LottiePathStyle;
}>;

export type SvgRenderUnit = Readonly<{
  id: string;
  name: string;
  order: number;
  animatedTargetId: string | null;
  paths: readonly ExtractedSvgPath[];
  bounds: LottiePathBounds;
}>;

export type PreparedLottieSvgSource = Readonly<{
  viewBox: readonly [number, number, number, number];
  width: number;
  height: number;
  inspection: SvgInspection;
  renderUnits: readonly SvgRenderUnit[];
  pathElementCount: number;
}>;

type SvgNode = {
  name: string;
  attributes: Readonly<Record<string, string>>;
  children: SvgNode[];
  parent: SvgNode | null;
  order: number;
};

const UNSUPPORTED_ELEMENTS = new Set([
  "script",
  "foreignobject",
  "image",
  "text",
  "use",
  "lineargradient",
  "radialgradient",
  "filter",
  "clippath",
  "mask",
  "pattern",
  "symbol",
  "marker",
  "style",
  "rect",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
]);
const CONTAINER_ELEMENTS = new Set(["svg", "g", "defs", "title", "desc", "metadata"]);
const STYLE_PROPERTIES = new Set([
  "fill",
  "fill-opacity",
  "fill-rule",
  "stroke",
  "stroke-opacity",
  "stroke-width",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-dasharray",
  "opacity",
  "display",
  "visibility",
]);
const NAMED_COLOURS = Object.freeze<Record<string, readonly [number, number, number, number]>>({
  black: [0, 0, 0, 1],
  white: [1, 1, 1, 1],
  red: [1, 0, 0, 1],
  green: [0, 128 / 255, 0, 1],
  blue: [0, 0, 1, 1],
  transparent: [0, 0, 0, 0],
});
const EPSILON = 1e-9;

function unsupported(message: string, details: Readonly<Record<string, unknown>> = {}): LottieEngineError {
  return new LottieEngineError("LOTTIE_SOURCE_UNSUPPORTED", message, details);
}

function invalid(message: string, details: Readonly<Record<string, unknown>> = {}): LottieEngineError {
  return new LottieEngineError("LOTTIE_SOURCE_INVALID", message, details);
}

function decodeXml(value: string): string {
  return value.replace(/&(?:quot|apos|lt|gt|amp|#\d+|#x[0-9a-f]+);/gi, (entity) => {
    if (entity === "&quot;") return '"';
    if (entity === "&apos;") return "'";
    if (entity === "&lt;") return "<";
    if (entity === "&gt;") return ">";
    if (entity === "&amp;") return "&";
    const hexadecimal = /^&#x([0-9a-f]+);$/i.exec(entity);
    if (hexadecimal) return String.fromCodePoint(Number.parseInt(hexadecimal[1]!, 16));
    const decimal = /^&#(\d+);$/.exec(entity);
    if (decimal) return String.fromCodePoint(Number.parseInt(decimal[1]!, 10));
    return entity;
  });
}

function parseAttributes(source: string, elementName: string): Readonly<Record<string, string>> {
  const attributes: Record<string, string> = {};
  let offset = 0;
  while (offset < source.length) {
    while (offset < source.length && /\s/.test(source[offset]!)) offset += 1;
    if (offset >= source.length) break;
    const nameMatch = source.slice(offset).match(/^[:A-Za-z_][:A-Za-z0-9_.-]*/);
    if (!nameMatch) throw invalid("SVG contains an invalid attribute name.", { elementName, offset });
    const rawName = nameMatch[0];
    const name = rawName.toLowerCase();
    offset += rawName.length;
    while (offset < source.length && /\s/.test(source[offset]!)) offset += 1;
    if (source[offset] !== "=") throw invalid("SVG attributes must use explicit quoted values.", { elementName, attribute: rawName });
    offset += 1;
    while (offset < source.length && /\s/.test(source[offset]!)) offset += 1;
    const quote = source[offset];
    if (quote !== '"' && quote !== "'") throw invalid("SVG attribute values must be quoted.", { elementName, attribute: rawName });
    offset += 1;
    const valueStart = offset;
    while (offset < source.length && source[offset] !== quote) offset += 1;
    if (offset >= source.length) throw invalid("SVG contains an unterminated attribute value.", { elementName, attribute: rawName });
    if (Object.prototype.hasOwnProperty.call(attributes, name)) {
      throw invalid("SVG contains a duplicate attribute.", { elementName, attribute: rawName });
    }
    attributes[name] = decodeXml(source.slice(valueStart, offset));
    offset += 1;
  }
  return Object.freeze(attributes);
}

function readTag(source: string, start: number): Readonly<{ content: string; end: number }> {
  let quote: string | null = null;
  for (let offset = start + 1; offset < source.length; offset += 1) {
    const character = source[offset]!;
    if (quote) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === ">") return Object.freeze({ content: source.slice(start + 1, offset), end: offset + 1 });
  }
  throw invalid("SVG contains an unterminated element tag.", { start });
}

function parseSvgTree(source: string): SvgNode {
  const roots: SvgNode[] = [];
  const stack: SvgNode[] = [];
  let order = 0;
  let offset = 0;
  while (offset < source.length) {
    const open = source.indexOf("<", offset);
    if (open < 0) break;
    if (source.startsWith("<!--", open)) {
      const end = source.indexOf("-->", open + 4);
      if (end < 0) throw invalid("SVG contains an unterminated comment.");
      offset = end + 3;
      continue;
    }
    if (source.startsWith("<?", open)) {
      const end = source.indexOf("?>", open + 2);
      if (end < 0) throw invalid("SVG contains an unterminated processing instruction.");
      offset = end + 2;
      continue;
    }
    if (source.startsWith("<!", open)) {
      throw unsupported("DTD and CDATA declarations are not supported by the governed Lottie subset.");
    }
    const tag = readTag(source, open);
    offset = tag.end;
    const trimmed = tag.content.trim();
    if (!trimmed) throw invalid("SVG contains an empty tag.");
    if (trimmed.startsWith("/")) {
      const closingName = trimmed.slice(1).trim().toLowerCase();
      const current = stack.pop();
      if (!current || current.name !== closingName) {
        throw invalid("SVG element nesting is invalid.", { closingName, openElement: current?.name ?? null });
      }
      continue;
    }
    const selfClosing = /\/\s*$/.test(trimmed);
    const body = selfClosing ? trimmed.replace(/\/\s*$/, "").trim() : trimmed;
    const nameMatch = body.match(/^[:A-Za-z_][:A-Za-z0-9_.-]*/);
    if (!nameMatch) throw invalid("SVG contains an invalid element name.", { tag: body.slice(0, 40) });
    const rawName = nameMatch[0];
    const name = rawName.toLowerCase();
    const node: SvgNode = {
      name,
      attributes: parseAttributes(body.slice(rawName.length), rawName),
      children: [],
      parent: stack.at(-1) ?? null,
      order: order++,
    };
    if (node.parent) node.parent.children.push(node);
    else roots.push(node);
    if (!selfClosing) stack.push(node);
  }
  if (stack.length > 0) throw invalid("SVG contains unclosed elements.", { elements: stack.map((node) => node.name) });
  if (roots.length !== 1 || roots[0]?.name !== "svg") throw invalid("Lottie export requires exactly one SVG root element.");
  return roots[0];
}

function allNodes(root: SvgNode): readonly SvgNode[] {
  const nodes: SvgNode[] = [];
  const visit = (node: SvgNode): void => {
    nodes.push(node);
    node.children.forEach(visit);
  };
  visit(root);
  return Object.freeze(nodes);
}

function parseInlineStyle(node: SvgNode): Readonly<Record<string, string>> {
  const source = node.attributes.style;
  if (!source) return Object.freeze({});
  const properties: Record<string, string> = {};
  for (const rawDeclaration of source.split(";")) {
    const declaration = rawDeclaration.trim();
    if (!declaration) continue;
    const separator = declaration.indexOf(":");
    if (separator < 1) throw unsupported("Inline SVG style declarations must contain a property and value.", { element: node.name, declaration });
    const property = declaration.slice(0, separator).trim().toLowerCase();
    const value = declaration.slice(separator + 1).trim();
    if (!STYLE_PROPERTIES.has(property)) {
      throw unsupported("The governed Lottie subset does not support this inline SVG style property.", { property, element: node.name });
    }
    if (Object.prototype.hasOwnProperty.call(properties, property)) {
      throw unsupported("Duplicate inline SVG style properties are not supported.", { property, element: node.name });
    }
    properties[property] = value;
  }
  return Object.freeze(properties);
}

function ancestors(node: SvgNode): readonly SvgNode[] {
  const result: SvgNode[] = [];
  let current: SvgNode | null = node;
  while (current) {
    result.unshift(current);
    current = current.parent;
  }
  return Object.freeze(result);
}

function presentationValue(node: SvgNode, property: string): string | undefined {
  return parseInlineStyle(node)[property] ?? node.attributes[property];
}

function parseUnitInterval(value: string | undefined, fallback: number, property: string): number {
  if (value === undefined) return fallback;
  const trimmed = value.trim();
  const parsed = trimmed.endsWith("%") ? Number(trimmed.slice(0, -1)) / 100 : Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw unsupported(`${property} must be a number from 0 to 1 or a percentage from 0% to 100%.`, { property, value });
  }
  return parsed;
}

function parseLength(value: string | undefined, fallback: number, property: string): number {
  if (value === undefined) return fallback;
  const match = value.trim().match(/^([-+]?(?:(?:\d+(?:\.\d*)?)|(?:\.\d+))(?:[eE][+-]?\d+)?)(?:px)?$/i);
  if (!match) throw unsupported(`${property} must use unitless SVG user units or px.`, { property, value });
  const parsed = Number(match[1]);
  if (!Number.isFinite(parsed) || parsed < 0) throw unsupported(`${property} must be a non-negative finite number.`, { property, value });
  return parsed;
}

function component(value: string): number {
  const trimmed = value.trim();
  const parsed = trimmed.endsWith("%") ? (Number(trimmed.slice(0, -1)) / 100) : (Number(trimmed) / 255);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) throw unsupported("RGB colour components are outside their supported range.", { value });
  return parsed;
}

function alphaComponent(value: string): number {
  const trimmed = value.trim();
  const parsed = trimmed.endsWith("%") ? Number(trimmed.slice(0, -1)) / 100 : Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) throw unsupported("Alpha colour components are outside their supported range.", { value });
  return parsed;
}

function parseColour(value: string): readonly [number, number, number, number] | null {
  const normalized = value.trim().toLowerCase();
  if (normalized === "none") return null;
  const named = NAMED_COLOURS[normalized];
  if (named) return named;
  if (/^#[0-9a-f]{3,4}$/i.test(normalized)) {
    const values = normalized.slice(1).split("").map((digit) => Number.parseInt(digit + digit, 16) / 255);
    return Object.freeze([values[0]!, values[1]!, values[2]!, values[3] ?? 1]);
  }
  if (/^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(normalized)) {
    const hex = normalized.slice(1);
    return Object.freeze([
      Number.parseInt(hex.slice(0, 2), 16) / 255,
      Number.parseInt(hex.slice(2, 4), 16) / 255,
      Number.parseInt(hex.slice(4, 6), 16) / 255,
      hex.length === 8 ? Number.parseInt(hex.slice(6, 8), 16) / 255 : 1,
    ]);
  }
  const functional = normalized.match(/^rgba?\((.*)\)$/);
  if (functional) {
    const body = functional[1]!.trim();
    const slashParts = body.split("/").map((part) => part.trim());
    const colourParts = slashParts[0]!.includes(",")
      ? slashParts[0]!.split(",").map((part) => part.trim())
      : slashParts[0]!.split(/\s+/).filter(Boolean);
    let alpha = slashParts[1] ? alphaComponent(slashParts[1]) : 1;
    if (colourParts.length === 4 && slashParts.length === 1) alpha = alphaComponent(colourParts.pop()!);
    if (colourParts.length !== 3) throw unsupported("rgb() and rgba() colours must contain three colour components.", { value });
    return Object.freeze([component(colourParts[0]!), component(colourParts[1]!), component(colourParts[2]!), alpha]);
  }
  throw unsupported("The governed Lottie subset supports solid hex, rgb(), rgba(), and a small portable named-colour set.", { value });
}

function resolveStyle(node: SvgNode): LottiePathStyle {
  const chain = ancestors(node);
  let fillValue = "black";
  let fillOpacity = 1;
  let fillRule: 1 | 2 = 1;
  let strokeValue = "none";
  let strokeOpacity = 1;
  let strokeWidth = 1;
  let lineCap: 1 | 2 | 3 = 1;
  let lineJoin: 1 | 2 | 3 = 1;
  let pathOpacity = 1;

  for (const ancestor of chain) {
    const display = presentationValue(ancestor, "display")?.trim().toLowerCase();
    const visibility = presentationValue(ancestor, "visibility")?.trim().toLowerCase();
    if (display === "none" || visibility === "hidden" || visibility === "collapse") {
      throw unsupported("Hidden SVG nodes must be removed before governed Lottie export.", { element: ancestor.name, id: ancestor.attributes.id ?? null });
    }
    const dashArray = presentationValue(ancestor, "stroke-dasharray")?.trim().toLowerCase();
    if (dashArray && dashArray !== "none") throw unsupported("Dashed strokes are not supported by Lottie export v1.", { dashArray });
    const opacityValue = presentationValue(ancestor, "opacity");
    if (opacityValue !== undefined) {
      const opacity = parseUnitInterval(opacityValue, 1, "opacity");
      if (ancestor !== node && Math.abs(opacity - 1) > EPSILON) {
        throw unsupported("Group opacity cannot be flattened without changing overlap compositing.", { id: ancestor.attributes.id ?? null, opacity });
      }
      if (ancestor === node) pathOpacity = opacity;
    }
    const fill = presentationValue(ancestor, "fill");
    if (fill !== undefined) fillValue = fill;
    const fillOpacityValue = presentationValue(ancestor, "fill-opacity");
    if (fillOpacityValue !== undefined) fillOpacity = parseUnitInterval(fillOpacityValue, fillOpacity, "fill-opacity");
    const rule = presentationValue(ancestor, "fill-rule")?.trim().toLowerCase();
    if (rule !== undefined) {
      if (rule === "nonzero") fillRule = 1;
      else if (rule === "evenodd") fillRule = 2;
      else throw unsupported("fill-rule must be nonzero or evenodd.", { rule });
    }
    const stroke = presentationValue(ancestor, "stroke");
    if (stroke !== undefined) strokeValue = stroke;
    const strokeOpacityValue = presentationValue(ancestor, "stroke-opacity");
    if (strokeOpacityValue !== undefined) strokeOpacity = parseUnitInterval(strokeOpacityValue, strokeOpacity, "stroke-opacity");
    const width = presentationValue(ancestor, "stroke-width");
    if (width !== undefined) strokeWidth = parseLength(width, strokeWidth, "stroke-width");
    const cap = presentationValue(ancestor, "stroke-linecap")?.trim().toLowerCase();
    if (cap !== undefined) {
      if (cap === "butt") lineCap = 1;
      else if (cap === "round") lineCap = 2;
      else if (cap === "square") lineCap = 3;
      else throw unsupported("stroke-linecap must be butt, round, or square.", { cap });
    }
    const join = presentationValue(ancestor, "stroke-linejoin")?.trim().toLowerCase();
    if (join !== undefined) {
      if (join === "miter" || join === "miter-clip") lineJoin = 1;
      else if (join === "round" || join === "arcs") lineJoin = 2;
      else if (join === "bevel") lineJoin = 3;
      else throw unsupported("stroke-linejoin must be miter, round, or bevel.", { join });
    }
  }

  const fillColour = parseColour(fillValue);
  const strokeColour = parseColour(strokeValue);
  const fill = fillColour
    ? Object.freeze({ colour: Object.freeze(fillColour.slice(0, 3) as [number, number, number]), opacity: fillColour[3] * fillOpacity * pathOpacity })
    : null;
  const stroke = strokeColour && strokeWidth > 0
    ? Object.freeze({
        colour: Object.freeze(strokeColour.slice(0, 3) as [number, number, number]),
        opacity: strokeColour[3] * strokeOpacity * pathOpacity,
        width: strokeWidth,
        lineCap,
        lineJoin,
      })
    : null;
  if (!fill && !stroke) throw unsupported("A visible Lottie path requires a supported fill or stroke.", { id: node.attributes.id ?? null });
  return Object.freeze({ fill, fillRule, stroke });
}

function unionBounds(paths: readonly ExtractedSvgPath[]): LottiePathBounds {
  if (paths.length === 0) throw invalid("A Lottie render unit must contain at least one path.");
  return Object.freeze({
    minX: Math.min(...paths.map((item) => item.bounds.minX)),
    minY: Math.min(...paths.map((item) => item.bounds.minY)),
    maxX: Math.max(...paths.map((item) => item.bounds.maxX)),
    maxY: Math.max(...paths.map((item) => item.bounds.maxY)),
  });
}

function descendantPaths(node: SvgNode): readonly SvgNode[] {
  const paths: SvgNode[] = [];
  const visit = (current: SvgNode): void => {
    if (current.name === "path") paths.push(current);
    current.children.forEach(visit);
  };
  visit(node);
  return Object.freeze(paths);
}

function isAncestor(ancestor: SvgNode, node: SvgNode): boolean {
  let current = node.parent;
  while (current) {
    if (current === ancestor) return true;
    current = current.parent;
  }
  return false;
}

function extractPath(node: SvgNode, viewBox: readonly [number, number, number, number], precision: number): ExtractedSvgPath {
  const data = node.attributes.d;
  if (!data?.trim()) throw invalid("Every exported SVG path must contain path data.", { id: node.attributes.id ?? null });
  const parsed = parseSvgPathDataToLottie(data, { offsetX: viewBox[0], offsetY: viewBox[1], precision });
  const bounds = Object.freeze({
    minX: Math.min(...parsed.subpaths.map((item) => item.bounds.minX)),
    minY: Math.min(...parsed.subpaths.map((item) => item.bounds.minY)),
    maxX: Math.max(...parsed.subpaths.map((item) => item.bounds.maxX)),
    maxY: Math.max(...parsed.subpaths.map((item) => item.bounds.maxY)),
  });
  return Object.freeze({
    id: node.attributes.id ?? null,
    name: node.attributes.id ?? `path-${node.order}`,
    order: node.order,
    subpaths: parsed.subpaths,
    bounds,
    style: resolveStyle(node),
  });
}

export function prepareSvgSourceForLottie(
  source: string,
  targetIds: readonly string[],
  precision = 4,
): PreparedLottieSvgSource {
  const inspection = inspectSvg(source);
  if (!inspection.valid || !inspection.viewBox) {
    throw invalid("Lottie export requires a governed SVG with a valid viewBox.", { findings: inspection.findings });
  }
  const viewBox = inspection.viewBox;
  if (!Number.isSafeInteger(viewBox[2]) || !Number.isSafeInteger(viewBox[3]) || viewBox[2] < 1 || viewBox[3] < 1) {
    throw unsupported("Lottie export v1 requires integer viewBox width and height.", { viewBox });
  }
  const root = parseSvgTree(source);
  const nodes = allNodes(root);
  for (const node of nodes) {
    if (UNSUPPORTED_ELEMENTS.has(node.name)) {
      throw unsupported("The SVG contains an element outside the governed Lottie v1 subset.", { element: node.name, id: node.attributes.id ?? null });
    }
    if (node.name !== "path" && !CONTAINER_ELEMENTS.has(node.name)) {
      throw unsupported("The SVG contains an unknown element outside the governed Lottie v1 subset.", { element: node.name });
    }
    if (node.attributes.transform !== undefined) {
      throw unsupported("SVG transforms must be flattened into path geometry before Lottie export.", { element: node.name, id: node.attributes.id ?? null });
    }
    if (node.attributes["vector-effect"] !== undefined) {
      throw unsupported("SVG vector-effect is not supported by Lottie export v1.", { id: node.attributes.id ?? null });
    }
    if (node.attributes.href !== undefined || node.attributes["xlink:href"] !== undefined) {
      throw unsupported("Referenced SVG content is not supported by Lottie export v1.", { element: node.name, id: node.attributes.id ?? null });
    }
  }

  const idMap = new Map<string, SvgNode>();
  for (const node of nodes) {
    const id = node.attributes.id;
    if (id) {
      if (idMap.has(id)) throw invalid("Duplicate SVG IDs are not permitted for Lottie export.", { id });
      idMap.set(id, node);
    }
  }
  const targetNodes = new Map<string, SvgNode>();
  for (const targetId of targetIds) {
    const node = idMap.get(targetId);
    if (!node) throw new LottieEngineError("LOTTIE_TARGET_MISSING", `Motion target ${targetId} is missing from the SVG.`, { targetId });
    if (node.name !== "g" && node.name !== "path") {
      throw unsupported("Lottie motion targets must be path or group elements.", { targetId, element: node.name });
    }
    targetNodes.set(targetId, node);
  }
  const entries = [...targetNodes.entries()];
  for (let leftIndex = 0; leftIndex < entries.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < entries.length; rightIndex += 1) {
      const [leftId, leftNode] = entries[leftIndex]!;
      const [rightId, rightNode] = entries[rightIndex]!;
      if (isAncestor(leftNode, rightNode) || isAncestor(rightNode, leftNode)) {
        throw new LottieEngineError("LOTTIE_TARGET_OVERLAP", "Motion targets cannot contain one another in Lottie export v1.", { leftId, rightId });
      }
    }
  }

  const nodeToTarget = new Map<SvgNode, string>([...targetNodes.entries()].map(([id, node]) => [node, id]));
  const renderUnits: SvgRenderUnit[] = [];
  const pathCache = new Map<SvgNode, ExtractedSvgPath>();
  const extracted = (node: SvgNode): ExtractedSvgPath => {
    const cached = pathCache.get(node);
    if (cached) return cached;
    const value = extractPath(node, viewBox, precision);
    pathCache.set(node, value);
    return value;
  };

  const visit = (node: SvgNode): void => {
    const targetId = nodeToTarget.get(node);
    if (targetId) {
      const paths = descendantPaths(node).map(extracted);
      if (paths.length === 0) throw invalid("A Lottie motion target contains no paths.", { targetId });
      renderUnits.push(Object.freeze({
        id: targetId,
        name: targetId,
        order: node.order,
        animatedTargetId: targetId,
        paths: Object.freeze(paths),
        bounds: unionBounds(paths),
      }));
      return;
    }
    if (node.name === "path") {
      const path = extracted(node);
      renderUnits.push(Object.freeze({
        id: node.attributes.id ?? `static-path-${node.order}`,
        name: node.attributes.id ?? `Static path ${node.order}`,
        order: node.order,
        animatedTargetId: null,
        paths: Object.freeze([path]),
        bounds: path.bounds,
      }));
      return;
    }
    node.children.forEach(visit);
  };
  root.children.forEach(visit);

  for (const [targetId, targetNode] of targetNodes) {
    if (!renderUnits.some((unit) => unit.animatedTargetId === targetId)) {
      throw new LottieEngineError("LOTTIE_TARGET_DUPLICATE", "A motion target could not be assigned to exactly one render unit.", { targetId, order: targetNode.order });
    }
  }
  if (renderUnits.length === 0) throw invalid("The SVG contains no exportable path geometry.");

  return Object.freeze({
    viewBox,
    width: viewBox[2],
    height: viewBox[3],
    inspection,
    renderUnits: Object.freeze(renderUnits),
    pathElementCount: pathCache.size,
  });
}
