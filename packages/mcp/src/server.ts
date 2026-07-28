import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { RasterRuntimeGuard } from "@evavo/raster-engine";
import { vectorMcpFailure } from "./errors.js";
import {
  createVectorMcpOperations,
  VECTOR_MCP_CONTRACT_VERSION,
  VECTOR_MCP_VERSION,
  type VectorMcpOperations,
} from "./operations.js";
import {
  createVectorMcpPathPolicy,
  type VectorMcpPathPolicy,
  type VectorMcpPathPolicyOptions,
} from "./path-policy.js";

export type VectorMcpServerBundle = Readonly<{
  server: McpServer;
  operations: VectorMcpOperations;
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
const evidenceLevelSchema = z.enum(["summary", "full"]).optional();

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
        `EVAVO Vector Studio MCP contract ${VECTOR_MCP_CONTRACT_VERSION}.`,
        "Call vector_capabilities and vector_input_policy before the first trace in a workspace.",
        "Raster tools accept one static image at a time and never flatten animation frames or TIFF pages.",
        "All filesystem paths must remain within the configured allowed roots.",
        "Output tools create new files only, never overwrite, and commit SVG plus difference PNG atomically.",
        "Trace completion is not production approval. Inspect render, topology, editability and brand fidelity evidence before publication.",
      ].join(" "),
    },
  );

  server.registerTool(
    "vector_capabilities",
    {
      title: "Vector Studio Capabilities",
      description: "Return the current MCP, filesystem, tracing, output and approval contract without reading a file.",
      inputSchema: {},
    },
    async () => executeTool(() => operations.capabilities()),
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
      description: "Inspect one allowed static raster without creating output. Returns dimensions, hash, alpha, colour, tone, detail and profile evidence.",
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
      description: "Trace one static raster into a new SVG and optional new difference PNG. Returns receipts and evidence, never full SVG or binary bytes in model context.",
      inputSchema: {
        inputPath: pathSchema.describe("Existing raster source within an allowed root."),
        outputSvgPath: pathSchema.describe("New SVG output path. Existing files are rejected."),
        differenceOutputPath: pathSchema
          .describe("Optional new PNG path for selected-candidate visual difference evidence.")
          .optional(),
        profile: profileSchema,
        candidateMode: candidateModeSchema,
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
      title: "Optimise SVG Safely",
      description: "Conservatively optimise an existing governed SVG into a new file. Unsafe SVG is rejected and existing outputs are never overwritten.",
      inputSchema: {
        inputPath: pathSchema.describe("Existing SVG file within an allowed root."),
        outputPath: pathSchema.describe("New SVG output path within an allowed root."),
      },
    },
    async ({ inputPath, outputPath }) =>
      executeTool(() => operations.optimiseSvg(inputPath, outputPath)),
  );

  return Object.freeze({ server, operations, pathPolicy });
}
