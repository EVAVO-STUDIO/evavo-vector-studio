import assert from "node:assert/strict";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createVectorMcpBatchOperations,
} from "./batch-tools.js";
import { VectorMcpOperationError } from "./errors.js";
import { createVectorMcpPathPolicy } from "./path-policy.js";

test("rejects a pre-cancelled durable batch without creating retained job state", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "evavo-vector-mcp-batch-cancel-"));
  const manifestPath = path.join(root, "batch.json");
  try {
    await writeFile(
      manifestPath,
      `${JSON.stringify({
        version: "1.0",
        id: "cancelled-batch",
        name: "Cancelled batch",
        failureMode: "continue",
        items: [
          {
            id: "mark",
            operation: "optimise-svg",
            spec: {
              inputPath: "mark.svg",
              outputPath: "mark.optimised.svg",
              evidenceOutputPath: "mark.evidence.json",
            },
          },
        ],
      }, null, 2)}\n`,
      "utf8",
    );

    const pathPolicy = await createVectorMcpPathPolicy({
      cwd: root,
      allowedRoots: [root],
    });
    const operations = createVectorMcpBatchOperations(pathPolicy);
    const controller = new AbortController();
    controller.abort();

    await assert.rejects(
      operations.runBatch(
        { manifestPath, rootPath: root },
        controller.signal,
      ),
      (error: unknown) =>
        error instanceof VectorMcpOperationError &&
        error.code === "VECTOR_MCP_CANCELLED" &&
        error.retryable,
    );

    await assert.rejects(
      access(path.join(root, ".evavo-vector-jobs", "cancelled-batch", "state.json")),
      (error: unknown) =>
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
