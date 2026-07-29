import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { HostedJobController } from "./controller.js";
import { HostedJobError } from "./errors.js";
import { FileHostedJobStore } from "./file-store.js";

function request() {
  return {
    workspaceId: "evavo-studio",
    idempotencyKey: "persistent-mark:revision-01",
    operation: "optimise-svg",
    payload: {
      input: "source/mark.svg",
      output: "output/mark.optimised.svg",
    },
  } as const;
}

test("persists idempotency, state transitions and receipts across store instances", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "evavo-hosted-job-store-"));
  try {
    const firstStore = await FileHostedJobStore.open(root);
    const firstController = new HostedJobController(firstStore, {
      now: () => new Date("2026-07-29T00:00:00.000Z"),
      createId: () => "vjob_persistent_0001",
      createLeaseToken: () => "lease-persistent",
    });
    const created = await firstController.create(request());
    assert.equal(created.reused, false);
    assert.equal(created.record.status, "queued");

    const secondStore = await FileHostedJobStore.open(root);
    const secondController = new HostedJobController(secondStore, {
      now: () => new Date("2026-07-29T00:00:10.000Z"),
      createId: () => "vjob_should_not_be_used",
      createLeaseToken: () => "lease-persistent",
    });
    const replay = await secondController.create(request());
    assert.equal(replay.reused, true);
    assert.equal(replay.record.id, created.record.id);

    const leased = await secondController.acquireLease({
      workerId: "worker-persistent",
      leaseMs: 30_000,
    });
    assert.equal(leased?.id, created.record.id);
    await secondController.start(created.record.id, "lease-persistent");
    const completed = await secondController.succeed(
      created.record.id,
      "lease-persistent",
      {
        outputs: [
          {
            path: "/output/mark.optimised.svg",
            mimeType: "image/svg+xml",
            bytes: 321,
            sha256: "c".repeat(64),
          },
        ],
        evidence: { validation: "passed" },
      },
    );
    assert.equal(completed.status, "succeeded");

    const thirdStore = await FileHostedJobStore.open(root);
    const retained = await thirdStore.get(created.record.id);
    assert.equal(retained?.status, "succeeded");
    assert.equal(retained?.result?.outputs[0]?.sha256, "c".repeat(64));
    assert.equal(retained?.version, completed.version);

    const jobSource = await readFile(
      path.join(thirdStore.jobsPath, `${created.record.id}.json`),
      "utf8",
    );
    assert.match(jobSource, /"status": "succeeded"/);
    assert.match(jobSource, /"requestSha256": "[a-f0-9]{64}"/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("serialises concurrent idempotent creation to one retained job", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "evavo-hosted-job-concurrent-"));
  try {
    const store = await FileHostedJobStore.open(root);
    let sequence = 0;
    const controller = new HostedJobController(store, {
      createId: () => `vjob_concurrent_${String(++sequence).padStart(4, "0")}`,
    });
    const results = await Promise.all([
      controller.create(request()),
      controller.create(request()),
      controller.create(request()),
    ]);
    assert.equal(new Set(results.map((result) => result.record.id)).size, 1);
    assert.equal(results.filter((result) => !result.reused).length, 1);
    assert.equal((await store.list()).length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects corrupted retained job JSON instead of guessing", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "evavo-hosted-job-corrupt-"));
  try {
    const store = await FileHostedJobStore.open(root);
    await writeFile(
      path.join(store.jobsPath, "vjob_corrupted_0001.json"),
      "{not-json}\n",
      "utf8",
    );
    await assert.rejects(
      store.list(),
      (error: unknown) =>
        error instanceof HostedJobError &&
        error.code === "HOSTED_JOB_STORE_CORRUPT",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
