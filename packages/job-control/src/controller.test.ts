import assert from "node:assert/strict";
import test from "node:test";
import { HostedJobController } from "./controller.js";
import { HostedJobError } from "./errors.js";
import { MemoryHostedJobStore } from "./memory-store.js";

function fixture() {
  let nowMs = Date.parse("2026-07-29T00:00:00.000Z");
  let jobSequence = 0;
  let leaseSequence = 0;
  const store = new MemoryHostedJobStore();
  const controller = new HostedJobController(store, {
    now: () => new Date(nowMs),
    createId: () => `vjob_fixture_${String(++jobSequence).padStart(4, "0")}`,
    createLeaseToken: () => `lease-${++leaseSequence}`,
  });
  return Object.freeze({
    store,
    controller,
    advance(milliseconds: number) {
      nowMs += milliseconds;
    },
  });
}

function request(idempotencyKey = "mark:revision-01") {
  return {
    workspaceId: "evavo-studio",
    idempotencyKey,
    operation: "optimise-svg",
    payload: {
      input: "source/mark.svg",
      output: "output/mark.optimised.svg",
    },
    priority: 7,
    maxAttempts: 3,
  } as const;
}

test("creates idempotently and rejects changed requests under one key", async () => {
  const { controller } = fixture();
  const first = await controller.create(request());
  const replay = await controller.create(request());
  assert.equal(first.reused, false);
  assert.equal(replay.reused, true);
  assert.equal(replay.record.id, first.record.id);
  assert.equal(replay.record.status, "queued");

  await assert.rejects(
    controller.create({
      ...request(),
      payload: { input: "source/changed.svg" },
    }),
    (error: unknown) =>
      error instanceof HostedJobError &&
      error.code === "HOSTED_JOB_IDEMPOTENCY_CONFLICT" &&
      error.status === 409,
  );
});

test("leases, starts, heartbeats and succeeds with receipts", async () => {
  const { controller, advance } = fixture();
  const created = await controller.create(request());
  const leased = await controller.acquireLease({
    workerId: "worker-01",
    leaseMs: 30_000,
    operations: ["optimise-svg"],
  });
  assert.equal(leased?.id, created.record.id);
  assert.equal(leased?.status, "leased");
  assert.equal(leased?.attempts, 1);
  assert.equal(leased?.lease?.token, "lease-1");

  const running = await controller.start(created.record.id, "lease-1");
  assert.equal(running.status, "running");
  assert.equal(running.startedAt, "2026-07-29T00:00:00.000Z");

  advance(5_000);
  const heartbeat = await controller.heartbeat(created.record.id, "lease-1", 60_000);
  assert.equal(heartbeat.lease?.heartbeatAt, "2026-07-29T00:00:05.000Z");
  assert.equal(heartbeat.lease?.expiresAt, "2026-07-29T00:01:05.000Z");

  const completed = await controller.succeed(created.record.id, "lease-1", {
    outputs: [
      {
        path: "/output/mark.optimised.svg",
        mimeType: "image/svg+xml",
        bytes: 456,
        sha256: "a".repeat(64),
      },
    ],
    evidence: { inspection: "passed" },
  });
  assert.equal(completed.status, "succeeded");
  assert.equal(completed.lease, null);
  assert.equal(completed.result?.outputs[0]?.bytes, 456);
  assert.equal(completed.result?.evidence.inspection, "passed");
  assert.equal(completed.finishedAt, "2026-07-29T00:00:05.000Z");
});

test("cancels queued work immediately and active work cooperatively", async () => {
  const queuedFixture = fixture();
  const queued = await queuedFixture.controller.create(request("queued-cancel"));
  const cancelled = await queuedFixture.controller.requestCancellation(
    queued.record.id,
    { requestedBy: "greg", reason: "No longer needed" },
  );
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.cancellation?.requestedBy, "greg");
  assert.equal(cancelled.finishedAt, "2026-07-29T00:00:00.000Z");

  const activeFixture = fixture();
  const active = await activeFixture.controller.create(request("active-cancel"));
  const lease = await activeFixture.controller.acquireLease({
    workerId: "worker-02",
    leaseMs: 30_000,
  });
  assert.equal(lease?.id, active.record.id);
  await activeFixture.controller.start(active.record.id, "lease-1");
  const requested = await activeFixture.controller.requestCancellation(active.record.id);
  assert.equal(requested.status, "cancel-requested");
  await assert.rejects(
    activeFixture.controller.succeed(active.record.id, "lease-1"),
    (error: unknown) =>
      error instanceof HostedJobError &&
      error.code === "HOSTED_JOB_CANCELLATION_REQUESTED",
  );
  const acknowledged = await activeFixture.controller.acknowledgeCancellation(
    active.record.id,
    "lease-1",
  );
  assert.equal(acknowledged.status, "cancelled");
  assert.equal(acknowledged.lease, null);
});

test("requeues retryable failures and expires abandoned leases", async () => {
  const retryFixture = fixture();
  const created = await retryFixture.controller.create(request("retryable"));
  await retryFixture.controller.acquireLease({ workerId: "worker-03", leaseMs: 30_000 });
  await retryFixture.controller.start(created.record.id, "lease-1");
  const requeued = await retryFixture.controller.fail(created.record.id, "lease-1", {
    code: "TRANSIENT_RENDERER_FAILURE",
    message: "Renderer unavailable",
    retryable: true,
  });
  assert.equal(requeued.status, "queued");
  assert.equal(requeued.attempts, 1);
  assert.equal(requeued.failure?.retryable, true);

  const secondLease = await retryFixture.controller.acquireLease({
    workerId: "worker-03",
    leaseMs: 5_000,
  });
  assert.equal(secondLease?.attempts, 2);
  retryFixture.advance(5_001);
  assert.equal(await retryFixture.controller.reclaimExpiredLeases(), 1);
  const reclaimed = await retryFixture.controller.get(created.record.id);
  assert.equal(reclaimed.status, "queued");
  assert.equal(reclaimed.failure?.code, "HOSTED_JOB_LEASE_EXPIRED");

  const thirdLease = await retryFixture.controller.acquireLease({
    workerId: "worker-03",
    leaseMs: 5_000,
  });
  assert.equal(thirdLease?.attempts, 3);
  retryFixture.advance(5_001);
  assert.equal(await retryFixture.controller.reclaimExpiredLeases(), 1);
  const exhausted = await retryFixture.controller.get(created.record.id);
  assert.equal(exhausted.status, "failed");
  assert.equal(exhausted.finishedAt, "2026-07-29T00:00:10.002Z");
});
