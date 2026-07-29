import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import type { HostedJobStatus } from "@evavo/job-control";
import {
  VectorWorkerClientError,
  type VectorWorkerClient,
} from "@evavo/worker-client";
import {
  MemoryVectorObjectStore,
  createVectorWorkerExecutor,
  type VectorWorkerExecutor,
} from "@evavo/worker-engine";
import type {
  VectorWorkerProtocolRecord,
} from "@evavo/worker-protocol";
import {
  HttpVectorWorker,
} from "./runner.js";

const LEASE_TOKEN = "01234567-89ab-cdef-0123-456789abcdef";
const JOB_ID = "vjob_http_worker_01";

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function record(
  status: HostedJobStatus,
  payload: Readonly<Record<string, unknown>>,
): VectorWorkerProtocolRecord {
  const active = status === "leased" || status === "running" || status === "cancel-requested";
  return Object.freeze({
    contractVersion: "1.0",
    id: JOB_ID,
    version: status === "leased" ? 2 : status === "running" ? 3 : 4,
    workspaceId: "http-worker-tests",
    idempotencyKey: "optimise-mark-revision-01",
    requestSha256: "a".repeat(64),
    operation: "optimise-svg",
    payload,
    priority: 5,
    status,
    attempts: 1,
    maxAttempts: 3,
    createdAt: "2026-07-29T04:00:00.000Z",
    updatedAt: "2026-07-29T04:00:01.000Z",
    startedAt: status === "leased" ? null : "2026-07-29T04:00:01.000Z",
    finishedAt: status === "succeeded" || status === "failed" || status === "cancelled"
      ? "2026-07-29T04:00:02.000Z"
      : null,
    lease: active
      ? Object.freeze({
          workerId: "http-worker-test",
          acquiredAt: "2026-07-29T04:00:00.000Z",
          heartbeatAt: "2026-07-29T04:00:01.000Z",
          expiresAt: "2026-07-29T04:01:01.000Z",
          tokenPresent: true as const,
        })
      : null,
    cancellation: status === "cancel-requested" || status === "cancelled"
      ? Object.freeze({
          requestedAt: "2026-07-29T04:00:01.500Z",
          requestedBy: "operator",
          reason: "Cancelled fixture",
        })
      : null,
    result: status === "succeeded"
      ? Object.freeze({
          outputs: Object.freeze([]),
          evidence: Object.freeze({ approval: "human-review-required" }),
          completedAt: "2026-07-29T04:00:02.000Z",
        })
      : null,
    failure: null,
  });
}

function optimisePayload(source: string) {
  return Object.freeze({
    source: Object.freeze({
      objectKey: "source/mark.svg",
      sha256: sha256(source),
    }),
    outputs: Object.freeze({
      svgObjectKey: "output/mark.optimised.svg",
      evidenceObjectKey: "output/mark.evidence.json",
    }),
  });
}

function fakeClient(options: Readonly<{
  payload: Readonly<Record<string, unknown>>;
  completionFailures?: number;
  cancellationOnHeartbeat?: boolean;
  noLease?: boolean;
}>) {
  const calls = {
    acquire: 0,
    start: 0,
    heartbeat: 0,
    complete: 0,
    fail: 0,
    acknowledge: 0,
  };
  const leased = record("leased", options.payload);
  const running = record("running", options.payload);
  const succeeded = record("succeeded", options.payload);
  const cancelled = record("cancelled", options.payload);
  const queued = record("queued", options.payload);
  const client: VectorWorkerClient = Object.freeze({
    version: "1.0",
    baseUrl: "https://worker.example.com/",
    async capabilities() {
      return Object.freeze({ service: "test-worker", contract: Object.freeze({}) });
    },
    async acquireLease() {
      calls.acquire += 1;
      return options.noLease
        ? null
        : Object.freeze({
            protocolVersion: "1.0" as const,
            leaseToken: LEASE_TOKEN,
            record: leased,
          });
    },
    async start() {
      calls.start += 1;
      return Object.freeze({ record: running });
    },
    async heartbeat() {
      calls.heartbeat += 1;
      return Object.freeze({
        record: options.cancellationOnHeartbeat
          ? record("cancel-requested", options.payload)
          : running,
        cancellationRequested: options.cancellationOnHeartbeat === true,
      });
    },
    async complete() {
      calls.complete += 1;
      if (calls.complete <= (options.completionFailures ?? 0)) {
        throw new VectorWorkerClientError(
          "VECTOR_WORKER_CLIENT_NETWORK_FAILED",
          "Synthetic lost completion response.",
          { retryable: true },
        );
      }
      return Object.freeze({ record: succeeded });
    },
    async fail() {
      calls.fail += 1;
      return Object.freeze({ record: queued });
    },
    async acknowledgeCancellation() {
      calls.acknowledge += 1;
      return Object.freeze({ record: cancelled });
    },
  });
  return Object.freeze({ client, calls });
}

function worker(client: VectorWorkerClient, executor: VectorWorkerExecutor) {
  return new HttpVectorWorker(client, executor, {
    workerId: "http-worker-test",
    leaseMs: 5_000,
    heartbeatMs: 1_000,
    pollMs: 100,
    operations: ["optimise-svg"],
    completionAttempts: 3,
    completionRetryMs: 100,
  });
}

test("returns idle without starting execution when no lease is available", async () => {
  const fixture = fakeClient({ payload: {}, noLease: true });
  const executor: VectorWorkerExecutor = Object.freeze({
    supportedOperations: Object.freeze(["optimise-svg"]),
    async execute(): Promise<never> {
      throw new Error("The idle worker must not execute.");
    },
  });
  const result = await worker(fixture.client, executor).runOne();
  assert.equal(result.outcome, "idle");
  assert.equal(result.record, null);
  assert.equal(fixture.calls.acquire, 1);
  assert.equal(fixture.calls.start, 0);
});

test("executes against the shared object store and safely replays a lost completion response", async () => {
  const source = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><title>Mark</title><path d="M2 2H18V18H2Z"/></svg>';
  const objects = new MemoryVectorObjectStore();
  objects.seed("source/mark.svg", source, "image/svg+xml");
  const fixture = fakeClient({
    payload: optimisePayload(source),
    completionFailures: 1,
  });
  const result = await worker(
    fixture.client,
    createVectorWorkerExecutor(objects),
  ).runOne();

  assert.equal(result.outcome, "succeeded");
  assert.equal(result.record?.status, "succeeded");
  assert.equal(result.completionAttempts, 2);
  assert.equal(fixture.calls.complete, 2);
  assert.equal(fixture.calls.fail, 0);
  assert.equal(objects.has("output/mark.optimised.svg"), true);
  assert.equal(objects.has("output/mark.evidence.json"), true);
  assert.doesNotMatch(JSON.stringify(result), /<svg\b/i);
  assert.doesNotMatch(JSON.stringify(result), new RegExp(LEASE_TOKEN));
});

test("acknowledges a cancellation observed by heartbeat before output commit", async () => {
  const fixture = fakeClient({ payload: {}, cancellationOnHeartbeat: true });
  const executor: VectorWorkerExecutor = Object.freeze({
    supportedOperations: Object.freeze(["optimise-svg"]),
    async execute(_job, context): Promise<never> {
      return new Promise((_resolve, reject) => {
        const signal = context?.signal;
        if (signal?.aborted) {
          reject(signal.reason);
          return;
        }
        signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    },
  });
  const result = await worker(fixture.client, executor).runOne();
  assert.equal(result.outcome, "cancelled");
  assert.equal(result.record?.status, "cancelled");
  assert.equal(fixture.calls.heartbeat, 1);
  assert.equal(fixture.calls.acknowledge, 1);
  assert.equal(fixture.calls.complete, 0);
  assert.equal(fixture.calls.fail, 0);
});

test("does not report failure when immutable output completion remains uncertain", async () => {
  const source = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M2 2H18V18H2Z"/></svg>';
  const objects = new MemoryVectorObjectStore();
  objects.seed("source/mark.svg", source, "image/svg+xml");
  const fixture = fakeClient({
    payload: optimisePayload(source),
    completionFailures: 10,
  });
  const result = await worker(
    fixture.client,
    createVectorWorkerExecutor(objects),
  ).runOne();

  assert.equal(result.outcome, "control-uncertain");
  assert.equal(result.error?.code, "HTTP_WORKER_COMPLETION_UNCERTAIN");
  assert.equal(result.error?.retryable, true);
  assert.equal(fixture.calls.complete, 3);
  assert.equal(fixture.calls.fail, 0);
  assert.equal(objects.has("output/mark.optimised.svg"), true);
  assert.equal(objects.has("output/mark.evidence.json"), true);
});
