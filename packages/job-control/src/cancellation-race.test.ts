import assert from "node:assert/strict";
import test from "node:test";
import {
  HostedJobController,
  MemoryHostedJobStore,
} from "./index.js";

test("records receipt-backed success when cancellation arrives after immutable commit", async () => {
  let jobSequence = 0;
  let leaseSequence = 0;
  const controller = new HostedJobController(new MemoryHostedJobStore(), {
    createId: () => `vjob_race_${++jobSequence}`,
    createLeaseToken: () => `lease-${++leaseSequence}`,
  });
  const created = await controller.create({
    workspaceId: "race-tests",
    idempotencyKey: "committed-output-cancellation-race",
    operation: "optimise-svg",
    payload: {},
  });
  const leased = await controller.acquireLease({
    workerId: "race-worker",
    leaseMs: 30_000,
  });
  assert.equal(leased?.id, created.record.id);
  await controller.start(created.record.id, "lease-1");
  const requested = await controller.requestCancellation(created.record.id, {
    requestedBy: "test-suite",
    reason: "Arrived after immutable object commit",
  });
  assert.equal(requested.status, "cancel-requested");

  const completed = await controller.succeed(created.record.id, "lease-1", {
    outputs: [
      {
        path: "memory://output/mark.optimised.svg",
        mimeType: "image/svg+xml",
        bytes: 123,
        sha256: "b".repeat(64),
      },
    ],
    evidence: {
      approval: "human-review-required",
    },
  });

  assert.equal(completed.status, "succeeded");
  assert.equal(completed.lease, null);
  assert.equal(
    completed.cancellation?.reason,
    "Arrived after immutable object commit",
  );
  assert.equal(completed.result?.outputs[0]?.bytes, 123);
  assert.equal(
    completed.result?.evidence.cancellationRaceResolution,
    "committed-success-retained",
  );
});
