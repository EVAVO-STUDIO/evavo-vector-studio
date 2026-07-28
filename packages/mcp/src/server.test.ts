import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createRasterRuntimeGuard } from "@evavo/raster-engine";
import { VECTOR_MCP_BATCH_TOOL_NAMES } from "./batch-tools.js";
import { VECTOR_MCP_DOTLOTTIE_TOOL_NAMES } from "./dotlottie-tools.js";
import { VECTOR_MCP_LOTTIE_TOOL_NAMES } from "./lottie-tools.js";
import { VECTOR_MCP_TOOL_NAMES } from "./operations.js";
import {
  createVectorMcpServer,
  VECTOR_MCP_SERVER_CONTRACT_VERSION,
} from "./server.js";

const ALL_TOOL_NAMES = Object.freeze([
  ...VECTOR_MCP_TOOL_NAMES,
  ...VECTOR_MCP_LOTTIE_TOOL_NAMES,
  ...VECTOR_MCP_DOTLOTTIE_TOOL_NAMES,
  ...VECTOR_MCP_BATCH_TOOL_NAMES,
]);

const MOTION_PLAN = Object.freeze({
  version: "1.0",
  name: "Gentle entrance",
  durationMs: 800,
  iterations: 1,
  direction: "normal",
  fillMode: "both",
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
} as const);

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
      [...ALL_TOOL_NAMES].sort(),
    );
    assert.equal(client.getServerVersion()?.name, "evavo-vector-studio");
    assert.match(client.getInstructions() ?? "", /new files only|new-files-only/i);
    assert.match(client.getInstructions() ?? "", /Lottie/i);
    assert.match(client.getInstructions() ?? "", /dotLottie/i);
    assert.match(client.getInstructions() ?? "", /durable batch|resumable/i);

    const result = await client.callTool({
      name: "vector_capabilities",
      arguments: {},
    });
    assert.notEqual(result.isError, true);
    const payload = result.structuredContent as Record<string, unknown> | undefined;
    assert.equal(payload?.ok, true);
    assert.equal(payload?.transport, "stdio");
    assert.equal(
      payload?.mcpContractVersion,
      VECTOR_MCP_SERVER_CONTRACT_VERSION,
    );
    assert.equal(payload?.approval, "human-review-required");
    const outputs = payload?.outputs as Record<string, unknown> | undefined;
    assert.equal(outputs?.animatedSvg, true);
    assert.equal(outputs?.lottie, true);
    assert.equal(outputs?.lottieJson, true);
    assert.equal(outputs?.lottiePlayerRenderValidation, false);
    assert.equal(outputs?.dotLottie, true);
    assert.equal(outputs?.dotLottieArchive, true);
    assert.equal(outputs?.dotLottiePlayerRenderValidation, false);
    assert.equal(outputs?.dotLottieBrowserArchiveLoadValidation, false);
    const lottie = payload?.lottie as Record<string, unknown> | undefined;
    assert.equal(lottie?.structuralInspection, true);
    assert.equal(lottie?.playerRenderValidation, false);
    assert.equal(lottie?.dotLottiePackaging, false);
    assert.equal(lottie?.modelContextIncludesGeneratedJson, false);
    const dotLottie = payload?.dotLottie as Record<string, unknown> | undefined;
    assert.equal(dotLottie?.manifestVersion, "2");
    assert.equal(dotLottie?.deterministic, true);
    assert.equal(dotLottie?.archiveInspection, true);
    assert.equal(dotLottie?.embeddedLottieInspection, true);
    assert.equal(dotLottie?.playerRenderValidation, false);
    assert.equal(dotLottie?.browserArchiveLoadValidation, false);
    assert.equal(dotLottie?.modelContextIncludesArchiveBytes, false);
    assert.equal(dotLottie?.modelContextIncludesEmbeddedJson, false);
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
        motionPlan: MOTION_PLAN,
      },
    });
    if (result.isError) {
      throw new Error(`vector_animate_svg failed: ${JSON.stringify(result.structuredContent)}`);
    }
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

test("exports and inspects Lottie through receipt-only MCP tools", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "evavo-vector-mcp-lottie-"));
  const sourcePath = path.join(root, "source.svg");
  const outputPath = path.join(root, "output.lottie.json");
  const evidencePath = path.join(root, "output.lottie.evidence.json");
  await writeFile(
    sourcePath,
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><title>Mark</title><g id="mark"><path id="body" fill="#111111" d="M10 10H90V90H10Z"/></g></svg>',
    "utf8",
  );
  const request = {
    inputPath: sourcePath,
    outputLottiePath: outputPath,
    evidenceOutputPath: evidencePath,
    frameRate: 60,
    precision: 4,
    motionPlan: MOTION_PLAN,
  } as const;
  const { server, client } = await connectedServer(root);
  try {
    const result = await client.callTool({
      name: "vector_export_lottie",
      arguments: request,
    });
    if (result.isError) {
      throw new Error(`vector_export_lottie failed: ${JSON.stringify(result.structuredContent)}`);
    }
    const payload = result.structuredContent as {
      ok?: boolean;
      approval?: string;
      compatibility?: {
        structuralInspection?: string;
        playerRenderValidation?: string;
        dotLottiePackaging?: string;
      };
      outputs?: {
        lottieJson?: { path?: string; mimeType?: string; bytes?: number; sha256?: string };
        evidence?: { path?: string; sha256?: string };
      };
    } | undefined;
    assert.equal(payload?.ok, true);
    assert.equal(payload?.approval, "review-required");
    assert.equal(payload?.outputs?.lottieJson?.path, outputPath);
    assert.equal(payload?.outputs?.lottieJson?.mimeType, "video/lottie+json");
    assert.equal(payload?.outputs?.evidence?.path, evidencePath);
    assert.match(payload?.outputs?.lottieJson?.sha256 ?? "", /^[a-f0-9]{64}$/);
    assert.equal(payload?.compatibility?.structuralInspection, "passed");
    assert.equal(payload?.compatibility?.playerRenderValidation, "not-yet-performed");
    assert.equal(payload?.compatibility?.dotLottiePackaging, "not-yet-available");
    assert.doesNotMatch(JSON.stringify(payload), /"layers"\s*:/);
    assert.doesNotMatch(JSON.stringify(payload), /"assets"\s*:/);

    const lottieSource = await readFile(outputPath, "utf8");
    const lottieDocument = JSON.parse(lottieSource) as {
      meta?: { contractVersion?: string };
      layers?: unknown[];
    };
    assert.equal(lottieDocument.meta?.contractVersion, "1.0");
    assert.ok(Array.isArray(lottieDocument.layers));
    assert.ok((lottieDocument.layers?.length ?? 0) > 0);

    const evidence = await readFile(evidencePath, "utf8");
    assert.doesNotMatch(evidence, /"layers"\s*:/);
    assert.doesNotMatch(evidence, /"assets"\s*:/);

    const inspection = await client.callTool({
      name: "vector_inspect_lottie",
      arguments: { inputPath: outputPath },
    });
    if (inspection.isError) {
      throw new Error(`vector_inspect_lottie failed: ${JSON.stringify(inspection.structuredContent)}`);
    }
    const inspectionPayload = inspection.structuredContent as {
      inspection?: { valid?: boolean; layerCount?: number; animatedPropertyCount?: number };
      approval?: string;
    } | undefined;
    assert.equal(inspectionPayload?.inspection?.valid, true);
    assert.ok((inspectionPayload?.inspection?.layerCount ?? 0) > 0);
    assert.ok((inspectionPayload?.inspection?.animatedPropertyCount ?? 0) > 0);
    assert.equal(inspectionPayload?.approval, "human-review-required");

    const duplicate = await client.callTool({
      name: "vector_export_lottie",
      arguments: request,
    });
    assert.equal(duplicate.isError, true);
    assert.equal(
      (duplicate.structuredContent as { error?: { code?: string } } | undefined)?.error?.code,
      "VECTOR_MCP_OUTPUT_EXISTS",
    );
  } finally {
    await client.close();
    await server.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("packages and inspects dotLottie through receipt-only MCP tools", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "evavo-vector-mcp-dotlottie-"));
  const sourcePath = path.join(root, "source.svg");
  const lottiePath = path.join(root, "output.lottie.json");
  const archivePath = path.join(root, "output.lottie");
  const evidencePath = path.join(root, "output.dotlottie.evidence.json");
  await writeFile(
    sourcePath,
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><title>Mark</title><g id="mark"><path id="body" fill="#111111" d="M10 10H90V90H10Z"/></g></svg>',
    "utf8",
  );
  const { server, client } = await connectedServer(root);
  try {
    const exported = await client.callTool({
      name: "vector_export_lottie",
      arguments: {
        inputPath: sourcePath,
        outputLottiePath: lottiePath,
        motionPlan: MOTION_PLAN,
      },
    });
    if (exported.isError) {
      throw new Error(`vector_export_lottie failed: ${JSON.stringify(exported.structuredContent)}`);
    }

    const request = {
      inputPath: lottiePath,
      outputPath: archivePath,
      evidenceOutputPath: evidencePath,
      animationId: "mark-intro",
    } as const;
    const packaged = await client.callTool({
      name: "vector_package_dotlottie",
      arguments: request,
    });
    if (packaged.isError) {
      throw new Error(`vector_package_dotlottie failed: ${JSON.stringify(packaged.structuredContent)}`);
    }
    const payload = packaged.structuredContent as {
      ok?: boolean;
      approval?: string;
      manifestVersion?: string;
      manifest?: { initial?: { animation?: string } };
      inspection?: { valid?: boolean; entryCount?: number };
      compatibility?: {
        archiveInspection?: string;
        embeddedLottieInspection?: string;
        playerRenderValidation?: string;
        browserArchiveLoadValidation?: string;
      };
      outputs?: {
        dotLottie?: { path?: string; mimeType?: string; bytes?: number; sha256?: string };
        evidence?: { path?: string; sha256?: string };
      };
    } | undefined;
    assert.equal(payload?.ok, true);
    assert.equal(payload?.approval, "review-required");
    assert.equal(payload?.manifestVersion, "2");
    assert.equal(payload?.manifest?.initial?.animation, "mark-intro");
    assert.equal(payload?.inspection?.valid, true);
    assert.equal(payload?.inspection?.entryCount, 2);
    assert.equal(payload?.outputs?.dotLottie?.path, archivePath);
    assert.equal(payload?.outputs?.dotLottie?.mimeType, "application/zip+dotlottie");
    assert.equal(payload?.outputs?.evidence?.path, evidencePath);
    assert.match(payload?.outputs?.dotLottie?.sha256 ?? "", /^[a-f0-9]{64}$/);
    assert.equal(payload?.compatibility?.archiveInspection, "passed");
    assert.equal(payload?.compatibility?.embeddedLottieInspection, "passed");
    assert.equal(payload?.compatibility?.playerRenderValidation, "not-yet-performed");
    assert.equal(payload?.compatibility?.browserArchiveLoadValidation, "not-yet-performed");
    assert.doesNotMatch(JSON.stringify(payload), /"layers"\s*:/);
    assert.doesNotMatch(JSON.stringify(payload), /UEsDB/);

    const archive = await readFile(archivePath);
    assert.deepEqual([...archive.subarray(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
    const evidence = await readFile(evidencePath, "utf8");
    assert.doesNotMatch(evidence, /"layers"\s*:/);
    assert.doesNotMatch(evidence, /UEsDB/);

    const inspected = await client.callTool({
      name: "vector_inspect_dotlottie",
      arguments: { inputPath: archivePath },
    });
    if (inspected.isError) {
      throw new Error(`vector_inspect_dotlottie failed: ${JSON.stringify(inspected.structuredContent)}`);
    }
    const inspectionPayload = inspected.structuredContent as {
      inspection?: { valid?: boolean; manifestVersion?: string; initialAnimationId?: string };
      approval?: string;
    } | undefined;
    assert.equal(inspectionPayload?.inspection?.valid, true);
    assert.equal(inspectionPayload?.inspection?.manifestVersion, "2");
    assert.equal(inspectionPayload?.inspection?.initialAnimationId, "mark-intro");
    assert.equal(inspectionPayload?.approval, "human-review-required");

    const duplicate = await client.callTool({
      name: "vector_package_dotlottie",
      arguments: request,
    });
    assert.equal(duplicate.isError, true);
    assert.equal(
      (duplicate.structuredContent as { error?: { code?: string } } | undefined)?.error?.code,
      "VECTOR_MCP_OUTPUT_EXISTS",
    );
  } finally {
    await client.close();
    await server.close();
    await rm(root, { recursive: true, force: true });
  }
});
