import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  HostedJobController,
  MemoryHostedJobStore,
} from "@evavo/job-control";
import {
  MemoryVectorObjectStore,
  VectorWorkerError,
  createVectorWorkerExecutor,
  type VectorWorkerExecutor,
} from "@evavo/worker-engine";
import { LocalVectorWorker } from "./runner.js";

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function controllerFixture() {
  let jobSequence = 0;
  let leaseSequence = 0;
  const store = new MemoryHostedJobStore();
  const controller = new HostedJobController(store, {
    createId: () => `vjob_local_${++jobSequence}`,
    createLeaseToken: () => `lease-${++leaseSequence}`,
  });
  return Object.freeze({ store, controller });
}

function optimiseRequest(
  key: string,
  source: string,
) {
  return Object.freeze({
    workspaceId: "worker-tests",
    idempotencyKey: key,
    operation: "optimise-svg" as const,
    priority: 5,
    maxAttempts: 3,
    payload: Object.freeze({
      source: Object.freeze({
        objectKey: "source/mark.svg",
        sha256: sha256(source),
      }),
      outputs: Object.freeze({
        svgObjectKey: `output/${key}.optimised.svg`,
        evidenceObjectKey: `output/${key}.evidence.json`,
      }),
    }),
  });
}

function worker(
  controller: HostedJobController,
  executor: VectorWorkerExecutor,
) {
  return new LocalVectorWorker(controller, executor, {
    workerId: "local-test-worker",
    leaseMs: 10_000,
    heartbeatMs: 1_000,
    pollMs: 100,
    operations: ["optimise-svg"],
  });
}

test("leases, executes and records receipt-backed local work", async () => {
  const source = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><title>Mark</title><path d="M2 2H18V18H2Z"/></svg>';
  const fixture = controllerFixture();
  const objects = new MemoryVectorObjectStore();
  objects.seed("source/mark.svg", source, "image/svg+xml");
  const created = await fixture.controller.create(
    optimiseRequest("optimise-one", source),
  );
  const local = worker(
    fixture.controller,
    createVectorWorkerExecutor(objects),
  );

  const result = await local.runOne();
  assert.equal(result.outcome, "succeeded");
  assert.equal(result.job?.id, created.record.id);
  assert.equal(result.job?.status, "succeeded");
  assert.equal(result.job?.lease, null);
  assert.equal(result.job?.attempts, 1);
  assert.equal(result.job?.result?.outputs.length, 2);
  assert.equal(objects.has("output/optimise-one.optimised.svg"), true);
  assert.equal(objects.has("output/optimise-one.evidence.json"), true);
  assert.match(
    (await objects.get("output/optimise-one.optimised.svg")).sha256,
    /^[a-f0-9]{64}$/,
  );
  assert.doesNotMatch(JSON.stringify(result.job?.result?.evidence), /<svg\b/i);
});

test("retains committed success when cancellation races after executor commit", async () => {
  const fixture = controllerFixture();
  const created = await fixture.controller.create({
    workspaceId: "worker-tests",
    idempotencyKey: "cancellation-race",
    operation: "optimise-svg",
    priority: 5,
    maxAttempts: 1,
    payload: {},
  });
  const executor: VectorWorkerExecutor = Object.freeze({
    supportedOperations: Object.freeze(["optimise-svg"]),
    async execute(job) {
      await fixture.controller.requestCancellation(job.id, {
        reason: "Arrived after immutable commit",
      });
      return Object.freeze({
        jobId: job.id,
        operation: "optimise-svg",
        workerContractVersion: "1.0",
        outputs: Object.freeze([
          Object.freeze({
            path: "memory://output/committed.svg",
            mimeType: "image/svg+xml",
            bytes: 100,
            sha256: "c".repeat(64),
          }),
        ]),
        evidence: Object.freeze({
          cancellationRaceResolution: "committed-success-retained",
          approval: "human-review-required",
        }),
      });
    },
  });
  const result = await worker(fixture.controller, executor).runOne();
  assert.equal(result.outcome, "succeeded");
  assert.equal(result.job?.id, created.record.id);
  assert.equal(result.job?.status, "succeeded");
  assert.equal(
    result.job?.cancellation?.reason,
    "Arrived after immutable commit",
  );
  assert.equal(
    result.job?.result?.evidence.cancellationRaceResolution,
    "committed-success-retained",
  );
});

test("requeues retryable execution failure and reports stable evidence", async () => {
  const fixture = controllerFixture();
  await fixture.controller.create({
    workspaceId: "worker-tests",
    idempotencyKey: "retryable-worker-failure",
    operation: "optimise-svg",
    priority: 5,
    maxAttempts: 2,
    payload: {},
  });
  const executor: VectorWorkerExecutor = Object.freeze({
    supportedOperations: Object.freeze(["optimise-svg"]),
    async execute() {
      throw new VectorWorkerError(
        "TEST_TRANSIENT_EXECUTION_FAILURE",
        "Transient test failure",
        { retryable: true },
      );
    },
  });
  const result = await worker(fixture.controller, executor).runOne();
  assert.equal(result.outcome, "queued");
  assert.equal(result.job?.status, "queued");
  assert.equal(result.job?.attempts, 1);
  assert.equal(result.job?.failure?.code, "TEST_TRANSIENT_EXECUTION_FAILURE");
  assert.equal(result.error?.retryable, true);
});

test("exits an idle polling loop deterministically", async () => {
  const fixture = controllerFixture();
  const executor: VectorWorkerExecutor = Object.freeze({
    supportedOperations: Object.freeze(["optimise-svg"]),
    async execute() {
      throw new Error("The idle worker must not execute a job.");
    },
  });
  const results: string[] = [];
  const summary = await worker(fixture.controller, executor).run({
    idleExitMs: 0,
    onResult: (result) => {
      results.push(result.outcome);
    },
  });
  assert.deepEqual(results, ["idle"]);
  assert.equal(summary.processed, 0);
  assert.equal(summary.stoppedBy, "idle-timeout");
});
