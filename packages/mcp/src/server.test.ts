import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createRasterRuntimeGuard } from "@evavo/raster-engine";
import { VECTOR_MCP_TOOL_NAMES } from "./operations.js";
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
  const client = new Client({ name: "evavo-vector-studio-test", version: "0.4.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return Object.freeze({ server, client });
}

test("performs an MCP handshake and exposes the governed tool set", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "evavo-vector-mcp-sdk-"));
  const { server, client } = await connectedServer(root);
  try {
    const listed = await client.listTools();
    assert.deepEqual(
      listed.tools.map((tool) => tool.name).sort(),
      [...VECTOR_MCP_TOOL_NAMES].sort(),
    );
    assert.equal(client.getServerVersion()?.name, "evavo-vector-studio");
    assert.match(client.getInstructions() ?? "", /new files only|new-files-only/i);

    const result = await client.callTool({
      name: "vector_capabilities",
      arguments: {},
    });
    assert.notEqual(result.isError, true);
    const payload = result.structuredContent as Record<string, unknown> | undefined;
    assert.equal(payload?.ok, true);
    assert.equal(payload?.transport, "stdio");
    assert.equal(payload?.approval, "human-review-required");
  } finally {
    await client.close();
    await server.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("returns a structured stable failure instead of leaking an exception", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "evavo-vector-mcp-sdk-error-"));
  const { server, client } = await connectedServer(root);
  try {
    const result = await client.callTool({
      name: "vector_inspect_svg",
      arguments: { inputPath: "missing.svg" },
    });
    assert.equal(result.isError, true);
    const payload = result.structuredContent as {
      ok?: boolean;
      error?: { code?: string; retryable?: boolean };
    } | undefined;
    assert.equal(payload?.ok, false);
    assert.equal(payload?.error?.code, "VECTOR_MCP_INPUT_NOT_FOUND");
    assert.equal(payload?.error?.retryable, false);
  } finally {
    await client.close();
    await server.close();
    await rm(root, { recursive: true, force: true });
  }
});
