import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import {
  BATCH_CONTRACT_VERSION,
  inspectDurableBatch,
  readBatchManifest,
  runDurableBatch,
  type BatchItemState,
  type BatchJobState,
} from "@evavo/job-engine";
import {
  VECTOR_BATCH_OPERATION_NAMES,
  createVectorBatchOperationRegistry,
} from "@evavo/vector-jobs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { VectorMcpOperationError, vectorMcpFailure } from "./errors.js";
import type { VectorMcpPathPolicy } from "./path-policy.js";

export const VECTOR_MCP_BATCH_CONTRACT_VERSION = "1.0" as const;
export const VECTOR_MCP_BATCH_MAX_ITEMS = 100;
export const VECTOR_MCP_BATCH_TOOL_NAMES = Object.freeze([
  "vector_run_batch",
  "vector_inspect_batch",
] as const);

const DEFAULT_ITEM_LIMIT = 25;
const MAX_ITEM_LIMIT = 100;
const DEFAULT_EVENT_LIMIT = 25;
const MAX_EVENT_LIMIT = 100;

export type VectorMcpBatchRunRequest = Readonly<{
  manifestPath: string;
  rootPath?: string;
  itemOffset?: number;
  itemLimit?: number;
  eventLimit?: number;
}>;

export type VectorMcpBatchInspectRequest = VectorMcpBatchRunRequest;

export type VectorMcpBatchOperations = Readonly<{
  runBatch: (
    request: VectorMcpBatchRunRequest,
    signal?: AbortSignal,
  ) => Promise<Readonly<Record<string, unknown>>>;
  inspectBatch: (
    request: VectorMcpBatchInspectRequest,
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
    | (() => Promise<Readonly<Record<string, unknown>>>),
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
  const normalised = path.normalize(value);
  return process.platform === "win32"
    ? normalised.toLowerCase()
    : normalised;
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (
      relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative)
    )
  );
}

function throwIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new VectorMcpOperationError(
      "VECTOR_MCP_CANCELLED",
      "The MCP durable batch operation was cancelled.",
      { retryable: true },
    );
  }
}

function boundedInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  field: string,
): number {
  const resolved = value ?? fallback;
  if (
    !Number.isSafeInteger(resolved) ||
    resolved < minimum ||
    resolved > maximum
  ) {
    throw new VectorMcpOperationError(
      "VECTOR_MCP_OPTIONS_INVALID",
      `${field} must be an integer from ${minimum} to ${maximum}.`,
      { details: { field, value: resolved, minimum, maximum } },
    );
  }
  return resolved;
}

async function resolveBatchRoot(
  pathPolicy: VectorMcpPathPolicy,
  resolvedManifestPath: string,
  requestedRoot?: string,
): Promise<string> {
  let root: string | null = null;
  if (requestedRoot?.trim()) {
    const absolute = path.resolve(requestedRoot);
    try {
      root = await realpath(absolute);
    } catch (error) {
      throw new VectorMcpOperationError(
        "VECTOR_MCP_BATCH_ROOT_INVALID",
        "The requested MCP batch root does not exist or cannot be resolved.",
        {
          details: {
            requestedRoot,
            absolute,
            cause: error instanceof Error ? error.message : String(error),
          },
        },
      );
    }
    const information = await stat(root);
    if (!information.isDirectory()) {
      throw new VectorMcpOperationError(
        "VECTOR_MCP_BATCH_ROOT_INVALID",
        "The requested MCP batch root must be a directory.",
        { details: { requestedRoot, root } },
      );
    }
    if (!pathPolicy.roots.some((allowed) => isWithin(allowed, root!))) {
      throw new VectorMcpOperationError(
        "VECTOR_MCP_PATH_OUTSIDE_ROOT",
        "The requested MCP batch root is outside every configured allowed root.",
        {
          details: {
            requestedRoot,
            root,
            allowedRoots: pathPolicy.roots,
          },
        },
      );
    }
  } else {
    root = [...pathPolicy.roots]
      .filter((allowed) => isWithin(allowed, resolvedManifestPath))
      .sort((left, right) => right.length - left.length)[0] ?? null;
  }

  if (!root || !isWithin(root, resolvedManifestPath)) {
    throw new VectorMcpOperationError(
      "VECTOR_MCP_BATCH_ROOT_INVALID",
      "The batch manifest must remain inside the selected MCP batch root.",
      {
        details: {
          resolvedManifestPath,
          selectedRoot: root,
          allowedRoots: pathPolicy.roots,
        },
      },
    );
  }
  return root;
}

function itemSummary(item: BatchItemState): Readonly<Record<string, unknown>> {
  return Object.freeze({
    id: item.id,
    operation: item.operation,
    status: item.status,
    attempts: item.attempts,
    revision: item.revision,
    startedAt: item.startedAt,
    finishedAt: item.finishedAt,
    outputs: item.outputs,
    error: item.error,
  });
}

function stateProgress(state: BatchJobState): Readonly<Record<string, number>> {
  const count = (status: BatchItemState["status"]) =>
    state.items.filter((item) => item.status === status).length;
  const complete = count("complete");
  return Object.freeze({
    total: state.items.length,
    pending: count("pending"),
    running: count("running"),
    complete,
    failed: count("failed"),
    skipped: count("skipped"),
    percentComplete: state.items.length === 0
      ? 0
      : Number(((complete / state.items.length) * 100).toFixed(2)),
  });
}

function paginatedState(
  state: BatchJobState,
  offset: number,
  limit: number,
): Readonly<Record<string, unknown>> {
  const items = state.items.slice(offset, offset + limit).map(itemSummary);
  return Object.freeze({
    jobId: state.jobId,
    status: state.status,
    failureMode: state.failureMode,
    manifestSha256: state.manifestSha256,
    rootPath: state.rootPath,
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
    startedAt: state.startedAt,
    finishedAt: state.finishedAt,
    progress: stateProgress(state),
    page: Object.freeze({
      offset,
      limit,
      returned: items.length,
      totalItems: state.items.length,
      nextOffset: offset + items.length < state.items.length
        ? offset + items.length
        : null,
    }),
    items: Object.freeze(items),
  });
}

async function prepareRequest(
  pathPolicy: VectorMcpPathPolicy,
  request: VectorMcpBatchRunRequest,
  signal?: AbortSignal,
): Promise<Readonly<{
  manifestPath: string;
  rootPath: string;
  itemOffset: number;
  itemLimit: number;
  eventLimit: number;
  manifest: Awaited<ReturnType<typeof readBatchManifest>>;
}>> {
  throwIfCancelled(signal);
  const manifestPath = await pathPolicy.resolveInputFile(request.manifestPath);
  const rootPath = await resolveBatchRoot(
    pathPolicy,
    manifestPath,
    request.rootPath,
  );
  const manifest = await readBatchManifest(manifestPath);
  if (manifest.manifest.items.length > VECTOR_MCP_BATCH_MAX_ITEMS) {
    throw new VectorMcpOperationError(
      "VECTOR_MCP_BATCH_TOO_LARGE",
      `MCP batch execution supports at most ${VECTOR_MCP_BATCH_MAX_ITEMS} items per manifest. Use evavo-vector-batch for larger local manifests.`,
      {
        details: {
          itemCount: manifest.manifest.items.length,
          maximum: VECTOR_MCP_BATCH_MAX_ITEMS,
        },
      },
    );
  }
  return Object.freeze({
    manifestPath,
    rootPath,
    itemOffset: boundedInteger(
      request.itemOffset,
      0,
      0,
      Math.max(0, manifest.manifest.items.length),
      "itemOffset",
    ),
    itemLimit: boundedInteger(
      request.itemLimit,
      DEFAULT_ITEM_LIMIT,
      1,
      MAX_ITEM_LIMIT,
      "itemLimit",
    ),
    eventLimit: boundedInteger(
      request.eventLimit,
      DEFAULT_EVENT_LIMIT,
      0,
      MAX_EVENT_LIMIT,
      "eventLimit",
    ),
    manifest,
  });
}

export function createVectorMcpBatchOperations(
  pathPolicy: VectorMcpPathPolicy,
): VectorMcpBatchOperations {
  async function runBatch(
    request: VectorMcpBatchRunRequest,
    signal?: AbortSignal,
  ): Promise<Readonly<Record<string, unknown>>> {
    const prepared = await prepareRequest(pathPolicy, request, signal);
    const result = await runDurableBatch({
      manifestPath: prepared.manifestPath,
      rootPath: prepared.rootPath,
      handlers: createVectorBatchOperationRegistry(),
      signal,
    });
    throwIfCancelled(signal);
    const inspection = await inspectDurableBatch({
      jobId: prepared.manifest.manifest.id,
      rootPath: prepared.rootPath,
      eventLimit: prepared.eventLimit,
    });
    return Object.freeze({
      ok: true,
      operation: "run-batch",
      batchContractVersion: BATCH_CONTRACT_VERSION,
      mcpBatchContractVersion: VECTOR_MCP_BATCH_CONTRACT_VERSION,
      manifest: Object.freeze({
        requestedPath: request.manifestPath,
        path: prepared.manifestPath,
        sha256: prepared.manifest.sha256,
        itemCount: prepared.manifest.manifest.items.length,
      }),
      jobDirectory: result.jobDirectory,
      state: paginatedState(
        result.state,
        prepared.itemOffset,
        prepared.itemLimit,
      ),
      lock: inspection.lock,
      recentEvents: inspection.recentEvents,
      generatedBodiesInModelContext: false,
      hostedBackgroundQueue: false,
      approval: "human-review-required",
    });
  }

  async function inspectBatch(
    request: VectorMcpBatchInspectRequest,
    signal?: AbortSignal,
  ): Promise<Readonly<Record<string, unknown>>> {
    const prepared = await prepareRequest(pathPolicy, request, signal);
    const inspection = await inspectDurableBatch({
      jobId: prepared.manifest.manifest.id,
      rootPath: prepared.rootPath,
      eventLimit: prepared.eventLimit,
    });
    throwIfCancelled(signal);
    return Object.freeze({
      ok: true,
      operation: "inspect-batch",
      batchContractVersion: BATCH_CONTRACT_VERSION,
      mcpBatchContractVersion: VECTOR_MCP_BATCH_CONTRACT_VERSION,
      manifest: Object.freeze({
        requestedPath: request.manifestPath,
        path: prepared.manifestPath,
        sha256: prepared.manifest.sha256,
        itemCount: prepared.manifest.manifest.items.length,
      }),
      jobDirectory: inspection.jobDirectory,
      state: paginatedState(
        inspection.state,
        prepared.itemOffset,
        prepared.itemLimit,
      ),
      lock: inspection.lock,
      recentEvents: inspection.recentEvents,
      generatedBodiesInModelContext: false,
      hostedBackgroundQueue: false,
      approval: inspection.state.status === "complete"
        ? "human-review-required"
        : "processing-or-repair-required",
    });
  }

  return Object.freeze({ runBatch, inspectBatch });
}

export function extendVectorMcpBatchCapabilities(
  base: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const baseTools = Array.isArray(base.tools)
    ? base.tools.filter((item): item is string => typeof item === "string")
    : [];
  const baseOutputs = base.outputs && typeof base.outputs === "object"
    ? base.outputs as Record<string, unknown>
    : {};
  return Object.freeze({
    ...base,
    mcpContractVersion: "1.4",
    tools: Object.freeze([
      ...baseTools,
      ...VECTOR_MCP_BATCH_TOOL_NAMES,
    ]),
    durableBatch: Object.freeze({
      contractVersion: VECTOR_MCP_BATCH_CONTRACT_VERSION,
      manifestContractVersion: BATCH_CONTRACT_VERSION,
      operations: VECTOR_BATCH_OPERATION_NAMES,
      maximumManifestItems: VECTOR_MCP_BATCH_MAX_ITEMS,
      itemPageLimit: MAX_ITEM_LIMIT,
      eventLimit: MAX_EVENT_LIMIT,
      persistentState: true,
      resumable: true,
      cancellationAware: true,
      canonicalAllowedRoots: true,
      existingOutputsOverwritten: false,
      generatedBodiesInModelContext: false,
      hostedBackgroundQueue: false,
    }),
    outputs: Object.freeze({
      ...baseOutputs,
      durableBatch: true,
      hostedBackgroundQueue: false,
    }),
  });
}

export function registerVectorMcpBatchTools(
  server: McpServer,
  pathPolicy: VectorMcpPathPolicy,
): VectorMcpBatchOperations {
  const operations = createVectorMcpBatchOperations(pathPolicy);
  const pathSchema = z.string().min(1).max(4096);
  const sharedSchema = {
    manifestPath: pathSchema.describe(
      "Existing batch-v1 manifest inside an allowed root.",
    ),
    rootPath: pathSchema.describe(
      "Optional canonical batch execution root inside an MCP allowed root. Defaults to the deepest allowed root containing the manifest.",
    ).optional(),
    itemOffset: z.number().int().min(0).max(100).optional(),
    itemLimit: z.number().int().min(1).max(MAX_ITEM_LIMIT).optional(),
    eventLimit: z.number().int().min(0).max(MAX_EVENT_LIMIT).optional(),
  };

  server.registerTool(
    "vector_run_batch",
    {
      title: "Run or Resume Durable Vector Batch",
      description:
        "Run or resume one bounded batch-v1 manifest using persistent local state. Returns paginated status and file receipts, never generated SVG, PNG, Lottie JSON or archive bodies.",
      inputSchema: sharedSchema,
    },
    async (input, extra) =>
      executeTool(() => operations.runBatch(input, extra.signal)),
  );

  server.registerTool(
    "vector_inspect_batch",
    {
      title: "Inspect Durable Vector Batch",
      description:
        "Inspect retained batch progress, paginated item receipts, failures, lock state and recent events without executing production work.",
      inputSchema: sharedSchema,
    },
    async (input, extra) =>
      executeTool(() => operations.inspectBatch(input, extra.signal)),
  );

  return operations;
}
