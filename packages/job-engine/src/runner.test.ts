import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { BatchEngineError } from "./errors.js";
import { inspectDurableBatch } from "./inspection.js";
import { runDurableBatch } from "./runner.js";
import {
  acquireBatchLock,
  batchJobPaths,
  releaseBatchLock,
} from "./store.js";
import type {
  BatchOperationContext,
  BatchOperationDescriptor,
  BatchOperationHandler,
  BatchOperationRegistry,
  BatchOutputReceipt,
} from "./types.js";

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function specText(
  context: BatchOperationContext,
  key: string,
): string {
  const value = context.item.spec[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new BatchEngineError(
      "BATCH_OPERATION_FAILED",
      `The test operation requires ${key}.`,
      { details: { itemId: context.item.id, key } },
    );
  }
  return value;
}

function resolvedPath(
  context: BatchOperationContext,
  key: string,
): string {
  return path.resolve(context.rootPath, specText(context, key));
}

function copyHandler(
  executions: Map<string, number>,
): BatchOperationHandler {
  return Object.freeze({
    async describe(context): Promise<BatchOperationDescriptor> {
      const inputPath = resolvedPath(context, "inputPath");
      const outputPath = resolvedPath(context, "outputPath");
      const source = await readFile(inputPath);
      return Object.freeze({
        revision: sha256(Buffer.concat([
          Buffer.from(JSON.stringify(context.item.spec), "utf8"),
          source,
        ])),
        inputPaths: Object.freeze([inputPath]),
        outputPaths: Object.freeze([outputPath]),
        summary: Object.freeze({ inputBytes: source.byteLength }),
      });
    },
    async execute(context, descriptor) {
      const inputPath = descriptor.inputPaths[0]!;
      const outputPath = descriptor.outputPaths[0]!;
      const source = await readFile(inputPath, "utf8");
      const output = source.toUpperCase();
      await mkdir(path.dirname(outputPath), { recursive: true });
      await writeFile(outputPath, output, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
      executions.set(
        context.item.id,
        (executions.get(context.item.id) ?? 0) + 1,
      );
      const bytes = Buffer.from(output, "utf8");
      const receipt: BatchOutputReceipt = Object.freeze({
        path: outputPath,
        mimeType: "text/plain",
        bytes: bytes.byteLength,
        sha256: sha256(bytes),
      });
      return Object.freeze({
        revision: descriptor.revision,
        outputs: Object.freeze([receipt]),
        evidence: Object.freeze({ transformed: "uppercase" }),
      });
    },
  });
}

const failingHandler: BatchOperationHandler = Object.freeze({
  describe(context) {
    const outputPath = resolvedPath(context, "outputPath");
    return Object.freeze({
      revision: sha256(JSON.stringify(context.item.spec)),
      inputPaths: Object.freeze([]),
      outputPaths: Object.freeze([outputPath]),
    });
  },
  async execute() {
    throw new BatchEngineError(
      "BATCH_OPERATION_FAILED",
      "The fixture operation failed intentionally.",
      { details: { intentional: true } },
    );
  },
});

async function writeManifest(
  root: string,
  manifest: Readonly<Record<string, unknown>>,
): Promise<string> {
  const manifestPath = path.join(root, "batch.json");
  await writeFile(
    manifestPath,
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
  return manifestPath;
}

function manifest(options: Readonly<{
  id: string;
  failureMode?: "continue" | "fail-fast";
  items: readonly Readonly<Record<string, unknown>>[];
}>): Readonly<Record<string, unknown>> {
  return Object.freeze({
    version: "1.0",
    id: options.id,
    name: `Fixture ${options.id}`,
    failureMode: options.failureMode ?? "continue",
    items: options.items,
  });
}

function item(
  id: string,
  operation: string,
  spec: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  return Object.freeze({ id, operation, spec });
}

test("reuses verified completed items without executing them twice", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "evavo-batch-reuse-"));
  const executions = new Map<string, number>();
  const handlers: BatchOperationRegistry = Object.freeze({
    "copy-text": copyHandler(executions),
  });
  try {
    await mkdir(path.join(root, "source"), { recursive: true });
    await writeFile(path.join(root, "source", "one.txt"), "one\n", "utf8");
    const manifestPath = await writeManifest(root, manifest({
      id: "reuse-job",
      items: [
        item("one", "copy-text", {
          inputPath: "source/one.txt",
          outputPath: "output/one.txt",
        }),
      ],
    }));

    const first = await runDurableBatch({ manifestPath, rootPath: root, handlers });
    assert.equal(first.state.status, "complete");
    assert.equal(first.state.items[0]?.attempts, 1);
    assert.equal(await readFile(path.join(root, "output", "one.txt"), "utf8"), "ONE\n");

    const second = await runDurableBatch({ manifestPath, rootPath: root, handlers });
    assert.equal(second.state.status, "complete");
    assert.equal(second.state.items[0]?.attempts, 1);
    assert.equal(executions.get("one"), 1);

    const inspection = await inspectDurableBatch({
      jobId: "reuse-job",
      rootPath: root,
    });
    assert.equal(inspection.progress.percentComplete, 100);
    assert.equal(inspection.lock.present, false);
    assert.ok(
      inspection.recentEvents.some((event) => event.type === "item-reused"),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("fails a completed item when its output receipt no longer verifies", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "evavo-batch-tamper-"));
  const handlers: BatchOperationRegistry = Object.freeze({
    "copy-text": copyHandler(new Map()),
  });
  try {
    await writeFile(path.join(root, "source.txt"), "source", "utf8");
    const manifestPath = await writeManifest(root, manifest({
      id: "tamper-job",
      items: [
        item("copy", "copy-text", {
          inputPath: "source.txt",
          outputPath: "output.txt",
        }),
      ],
    }));
    await runDurableBatch({ manifestPath, rootPath: root, handlers });
    await writeFile(path.join(root, "output.txt"), "tampered", "utf8");

    const rerun = await runDurableBatch({ manifestPath, rootPath: root, handlers });
    assert.equal(rerun.state.status, "failed");
    assert.equal(
      rerun.state.items[0]?.error?.code,
      "BATCH_COMPLETED_OUTPUT_INVALID",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects a changed manifest for an existing durable job ID", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "evavo-batch-manifest-drift-"));
  const handlers: BatchOperationRegistry = Object.freeze({
    "copy-text": copyHandler(new Map()),
  });
  try {
    await writeFile(path.join(root, "source.txt"), "source", "utf8");
    const manifestPath = await writeManifest(root, manifest({
      id: "immutable-job",
      items: [
        item("copy", "copy-text", {
          inputPath: "source.txt",
          outputPath: "output.txt",
        }),
      ],
    }));
    await runDurableBatch({ manifestPath, rootPath: root, handlers });
    await writeManifest(root, manifest({
      id: "immutable-job",
      items: [
        item("copy", "copy-text", {
          inputPath: "source.txt",
          outputPath: "different-output.txt",
        }),
      ],
    }));

    await assert.rejects(
      () => runDurableBatch({ manifestPath, rootPath: root, handlers }),
      (error: unknown) =>
        error instanceof BatchEngineError &&
        error.code === "BATCH_MANIFEST_CHANGED",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("isolates failures in continue mode and stops in fail-fast mode", async () => {
  for (const failureMode of ["continue", "fail-fast"] as const) {
    const root = await mkdtemp(path.join(os.tmpdir(), `evavo-batch-${failureMode}-`));
    const handlers: BatchOperationRegistry = Object.freeze({
      "copy-text": copyHandler(new Map()),
      "fail-intentionally": failingHandler,
    });
    try {
      await writeFile(path.join(root, "one.txt"), "one", "utf8");
      await writeFile(path.join(root, "two.txt"), "two", "utf8");
      const manifestPath = await writeManifest(root, manifest({
        id: `${failureMode}-job`,
        failureMode,
        items: [
          item("first", "copy-text", {
            inputPath: "one.txt",
            outputPath: "first.txt",
          }),
          item("broken", "fail-intentionally", {
            outputPath: "broken.txt",
          }),
          item("last", "copy-text", {
            inputPath: "two.txt",
            outputPath: "last.txt",
          }),
        ],
      }));

      const result = await runDurableBatch({ manifestPath, rootPath: root, handlers });
      assert.equal(result.state.status, "failed");
      assert.equal(result.state.items[0]?.status, "complete");
      assert.equal(result.state.items[1]?.status, "failed");
      assert.equal(
        result.state.items[2]?.status,
        failureMode === "continue" ? "complete" : "pending",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test("recovers an interrupted running item and increments its attempt", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "evavo-batch-recovery-"));
  const executions = new Map<string, number>();
  const handlers: BatchOperationRegistry = Object.freeze({
    "copy-text": copyHandler(executions),
  });
  try {
    await writeFile(path.join(root, "source.txt"), "recover", "utf8");
    const manifestPath = await writeManifest(root, manifest({
      id: "recovery-job",
      items: [
        item("copy", "copy-text", {
          inputPath: "source.txt",
          outputPath: "output.txt",
        }),
      ],
    }));
    const first = await runDurableBatch({ manifestPath, rootPath: root, handlers });
    const paths = batchJobPaths(root, "recovery-job");
    const state = JSON.parse(await readFile(paths.statePath, "utf8")) as {
      status: string;
      finishedAt: string | null;
      items: Array<Record<string, unknown>>;
    };
    state.status = "running";
    state.finishedAt = null;
    state.items[0] = {
      ...state.items[0],
      status: "running",
      finishedAt: null,
    };
    await writeFile(paths.statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    await unlink(path.join(root, "output.txt"));

    const recovered = await runDurableBatch({ manifestPath, rootPath: root, handlers });
    assert.equal(recovered.state.status, "complete");
    assert.equal(recovered.state.items[0]?.attempts, 2);
    assert.equal(executions.get("copy"), 2);
    assert.equal(first.state.items[0]?.attempts, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("enforces exclusive job locks", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "evavo-batch-lock-"));
  const paths = batchJobPaths(root, "lock-job");
  const first = await acquireBatchLock(paths, 60_000);
  try {
    await assert.rejects(
      () => acquireBatchLock(paths, 60_000),
      (error: unknown) =>
        error instanceof BatchEngineError &&
        error.code === "BATCH_JOB_LOCKED" &&
        error.retryable,
    );
  } finally {
    await releaseBatchLock(first);
    await rm(root, { recursive: true, force: true });
  }
});
