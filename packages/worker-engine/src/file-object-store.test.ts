import assert from "node:assert/strict";
import {
  access,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { VectorWorkerError } from "./errors.js";
import { FileVectorObjectStore } from "./file-object-store.js";

const ENCODER = new TextEncoder();

test("commits immutable multi-object transactions with receipts", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "evavo-vector-objects-"));
  try {
    const store = await FileVectorObjectStore.open(root);
    const receipts = await store.putManyNew([
      {
        objectKey: "output/mark.svg",
        mimeType: "image/svg+xml",
        bytes: ENCODER.encode("<svg/>")
      },
      {
        objectKey: "output/mark.evidence.json",
        mimeType: "application/json",
        bytes: ENCODER.encode("{}\n"),
      },
    ]);
    assert.equal(receipts.length, 2);
    assert.match(receipts[0]?.sha256 ?? "", /^[a-f0-9]{64}$/);
    assert.equal(await readFile(path.join(root, "output", "mark.svg"), "utf8"), "<svg/>");
    assert.equal((await store.get("output/mark.svg")).byteCount, 6);

    await assert.rejects(
      store.putManyNew([
        {
          objectKey: "output/mark.svg",
          mimeType: "image/svg+xml",
          bytes: ENCODER.encode("changed"),
        },
      ]),
      (error: unknown) =>
        error instanceof VectorWorkerError &&
        error.code === "VECTOR_WORKER_OBJECT_EXISTS",
    );
    assert.equal(await readFile(path.join(root, "output", "mark.svg"), "utf8"), "<svg/>");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects traversal, source symlink escapes and output parent symlink escapes", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "evavo-vector-object-root-"));
  const outside = await mkdtemp(path.join(os.tmpdir(), "evavo-vector-object-outside-"));
  try {
    const store = await FileVectorObjectStore.open(root);
    await writeFile(path.join(outside, "outside.svg"), "<svg/>", "utf8");

    await assert.rejects(
      store.get("../outside.svg"),
      (error: unknown) =>
        error instanceof VectorWorkerError &&
        error.code === "VECTOR_WORKER_OBJECT_KEY_INVALID",
    );

    try {
      await symlink(path.join(outside, "outside.svg"), path.join(root, "escape.svg"));
      await symlink(outside, path.join(root, "escape-output"), "dir");
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        (error.code === "EPERM" || error.code === "EACCES")
      ) {
        context.skip("This platform does not permit symlink creation in the test environment.");
        return;
      }
      throw error;
    }

    await assert.rejects(
      store.get("escape.svg"),
      (error: unknown) =>
        error instanceof VectorWorkerError &&
        error.code === "VECTOR_WORKER_OBJECT_KEY_INVALID",
    );
    await assert.rejects(
      store.putManyNew([
        {
          objectKey: "escape-output/result.svg",
          mimeType: "image/svg+xml",
          bytes: ENCODER.encode("<svg/>")
        },
      ]),
      (error: unknown) =>
        error instanceof VectorWorkerError &&
        error.code === "VECTOR_WORKER_OBJECT_KEY_INVALID",
    );
    await assert.rejects(access(path.join(outside, "result.svg")));
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("aborts before committing any object", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "evavo-vector-object-cancel-"));
  try {
    const store = await FileVectorObjectStore.open(root);
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      store.putManyNew(
        [
          {
            objectKey: "output/cancelled.json",
            mimeType: "application/json",
            bytes: ENCODER.encode("{}"),
          },
        ],
        { signal: controller.signal },
      ),
      (error: unknown) =>
        error instanceof VectorWorkerError &&
        error.code === "VECTOR_WORKER_CANCELLED",
    );
    await assert.rejects(access(path.join(root, "output", "cancelled.json")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
