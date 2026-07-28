import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createRasterRuntimeGuard } from "@evavo/raster-engine";
import {
  VECTOR_MCP_BATCH_CONTRACT_VERSION,
  VECTOR_MCP_BATCH_MAX_ITEMS,
  VECTOR_MCP_BATCH_TOOL_NAMES,
} from "./batch-tools.js";
import { createVectorMcpServer } from "./server.js";

async function connectedServer(root: string) {
  const { server } = await createVectorMcpServer({
    pathPolicyOptions: { cwd: root, allowedRoots: [root] },
    runtimeGuard: createRasterRuntimeGuard({
      timeoutMs: 10_000,
      maxConcurrent: 1,
      retryAfterSeconds: 1,
    }),
  });
  const client = new Client({
    name: "evavo-vector-studio-batch-test",
    version: "0.4.0",
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return Object.freeze({ server, client });
}

function optimiseItem(id: string, source: string) {
  return Object.freeze({
    id,
    operation: "optimise-svg",
    spec: Object.freeze({
      inputPath: source,
      outputPath: `output/${id}.optimised.svg`,
      evidenceOutputPath: `output/${id}.optimised.evidence.json`,
    }),
  });
}

test("runs, paginates, inspects and safely resumes a receipt-only durable batch", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "evavo-vector-mcp-batch-"));
  const manifestPath = path.join(root, "batch.json");
  try {
    await writeFile(
      path.join(root, "first.svg"),
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><title>First</title><path id="first" fill="#ff244e" d="M2 2H18V18H2Z"/></svg>',
      "utf8",
    );
    await writeFile(
      path.join(root, "second.svg"),
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><title>Second</title><path id="second" fill="#111111" d="M3 3H17V17H3Z"/></svg>',
      "utf8",
    );
    await writeFile(
      manifestPath,
      `${JSON.stringify({
        $schema: "../schemas/batch-v1.schema.json",
        version: "1.0",
        id: "mcp-batch-fixture",
        name: "MCP batch fixture",
        failureMode: "continue",
        items: [
          optimiseItem("first", "first.svg"),
          optimiseItem("second", "second.svg"),
        ],
      }, null, 2)}\n`,
      "utf8",
    );

    const { server, client } = await connectedServer(root);
    try {
      const listed = await client.listTools();
      for (const toolName of VECTOR_MCP_BATCH_TOOL_NAMES) {
        assert.ok(listed.tools.some((tool) => tool.name === toolName));
      }

      const capabilities = await client.callTool({
        name: "vector_capabilities",
        arguments: {},
      });
      assert.notEqual(capabilities.isError, true);
      const capabilityPayload = capabilities.structuredContent as {
        mcpContractVersion?: string;
        durableBatch?: {
          contractVersion?: string;
          maximumManifestItems?: number;
          persistentState?: boolean;
          resumable?: boolean;
          generatedBodiesInModelContext?: boolean;
          hostedBackgroundQueue?: boolean;
        };
      } | undefined;
      assert.equal(capabilityPayload?.mcpContractVersion, "1.4");
      assert.equal(
        capabilityPayload?.durableBatch?.contractVersion,
        VECTOR_MCP_BATCH_CONTRACT_VERSION,
      );
      assert.equal(
        capabilityPayload?.durableBatch?.maximumManifestItems,
        VECTOR_MCP_BATCH_MAX_ITEMS,
      );
      assert.equal(capabilityPayload?.durableBatch?.persistentState, true);
      assert.equal(capabilityPayload?.durableBatch?.resumable, true);
      assert.equal(
        capabilityPayload?.durableBatch?.generatedBodiesInModelContext,
        false,
      );
      assert.equal(capabilityPayload?.durableBatch?.hostedBackgroundQueue, false);

      const first = await client.callTool({
        name: "vector_run_batch",
        arguments: {
          manifestPath,
          rootPath: root,
          itemOffset: 0,
          itemLimit: 1,
          eventLimit: 100,
        },
      });
      if (first.isError) {
        throw new Error(`vector_run_batch failed: ${JSON.stringify(first.structuredContent)}`);
      }
      const firstPayload = first.structuredContent as {
        ok?: boolean;
        approval?: string;
        generatedBodiesInModelContext?: boolean;
        hostedBackgroundQueue?: boolean;
        state?: {
          status?: string;
          progress?: { total?: number; complete?: number; percentComplete?: number };
          page?: { returned?: number; nextOffset?: number | null };
          items?: Array<{
            id?: string;
            attempts?: number;
            outputs?: Array<{ path?: string; sha256?: string }>;
          }>;
        };
      } | undefined;
      assert.equal(firstPayload?.ok, true);
      assert.equal(firstPayload?.approval, "human-review-required");
      assert.equal(firstPayload?.generatedBodiesInModelContext, false);
      assert.equal(firstPayload?.hostedBackgroundQueue, false);
      assert.equal(firstPayload?.state?.status, "complete");
      assert.equal(firstPayload?.state?.progress?.total, 2);
      assert.equal(firstPayload?.state?.progress?.complete, 2);
      assert.equal(firstPayload?.state?.progress?.percentComplete, 100);
      assert.equal(firstPayload?.state?.page?.returned, 1);
      assert.equal(firstPayload?.state?.page?.nextOffset, 1);
      assert.equal(firstPayload?.state?.items?.[0]?.id, "first");
      assert.equal(firstPayload?.state?.items?.[0]?.attempts, 1);
      assert.match(
        firstPayload?.state?.items?.[0]?.outputs?.[0]?.sha256 ?? "",
        /^[a-f0-9]{64}$/,
      );
      assert.doesNotMatch(JSON.stringify(firstPayload), /<svg\b/i);

      const inspected = await client.callTool({
        name: "vector_inspect_batch",
        arguments: {
          manifestPath,
          rootPath: root,
          itemOffset: 1,
          itemLimit: 1,
          eventLimit: 100,
        },
      });
      if (inspected.isError) {
        throw new Error(`vector_inspect_batch failed: ${JSON.stringify(inspected.structuredContent)}`);
      }
      const inspectedPayload = inspected.structuredContent as {
        state?: {
          page?: { returned?: number; nextOffset?: number | null };
          items?: Array<{ id?: string; attempts?: number }>;
        };
        recentEvents?: Array<{ type?: string }>;
      } | undefined;
      assert.equal(inspectedPayload?.state?.page?.returned, 1);
      assert.equal(inspectedPayload?.state?.page?.nextOffset, null);
      assert.equal(inspectedPayload?.state?.items?.[0]?.id, "second");
      assert.equal(inspectedPayload?.state?.items?.[0]?.attempts, 1);

      const resumed = await client.callTool({
        name: "vector_run_batch",
        arguments: {
          manifestPath,
          rootPath: root,
          itemOffset: 0,
          itemLimit: 2,
          eventLimit: 100,
        },
      });
      if (resumed.isError) {
        throw new Error(`vector_run_batch resume failed: ${JSON.stringify(resumed.structuredContent)}`);
      }
      const resumedPayload = resumed.structuredContent as {
        state?: { items?: Array<{ attempts?: number }> };
        recentEvents?: Array<{ type?: string }>;
      } | undefined;
      assert.deepEqual(
        resumedPayload?.state?.items?.map((item) => item.attempts),
        [1, 1],
      );
      assert.ok(
        resumedPayload?.recentEvents?.some((event) => event.type === "item-reused"),
      );
      assert.doesNotMatch(JSON.stringify(resumedPayload), /<svg\b/i);

      assert.match(
        await readFile(path.join(root, "output", "first.optimised.svg"), "utf8"),
        /<svg\b/i,
      );
      assert.match(
        await readFile(
          path.join(root, "output", "first.optimised.evidence.json"),
          "utf8",
        ),
        /"bytesSaved"/,
      );
    } finally {
      await client.close();
      await server.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects manifests above the MCP batch item limit before production work", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "evavo-vector-mcp-batch-limit-"));
  const manifestPath = path.join(root, "batch.json");
  try {
    await writeFile(
      manifestPath,
      `${JSON.stringify({
        version: "1.0",
        id: "mcp-batch-limit",
        name: "MCP batch limit",
        failureMode: "continue",
        items: Array.from({ length: VECTOR_MCP_BATCH_MAX_ITEMS + 1 }, (_, index) => ({
          id: `item-${index}`,
          operation: "optimise-svg",
          spec: {
            inputPath: "unused.svg",
            outputPath: `output/item-${index}.svg`,
            evidenceOutputPath: `output/item-${index}.json`,
          },
        })),
      }, null, 2)}\n`,
      "utf8",
    );

    const { server, client } = await connectedServer(root);
    try {
      const result = await client.callTool({
        name: "vector_run_batch",
        arguments: { manifestPath, rootPath: root },
      });
      assert.equal(result.isError, true);
      const payload = result.structuredContent as {
        error?: { code?: string; retryable?: boolean; details?: { maximum?: number } };
      } | undefined;
      assert.equal(payload?.error?.code, "VECTOR_MCP_BATCH_TOO_LARGE");
      assert.equal(payload?.error?.retryable, false);
      assert.equal(payload?.error?.details?.maximum, VECTOR_MCP_BATCH_MAX_ITEMS);
    } finally {
      await client.close();
      await server.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
