import type { DecodedRaster } from "./types.js";

export const REGION_COMPARISON_VERSION = "evavo.raster-region-comparison.v1";
export const REGION_POLICIES = Object.freeze(["protected", "secondary", "active"] as const);

export type RegionPolicy = (typeof REGION_POLICIES)[number];
export type RasterRegionDefinition = Readonly<{
  id: string;
  index: number;
  policy: RegionPolicy;
}>;
export type RasterRegionMetrics = Readonly<{
  id: string;
  index: number;
  policy: RegionPolicy;
  pixelCount: number;
  visualMae: number;
  rmsVisualError: number;
  mismatchFraction: number;
  errorEnergy: number;
}>;
export type RasterRegionComparison = Readonly<{
  schema: typeof REGION_COMPARISON_VERSION;
  width: number;
  height: number;
  mismatchPixelError: number;
  regions: readonly RasterRegionMetrics[];
  unassignedPixelCount: number;
  totalErrorEnergy: number;
  protectedErrorEnergy: number;
  secondaryErrorEnergy: number;
  activeErrorEnergy: number;
  motionContainmentScore: number;
  protectedDriftFraction: number;
}>;

const DEFAULT_MISMATCH_PIXEL_ERROR = 0.1;
const REGION_ID = /^[a-z][a-z0-9._-]{0,63}$/u;

function fail(code: string): never {
  throw new Error(code);
}

function round(value: number, places = 6): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function assertRaster(image: DecodedRaster, label: string): void {
  if (!Number.isSafeInteger(image.width) || !Number.isSafeInteger(image.height) || image.width < 1 || image.height < 1) {
    fail(`RASTER_REGION_COMPARISON_DIMENSIONS_INVALID:${label}`);
  }
  if (image.pixels.byteLength !== image.width * image.height * 4) {
    fail(`RASTER_REGION_COMPARISON_RGBA_INVALID:${label}`);
  }
}

function visualErrorAt(source: DecodedRaster, rendered: DecodedRaster, pixelIndex: number): number {
  const offset = pixelIndex * 4;
  const sourceAlpha = source.pixels[offset + 3] / 255;
  const outputAlpha = rendered.pixels[offset + 3] / 255;
  const alphaError = Math.abs(sourceAlpha - outputAlpha);
  let blackError = 0;
  let whiteError = 0;
  for (let channel = 0; channel < 3; channel += 1) {
    const sourceChannel = source.pixels[offset + channel] / 255;
    const outputChannel = rendered.pixels[offset + channel] / 255;
    const sourcePremultiplied = sourceChannel * sourceAlpha;
    const outputPremultiplied = outputChannel * outputAlpha;
    blackError += Math.abs(sourcePremultiplied - outputPremultiplied);
    whiteError += Math.abs(
      sourcePremultiplied + 1 - sourceAlpha -
      (outputPremultiplied + 1 - outputAlpha),
    );
  }
  return Math.max(alphaError, blackError / 3, whiteError / 3);
}

function validateRegions(definitions: readonly RasterRegionDefinition[]): Map<number, RasterRegionDefinition> {
  if (!Array.isArray(definitions) || definitions.length < 1 || definitions.length > 254) {
    fail("RASTER_REGION_COMPARISON_REGIONS_INVALID");
  }
  const byIndex = new Map<number, RasterRegionDefinition>();
  const ids = new Set<string>();
  for (const definition of definitions) {
    if (
      !definition ||
      typeof definition !== "object" ||
      typeof definition.id !== "string" ||
      !REGION_ID.test(definition.id) ||
      !Number.isSafeInteger(definition.index) ||
      definition.index < 1 ||
      definition.index > 254 ||
      !(REGION_POLICIES as readonly string[]).includes(definition.policy) ||
      byIndex.has(definition.index) ||
      ids.has(definition.id)
    ) {
      fail("RASTER_REGION_COMPARISON_REGIONS_INVALID");
    }
    byIndex.set(definition.index, Object.freeze({ ...definition }));
    ids.add(definition.id);
  }
  return byIndex;
}

export function compareRgbaImagesByRegion(
  source: DecodedRaster,
  rendered: DecodedRaster,
  regionMap: Uint8Array,
  definitions: readonly RasterRegionDefinition[],
  options: Readonly<{ mismatchPixelError?: number }> = {},
): RasterRegionComparison {
  assertRaster(source, "source");
  assertRaster(rendered, "rendered");
  if (source.width !== rendered.width || source.height !== rendered.height) {
    fail("RASTER_REGION_COMPARISON_CANVAS_MISMATCH");
  }
  const pixelCount = source.width * source.height;
  if (!(regionMap instanceof Uint8Array) || regionMap.byteLength !== pixelCount) {
    fail("RASTER_REGION_COMPARISON_MAP_INVALID");
  }
  const byIndex = validateRegions(definitions);
  const mismatchPixelError = options.mismatchPixelError ?? DEFAULT_MISMATCH_PIXEL_ERROR;
  if (!Number.isFinite(mismatchPixelError) || mismatchPixelError <= 0 || mismatchPixelError > 1) {
    fail("RASTER_REGION_COMPARISON_THRESHOLD_INVALID");
  }

  const accumulators = new Map<number, {
    pixelCount: number;
    visualTotal: number;
    visualSquaredTotal: number;
    mismatchCount: number;
    errorEnergy: number;
  }>();
  for (const index of byIndex.keys()) {
    accumulators.set(index, {
      pixelCount: 0,
      visualTotal: 0,
      visualSquaredTotal: 0,
      mismatchCount: 0,
      errorEnergy: 0,
    });
  }

  let unassignedPixelCount = 0;
  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
    const definition = byIndex.get(regionMap[pixelIndex]);
    if (!definition) {
      unassignedPixelCount += 1;
      continue;
    }
    const visualError = visualErrorAt(source, rendered, pixelIndex);
    const accumulator = accumulators.get(definition.index)!;
    accumulator.pixelCount += 1;
    accumulator.visualTotal += visualError;
    accumulator.visualSquaredTotal += visualError * visualError;
    accumulator.errorEnergy += visualError;
    if (visualError >= mismatchPixelError) accumulator.mismatchCount += 1;
  }

  const regions = [...byIndex.values()]
    .sort((left, right) => left.index - right.index)
    .map((definition): RasterRegionMetrics => {
      const accumulator = accumulators.get(definition.index)!;
      const divisor = Math.max(1, accumulator.pixelCount);
      return Object.freeze({
        id: definition.id,
        index: definition.index,
        policy: definition.policy,
        pixelCount: accumulator.pixelCount,
        visualMae: round(accumulator.visualTotal / divisor),
        rmsVisualError: round(Math.sqrt(accumulator.visualSquaredTotal / divisor)),
        mismatchFraction: round(accumulator.mismatchCount / divisor),
        errorEnergy: round(accumulator.errorEnergy),
      });
    });

  const energy = (policy: RegionPolicy) => regions
    .filter((region) => region.policy === policy)
    .reduce((sum, region) => sum + region.errorEnergy, 0);
  const protectedErrorEnergy = energy("protected");
  const secondaryErrorEnergy = energy("secondary");
  const activeErrorEnergy = energy("active");
  const totalErrorEnergy = protectedErrorEnergy + secondaryErrorEnergy + activeErrorEnergy;
  const allowedErrorEnergy = activeErrorEnergy + secondaryErrorEnergy * 0.5;
  const motionContainmentScore = totalErrorEnergy <= 1e-12
    ? 1
    : Math.max(0, Math.min(1, allowedErrorEnergy / totalErrorEnergy));
  const protectedDriftFraction = totalErrorEnergy <= 1e-12
    ? 0
    : protectedErrorEnergy / totalErrorEnergy;

  return Object.freeze({
    schema: REGION_COMPARISON_VERSION,
    width: source.width,
    height: source.height,
    mismatchPixelError,
    regions: Object.freeze(regions),
    unassignedPixelCount,
    totalErrorEnergy: round(totalErrorEnergy),
    protectedErrorEnergy: round(protectedErrorEnergy),
    secondaryErrorEnergy: round(secondaryErrorEnergy),
    activeErrorEnergy: round(activeErrorEnergy),
    motionContainmentScore: round(motionContainmentScore),
    protectedDriftFraction: round(protectedDriftFraction),
  });
}
