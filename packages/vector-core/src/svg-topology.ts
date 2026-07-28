export type SvgTopologyInspection = Readonly<{
  idCount: number;
  uniqueIdCount: number;
  duplicateIdCount: number;
  localReferenceCount: number;
  unresolvedReferenceCount: number;
  pathElementCount: number;
  duplicatePathDataCount: number;
  compoundPathCount: number;
  closedSubpathCount: number;
  openSubpathCount: number;
  potentialOpenFilledPathCount: number;
  evenOddFillPathCount: number;
  textElementCount: number;
  useElementCount: number;
  styleElementCount: number;
  symbolElementCount: number;
  clipPathCount: number;
  maskCount: number;
  transformedElementCount: number;
  nonPathShapeCount: number;
}>;

const OPENING_TAG = /<[A-Za-z][^>]*>/g;
const PATH_TAG = /<path\b[^>]*>/gi;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function attributeValue(tag: string, name: string): string | null {
  const expression = new RegExp(`\\s${escapeRegExp(name)}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, "i");
  return tag.match(expression)?.[2] ?? null;
}

function styleProperty(tag: string, name: string): string | null {
  const style = attributeValue(tag, "style");
  if (!style) return null;
  const expected = name.trim().toLowerCase();
  for (const declaration of style.split(";")) {
    const separator = declaration.indexOf(":");
    if (separator < 0) continue;
    const property = declaration.slice(0, separator).trim().toLowerCase();
    if (property === expected) return declaration.slice(separator + 1).trim();
  }
  return null;
}

function normalisePathData(pathData: string): string {
  return pathData
    .trim()
    .replace(/[\s,]+/g, " ")
    .replace(/\s*([AaCcHhLlMmQqSsTtVvZz])\s*/g, "$1");
}

function count(source: string, expression: RegExp): number {
  return source.match(expression)?.length ?? 0;
}

export function inspectSvgTopology(source: string): SvgTopologyInspection {
  const ids: string[] = [];
  const localReferences: string[] = [];
  let transformedElementCount = 0;

  for (const tagMatch of source.matchAll(OPENING_TAG)) {
    const tag = tagMatch[0] ?? "";
    const id = attributeValue(tag, "id")?.trim();
    if (id) ids.push(id);

    for (const attribute of ["href", "xlink:href"] as const) {
      const reference = attributeValue(tag, attribute)?.trim();
      if (reference?.startsWith("#") && reference.length > 1) localReferences.push(reference.slice(1));
    }

    if (attributeValue(tag, "transform") !== null) transformedElementCount += 1;
  }

  for (const referenceMatch of source.matchAll(/url\(\s*["']?#([^)'"\s]+)["']?\s*\)/gi)) {
    const reference = referenceMatch[1]?.trim();
    if (reference) localReferences.push(reference);
  }

  const uniqueIds = new Set(ids);
  const seenPathData = new Map<string, number>();
  let pathElementCount = 0;
  let duplicatePathDataCount = 0;
  let compoundPathCount = 0;
  let closedSubpathCount = 0;
  let openSubpathCount = 0;
  let potentialOpenFilledPathCount = 0;
  let evenOddFillPathCount = 0;

  for (const pathMatch of source.matchAll(PATH_TAG)) {
    pathElementCount += 1;
    const tag = pathMatch[0] ?? "";
    const pathData = attributeValue(tag, "d") ?? "";
    const normalised = normalisePathData(pathData);
    if (normalised) {
      const occurrences = seenPathData.get(normalised) ?? 0;
      if (occurrences > 0) duplicatePathDataCount += 1;
      seenPathData.set(normalised, occurrences + 1);
    }

    const moveCount = pathData.match(/[Mm]/g)?.length ?? 0;
    const closeCount = pathData.match(/[Zz]/g)?.length ?? 0;
    if (moveCount > 1) compoundPathCount += 1;
    closedSubpathCount += Math.min(moveCount, closeCount);
    const openCount = Math.max(0, moveCount - closeCount);
    openSubpathCount += openCount;

    const fill = (attributeValue(tag, "fill") ?? styleProperty(tag, "fill") ?? "").trim().toLowerCase();
    if (openCount > 0 && fill !== "none") potentialOpenFilledPathCount += 1;

    const fillRule = (attributeValue(tag, "fill-rule") ?? styleProperty(tag, "fill-rule") ?? "").trim().toLowerCase();
    if (fillRule === "evenodd") evenOddFillPathCount += 1;
  }

  return Object.freeze({
    idCount: ids.length,
    uniqueIdCount: uniqueIds.size,
    duplicateIdCount: Math.max(0, ids.length - uniqueIds.size),
    localReferenceCount: localReferences.length,
    unresolvedReferenceCount: localReferences.filter((reference) => !uniqueIds.has(reference)).length,
    pathElementCount,
    duplicatePathDataCount,
    compoundPathCount,
    closedSubpathCount,
    openSubpathCount,
    potentialOpenFilledPathCount,
    evenOddFillPathCount,
    textElementCount: count(source, /<text\b/gi),
    useElementCount: count(source, /<use\b/gi),
    styleElementCount: count(source, /<style\b/gi),
    symbolElementCount: count(source, /<symbol\b/gi),
    clipPathCount: count(source, /<clipPath\b/gi),
    maskCount: count(source, /<mask\b/gi),
    transformedElementCount,
    nonPathShapeCount: count(source, /<(?:rect|circle|ellipse|line|polyline|polygon)\b/gi),
  });
}
