import assert from "node:assert/strict";
import test from "node:test";
import { completeHostedJobIdempotently } from "./completion-replay.js";
import { HostedJobController } from "./controller.js";
import { HostedJobError } from "./errors.js";
import { MemoryHostedJobStore } from "./memory-store.js";

function fixture() {
  let sequence = 0;
  const store = new MemoryHostedJobStore();
  const controller = new HostedJobController(store, {
    now: () => new Date("2026-07-29T04:00:00.000Z"),
    createId: () => `vjob_completion_${++sequence}`,
    createLeaseToken: () => "lease-completion-replay-0001",
  });
  return Object.freeze({ store, controller });
}

function request(key: string) {
  return Object.freeze({
    workspaceId: "worker-tests",
    idempotencyKey: key,
    operation: "optimise-svg" as const,
    priority: 5,
    maxAttempts: 2,
    payload: Object.freeze({ source: "source/mark.svg" }),
  });
}

const completion = Object.freeze({
  outputs: Object.freeze([
    Object.freeze({
      path: "object://output/mark.optimised.svg",
      mimeType: "image/svg+xml",
      bytes: 123,
      sha256: "a".repeat(64),
    }),
    Object.freeze({
      path: "object://output/mark.evidence.json",
      mimeType: "application/json",
      bytes: 456,
      sha256: "b".repeat(64),
    }),
  ]),
  evidence: Object.freeze({
    approval: "human-review-required",
    sourceSha256: "c".repeat(64),
  }),
});

test("replays an exact receipt-backed completion without mutating the terminal record", async () => {
  const { store, controller } = fixture();
  const created = await controller.create(request("exact-replay"));
  await controller.acquireLease({
    workerId: "remote-worker-01",
    leaseMs: 60_000,
    operations: ["optimise-svg"],
  });
  await controller.start(created.record.id, "lease-completion-replay-0001");

  const completed = await completeHostedJobIdempotently(
    controller,
    store,
    created.record.id,
    "lease-completion-replay-0001",
    completion,
  );
  const replayed = await completeHostedJobIdempotently(
    controller,
    store,
    created.record.id,
    "lease-completion-replay-0001",
    completion,
  );

  assert.equal(completed.replayed, false);
  assert.equal(replayed.replayed, true);
  assert.equal(completed.record.status, "succeeded");
  assert.equal(replayed.record.status, "succeeded");
  assert.equal(replayed.record.version, completed.record.version);
  assert.equal(replayed.record.updatedAt, completed.record.updatedAt);
  assert.deepEqual(replayed.record.result, completed.record.result);
});

test("rejects a changed completion replay after immutable success", async () => {
  const { store, controller } = fixture();
  const created = await controller.create(request("changed-replay"));
  await controller.acquireLease({
    workerId: "remote-worker-01",
    leaseMs: 60_000,
    operations: ["optimise-svg"],
  });
  await controller.start(created.record.id, "lease-completion-replay-0001");
  await completeHostedJobIdempotently(
    controller,
    store,
    created.record.id,
    "lease-completion-replay-0001",
    completion,
  );

  await assert.rejects(
    completeHostedJobIdempotently(
      controller,
      store,
      created.record.id,
      "lease-completion-replay-0001",
      {
        ...completion,
        outputs: [
          {
            ...completion.outputs[0]!,
            sha256: "d".repeat(64),
          },
          completion.outputs[1]!,
        ],
      },
    ),
    (error: unknown) =>
      error instanceof HostedJobError &&
      error.code === "HOSTED_JOB_COMPLETION_CONFLICT" &&
      error.status === 409,
  );
});

test("replays the same cancellation-raced completion despite retained race evidence", async () => {
  const { store, controller } = fixture();
  const created = await controller.create(request("cancellation-replay"));
  await controller.acquireLease({
    workerId: "remote-worker-01",
    leaseMs: 60_000,
    operations: ["optimise-svg"],
  });
  await controller.start(created.record.id, "lease-completion-replay-0001");
  await controller.requestCancellation(created.record.id, {
    requestedBy: "operator",
    reason: "Arrived after immutable object commit",
  });

  const completed = await completeHostedJobIdempotently(
    controller,
    store,
    created.record.id,
    "lease-completion-replay-0001",
    completion,
  );
  const replayed = await completeHostedJobIdempotently(
    controller,
    store,
    created.record.id,
    "lease-completion-replay-0001",
    completion,
  );

  assert.equal(
    completed.record.result?.evidence.cancellationRaceResolution,
    "committed-success-retained",
  );
  assert.equal(replayed.replayed, true);
  assert.equal(replayed.record.version, completed.record.version);
  assert.deepEqual(replayed.record.result, completed.record.result);
});
