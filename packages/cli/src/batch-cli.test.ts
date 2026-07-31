import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

const cliPath = fileURLToPath(new URL("./batch-cli.js", import.meta.url));

function run(args: readonly string[]) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
  });
}

test("runs, inspects and resumes a governed motion-ready SVG batch without overwriting", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "evavo-vector-batch-cli-"));
  try {
    const sourcePath = path.join(root, "source.svg");
    const manifestPath = path.join(root, "batch.json");
    const outputPath = path.join(root, "output", "mark.optimised.svg");
    const evidencePath = path.join(root, "output", "mark.optimised.evidence.json");
    await writeFile(
      sourcePath,
      '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20"><title>Mark</title><path fill="#ff244e" d="M2 2H18V18H2Z"/></svg>',
      "utf8",
    );
    await writeFile(
      manifestPath,
      `${JSON.stringify({
        version: "1.0",
        id: "optimise-fixture",
        name: "Optimise fixture",
        failureMode: "continue",
        items: [
          {
            id: "mark",
            operation: "optimise-svg",
            spec: {
              inputPath: "source.svg",
              outputPath: "output/mark.optimised.svg",
              evidenceOutputPath: "output/mark.optimised.evidence.json",
              deliveryProfile: "motion",
              stableIdPrefix: "batch-mark",
            },
          },
        ],
      }, null, 2)}\n`,
      "utf8",
    );

    const first = run(["run", manifestPath, "--root", root]);
    assert.equal(first.status, 0, first.stderr);
    const firstPayload = JSON.parse(first.stdout) as {
      command?: string;
      state?: {
        status?: string;
        items?: Array<{
          status?: string;
          attempts?: number;
          outputs?: Array<{ sha256?: string }>;
          evidence?: {
            deliveryProfile?: string;
            stablePathIdCount?: number;
            stableIdPrefix?: string;
            rootDimensions?: string;
          };
        }>;
      };
    };
    assert.equal(firstPayload.command, "run");
    assert.equal(firstPayload.state?.status, "complete");
    assert.equal(firstPayload.state?.items?.[0]?.status, "complete");
    assert.equal(firstPayload.state?.items?.[0]?.attempts, 1);
    assert.match(
      firstPayload.state?.items?.[0]?.outputs?.[0]?.sha256 ?? "",
      /^[a-f0-9]{64}$/,
    );
    assert.equal(firstPayload.state?.items?.[0]?.evidence?.deliveryProfile, "motion");
    assert.equal(firstPayload.state?.items?.[0]?.evidence?.stablePathIdCount, 1);
    assert.equal(firstPayload.state?.items?.[0]?.evidence?.stableIdPrefix, "batch-mark");
    assert.equal(firstPayload.state?.items?.[0]?.evidence?.rootDimensions, "removed-responsive");

    const output = await readFile(outputPath, "utf8");
    assert.match(output, /<svg/);
    assert.match(output, /id="batch-mark-0001"/);
    assert.doesNotMatch(output, /\swidth=/i);
    assert.doesNotMatch(output, /\sheight=/i);

    const evidence = await readFile(evidencePath, "utf8");
    assert.match(evidence, /"bytesSaved"/);
    assert.match(evidence, /"profile": "motion"/);
    assert.match(evidence, /"prefix": "batch-mark"/);
    assert.match(evidence, /"rootDimensions": "removed-responsive"/);

    const second = run(["run", manifestPath, "--root", root]);
    assert.equal(second.status, 0, second.stderr);
    const secondPayload = JSON.parse(second.stdout) as {
      state?: { items?: Array<{ attempts?: number }> };
    };
    assert.equal(secondPayload.state?.items?.[0]?.attempts, 1);

    const inspected = run([
      "inspect",
      manifestPath,
      "--root",
      root,
      "--event-limit",
      "20",
    ]);
    assert.equal(inspected.status, 0, inspected.stderr);
    const inspection = JSON.parse(inspected.stdout) as {
      command?: string;
      progress?: { percentComplete?: number };
      recentEvents?: Array<{ type?: string }>;
    };
    assert.equal(inspection.command, "inspect");
    assert.equal(inspection.progress?.percentComplete, 100);
    assert.ok(
      inspection.recentEvents?.some((event) => event.type === "item-reused"),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects a stable ID prefix for a compact web delivery batch", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "evavo-vector-batch-delivery-"));
  try {
    const sourcePath = path.join(root, "source.svg");
    const manifestPath = path.join(root, "batch.json");
    await writeFile(
      sourcePath,
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><title>Mark</title><path d="M0 0H10V10H0Z"/></svg>',
      "utf8",
    );
    await writeFile(
      manifestPath,
      `${JSON.stringify({
        version: "1.0",
        id: "invalid-delivery-fixture",
        name: "Invalid delivery fixture",
        failureMode: "continue",
        items: [{
          id: "mark",
          operation: "optimise-svg",
          spec: {
            inputPath: "source.svg",
            outputPath: "mark.web.svg",
            evidenceOutputPath: "mark.web.evidence.json",
            deliveryProfile: "web",
            stableIdPrefix: "not-allowed-for-web",
          },
        }],
      }, null, 2)}\n`,
      "utf8",
    );

    const result = run(["run", manifestPath, "--root", root]);
    assert.equal(result.status, 2);
    const payload = JSON.parse(result.stdout) as {
      state?: {
        items?: Array<{
          status?: string;
          error?: { code?: string; message?: string };
        }>;
      };
    };
    assert.equal(payload.state?.items?.[0]?.status, "failed");
    assert.equal(payload.state?.items?.[0]?.error?.code, "BATCH_OPERATION_FAILED");
    assert.match(
      payload.state?.items?.[0]?.error?.message ?? "",
      /editable or motion delivery profiles/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("reports capabilities and rejects input revision drift", async () => {
  const capabilities = run(["capabilities"]);
  assert.equal(capabilities.status, 0, capabilities.stderr);
  const contract = JSON.parse(capabilities.stdout) as {
    batchContractVersion?: string;
    operations?: string[];
    delivery?: {
      profiles?: string[];
      defaultProfile?: string;
      stableIdProfiles?: string[];
      alphaAwareRasterAnalysis?: boolean;
      immutableManifestRevision?: boolean;
    };
    durability?: { completedOutputReverification?: boolean };
    outputs?: {
      existingFilesOverwritten?: boolean;
      deliveryEvidenceRetained?: boolean;
    };
  };
  assert.equal(contract.batchContractVersion, "1.0");
  assert.deepEqual(contract.operations, [
    "trace-raster",
    "optimise-svg",
    "animate-svg",
    "export-lottie",
    "package-dotlottie",
  ]);
  assert.deepEqual(contract.delivery?.profiles, ["editable", "web", "motion", "print"]);
  assert.equal(contract.delivery?.defaultProfile, "editable");
  assert.deepEqual(contract.delivery?.stableIdProfiles, ["editable", "motion"]);
  assert.equal(contract.delivery?.alphaAwareRasterAnalysis, true);
  assert.equal(contract.delivery?.immutableManifestRevision, true);
  assert.equal(contract.durability?.completedOutputReverification, true);
  assert.equal(contract.outputs?.existingFilesOverwritten, false);
  assert.equal(contract.outputs?.deliveryEvidenceRetained, true);

  const root = await mkdtemp(path.join(os.tmpdir(), "evavo-vector-batch-drift-"));
  try {
    const sourcePath = path.join(root, "source.svg");
    const manifestPath = path.join(root, "batch.json");
    await writeFile(
      sourcePath,
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><title>Mark</title><path d="M0 0H10V10H0Z"/></svg>',
      "utf8",
    );
    await writeFile(
      manifestPath,
      `${JSON.stringify({
        version: "1.0",
        id: "drift-fixture",
        name: "Drift fixture",
        failureMode: "continue",
        items: [{
          id: "mark",
          operation: "optimise-svg",
          spec: {
            inputPath: "source.svg",
            outputPath: "mark.optimised.svg",
            evidenceOutputPath: "mark.evidence.json",
          },
        }],
      }, null, 2)}\n`,
      "utf8",
    );
    const first = run(["run", manifestPath, "--root", root]);
    assert.equal(first.status, 0, first.stderr);
    await writeFile(
      sourcePath,
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><title>Changed</title><circle cx="5" cy="5" r="4"/></svg>',
      "utf8",
    );
    const changed = run(["run", manifestPath, "--root", root]);
    assert.equal(changed.status, 2);
    const payload = JSON.parse(changed.stdout) as {
      state?: { items?: Array<{ error?: { code?: string } }> };
    };
    assert.equal(
      payload.state?.items?.[0]?.error?.code,
      "BATCH_ITEM_REVISION_MISMATCH",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
