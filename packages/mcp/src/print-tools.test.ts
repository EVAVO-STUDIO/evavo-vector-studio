import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  createVectorMcpPathPolicy,
} from "./path-policy.js";
import {
  createVectorMcpPrintOperations,
  VECTOR_MCP_PRINT_CONTRACT_VERSION,
  VECTOR_MCP_PRINT_TOOL_NAMES,
} from "./print-tools.js";
import {
  createVectorMcpServer,
  VECTOR_MCP_SERVER_CONTRACT_VERSION,
} from "./server.js";

async function connectedServer(root: string) {
  const { server } = await createVectorMcpServer({
    pathPolicyOptions: { cwd: root, allowedRoots: [root] },
  });
  const client = new Client({
    name: "evavo-vector-print-preflight-test",
    version: "0.4.0",
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return Object.freeze({ server, client });
}

const COMMERCIAL_SVG = [
  '<svg xmlns="http://www.w3.org/2000/svg" width="216mm" height="303mm" viewBox="0 0 216 303">',
  "<title>Commercial print sample</title>",
  '<rect width="216" height="303" fill="#111"/>',
  "</svg>",
].join("");

test("exposes print preflight through the MCP handshake and writes no file", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "evavo-vector-mcp-print-"));
  const sourcePath = path.join(root, "commercial.svg");
  await writeFile(sourcePath, COMMERCIAL_SVG, "utf8");
  const before = await readdir(root);
  const { server, client } = await connectedServer(root);
  try {
    const listed = await client.listTools();
    assert.equal(
      listed.tools.some((tool) => tool.name === VECTOR_MCP_PRINT_TOOL_NAMES[0]),
      true,
    );

    const capabilityResult = await client.callTool({
      name: "vector_capabilities",
      arguments: {},
    });
    assert.notEqual(capabilityResult.isError, true);
    const capabilities = capabilityResult.structuredContent as {
      mcpContractVersion?: string;
      tools?: string[];
      printPreflight?: {
        profiles?: string[];
        productionApproval?: boolean;
        outputWritten?: boolean;
      };
      outputs?: {
        printPreflightEvidence?: boolean;
        printPreflightWritesFiles?: boolean;
        printProductionApproval?: boolean;
      };
    } | undefined;
    assert.equal(
      capabilities?.mcpContractVersion,
      VECTOR_MCP_SERVER_CONTRACT_VERSION,
    );
    assert.equal(
      capabilities?.tools?.includes("vector_preflight_svg_print"),
      true,
    );
    assert.deepEqual(capabilities?.printPreflight?.profiles, [
      "commercial",
      "large-format",
      "cut-vinyl",
      "screen-print",
    ]);
    assert.equal(capabilities?.printPreflight?.productionApproval, false);
    assert.equal(capabilities?.printPreflight?.outputWritten, false);
    assert.equal(capabilities?.outputs?.printPreflightEvidence, true);
    assert.equal(capabilities?.outputs?.printPreflightWritesFiles, false);
    assert.equal(capabilities?.outputs?.printProductionApproval, false);

    const result = await client.callTool({
      name: "vector_preflight_svg_print",
      arguments: {
        inputPath: sourcePath,
        profile: "commercial",
        trimWidthMm: 210,
        trimHeightMm: 297,
        bleedMm: 3,
      },
    });
    if (result.isError) {
      throw new Error(
        `vector_preflight_svg_print failed: ${JSON.stringify(result.structuredContent)}`,
      );
    }
    const payload = result.structuredContent as {
      ok?: boolean;
      operation?: string;
      contractVersion?: string;
      mcpPrintContractVersion?: string;
      input?: { path?: string; bytes?: number; sha256?: string };
      result?: {
        passed?: boolean;
        profile?: string;
        approval?: string;
        target?: {
          trimWidthMm?: number | null;
          trimHeightMm?: number | null;
          bleedMm?: number;
          expectedCanvasWidthMm?: number | null;
          expectedCanvasHeightMm?: number | null;
          dimensionsMatched?: boolean | null;
        };
      };
      outputWritten?: boolean;
      generatedBodiesInModelContext?: boolean;
      productionApproval?: boolean;
      approval?: string;
    } | undefined;
    assert.equal(payload?.ok, true);
    assert.equal(payload?.operation, "preflight-svg-print");
    assert.equal(payload?.contractVersion, "1.0");
    assert.equal(
      payload?.mcpPrintContractVersion,
      VECTOR_MCP_PRINT_CONTRACT_VERSION,
    );
    assert.equal(payload?.input?.path, sourcePath);
    assert.ok((payload?.input?.bytes ?? 0) > 0);
    assert.match(payload?.input?.sha256 ?? "", /^[a-f0-9]{64}$/);
    assert.equal(payload?.result?.passed, true);
    assert.equal(payload?.result?.profile, "commercial");
    assert.equal(payload?.result?.approval, "review-required");
    assert.equal(payload?.result?.target?.trimWidthMm, 210);
    assert.equal(payload?.result?.target?.trimHeightMm, 297);
    assert.equal(payload?.result?.target?.bleedMm, 3);
    assert.equal(payload?.result?.target?.expectedCanvasWidthMm, 216);
    assert.equal(payload?.result?.target?.expectedCanvasHeightMm, 303);
    assert.equal(payload?.result?.target?.dimensionsMatched, true);
    assert.equal(payload?.outputWritten, false);
    assert.equal(payload?.generatedBodiesInModelContext, false);
    assert.equal(payload?.productionApproval, false);
    assert.equal(payload?.approval, "review-required");
    assert.doesNotMatch(JSON.stringify(payload), /<svg\b/i);
    assert.deepEqual(await readdir(root), before);
  } finally {
    await client.close();
    await server.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("fails cancellation before reading an SVG", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "evavo-vector-mcp-print-cancel-"));
  const sourcePath = path.join(root, "commercial.svg");
  await writeFile(sourcePath, COMMERCIAL_SVG, "utf8");
  try {
    const pathPolicy = await createVectorMcpPathPolicy({
      cwd: root,
      allowedRoots: [root],
    });
    const operations = createVectorMcpPrintOperations(pathPolicy);
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      () =>
        operations.preflightSvgPrint(
          { inputPath: sourcePath, profile: "commercial" },
          controller.signal,
        ),
      (error) =>
        error instanceof Error &&
        "code" in error &&
        error.code === "VECTOR_MCP_CANCELLED",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects non-SVG input through the stable MCP error boundary", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "evavo-vector-mcp-print-extension-"));
  const sourcePath = path.join(root, "commercial.txt");
  await writeFile(sourcePath, COMMERCIAL_SVG, "utf8");
  const { server, client } = await connectedServer(root);
  try {
    const result = await client.callTool({
      name: "vector_preflight_svg_print",
      arguments: { inputPath: sourcePath, profile: "commercial" },
    });
    assert.equal(result.isError, true);
    assert.equal(
      (result.structuredContent as { error?: { code?: string } } | undefined)
        ?.error?.code,
      "VECTOR_MCP_INPUT_EXTENSION_INVALID",
    );
  } finally {
    await client.close();
    await server.close();
    await rm(root, { recursive: true, force: true });
  }
});
