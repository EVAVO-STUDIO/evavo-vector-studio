import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";
import {
  HostedJobController,
  MemoryHostedJobStore,
  type HostedJobOperation,
  type HostedJobRecord,
} from "@evavo/job-control";
import { createVectorWorkerExecutor } from "./executor.js";
import { VectorWorkerError } from "./errors.js";
import { MemoryVectorObjectStore } from "./memory-object-store.js";

const SOURCE_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><title>Mark</title><g id="mark"><path id="body" fill="#ff244e" d="M10 10H90V90H10Z"/></g></svg>';
const MOTION_PLAN = Object.freeze({
  version: "1.0",
  name: "Gentle entrance",
  durationMs: 800,
  delayMs: 0,
  iterations: 1,
  direction: "normal",
  fillMode: "both",
  reducedMotion: "last-frame",
  tracks: [
    {
      targetId: "mark",
      keyframes: [
        { offset: 0, opacity: 0, translateY: 8 },
        { offset: 1, opacity: 1, translateY: 0 },
      ],
    },
  ],
} as const);

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function jobFixture() {
  let idSequence = 0;
  let leaseSequence = 0;
  const controller = new HostedJobController(new MemoryHostedJobStore(), {
    now: () => new Date("2026-07-29T02:00:00.000Z"),
    createId: () => `vjob_workerfixture_${String(++idSequence).padStart(4, "0")}`,
    createLeaseToken: () => `worker-lease-${++leaseSequence}`,
  });
  return controller;
}

async function startJob(
  controller: HostedJobController,
  operation: HostedJobOperation,
  payload: Readonly<Record<string, unknown>>,
  idempotencyKey: string,
): Promise<Readonly<{ record: HostedJobRecord; leaseToken: string }>> {
  const created = await controller.create({
    workspaceId: "evavo-studio",
    idempotencyKey,
    operation,
    payload,
  });
  const leased = await controller.acquireLease({
    workerId: "worker-local-01",
    leaseMs: 60_000,
    operations: [operation],
  });
  assert.equal(leased?.id, created.record.id);
  const token = leased?.lease?.token;
  assert.ok(token);
  const record = await controller.start(created.record.id, token);
  return Object.freeze({ record, leaseToken: token });
}

test("executes optimise, animated SVG, Lottie and dotLottie jobs with immutable receipts", async () => {
  const controller = jobFixture();
  const objects = new MemoryVectorObjectStore();
  objects.seed("source/mark.svg", SOURCE_SVG, "image/svg+xml");
  const executor = createVectorWorkerExecutor(objects);
  const source = Object.freeze({
    objectKey: "source/mark.svg",
    sha256: sha256(SOURCE_SVG),
  });

  const optimise = await startJob(
    controller,
    "optimise-svg",
    {
      source,
      outputs: {
        svgObjectKey: "output/mark.optimised.svg",
        evidenceObjectKey: "output/mark.optimised.evidence.json",
      },
    },
    "optimise:revision-01",
  );
  const optimisedCompletion = await executor.execute(optimise.record);
  const optimisedTerminal = await controller.succeed(
    optimise.record.id,
    optimise.leaseToken,
    optimisedCompletion,
  );
  assert.equal(optimisedTerminal.status, "succeeded");
  assert.equal(optimisedTerminal.result?.outputs.length, 2);
  assert.equal(objects.has("output/mark.optimised.svg"), true);
  assert.equal(objects.has("output/mark.optimised.evidence.json"), true);
  assert.equal(optimisedCompletion.evidence.approval, "human-review-required");
  assert.doesNotMatch(JSON.stringify(optimisedCompletion), /<svg\b/i);

  const animate = await startJob(
    controller,
    "animate-svg",
    {
      source,
      motion: MOTION_PLAN,
      outputs: {
        svgObjectKey: "output/mark.animated.svg",
        evidenceObjectKey: "output/mark.motion.evidence.json",
      },
    },
    "animate:revision-01",
  );
  const animatedCompletion = await executor.execute(animate.record);
  await controller.succeed(
    animate.record.id,
    animate.leaseToken,
    animatedCompletion,
  );
  assert.equal(objects.has("output/mark.animated.svg"), true);
  const animatedSource = new TextDecoder().decode(
    (await objects.get("output/mark.animated.svg")).bytes,
  );
  assert.match(animatedSource, /data-evavo-motion-contract="1\.0"/);
  assert.doesNotMatch(JSON.stringify(animatedCompletion), /<svg\b/i);

  const lottie = await startJob(
    controller,
    "export-lottie",
    {
      source,
      motion: MOTION_PLAN,
      outputs: {
        lottieObjectKey: "output/mark.lottie.json",
        evidenceObjectKey: "output/mark.lottie.evidence.json",
      },
      options: { frameRate: 60, precision: 4, name: "Mark entrance" },
    },
    "lottie:revision-01",
  );
  const lottieCompletion = await executor.execute(lottie.record);
  await controller.succeed(
    lottie.record.id,
    lottie.leaseToken,
    lottieCompletion,
  );
  const lottieObject = await objects.get("output/mark.lottie.json");
  const lottieDocument = JSON.parse(new TextDecoder().decode(lottieObject.bytes)) as {
    layers?: unknown[];
    meta?: { contractVersion?: string };
  };
  assert.equal(lottieDocument.meta?.contractVersion, "1.0");
  assert.ok((lottieDocument.layers?.length ?? 0) > 0);
  assert.doesNotMatch(JSON.stringify(lottieCompletion), /"layers"\s*:/);

  const dotLottie = await startJob(
    controller,
    "package-dotlottie",
    {
      source: {
        objectKey: "output/mark.lottie.json",
        sha256: lottieObject.sha256,
      },
      outputs: {
        archiveObjectKey: "output/mark.lottie",
        evidenceObjectKey: "output/mark.dotlottie.evidence.json",
      },
      animationId: "mark-intro",
    },
    "dotlottie:revision-01",
  );
  const archiveCompletion = await executor.execute(dotLottie.record);
  await controller.succeed(
    dotLottie.record.id,
    dotLottie.leaseToken,
    archiveCompletion,
  );
  const archive = await objects.get("output/mark.lottie");
  assert.deepEqual([...archive.bytes.subarray(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
  assert.doesNotMatch(JSON.stringify(archiveCompletion), /UEsDB/);
  assert.equal(archiveCompletion.evidence.manifestVersion, "2");
});

test("rejects source hash drift before creating outputs", async () => {
  const controller = jobFixture();
  const objects = new MemoryVectorObjectStore();
  objects.seed("source/mark.svg", SOURCE_SVG, "image/svg+xml");
  const executor = createVectorWorkerExecutor(objects);
  const job = await startJob(
    controller,
    "optimise-svg",
    {
      source: {
        objectKey: "source/mark.svg",
        sha256: "0".repeat(64),
      },
      outputs: {
        svgObjectKey: "output/drift.svg",
        evidenceObjectKey: "output/drift.evidence.json",
      },
    },
    "hash-drift",
  );
  await assert.rejects(
    executor.execute(job.record),
    (error: unknown) =>
      error instanceof VectorWorkerError &&
      error.code === "VECTOR_WORKER_OBJECT_HASH_MISMATCH",
  );
  assert.equal(objects.has("output/drift.svg"), false);
});

test("rejects unsupported run-batch execution and pre-cancelled work", async () => {
  const controller = jobFixture();
  const objects = new MemoryVectorObjectStore();
  const executor = createVectorWorkerExecutor(objects);
  const batch = await startJob(
    controller,
    "run-batch",
    { manifest: { objectKey: "batches/job.json", sha256: "a".repeat(64) } },
    "batch-not-supported",
  );
  await assert.rejects(
    executor.execute(batch.record),
    (error: unknown) =>
      error instanceof VectorWorkerError &&
      error.code === "VECTOR_WORKER_OPERATION_UNSUPPORTED",
  );

  objects.seed("source/mark.svg", SOURCE_SVG, "image/svg+xml");
  const cancelled = await startJob(
    controller,
    "optimise-svg",
    {
      source: { objectKey: "source/mark.svg", sha256: sha256(SOURCE_SVG) },
      outputs: {
        svgObjectKey: "output/cancelled.svg",
        evidenceObjectKey: "output/cancelled.evidence.json",
      },
    },
    "pre-cancelled",
  );
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(
    executor.execute(cancelled.record, { signal: abort.signal }),
    (error: unknown) =>
      error instanceof VectorWorkerError &&
      error.code === "VECTOR_WORKER_CANCELLED" &&
      error.retryable,
  );
  assert.equal(objects.has("output/cancelled.svg"), false);
});
