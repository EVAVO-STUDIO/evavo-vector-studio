import assert from "node:assert/strict";
import test from "node:test";
import type {
  VectorWorkerClient,
} from "@evavo/worker-client";
import type {
  VectorWorkerExecutor,
} from "@evavo/worker-engine";
import { HttpWorkerError } from "./errors.js";
import { HttpVectorWorker } from "./runner.js";

const client: VectorWorkerClient = Object.freeze({
  version: "1.0",
  baseUrl: "https://worker.example.com/",
  async capabilities() {
    return Object.freeze({ service: "fixture", contract: Object.freeze({}) });
  },
  async acquireLease() {
    return null;
  },
  async start(): Promise<never> {
    throw new Error("Unexpected start.");
  },
  async heartbeat(): Promise<never> {
    throw new Error("Unexpected heartbeat.");
  },
  async complete(): Promise<never> {
    throw new Error("Unexpected completion.");
  },
  async fail(): Promise<never> {
    throw new Error("Unexpected failure.");
  },
  async acknowledgeCancellation(): Promise<never> {
    throw new Error("Unexpected cancellation acknowledgement.");
  },
});

const executor = Object.freeze({
  supportedOperations: Object.freeze(["optimise-svg"] as const),
  async execute(): Promise<never> {
    throw new Error("Unexpected execution.");
  },
}) satisfies VectorWorkerExecutor;

function create(objectTransport?: "shared-file" | "worker-api") {
  return new HttpVectorWorker(client, executor, {
    workerId: "transport-capability-test",
    leaseMs: 5_000,
    heartbeatMs: 1_000,
    pollMs: 100,
    operations: ["optimise-svg"],
    ...(objectTransport ? { objectTransport } : {}),
  });
}

test("defaults to the existing shared-file transport", () => {
  const capabilities = create().capabilities;
  assert.equal(capabilities.execution, "http-coordinated-shared-object-store");
  assert.equal(capabilities.objectTransport, "shared-file");
  assert.equal(capabilities.sharedImmutableObjectStoreRequired, true);
  assert.equal(capabilities.objectTransferAvailable, false);
});

test("reports API transfer without claiming queue delivery or managed execution", () => {
  const capabilities = create("worker-api").capabilities;
  assert.equal(capabilities.execution, "http-coordinated-object-transfer");
  assert.equal(capabilities.objectTransport, "worker-api");
  assert.equal(capabilities.sharedImmutableObjectStoreRequired, false);
  assert.equal(capabilities.objectTransferAvailable, true);
  assert.equal(capabilities.queueDeliveryAvailable, false);
  assert.equal(capabilities.managedRemoteExecutionAvailable, false);
});

test("rejects unknown object transports", () => {
  assert.throws(
    () => new HttpVectorWorker(client, executor, {
      workerId: "invalid-transport-test",
      objectTransport: "unsupported" as "worker-api",
    }),
    (error: unknown) =>
      error instanceof HttpWorkerError &&
      error.code === "HTTP_WORKER_CONFIG_INVALID",
  );
});
