import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import {
  SVG_PRINT_PREFLIGHT_CONTRACT_VERSION,
  SvgPrintPreflightError,
  preflightSvgForPrint,
  type SvgPrintPreflightOptions,
  type SvgPrintProfile,
} from "@evavo/vector-core";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { VectorMcpOperationError, vectorMcpFailure } from "./errors.js";
import type { VectorMcpPathPolicy } from "./path-policy.js";

export const VECTOR_MCP_PRINT_CONTRACT_VERSION = "1.0" as const;
export const VECTOR_MCP_PRINT_MAX_INPUT_BYTES = 5 * 1024 * 1024;
export const VECTOR_MCP_PRINT_TOOL_NAMES = Object.freeze([
  "vector_preflight_svg_print",
] as const);

const PRINT_PROFILES = Object.freeze([
  "commercial",
  "large-format",
  "cut-vinyl",
  "screen-print",
] as const satisfies readonly SvgPrintProfile[]);

export type VectorMcpPrintPreflightRequest = SvgPrintPreflightOptions &
  Readonly<{
    inputPath: string;
  }>;

export type VectorMcpPrintOperations = Readonly<{
  preflightSvgPrint: (
    request: VectorMcpPrintPreflightRequest,
    signal?: AbortSignal,
  ) => Promise<Readonly<Record<string, unknown>>>;
}>;

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
  operation: () => Promise<Readonly<Record<string, unknown>>>,
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

function throwIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new VectorMcpOperationError(
      "VECTOR_MCP_CANCELLED",
      "The MCP print-preflight operation was cancelled.",
      { retryable: true },
    );
  }
}

function printPreflightFailure(error: unknown): never {
  if (error instanceof SvgPrintPreflightError) {
    throw new VectorMcpOperationError(error.code, error.message, {
      details: error.details,
    });
  }
  throw error;
}

function preflightOptions(
  request: VectorMcpPrintPreflightRequest,
): SvgPrintPreflightOptions {
  return Object.freeze({
    profile: request.profile,
    trimWidthMm: request.trimWidthMm,
    trimHeightMm: request.trimHeightMm,
    bleedMm: request.bleedMm,
    dimensionToleranceMm: request.dimensionToleranceMm,
    minimumStrokePt: request.minimumStrokePt,
    maximumProcessColours: request.maximumProcessColours,
    allowText: request.allowText,
    allowEmbeddedRaster: request.allowEmbeddedRaster,
    allowTransparency: request.allowTransparency,
  });
}

export function createVectorMcpPrintOperations(
  pathPolicy: VectorMcpPathPolicy,
): VectorMcpPrintOperations {
  async function preflightSvgPrint(
    request: VectorMcpPrintPreflightRequest,
    signal?: AbortSignal,
  ): Promise<Readonly<Record<string, unknown>>> {
    throwIfCancelled(signal);
    const resolvedInputPath = await pathPolicy.resolveInputFile(request.inputPath);
    if (path.extname(resolvedInputPath).toLowerCase() !== ".svg") {
      throw new VectorMcpOperationError(
        "VECTOR_MCP_INPUT_EXTENSION_INVALID",
        "inputPath must reference an SVG file.",
        {
          details: {
            requestedPath: request.inputPath,
            path: resolvedInputPath,
            expectedExtension: ".svg",
          },
        },
      );
    }

    const information = await stat(resolvedInputPath);
    if (information.size < 1) {
      throw new VectorMcpOperationError(
        "VECTOR_MCP_PRINT_INPUT_EMPTY",
        "The SVG print-preflight input is empty.",
        { details: { path: resolvedInputPath } },
      );
    }
    if (information.size > VECTOR_MCP_PRINT_MAX_INPUT_BYTES) {
      throw new VectorMcpOperationError(
        "VECTOR_MCP_PRINT_INPUT_TOO_LARGE",
        "The SVG print-preflight input exceeds the bounded MCP limit.",
        {
          details: {
            path: resolvedInputPath,
            bytes: information.size,
            maximumBytes: VECTOR_MCP_PRINT_MAX_INPUT_BYTES,
          },
        },
      );
    }

    throwIfCancelled(signal);
    const source = await readFile(resolvedInputPath, "utf8");
    throwIfCancelled(signal);

    let result;
    try {
      result = preflightSvgForPrint(source, preflightOptions(request));
    } catch (error) {
      printPreflightFailure(error);
    }

    const sourceSha256 = createHash("sha256").update(source, "utf8").digest("hex");
    return Object.freeze({
      ok: true,
      operation: "preflight-svg-print",
      contractVersion: SVG_PRINT_PREFLIGHT_CONTRACT_VERSION,
      mcpPrintContractVersion: VECTOR_MCP_PRINT_CONTRACT_VERSION,
      input: Object.freeze({
        requestedPath: request.inputPath,
        path: resolvedInputPath,
        bytes: information.size,
        sha256: sourceSha256,
      }),
      result,
      outputWritten: false,
      generatedBodiesInModelContext: false,
      productionApproval: false,
      approval: "review-required",
    });
  }

  return Object.freeze({ preflightSvgPrint });
}

function objectRecord(value: unknown): Readonly<Record<string, unknown>> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : Object.freeze({});
}

export function extendVectorMcpPrintCapabilities(
  base: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    ...base,
    printPreflight: Object.freeze({
      contractVersion: SVG_PRINT_PREFLIGHT_CONTRACT_VERSION,
      mcpContractVersion: VECTOR_MCP_PRINT_CONTRACT_VERSION,
      profiles: PRINT_PROFILES,
      deterministic: true,
      readOnly: true,
      maxInputBytes: VECTOR_MCP_PRINT_MAX_INPUT_BYTES,
      physicalDimensions: true,
      trimAndBleed: true,
      minimumLineWeight: true,
      processColourTokenInspection: true,
      cmykOrSpotColourProofAvailable: false,
      generatedBodiesInModelContext: false,
      outputWritten: false,
      productionApproval: false,
      approval: "review-required",
    }),
    outputs: Object.freeze({
      ...objectRecord(base.outputs),
      printPreflightEvidence: true,
      printPreflightWritesFiles: false,
      printProductionApproval: false,
    }),
  });
}

export function registerVectorMcpPrintTools(
  server: McpServer,
  pathPolicy: VectorMcpPathPolicy,
): VectorMcpPrintOperations {
  const operations = createVectorMcpPrintOperations(pathPolicy);
  const pathSchema = z
    .string()
    .min(1)
    .max(4096)
    .describe("Absolute path or path relative to the MCP server working directory.");

  server.registerTool(
    "vector_preflight_svg_print",
    {
      title: "Preflight SVG for Print",
      description: "Run deterministic commercial, large-format, cut-vinyl or screen-print preflight on one existing SVG. Returns source hash, physical-dimension, trim, bleed, line-weight, paint and review evidence. Writes no file and never claims print approval.",
      inputSchema: {
        inputPath: pathSchema.describe("Existing SVG file within an allowed root."),
        profile: z.enum(PRINT_PROFILES).optional(),
        trimWidthMm: z.number().finite().positive().max(100_000).optional(),
        trimHeightMm: z.number().finite().positive().max(100_000).optional(),
        bleedMm: z.number().finite().min(0).max(100).optional(),
        dimensionToleranceMm: z.number().finite().min(0).max(10).optional(),
        minimumStrokePt: z.number().finite().min(0.01).max(100).optional(),
        maximumProcessColours: z.number().int().min(1).max(256).optional(),
        allowText: z.boolean().optional(),
        allowEmbeddedRaster: z.boolean().optional(),
        allowTransparency: z.boolean().optional(),
      },
    },
    async (input, extra) =>
      executeTool(() => operations.preflightSvgPrint(input, extra.signal)),
  );

  return operations;
}
