import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
    assert.equal((payload?.outputs as Record<string, unknown> | undefined)?.animatedSvg, true);
    assert.equal((payload?.outputs as Record<string, unknown> | undefined)?.lottie, false);
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

test("creates animated SVG from an inline plan without leaking SVG markup into model context", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "evavo-vector-mcp-motion-"));
  const sourcePath = path.join(root, "source.svg");
  const outputPath = path.join(root, "output.animated.svg");
  const evidencePath = path.join(root, "output.motion.evidence.json");
  await writeFile(
    sourcePath,
    '<svg viewBox="0 0 100 100"><title>Mark</title><g id="mark"><path d="M0 0L100 100"/></g></svg>',
    "utf8",
  );
  const { server, client } = await connectedServer(root);
  try {
    const result = await client.callTool({
      name: "vector_animate_svg",
      arguments: {
        inputPath: sourcePath,
        outputSvgPath: outputPath,
        evidenceOutputPath: evidencePath,
        motionPlan: {
          version: "1.0",
          name: "Gentle entrance",
          durationMs: 800,
          reducedMotion: "last-frame",
          tracks: [
            {
              targetId: "mark",
              keyframes: [
                { offset: 0, opacity: 0, translateY: 8 },
                { offset: 1, opacity: 1, translateY: 0 },
              ],
            },
          ],
        },
      },
    });
    assert.notEqual(result.isError, true);
    const payload = result.structuredContent as {
      ok?: boolean;
      approval?: string;
      outputs?: {
        animatedSvg?: { path?: string; sha256?: string };
        evidence?: { path?: string; sha256?: string };
      };
    } | undefined;
    assert.equal(payload?.ok, true);
    assert.equal(payload?.approval, "review-required");
    assert.equal(payload?.outputs?.animatedSvg?.path, outputPath);
    assert.equal(payload?.outputs?.evidence?.path, evidencePath);
    assert.match(payload?.outputs?.animatedSvg?.sha256 ?? "", /^[a-f0-9]{64}$/);
    assert.doesNotMatch(JSON.stringify(payload), /<svg\b/i);

    const animated = await readFile(outputPath, "utf8");
    const evidence = await readFile(evidencePath, "utf8");
    assert.match(animated, /data-evavo-motion-contract="1\.0"/);
    assert.match(animated, /@media\(prefers-reduced-motion:reduce\)/);
    assert.doesNotMatch(evidence, /<svg\b/i);

    const inspection = await client.callTool({
      name: "vector_inspect_animated_svg",
      arguments: { inputPath: outputPath },
    });
    assert.notEqual(inspection.isError, true);
    assert.equal(
      (inspection.structuredContent as { inspection?: { valid?: boolean } } | undefined)?.inspection?.valid,
      true,
    );
  } finally {
    await client.close();
    await server.close();
    await rm(root, { recursive: true, force: true });
  }
});
