import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { BatchEngineError } from "./errors.js";
import {
  canonicalBatchRoot,
  createBatchPathPolicy,
} from "./path-policy.js";

async function createSymlink(
  target: string,
  linkPath: string,
  type: "file" | "dir",
): Promise<boolean> {
  try {
    await symlink(target, linkPath, process.platform === "win32"
      ? type === "dir" ? "junction" : "file"
      : type);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EPERM" || code === "EACCES" || code === "ENOSYS") {
      return false;
    }
    throw error;
  }
}

test("resolves canonical inputs and permits verified regular outputs", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "evavo-batch-paths-"));
  try {
    await mkdir(path.join(root, "source"));
    await writeFile(path.join(root, "source", "mark.svg"), "<svg/>", "utf8");
    await mkdir(path.join(root, "output"));
    await writeFile(path.join(root, "output", "existing.svg"), "<svg/>", "utf8");

    const policy = await createBatchPathPolicy(root);
    assert.equal(policy.root, await canonicalBatchRoot(root));
    assert.equal(
      await policy.resolveInputFile("source/mark.svg"),
      path.join(policy.root, "source", "mark.svg"),
    );
    assert.equal(
      await policy.resolveOutputPath("output/new.svg"),
      path.join(policy.root, "output", "new.svg"),
    );
    assert.equal(
      await policy.resolveOutputPath("output/existing.svg"),
      path.join(policy.root, "output", "existing.svg"),
    );
    policy.assertDistinct([
      path.join(policy.root, "source", "mark.svg"),
      path.join(policy.root, "output", "new.svg"),
    ]);
    assert.throws(
      () => policy.assertDistinct([
        path.join(policy.root, "output", "new.svg"),
        path.join(policy.root, "output", ".", "new.svg"),
      ]),
      (error: unknown) =>
        error instanceof BatchEngineError &&
        error.code === "BATCH_PATH_COLLISION",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects lexical paths outside the canonical root", async () => {
  const container = await mkdtemp(path.join(os.tmpdir(), "evavo-batch-outside-"));
  const root = path.join(container, "root");
  try {
    await mkdir(root);
    await writeFile(path.join(container, "outside.svg"), "<svg/>", "utf8");
    const policy = await createBatchPathPolicy(root);
    await assert.rejects(
      () => policy.resolveInputFile("../outside.svg"),
      (error: unknown) =>
        error instanceof BatchEngineError &&
        error.code === "BATCH_PATH_OUTSIDE_ROOT",
    );
    await assert.rejects(
      () => policy.resolveOutputPath("../outside-output.svg"),
      (error: unknown) =>
        error instanceof BatchEngineError &&
        error.code === "BATCH_PATH_OUTSIDE_ROOT",
    );
  } finally {
    await rm(container, { recursive: true, force: true });
  }
});

test("rejects input and output-parent symlink escapes", async (t) => {
  const container = await mkdtemp(path.join(os.tmpdir(), "evavo-batch-symlink-"));
  const root = path.join(container, "root");
  const outside = path.join(container, "outside");
  try {
    await mkdir(root);
    await mkdir(outside);
    await writeFile(path.join(outside, "outside.svg"), "<svg/>", "utf8");
    const inputLinked = await createSymlink(
      path.join(outside, "outside.svg"),
      path.join(root, "linked.svg"),
      "file",
    );
    const directoryLinked = await createSymlink(
      outside,
      path.join(root, "linked-output"),
      "dir",
    );
    if (!inputLinked || !directoryLinked) {
      t.skip("The current platform does not permit symlink fixture creation.");
      return;
    }

    const policy = await createBatchPathPolicy(root);
    await assert.rejects(
      () => policy.resolveInputFile("linked.svg"),
      (error: unknown) =>
        error instanceof BatchEngineError &&
        error.code === "BATCH_PATH_OUTSIDE_ROOT",
    );
    await assert.rejects(
      () => policy.resolveOutputPath("linked-output/generated.svg"),
      (error: unknown) =>
        error instanceof BatchEngineError &&
        error.code === "BATCH_PATH_OUTSIDE_ROOT",
    );
  } finally {
    await rm(container, { recursive: true, force: true });
  }
});

test("rejects an output path that is itself a symlink", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "evavo-batch-output-link-"));
  try {
    await writeFile(path.join(root, "target.svg"), "<svg/>", "utf8");
    const linked = await createSymlink(
      path.join(root, "target.svg"),
      path.join(root, "output.svg"),
      "file",
    );
    if (!linked) {
      t.skip("The current platform does not permit symlink fixture creation.");
      return;
    }
    const policy = await createBatchPathPolicy(root);
    await assert.rejects(
      () => policy.resolveOutputPath("output.svg"),
      (error: unknown) =>
        error instanceof BatchEngineError &&
        error.code === "BATCH_OUTPUT_PARENT_INVALID",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
