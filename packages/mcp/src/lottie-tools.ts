import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import {
  DEFAULT_LOTTIE_FRAME_RATE,
  DEFAULT_LOTTIE_PRECISION,
  LOTTIE_CONTRACT_VERSION,
  MAX_LOTTIE_FRAME_RATE,
  MAX_LOTTIE_PRECISION,
  MIN_LOTTIE_FRAME_RATE,
  createLottieFromSvgMotion,
  inspectLottie,
} from "@evavo/lottie-engine";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { VectorMcpOperationError, vectorMcpFailure } from "./errors.js";
import {
  commitNewVectorFiles,
  type VectorMcpFileReceipt,
} from "./file-transaction.js";
import type { VectorMcpPathPolicy } from "./path-policy.js";

export const VECTOR_MCP_PUBLIC_CONTRACT_VERSION = "1.2" as const;
export const VECTOR_MCP_LOTTIE_TOOL_NAMES = Object.freeze([
  "vector_export_lottie",
  "vector_inspect_lottie",
] as const);

const MAX_SVG_INPUT_BYTES = 5 * 1024 * 1024;
const MAX_MOTION_PLAN_BYTES = 256 * 1024;
const MAX_LOTTIE_INPUT_BYTES = 20 * 1024 * 1024;
const MAX_LOTTIE_OUTPUT_BYTES = 20 * 1024 * 1024;

export type VectorMcpLottiePlanSource = Readonly<{
  motionPath?: string;
  motionPlan?: unknown;
}>;

export type VectorMcpExportLottieRequest =
  VectorMcpLottiePlanSource &
    Readonly<{
      inputPath: string;
      outputLottiePath: string;
      evidenceOutputPath?: string;
      frameRate?: number;
      precision?: number;
      name?: string;
    }>;

export type VectorMcpLottieOperations = Readonly<{
  exportLottie: (
    request: VectorMcpExportLottieRequest,
    signal?: AbortSignal,
  ) => Promise<Readonly<Record<string, unknown>>>;
  inspectLottie: (
    inputPath: string,
    signal?: AbortSignal,
  ) => Promise<Readonly<Record<string, unknown>>>;
}>;

type ResolvedPlan = Readonly<{
  value: unknown;
  source: Readonly<Record<string, unknown>>;
  resolvedPath: string | null;
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
  operation:
    | (() => Promise<Readonly<Record<string, unknown>>>)
    | (() => Readonly<Record<string, unknown>>),
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

function pathKey(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === "win32"
    ? resolved.toLowerCase()
    : resolved;
}

function receiptByPath(
  receipts: readonly VectorMcpFileReceipt[],
  outputPath: string,
): VectorMcpFileReceipt {
  const key = pathKey(outputPath);
  const receipt = receipts.find((item) => pathKey(item.path) === key);
  if (!receipt) {
    throw new VectorMcpOperationError(
      "VECTOR_MCP_OUTPUT_RECEIPT_MISSING",
      "A committed Lottie output does not have a matching file receipt.",
      {
        details: {
          outputPath,
          receiptPaths: receipts.map((item) => item.path),
        },
      },
    );
  }
  return receipt;
}

function assertExtension(
  requestedPath: string,
  extension: ".svg" | ".json",
  field: string,
): void {
  if (path.extname(requestedPath).toLowerCase() !== extension) {
    throw new VectorMcpOperationError(
      "VECTOR_MCP_OUTPUT_EXTENSION_INVALID",
      `${field} must use the ${extension} extension.`,
      {
        details: {
          field,
          requestedPath,
          expectedExtension: extension,
        },
      },
    );
  }
}

function throwIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new VectorMcpOperationError(
      "VECTOR_MCP_CANCELLED",
      "The MCP Lottie operation was cancelled before completion.",
      { retryable: true },
    );
  }
}

function decodeUtf8(
  buffer: Buffer,
  code: string,
  message: string,
  details: Readonly<Record<string, unknown>>,
): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch (error) {
    throw new VectorMcpOperationError(code, message, {
      details: {
        ...details,
        cause: error instanceof Error ? error.message : String(error),
      },
    });
  }
}

function parseJson(source: string, inputPath: string): unknown {
  try {
    return JSON.parse(source) as unknown;
  } catch (error) {
    throw new VectorMcpOperationError(
      "VECTOR_MCP_JSON_INVALID",
      "The MCP JSON input could not be parsed.",
      {
        details: {
          inputPath,
          cause: error instanceof Error ? error.message : String(error),
        },
      },
    );
  }
}

async function readBoundedUtf8File(
  inputPath: string,
  maxBytes: number,
  tooLargeCode: string,
  invalidUtf8Code: string,
  signal?: AbortSignal,
): Promise<Readonly<{ source: string; bytes: number }>> {
  throwIfCancelled(signal);
  const information = await stat(inputPath);
  if (information.size > maxBytes) {
    throw new VectorMcpOperationError(
      tooLargeCode,
      "The MCP input exceeds its configured byte limit.",
      {
        details: {
          inputPath,
          bytes: information.size,
          maxBytes,
        },
      },
    );
  }
  const buffer = await readFile(inputPath);
  throwIfCancelled(signal);
  return Object.freeze({
    source: decodeUtf8(
      buffer,
      invalidUtf8Code,
      "The MCP input is not valid UTF-8.",
      { inputPath },
    ),
    bytes: buffer.byteLength,
  });
}

async function resolveMotionPlan(
  pathPolicy: VectorMcpPathPolicy,
  request: VectorMcpLottiePlanSource,
  signal?: AbortSignal,
): Promise<ResolvedPlan> {
  const hasPath =
    typeof request.motionPath === "string" &&
    request.motionPath.trim().length > 0;
  const hasInline = request.motionPlan !== undefined;
  if (hasPath === hasInline) {
    throw new VectorMcpOperationError(
      "VECTOR_MCP_OPTIONS_INVALID",
      "Provide exactly one of motionPath or motionPlan.",
      {
        details: {
          hasMotionPath: hasPath,
          hasInlineMotionPlan: hasInline,
        },
      },
    );
  }

  if (hasPath) {
    assertExtension(request.motionPath!, ".json", "motionPath");
    const resolvedPath = await pathPolicy.resolveInputFile(
      request.motionPath!,
    );
    const file = await readBoundedUtf8File(
      resolvedPath,
      MAX_MOTION_PLAN_BYTES,
      "VECTOR_MCP_MOTION_PLAN_TOO_LARGE",
      "VECTOR_MCP_MOTION_PLAN_UTF8_INVALID",
      signal,
    );
    return Object.freeze({
      value: parseJson(file.source, resolvedPath),
      source: Object.freeze({
        mode: "file",
        requestedPath: request.motionPath,
        path: resolvedPath,
        bytes: file.bytes,
      }),
      resolvedPath,
    });
  }

  const canonical = JSON.stringify(request.motionPlan);
  const bytes = Buffer.byteLength(canonical, "utf8");
  if (bytes > MAX_MOTION_PLAN_BYTES) {
    throw new VectorMcpOperationError(
      "VECTOR_MCP_MOTION_PLAN_TOO_LARGE",
      "The inline MCP motion plan exceeds the configured byte limit.",
      {
        details: { bytes, maxBytes: MAX_MOTION_PLAN_BYTES },
      },
    );
  }
  return Object.freeze({
    value: request.motionPlan,
    source: Object.freeze({ mode: "inline", bytes }),
    resolvedPath: null,
  });
}

function canonicalMotionPlan(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function createVectorMcpLottieOperations(
  pathPolicy: VectorMcpPathPolicy,
): VectorMcpLottieOperations {
  async function exportLottie(
    request: VectorMcpExportLottieRequest,
    signal?: AbortSignal,
  ): Promise<Readonly<Record<string, unknown>>> {
    assertExtension(request.inputPath, ".svg", "inputPath");
    assertExtension(
      request.outputLottiePath,
      ".json",
      "outputLottiePath",
    );
    if (request.evidenceOutputPath) {
      assertExtension(
        request.evidenceOutputPath,
        ".json",
        "evidenceOutputPath",
      );
    }

    const resolvedInputPath = await pathPolicy.resolveInputFile(
      request.inputPath,
    );
    const plan = await resolveMotionPlan(pathPolicy, request, signal);
    const resolvedLottiePath = await pathPolicy.resolveOutputFile(
      request.outputLottiePath,
    );
    const resolvedEvidencePath = request.evidenceOutputPath
      ? await pathPolicy.resolveOutputFile(request.evidenceOutputPath)
      : null;
    pathPolicy.assertDistinct([
      resolvedInputPath,
      ...(plan.resolvedPath ? [plan.resolvedPath] : []),
      resolvedLottiePath,
      ...(resolvedEvidencePath ? [resolvedEvidencePath] : []),
    ]);

    const sourceFile = await readBoundedUtf8File(
      resolvedInputPath,
      MAX_SVG_INPUT_BYTES,
      "VECTOR_MCP_LOTTIE_SOURCE_TOO_LARGE",
      "VECTOR_MCP_LOTTIE_SOURCE_UTF8_INVALID",
      signal,
    );
    if (sourceFile.source.includes("\0")) {
      throw new VectorMcpOperationError(
        "VECTOR_MCP_LOTTIE_SOURCE_INVALID",
        "The SVG source contains null bytes.",
        { details: { inputPath: resolvedInputPath } },
      );
    }

    throwIfCancelled(signal);
    const result = createLottieFromSvgMotion(
      sourceFile.source,
      plan.value,
      {
        frameRate: request.frameRate,
        precision: request.precision,
        name: request.name,
      },
    );
    if (result.evidence.output.bytes > MAX_LOTTIE_OUTPUT_BYTES) {
      throw new VectorMcpOperationError(
        "VECTOR_MCP_LOTTIE_OUTPUT_TOO_LARGE",
        "The generated Lottie JSON exceeds the MCP output limit.",
        {
          details: {
            outputBytes: result.evidence.output.bytes,
            maxOutputBytes: MAX_LOTTIE_OUTPUT_BYTES,
          },
        },
      );
    }
    throwIfCancelled(signal);

    const commitLottiePath = await pathPolicy.resolveOutputFile(
      resolvedLottiePath,
    );
    const commitEvidencePath = resolvedEvidencePath
      ? await pathPolicy.resolveOutputFile(resolvedEvidencePath)
      : null;
    pathPolicy.assertDistinct([
      resolvedInputPath,
      ...(plan.resolvedPath ? [plan.resolvedPath] : []),
      commitLottiePath,
      ...(commitEvidencePath ? [commitEvidencePath] : []),
    ]);

    const normalizedPlan = canonicalMotionPlan(
      result.evidence.motion.normalized,
    );
    const motionPlanSha256 = createHash("sha256")
      .update(normalizedPlan, "utf8")
      .digest("hex");
    const evidenceDocument = Object.freeze({
      operation: "export-lottie",
      lottieContractVersion: LOTTIE_CONTRACT_VERSION,
      input: Object.freeze({
        requestedPath: request.inputPath,
        path: resolvedInputPath,
      }),
      motionPlan: Object.freeze({
        ...plan.source,
        normalizedSha256: motionPlanSha256,
      }),
      outputPath: commitLottiePath,
      inspection: result.inspection,
      evidence: result.evidence,
    });
    const receipts = await commitNewVectorFiles([
      {
        path: commitLottiePath,
        data: result.json,
        mimeType: "video/lottie+json",
      },
      ...(commitEvidencePath
        ? [
            {
              path: commitEvidencePath,
              data: `${JSON.stringify(evidenceDocument, null, 2)}\n`,
              mimeType: "application/json",
            },
          ]
        : []),
    ]);

    return Object.freeze({
      ok: true,
      operation: "export-lottie",
      lottieContractVersion: LOTTIE_CONTRACT_VERSION,
      input: Object.freeze({
        requestedPath: request.inputPath,
        path: resolvedInputPath,
        bytes: sourceFile.bytes,
      }),
      motionPlan: Object.freeze({
        ...plan.source,
        normalizedSha256: motionPlanSha256,
      }),
      outputs: Object.freeze({
        lottieJson: receiptByPath(receipts, commitLottiePath),
        evidence: commitEvidencePath
          ? receiptByPath(receipts, commitEvidencePath)
          : null,
      }),
      inspection: result.inspection,
      evidence: result.evidence,
      compatibility: result.evidence.compatibility,
      approval: result.evidence.approval,
    });
  }

  async function inspectLottieFile(
    inputPath: string,
    signal?: AbortSignal,
  ): Promise<Readonly<Record<string, unknown>>> {
    assertExtension(inputPath, ".json", "inputPath");
    const resolvedInputPath = await pathPolicy.resolveInputFile(inputPath);
    const file = await readBoundedUtf8File(
      resolvedInputPath,
      MAX_LOTTIE_INPUT_BYTES,
      "VECTOR_MCP_LOTTIE_INPUT_TOO_LARGE",
      "VECTOR_MCP_LOTTIE_INPUT_UTF8_INVALID",
      signal,
    );
    const inspection = inspectLottie(file.source);
    return Object.freeze({
      ok: true,
      operation: "inspect-lottie",
      input: Object.freeze({
        requestedPath: inputPath,
        path: resolvedInputPath,
        bytes: file.bytes,
        sha256: createHash("sha256")
          .update(file.source, "utf8")
          .digest("hex"),
      }),
      inspection,
      approval: inspection.valid
        ? "human-review-required"
        : "structural-repair-required",
    });
  }

  return Object.freeze({
    exportLottie,
    inspectLottie: inspectLottieFile,
  });
}

export function extendVectorMcpCapabilities(
  base: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const baseTools = Array.isArray(base.tools)
    ? base.tools.filter((item): item is string => typeof item === "string")
    : [];
  const baseOutputs =
    base.outputs && typeof base.outputs === "object"
      ? (base.outputs as Record<string, unknown>)
      : {};

  return Object.freeze({
    ...base,
    mcpContractVersion: VECTOR_MCP_PUBLIC_CONTRACT_VERSION,
    tools: Object.freeze([
      ...baseTools,
      ...VECTOR_MCP_LOTTIE_TOOL_NAMES,
    ]),
    lottie: Object.freeze({
      contractVersion: LOTTIE_CONTRACT_VERSION,
      sourceMode: "governed-path-based-svg",
      motionPlans: Object.freeze(["inline", "allowed-root-json-file"]),
      frameRate: Object.freeze({
        default: DEFAULT_LOTTIE_FRAME_RATE,
        minimum: MIN_LOTTIE_FRAME_RATE,
        maximum: MAX_LOTTIE_FRAME_RATE,
      }),
      precision: Object.freeze({
        default: DEFAULT_LOTTIE_PRECISION,
        minimum: 0,
        maximum: MAX_LOTTIE_PRECISION,
      }),
      maximumSourceBytes: MAX_SVG_INPUT_BYTES,
      maximumPlanBytes: MAX_MOTION_PLAN_BYTES,
      maximumOutputBytes: MAX_LOTTIE_OUTPUT_BYTES,
      structuralInspection: true,
      playerRenderValidation: false,
      dotLottiePackaging: false,
      modelContextIncludesGeneratedJson: false,
    }),
    outputs: Object.freeze({
      ...baseOutputs,
      lottie: true,
      lottieJson: true,
      lottiePlayerRenderValidation: false,
      dotLottie: false,
    }),
  });
}

export function registerVectorMcpLottieTools(
  server: McpServer,
  pathPolicy: VectorMcpPathPolicy,
): VectorMcpLottieOperations {
  const operations = createVectorMcpLottieOperations(pathPolicy);
  const pathSchema = z
    .string()
    .min(1)
    .max(4096)
    .describe(
      "Absolute path or path relative to the MCP server working directory.",
    );
  const motionPlanSchema = z
    .record(z.unknown())
    .describe(
      "Inline EVAVO motion v1 plan. Use either motionPlan or motionPath, not both.",
    )
    .optional();

  server.registerTool(
    "vector_export_lottie",
    {
      title: "Export Governed Lottie JSON",
      description:
        "Convert one governed path-based SVG and one inline or file-based motion v1 plan into new Lottie JSON and optional evidence files. Returns receipts and evidence, never the generated JSON body.",
      inputSchema: {
        inputPath: pathSchema.describe(
          "Existing governed path-based SVG within an allowed root.",
        ),
        motionPath: pathSchema
          .describe(
            "Existing motion-plan JSON path. Use either motionPath or motionPlan.",
          )
          .optional(),
        motionPlan: motionPlanSchema,
        outputLottiePath: pathSchema.describe(
          "New .json path for governed Lottie output.",
        ),
        evidenceOutputPath: pathSchema
          .describe("Optional new JSON evidence output path.")
          .optional(),
        frameRate: z
          .number()
          .int()
          .min(MIN_LOTTIE_FRAME_RATE)
          .max(MAX_LOTTIE_FRAME_RATE)
          .optional(),
        precision: z
          .number()
          .int()
          .min(0)
          .max(MAX_LOTTIE_PRECISION)
          .optional(),
        name: z.string().trim().min(1).max(120).optional(),
      },
    },
    async (input, extra) =>
      executeTool(() => operations.exportLottie(input, extra.signal)),
  );

  server.registerTool(
    "vector_inspect_lottie",
    {
      title: "Inspect Lottie JSON",
      description:
        "Inspect existing Lottie JSON for the governed shape-layer, property, keyframe, asset and expression subset without modifying it.",
      inputSchema: {
        inputPath: pathSchema.describe(
          "Existing Lottie JSON within an allowed root.",
        ),
      },
    },
    async ({ inputPath }, extra) =>
      executeTool(() => operations.inspectLottie(inputPath, extra.signal)),
  );

  return operations;
}
