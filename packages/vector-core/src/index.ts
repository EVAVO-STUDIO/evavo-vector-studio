export * from "./difference-artifact-verification.js";
export * from "./print-preflight.js";
export * from "./svg.js";
export * from "./svg-topology.js";
export { optimiseSvg } from "./svg-optimisation.js";
export type { SvgOptimisationRequestOptions } from "./svg-optimisation.js";

export type VectorJobKind = "logo" | "icon" | "line-art" | "illustration" | "photo";
export type VectorOutput = "svg" | "animated-svg" | "lottie";
export type VectorJobStatus = "queued" | "inspecting" | "tracing" | "refining" | "validating" | "complete" | "rejected";

export type VectorJobRequest = Readonly<{
  sourceName: string;
  sourceMimeType: string;
  kind: VectorJobKind;
  outputs: readonly VectorOutput[];
  preservePalette: boolean;
  maxColours: number;
  targetError: number;
}>;

export type PipelineStage = Readonly<{
  id: string;
  label: string;
  purpose: string;
  deterministic: boolean;
}>;

export const VECTOR_PIPELINE: readonly PipelineStage[] = Object.freeze([
  { id: "inspect", label: "Source inspection", purpose: "Classify artwork, alpha, palette and defects before changing pixels.", deterministic: true },
  { id: "prepare", label: "Bounded preparation", purpose: "Remove compression noise and edge halos without redrawing the artwork.", deterministic: true },
  { id: "segment", label: "Visual segmentation", purpose: "Separate intentional colour, transparency and negative-space regions.", deterministic: true },
  { id: "trace", label: "Contour reconstruction", purpose: "Recover topology, corners and curves as editable vector geometry.", deterministic: true },
  { id: "refine", label: "Geometry refinement", purpose: "Fit Beziers, reduce anchors and correct symmetry within an error budget.", deterministic: true },
  { id: "style", label: "Style reconstruction", purpose: "Rebuild fills, strokes and restrained gradients from source evidence.", deterministic: true },
  { id: "validate", label: "Render validation", purpose: "Rasterise and compare output against the source at multiple scales.", deterministic: true },
  { id: "motion", label: "Motion authoring", purpose: "Optionally create editable SVG or Lottie timelines from approved layers.", deterministic: false },
  { id: "package", label: "Production packaging", purpose: "Emit optimised, accessible, editable assets and an evidence report.", deterministic: true }
]);

export function validateVectorJobRequest(input: VectorJobRequest): readonly string[] {
  const errors: string[] = [];
  if (!input.sourceName.trim()) errors.push("sourceName is required");
  if (!/^image\/(png|jpeg|webp|tiff|svg\+xml)$/i.test(input.sourceMimeType)) errors.push("unsupported sourceMimeType");
  if (input.outputs.length === 0) errors.push("at least one output is required");
  if (!Number.isInteger(input.maxColours) || input.maxColours < 1 || input.maxColours > 256) errors.push("maxColours must be 1..256");
  if (!Number.isFinite(input.targetError) || input.targetError <= 0 || input.targetError > 1) errors.push("targetError must be greater than 0 and no more than 1");
  return Object.freeze(errors);
}

export function createJobId(now = new Date(), random = crypto.randomUUID()): string {
  return `vec_${now.toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}_${random.replace(/-/g, "").slice(0, 12)}`;
}
