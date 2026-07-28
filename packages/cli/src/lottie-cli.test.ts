import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const CLI_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "index.js");

function runCli(args: readonly string[]) {
  return spawnSync(process.execPath, [CLI_PATH, ...args], {
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
  });
}

function parseStdout(source: string): Record<string, unknown> {
  return JSON.parse(source) as Record<string, unknown>;
}

test("exports, inspects and refuses to overwrite governed Lottie output", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "evavo-vector-lottie-cli-"));
  const sourcePath = path.join(root, "mark.svg");
  const motionPath = path.join(root, "mark.motion.json");
  const outputPath = path.join(root, "mark.lottie.json");
  const evidencePath = path.join(root, "mark.lottie.evidence.json");

  try {
    await writeFile(
      sourcePath,
      [
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">',
        '<path id="background" fill="#ffffff" d="M0 0h100v100H0z"/>',
        '<g id="mark"><path id="body" fill="#ff244e" d="M20 20h60v60H20z"/></g>',
        "</svg>",
      ].join(""),
      "utf8",
    );
    await writeFile(
      motionPath,
      `${JSON.stringify({
        version: "1.0",
        name: "Mark entrance",
        durationMs: 800,
        iterations: 1,
        direction: "normal",
        fillMode: "both",
        reducedMotion: "last-frame",
        tracks: [
          {
            targetId: "mark",
            easing: "ease-out",
            keyframes: [
              { offset: 0, opacity: 0, translateY: 8, scale: 0.96 },
              { offset: 1, opacity: 1, translateY: 0, scale: 1 },
            ],
          },
        ],
      }, null, 2)}\n`,
      "utf8",
    );

    const exported = runCli([
      "lottie:export",
      sourcePath,
      "--motion",
      motionPath,
      "--out",
      outputPath,
      "--evidence-out",
      evidencePath,
      "--frame-rate",
      "30",
      "--precision",
      "5",
      "--name",
      "CLI mark entrance",
    ]);
    assert.equal(exported.status, 0, exported.stderr || exported.stdout);
    const payload = parseStdout(exported.stdout);
    assert.equal(payload.command, "lottie:export");
    assert.equal(payload.written, true);
    assert.equal((payload.inspection as { valid?: boolean } | undefined)?.valid, true);
    assert.equal((payload.evidence as { approval?: string } | undefined)?.approval, "review-required");
    assert.equal(
      (payload.evidence as { compatibility?: { playerRenderValidation?: string } } | undefined)
        ?.compatibility?.playerRenderValidation,
      "not-yet-performed",
    );

    const outputBefore = await readFile(outputPath, "utf8");
    const evidenceBefore = await readFile(evidencePath, "utf8");
    const animation = JSON.parse(outputBefore) as Record<string, unknown>;
    assert.equal(animation.fr, 30);
    assert.equal(animation.nm, "CLI mark entrance");
    assert.ok(Array.isArray(animation.layers));
    assert.match(evidenceBefore, /"command": "lottie:export"/);
    assert.doesNotMatch(evidenceBefore, /"v": "5\.12\.2"/);

    const inspected = runCli(["lottie:inspect", outputPath]);
    assert.equal(inspected.status, 0, inspected.stderr || inspected.stdout);
    const inspectionPayload = parseStdout(inspected.stdout);
    assert.equal(inspectionPayload.command, "lottie:inspect");
    assert.equal(inspectionPayload.valid, true);
    assert.equal(inspectionPayload.assetCount, 0);
    assert.equal(inspectionPayload.expressionCount, 0);

    const repeated = runCli([
      "lottie:export",
      sourcePath,
      "--motion",
      motionPath,
      "--out",
      outputPath,
      "--evidence-out",
      evidencePath,
    ]);
    assert.equal(repeated.status, 2);
    assert.match(repeated.stderr, /VECTOR_OUTPUT_EXISTS|VECTOR_OUTPUT_TRANSACTION_FAILED/);
    assert.equal(await readFile(outputPath, "utf8"), outputBefore);
    assert.equal(await readFile(evidencePath, "utf8"), evidenceBefore);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
