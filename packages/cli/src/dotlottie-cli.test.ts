import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { createLottieFromSvgMotion } from "@evavo/lottie-engine";

const SOURCE = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><title>Mark</title><g id="mark"><path fill="#111111" d="M10 10H90V90H10Z"/></g></svg>';
const MOTION = {
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
} as const;

const cliPath = fileURLToPath(new URL("./dotlottie-cli.js", import.meta.url));

function run(args: readonly string[]) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
  });
}

test("packages and inspects dotLottie through the CLI without overwriting", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "evavo-dotlottie-cli-"));
  const inputPath = path.join(root, "mark.lottie.json");
  const outputPath = path.join(root, "mark.lottie");
  const evidencePath = path.join(root, "mark.lottie.evidence.json");
  try {
    const lottie = createLottieFromSvgMotion(SOURCE, MOTION);
    await writeFile(inputPath, lottie.json, "utf8");

    const packaged = run([
      "package",
      inputPath,
      "--out",
      outputPath,
      "--animation-id",
      "mark-intro",
      "--evidence-out",
      evidencePath,
    ]);
    assert.equal(packaged.status, 0, packaged.stderr);
    const payload = JSON.parse(packaged.stdout) as {
      command?: string;
      written?: boolean;
      outputs?: {
        dotLottie?: { mimeType?: string; sha256?: string; bytes?: number };
        evidence?: { sha256?: string };
      };
      manifest?: { version?: string; initial?: { animation?: string } };
      inspection?: { valid?: boolean; entryCount?: number };
      evidence?: { compatibility?: { playerRenderValidation?: string } };
    };
    assert.equal(payload.command, "dotlottie:package");
    assert.equal(payload.written, true);
    assert.equal(payload.outputs?.dotLottie?.mimeType, "application/zip+dotlottie");
    assert.match(payload.outputs?.dotLottie?.sha256 ?? "", /^[a-f0-9]{64}$/);
    assert.match(payload.outputs?.evidence?.sha256 ?? "", /^[a-f0-9]{64}$/);
    assert.ok((payload.outputs?.dotLottie?.bytes ?? 0) > 0);
    assert.equal(payload.manifest?.version, "2");
    assert.equal(payload.manifest?.initial?.animation, "mark-intro");
    assert.equal(payload.inspection?.valid, true);
    assert.equal(payload.inspection?.entryCount, 2);
    assert.equal(payload.evidence?.compatibility?.playerRenderValidation, "not-yet-performed");

    const archive = await readFile(outputPath);
    assert.deepEqual([...archive.subarray(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
    const evidence = JSON.parse(await readFile(evidencePath, "utf8")) as {
      evidence?: { output?: { sha256?: string } };
    };
    assert.equal(evidence.evidence?.output?.sha256, payload.outputs?.dotLottie?.sha256);

    const inspected = run(["inspect", outputPath]);
    assert.equal(inspected.status, 0, inspected.stderr);
    const inspection = JSON.parse(inspected.stdout) as {
      command?: string;
      valid?: boolean;
      manifestVersion?: string;
      initialAnimationId?: string;
      approval?: string;
    };
    assert.equal(inspection.command, "dotlottie:inspect");
    assert.equal(inspection.valid, true);
    assert.equal(inspection.manifestVersion, "2");
    assert.equal(inspection.initialAnimationId, "mark-intro");
    assert.equal(inspection.approval, "human-review-required");

    const repeated = run(["package", inputPath, "--out", outputPath]);
    assert.equal(repeated.status, 2);
    assert.match(repeated.stderr, /VECTOR_OUTPUT_TRANSACTION_FAILED/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("reports machine-readable capabilities and governed option failures", async () => {
  const capabilities = run(["capabilities"]);
  assert.equal(capabilities.status, 0, capabilities.stderr);
  const contract = JSON.parse(capabilities.stdout) as {
    dotLottieContractVersion?: string;
    manifestVersion?: string;
    packaging?: { deterministic?: boolean; compression?: string; outputMode?: string };
    compatibility?: { playerRenderValidation?: boolean; browserArchiveLoadValidation?: boolean };
  };
  assert.equal(contract.dotLottieContractVersion, "1.0");
  assert.equal(contract.manifestVersion, "2");
  assert.equal(contract.packaging?.deterministic, true);
  assert.equal(contract.packaging?.compression, "deflate");
  assert.equal(contract.packaging?.outputMode, "new-files-only");
  assert.equal(contract.compatibility?.playerRenderValidation, false);
  assert.equal(contract.compatibility?.browserArchiveLoadValidation, false);

  const root = await mkdtemp(path.join(os.tmpdir(), "evavo-dotlottie-cli-options-"));
  try {
    const inputPath = path.join(root, "mark.json");
    await writeFile(inputPath, createLottieFromSvgMotion(SOURCE, MOTION).json, "utf8");
    const invalid = run([
      "package",
      inputPath,
      "--animation-id",
      "../unsafe",
    ]);
    assert.equal(invalid.status, 2);
    assert.match(invalid.stderr, /DOTLOTTIE_OPTIONS_INVALID/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
