import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const cliPath = fileURLToPath(new URL("./index.js", import.meta.url));

function run(args: readonly string[]) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
  });
}

function parseJson(source: string): Record<string, unknown> {
  return JSON.parse(source) as Record<string, unknown>;
}

test("imports, submits, executes, inspects and cancels through the local CLI", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "evavo-vector-worker-cli-"));
  const jobStore = path.join(root, "jobs");
  const objectStore = path.join(root, "objects");
  const sourcePath = path.join(root, "source.svg");
  const requestPath = path.join(root, "request.json");
  const common = [
    "--job-store",
    jobStore,
    "--object-store",
    objectStore,
  ] as const;
  try {
    await writeFile(
      sourcePath,
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><title>Mark</title><path fill="#ff244e" d="M2 2H18V18H2Z"/></svg>',
      "utf8",
    );

    const capabilities = run(["capabilities", ...common]);
    assert.equal(capabilities.status, 0, capabilities.stderr);
    const capabilitiesPayload = parseJson(capabilities.stdout) as {
      localWorkerContractVersion?: string;
      output?: { generatedBodiesInConsole?: boolean };
      worker?: { remoteExecutionAvailable?: boolean };
    };
    assert.equal(capabilitiesPayload.localWorkerContractVersion, "1.0");
    assert.equal(capabilitiesPayload.output?.generatedBodiesInConsole, false);
    assert.equal(capabilitiesPayload.worker?.remoteExecutionAvailable, false);

    const imported = run([
      "import",
      sourcePath,
      "--key",
      "source/mark.svg",
      "--mime",
      "image/svg+xml",
      ...common,
    ]);
    assert.equal(imported.status, 0, imported.stderr);
    const importPayload = parseJson(imported.stdout) as {
      receipt?: { sha256?: string; bytes?: number };
    };
    assert.match(importPayload.receipt?.sha256 ?? "", /^[a-f0-9]{64}$/);
    assert.ok((importPayload.receipt?.bytes ?? 0) > 0);

    await writeFile(
      requestPath,
      `${JSON.stringify({
        workspaceId: "cli-tests",
        idempotencyKey: "optimise-mark-revision-01",
        operation: "optimise-svg",
        priority: 5,
        maxAttempts: 2,
        payload: {
          source: {
            objectKey: "source/mark.svg",
            sha256: importPayload.receipt?.sha256,
          },
          outputs: {
            svgObjectKey: "output/mark.optimised.svg",
            evidenceObjectKey: "output/mark.optimised.evidence.json",
          },
        },
      }, null, 2)}\n`,
      "utf8",
    );

    const submitted = run(["submit", requestPath, ...common]);
    assert.equal(submitted.status, 0, submitted.stderr);
    const submittedPayload = parseJson(submitted.stdout) as {
      executionScheduled?: boolean;
      remoteExecutionAvailable?: boolean;
      record?: { id?: string; status?: string };
    };
    const jobId = submittedPayload.record?.id;
    assert.match(jobId ?? "", /^vjob_/);
    assert.equal(submittedPayload.record?.status, "queued");
    assert.equal(submittedPayload.executionScheduled, false);
    assert.equal(submittedPayload.remoteExecutionAvailable, false);

    const executed = run([
      "run-once",
      "--worker-id",
      "cli-test-worker",
      ...common,
    ]);
    assert.equal(executed.status, 0, executed.stderr);
    const executedPayload = parseJson(executed.stdout) as {
      result?: {
        outcome?: string;
        job?: {
          status?: string;
          lease?: unknown;
          result?: { outputs?: Array<{ sha256?: string }> };
        };
      };
    };
    assert.equal(executedPayload.result?.outcome, "succeeded");
    assert.equal(executedPayload.result?.job?.status, "succeeded");
    assert.equal(executedPayload.result?.job?.lease, null);
    assert.equal(executedPayload.result?.job?.result?.outputs?.length, 2);
    assert.doesNotMatch(executed.stdout, /<svg\b/i);

    const inspected = run(["inspect", jobId!, ...common]);
    assert.equal(inspected.status, 0, inspected.stderr);
    const inspectedPayload = parseJson(inspected.stdout) as {
      record?: { status?: string; lease?: unknown };
    };
    assert.equal(inspectedPayload.record?.status, "succeeded");
    assert.equal(inspectedPayload.record?.lease, null);
    assert.doesNotMatch(inspected.stdout, /<svg\b/i);

    const outputSvg = path.join(objectStore, "output", "mark.optimised.svg");
    const evidence = path.join(
      objectStore,
      "output",
      "mark.optimised.evidence.json",
    );
    assert.equal((await stat(outputSvg)).isFile(), true);
    assert.equal((await stat(evidence)).isFile(), true);
    assert.match(await readFile(outputSvg, "utf8"), /<svg\b/i);
    assert.match(await readFile(evidence, "utf8"), /"bytesSaved"/);

    const listed = run(["list", "--status", "succeeded", ...common]);
    assert.equal(listed.status, 0, listed.stderr);
    const listedPayload = parseJson(listed.stdout) as {
      count?: number;
      records?: Array<{ id?: string }>;
    };
    assert.equal(listedPayload.count, 1);
    assert.equal(listedPayload.records?.[0]?.id, jobId);

    const cancelledRequestPath = path.join(root, "cancelled-request.json");
    await writeFile(
      cancelledRequestPath,
      `${JSON.stringify({
        workspaceId: "cli-tests",
        idempotencyKey: "cancelled-revision-01",
        operation: "optimise-svg",
        payload: {
          source: {
            objectKey: "source/mark.svg",
            sha256: importPayload.receipt?.sha256,
          },
          outputs: {
            svgObjectKey: "output/cancelled.svg",
            evidenceObjectKey: "output/cancelled.evidence.json",
          },
        },
      }, null, 2)}\n`,
      "utf8",
    );
    const cancelledSubmitted = run([
      "submit",
      cancelledRequestPath,
      ...common,
    ]);
    assert.equal(cancelledSubmitted.status, 0, cancelledSubmitted.stderr);
    const cancelledJobId = (
      parseJson(cancelledSubmitted.stdout) as {
        record?: { id?: string };
      }
    ).record?.id;
    const cancelled = run([
      "cancel",
      cancelledJobId!,
      "--requested-by",
      "test-suite",
      "--reason",
      "Superseded fixture",
      ...common,
    ]);
    assert.equal(cancelled.status, 0, cancelled.stderr);
    assert.equal(
      (parseJson(cancelled.stdout) as {
        record?: { status?: string };
      }).record?.status,
      "cancelled",
    );

    const polling = run([
      "run",
      "--worker-id",
      "cli-idle-worker",
      "--idle-exit-ms",
      "0",
      ...common,
    ]);
    assert.equal(polling.status, 0, polling.stderr);
    const lines = polling.stdout.trim().split(/\r?\n/).map(parseJson);
    assert.equal(lines[0]?.type, "worker-started");
    assert.equal(lines.at(-1)?.type, "worker-summary");
    assert.equal(
      (lines.at(-1)?.summary as { stoppedBy?: string } | undefined)?.stoppedBy,
      "idle-timeout",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
