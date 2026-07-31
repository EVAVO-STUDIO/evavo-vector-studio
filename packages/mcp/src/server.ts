import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { RasterRuntimeGuard } from "@evavo/raster-engine";
import {
  extendVectorMcpBatchCapabilities,
  registerVectorMcpBatchTools,
  type VectorMcpBatchOperations,
} from "./batch-tools.js";
import {
  extendVectorMcpDotLottieCapabilities,
  registerVectorMcpDotLottieTools,
  type VectorMcpDotLottieOperations,
} from "./dotlottie-tools.js";
import { vectorMcpFailure } from "./errors.js";
import {
  extendVectorMcpCapabilities,
  registerVectorMcpLottieTools,
  type VectorMcpLottieOperations,
} from "./lottie-tools.js";
import {
  createVectorMcpOperations,
  VECTOR_MCP_VERSION,
  type VectorMcpOperations,
} from "./operations.js";
import {
  createVectorMcpPathPolicy,
  type VectorMcpPathPolicy,
  type VectorMcpPathPolicyOptions,
} from "./path-policy.js";
import {
  extendVectorMcpPrintCapabilities,
  registerVectorMcpPrintTools,
  type VectorMcpPrintOperations,
} from "./print-tools.js";

export const VECTOR_MCP_SERVER_CONTRACT_VERSION = "1.6" as const;

export type VectorMcpServerBundle = Readonly<{
  server: McpServer;
  operations: VectorMcpOperations;
  printOperations: VectorMcpPrintOperations;
  lottieOperations: VectorMcpLottieOperations;
  dotLottieOperations: VectorMcpDotLottieOperations;
  batchOperations: VectorMcpBatchOperations;
  pathPolicy: VectorMcpPathPolicy;
}>;

export type VectorMcpServerOptions = Readonly<{
  pathPolicy?: VectorMcpPathPolicy;
  pathPolicyOptions?: VectorMcpPathPolicyOptions;
  runtimeGuard?: RasterRuntimeGuard;
}>;

const pathSchema = z
  .string()
  .min(1)
  .max(4096)
  .describe("Absolute path or path relative to the MCP server working directory.");

const profileSchema = z
  .enum(["auto", "logo", "icon", "line-art", "illustration", "photo"])
  .optional();

const candidateModeSchema = z.enum(["adaptive", "single"]).optional();
const deliveryProfileSchema = z.enum(["editable", "web", "motion", "print"]).optional();
const stableIdPrefixSchema = z
  .string()
  .regex(/^[A-Za-z_][A-Za-z0-9_.-]{0,47}$/)
  .describe("Optional editable or motion path-ID prefix. Rejected for web and print delivery profiles.")
  .optional();
const evidenceLevelSchema = z.enum(["summary", "full"]).optional();
const motionPlanSchema = z
  .record(z.unknown())
  .describe("Inline EVAVO motion v1 plan. Use either motionPlan or motionPath, not both.")
  .optional();

function textPayload(payload: Readonly<Record<string, unknown>>): string {
  return JSON.stringify(payload, null, 2);
}

function successResult(payload: Readonly<Record<string, unknown>>) {
  return {
    content: [{ type: "text" as const, text: textPayload(payload) }],
    structuredContent: payload,
  };
}

async function executeTool(
  operation: () => Promise<Readonly<Record<string, unknown>>> | Readonly<Record<string, unknown>>,
) {
  try {
    return successResult(await operation());
  } catch (error) {
    const payload = vectorMcpFailure(error);
    return {
      content: [{ type: "text" as const, text: textPayload(payload) }],
      structuredContent: payload,
      isError: true,
    };
  }
}

export async function createVectorMcpServer(
  options: VectorMcpServerOptions = {},
): Promise<VectorMcpServerBundle> {
  const pathPolicy = options.pathPolicy ??
    await createVectorMcpPathPolicy(options.pathPolicyOptions);
  const operations = createVectorMcpOperations({
    pathPolicy,
    runtimeGuard: options.runtimeGuard,
  });

  const server = new McpServer(
    {
      name: "evavo-vector-studio",
      version: VECTOR_MCP_VERSION,
    },
    {
      instructions: [
        `EVAVO Vector Studio MCP contract ${VECTOR_MCP_SERVER_CONTRACT_VERSION}.`,
        "Call vector_capabilities and vector_input_policy before the first raster trace in a workspace.",
        "Raster tools accept one static image at a time, ignore hidden RGB beneath fully transparent pixels and never flatten animation frames or TIFF pages.",
        "Tracing and optimisation support editable, web, motion and print delivery profiles with governed stable IDs and responsive packaging evidence.",
        "Print preflight checks one allowed SVG against commercial, large-format, cut-vinyl or screen-print requirements without writing a file or claiming physical production approval.",
        "Motion tools accept a validated inline plan or one JSON plan file and produce script-free CSS animated SVG.",
        "Lottie tools accept the governed path-based SVG subset and create or inspect Lottie JSON without placing generated animation bodies in model context.",
        "dotLottie tools package or inspect deterministic manifest-v2 archives without placing archive bytes or embedded animation JSON in model context.",
        "Durable batch tools run or inspect bounded batch-v1 manifests through persistent local state, canonical allowed roots and paginated receipt-only results.",
        "Batch execution is resumable when invoked again but is not a hosted background queue and does not continue after the MCP server process stops.",
        "All filesystem paths must remain within the configured allowed roots.",
        "Output tools create new files only, never overwrite, and commit related outputs atomically. Print preflight is read-only and creates no output file.",
        "Trace, delivery packaging, print preflight, motion, Lottie, dotLottie and batch completion are not production approval. Inspect render, topology, editability, physical colour, line weight, timing, archive safety, player compatibility and brand fidelity evidence before publication.",
      ].join(" "),
    },
  );

  server.registerTool(
    "vector_capabilities",
    {
      title: "Vector Studio Capabilities",
      description: "Return the current MCP, filesystem, tracing, delivery-profile, print-preflight, motion, Lottie, dotLottie, durable batch, output and approval contract without reading a file.",
      inputSchema: {},
    },
    async () => executeTool(() =>
      extendVectorMcpPrintCapabilities(
        extendVectorMcpBatchCapabilities(
          extendVectorMcpDotLottieCapabilities(
            extendVectorMcpCapabilities(operations.capabilities()),
          ),
        ),
      )),
  );

  server.registerTool(
    "vector_input_policy",
    {
      title: "Vector Studio Input Policy",
      description: "Return accepted static raster classes, rejected multi-image containers and bounded input limits.",
      inputSchema: {},
    },
    async () => executeTool(() => operations.inputPolicy()),
  );

  server.registerTool(
    "vector_inspect_raster",
    {
      title: "Inspect Raster Source",
      description: "Inspect one allowed static raster without creating output. Returns alpha-aware visible bounds, dimensions, hash, colour, tone, detail and profile evidence.",
      inputSchema: {
        inputPath: pathSchema.describe("Existing raster file within an allowed root."),
      },
    },
    async ({ inputPath }, extra) =>
      executeTool(() => operations.inspectRaster(inputPath, extra.signal)),
  );

  server.registerTool(
    "vector_trace_raster",
    {
      title: "Trace Raster to Governed SVG",
      description: "Trace one static raster into a new editable, web, motion or print SVG and optional new difference PNG. Returns receipts and evidence, never full SVG or binary bytes in model context.",
      inputSchema: {
        inputPath: pathSchema.describe("Existing raster source within an allowed root."),
        outputSvgPath: pathSchema.describe("New SVG output path. Existing files are rejected."),
        differenceOutputPath: pathSchema
          .describe("Optional new PNG path for selected-candidate visual difference evidence.")
          .optional(),
        profile: profileSchema,
        candidateMode: candidateModeSchema,
        deliveryProfile: deliveryProfileSchema.describe("Default editable. Web removes fixed root dimensions only with a viewBox; motion adds stable target IDs; print preserves dimensions."),
        stableIdPrefix: stableIdPrefixSchema,
        maxColours: z.number().int().min(1).max(256).optional(),
        preservePalette: z.boolean().optional(),
        optimise: z.boolean().optional(),
        title: z.string().trim().min(1).max(200).optional(),
        differenceMaxDimension: z.number().int().min(32).max(1024).optional(),
        evidenceLevel: evidenceLevelSchema.describe("summary is compact; full includes complete candidate evidence."),
      },
    },
    async (input, extra) =>
      executeTool(() => operations.traceRaster(input, extra.signal)),
  );

  server.registerTool(
    "vector_inspect_svg",
    {
      title: "Inspect SVG",
      description: "Inspect an existing SVG for active content, references, geometry, topology and editability risks without modifying it.",
      inputSchema: {
        inputPath: pathSchema.describe("Existing SVG file within an allowed root."),
      },
    },
    async ({ inputPath }) => executeTool(() => operations.inspectSvg(inputPath)),
  );

  server.registerTool(
    "vector_optimise_svg",
    {
      title: "Package SVG for Delivery",
      description: "Conservatively package an existing governed SVG as an editable, web, motion or print output. Unsafe SVG is rejected and existing outputs are never overwritten.",
      inputSchema: {
        inputPath: pathSchema.describe("Existing SVG file within an allowed root."),
        outputPath: pathSchema.describe("New SVG output path within an allowed root."),
        deliveryProfile: deliveryProfileSchema.describe("Default editable. Determines stable IDs, metadata policy and root dimension handling."),
        stableIdPrefix: stableIdPrefixSchema,
      },
    },
    async (input) =>
      executeTool(() => operations.optimiseSvg(input)),
  );

  server.registerTool(
    "vector_validate_motion_plan",
    {
      title: "Validate Animated SVG Motion Plan",
      description: "Validate and normalize a motion v1 plan supplied inline or from one allowed JSON file. Optionally save the normalized plan to a new JSON path.",
      inputSchema: {
        motionPath: pathSchema
          .describe("Existing motion-plan JSON path. Use either motionPath or motionPlan.")
          .optional(),
        motionPlan: motionPlanSchema,
        normalizedOutputPath: pathSchema
          .describe("Optional new JSON output path for the normalized plan.")
          .optional(),
      },
    },
    async (input, extra) =>
      executeTool(() => operations.validateMotionPlan(input, extra.signal)),
  );

  server.registerTool(
    "vector_animate_svg",
    {
      title: "Create Governed Animated SVG",
      description: "Apply a validated inline or file-based motion v1 plan to one governed static SVG. Writes a new animated SVG and optional evidence JSON atomically without returning SVG markup to model context.",
      inputSchema: {
        inputPath: pathSchema.describe("Existing governed static SVG within an allowed root."),
        motionPath: pathSchema
          .describe("Existing motion-plan JSON path. Use either motionPath or motionPlan.")
          .optional(),
        motionPlan: motionPlanSchema,
        outputSvgPath: pathSchema.describe("New animated SVG output path."),
        evidenceOutputPath: pathSchema
          .describe("Optional new JSON evidence output path.")
          .optional(),
      },
    },
    async (input, extra) =>
      executeTool(() => operations.animateSvg(input, extra.signal)),
  );

  server.registerTool(
    "vector_inspect_animated_svg",
    {
      title: "Inspect Animated SVG",
      description: "Inspect EVAVO motion metadata, target rules, keyframes, reduced-motion fallback and underlying SVG safety without modifying the file.",
      inputSchema: {
        inputPath: pathSchema.describe("Existing animated SVG within an allowed root."),
      },
    },
    async ({ inputPath }) =>
      executeTool(() => operations.inspectAnimatedSvg(inputPath)),
  );

  const printOperations = registerVectorMcpPrintTools(server, pathPolicy);
  const lottieOperations = registerVectorMcpLottieTools(server, pathPolicy);
  const dotLottieOperations = registerVectorMcpDotLottieTools(
    server,
    pathPolicy,
  );
  const batchOperations = registerVectorMcpBatchTools(server, pathPolicy);

  return Object.freeze({
    server,
    operations,
    printOperations,
    lottieOperations,
    dotLottieOperations,
    batchOperations,
    pathPolicy,
  });
}
