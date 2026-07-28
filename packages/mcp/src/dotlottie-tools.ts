import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import {
  DOTLOTTIE_CONTRACT_VERSION,
  DOTLOTTIE_MANIFEST_VERSION,
  DOTLOTTIE_MIME_TYPE,
  MAX_DOTLOTTIE_ARCHIVE_BYTES,
  MAX_DOTLOTTIE_LOTTIE_BYTES,
  createDotLottiePackage,
  inspectDotLottie,
} from "@evavo/lottie-engine";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { VectorMcpOperationError, vectorMcpFailure } from "./errors.js";
import {
  commitNewVectorFiles,
  type VectorMcpFileReceipt,
} from "./file-transaction.js";
import type { VectorMcpPathPolicy } from "./path-policy.js";

export const VECTOR_MCP_DOTLOTTIE_CONTRACT_VERSION = "1.3" as const;
export const VECTOR_MCP_DOTLOTTIE_TOOL_NAMES = Object.freeze([
  "vector_package_dotlottie",
  "vector_inspect_dotlottie",
] as const);

export type VectorMcpPackageDotLottieRequest = Readonly<{
  inputPath: string;
  outputPath: string;
  evidenceOutputPath?: string;
  animationId?: string;
}>;

export type VectorMcpDotLottieOperations = Readonly<{
  packageDotLottie: (
    request: VectorMcpPackageDotLottieRequest,
    signal?: AbortSignal,
  ) => Promise<Readonly<Record<string, unknown>>>;
  inspectDotLottie: (
    inputPath: string,
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
      "A committed dotLottie output does not have a matching file receipt.",
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
  extension: ".json" | ".lottie",
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
      "The MCP dotLottie operation was cancelled before completion.",
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

async function readBoundedLottieJson(
  inputPath: string,
  signal?: AbortSignal,
): Promise<Readonly<{ source: string; bytes: number; sha256: string }>> {
  throwIfCancelled(signal);
  const information = await stat(inputPath);
  if (information.size === 0 || information.size > MAX_DOTLOTTIE_LOTTIE_BYTES) {
    throw new VectorMcpOperationError(
      "VECTOR_MCP_DOTLOTTIE_SOURCE_TOO_LARGE",
      "The Lottie JSON input is empty or exceeds the dotLottie package limit.",
      {
        details: {
          inputPath,
          bytes: information.size,
          maxBytes: MAX_DOTLOTTIE_LOTTIE_BYTES,
        },
      },
    );
  }
  const buffer = await readFile(inputPath);
  throwIfCancelled(signal);
  return Object.freeze({
    source: decodeUtf8(
      buffer,
      "VECTOR_MCP_DOTLOTTIE_SOURCE_UTF8_INVALID",
      "The Lottie JSON input is not valid UTF-8.",
      { inputPath },
    ),
    bytes: buffer.byteLength,
    sha256: createHash("sha256").update(buffer).digest("hex"),
  });
}

async function readBoundedArchive(
  inputPath: string,
  signal?: AbortSignal,
): Promise<Readonly<{ bytes: Uint8Array; byteLength: number; sha256: string }>> {
  throwIfCancelled(signal);
  const information = await stat(inputPath);
  if (information.size === 0 || information.size > MAX_DOTLOTTIE_ARCHIVE_BYTES) {
    throw new VectorMcpOperationError(
      "VECTOR_MCP_DOTLOTTIE_ARCHIVE_TOO_LARGE",
      "The dotLottie archive is empty or exceeds the inspection limit.",
      {
        details: {
          inputPath,
          bytes: information.size,
          maxBytes: MAX_DOTLOTTIE_ARCHIVE_BYTES,
        },
      },
    );
  }
  const buffer = await readFile(inputPath);
  throwIfCancelled(signal);
  return Object.freeze({
    bytes: Uint8Array.from(buffer),
    byteLength: buffer.byteLength,
    sha256: createHash("sha256").update(buffer).digest("hex"),
  });
}

export function createVectorMcpDotLottieOperations(
  pathPolicy: VectorMcpPathPolicy,
): VectorMcpDotLottieOperations {
  async function packageDotLottie(
    request: VectorMcpPackageDotLottieRequest,
    signal?: AbortSignal,
  ): Promise<Readonly<Record<string, unknown>>> {
    assertExtension(request.inputPath, ".json", "inputPath");
    assertExtension(request.outputPath, ".lottie", "outputPath");
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
    const resolvedOutputPath = await pathPolicy.resolveOutputFile(
      request.outputPath,
    );
    const resolvedEvidencePath = request.evidenceOutputPath
      ? await pathPolicy.resolveOutputFile(request.evidenceOutputPath)
      : null;
    pathPolicy.assertDistinct([
      resolvedInputPath,
      resolvedOutputPath,
      ...(resolvedEvidencePath ? [resolvedEvidencePath] : []),
    ]);

    const input = await readBoundedLottieJson(resolvedInputPath, signal);
    throwIfCancelled(signal);
    const result = createDotLottiePackage(input.source, {
      animationId: request.animationId,
    });
    throwIfCancelled(signal);

    const commitOutputPath = await pathPolicy.resolveOutputFile(
      resolvedOutputPath,
    );
    const commitEvidencePath = resolvedEvidencePath
      ? await pathPolicy.resolveOutputFile(resolvedEvidencePath)
      : null;
    pathPolicy.assertDistinct([
      resolvedInputPath,
      commitOutputPath,
      ...(commitEvidencePath ? [commitEvidencePath] : []),
    ]);

    const evidenceDocument = Object.freeze({
      operation: "package-dotlottie",
      mcpContractVersion: VECTOR_MCP_DOTLOTTIE_CONTRACT_VERSION,
      dotLottieContractVersion: DOTLOTTIE_CONTRACT_VERSION,
      manifestVersion: DOTLOTTIE_MANIFEST_VERSION,
      input: Object.freeze({
        requestedPath: request.inputPath,
        path: resolvedInputPath,
        bytes: input.bytes,
        sha256: input.sha256,
      }),
      outputPath: commitOutputPath,
      manifest: result.manifest,
      inspection: result.inspection,
      evidence: result.evidence,
    });

    const receipts = await commitNewVectorFiles([
      {
        path: commitOutputPath,
        data: result.bytes,
        mimeType: DOTLOTTIE_MIME_TYPE,
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
      operation: "package-dotlottie",
      mcpContractVersion: VECTOR_MCP_DOTLOTTIE_CONTRACT_VERSION,
      dotLottieContractVersion: DOTLOTTIE_CONTRACT_VERSION,
      manifestVersion: DOTLOTTIE_MANIFEST_VERSION,
      input: Object.freeze({
        requestedPath: request.inputPath,
        path: resolvedInputPath,
        bytes: input.bytes,
        sha256: input.sha256,
      }),
      outputs: Object.freeze({
        dotLottie: receiptByPath(receipts, commitOutputPath),
        evidence: commitEvidencePath
          ? receiptByPath(receipts, commitEvidencePath)
          : null,
      }),
      manifest: result.manifest,
      inspection: result.inspection,
      evidence: result.evidence,
      compatibility: result.evidence.compatibility,
      approval: result.evidence.approval,
    });
  }

  async function inspectDotLottieFile(
    inputPath: string,
    signal?: AbortSignal,
  ): Promise<Readonly<Record<string, unknown>>> {
    assertExtension(inputPath, ".lottie", "inputPath");
    const resolvedInputPath = await pathPolicy.resolveInputFile(inputPath);
    const archive = await readBoundedArchive(resolvedInputPath, signal);
    const inspection = inspectDotLottie(archive.bytes);
    return Object.freeze({
      ok: true,
      operation: "inspect-dotlottie",
      mcpContractVersion: VECTOR_MCP_DOTLOTTIE_CONTRACT_VERSION,
      dotLottieContractVersion: DOTLOTTIE_CONTRACT_VERSION,
      input: Object.freeze({
        requestedPath: inputPath,
        path: resolvedInputPath,
        bytes: archive.byteLength,
        sha256: archive.sha256,
      }),
      inspection,
      approval: inspection.valid
        ? "human-review-required"
        : "structural-repair-required",
    });
  }

  return Object.freeze({
    packageDotLottie,
    inspectDotLottie: inspectDotLottieFile,
  });
}

export function extendVectorMcpDotLottieCapabilities(
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
    mcpContractVersion: VECTOR_MCP_DOTLOTTIE_CONTRACT_VERSION,
    tools: Object.freeze([
      ...baseTools,
      ...VECTOR_MCP_DOTLOTTIE_TOOL_NAMES,
    ]),
    dotLottie: Object.freeze({
      contractVersion: DOTLOTTIE_CONTRACT_VERSION,
      manifestVersion: DOTLOTTIE_MANIFEST_VERSION,
      inputMode: "allowed-root-lottie-json-file",
      outputMode: "new-files-only",
      deterministic: true,
      maximumLottieJsonBytes: MAX_DOTLOTTIE_LOTTIE_BYTES,
      maximumArchiveBytes: MAX_DOTLOTTIE_ARCHIVE_BYTES,
      archiveInspection: true,
      embeddedLottieInspection: true,
      playerRenderValidation: false,
      browserArchiveLoadValidation: false,
      modelContextIncludesArchiveBytes: false,
      modelContextIncludesEmbeddedJson: false,
    }),
    outputs: Object.freeze({
      ...baseOutputs,
      dotLottie: true,
      dotLottieArchive: true,
      dotLottiePlayerRenderValidation: false,
      dotLottieBrowserArchiveLoadValidation: false,
    }),
  });
}

export function registerVectorMcpDotLottieTools(
  server: McpServer,
  pathPolicy: VectorMcpPathPolicy,
): VectorMcpDotLottieOperations {
  const operations = createVectorMcpDotLottieOperations(pathPolicy);
  const pathSchema = z
    .string()
    .min(1)
    .max(4096)
    .describe(
      "Absolute path or path relative to the MCP server working directory.",
    );

  server.registerTool(
    "vector_package_dotlottie",
    {
      title: "Package Deterministic dotLottie",
      description:
        "Package one governed Lottie JSON file into a new deterministic dotLottie v2 archive and optional evidence JSON. Returns receipts and evidence, never archive bytes or embedded JSON.",
      inputSchema: {
        inputPath: pathSchema.describe(
          "Existing governed Lottie JSON within an allowed root.",
        ),
        outputPath: pathSchema.describe(
          "New .lottie archive path. Existing files are rejected.",
        ),
        evidenceOutputPath: pathSchema
          .describe("Optional new JSON evidence output path.")
          .optional(),
        animationId: z
          .string()
          .trim()
          .regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/)
          .optional()
          .describe("Portable manifest animation ID, default main-animation."),
      },
    },
    async (input, extra) =>
      executeTool(() => operations.packageDotLottie(input, extra.signal)),
  );

  server.registerTool(
    "vector_inspect_dotlottie",
    {
      title: "Inspect dotLottie Archive",
      description:
        "Inspect one existing .lottie archive for ZIP safety, deterministic metadata, manifest semantics and embedded governed Lottie structure without returning archive bytes.",
      inputSchema: {
        inputPath: pathSchema.describe(
          "Existing dotLottie archive within an allowed root.",
        ),
      },
    },
    async ({ inputPath }, extra) =>
      executeTool(() => operations.inspectDotLottie(inputPath, extra.signal)),
  );

  return operations;
}
