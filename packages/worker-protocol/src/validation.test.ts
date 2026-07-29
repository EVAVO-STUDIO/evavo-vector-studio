import assert from "node:assert/strict";
import test from "node:test";
import {
  HostedJobController,
  MemoryHostedJobStore,
} from "@evavo/job-control";
import { VectorWorkerProtocolError } from "./errors.js";
import {
  validateWorkerCompleteRequest,
  validateWorkerFailRequest,
  validateWorkerHeartbeatRequest,
  validateWorkerLeaseRequest,
  validateWorkerLeaseTokenRequest,
  workerLeaseResponse,
  workerProtocolRecord,
} from "./validation.js";

test("validates a bounded lease request and rejects unsupported run-batch", () => {
  assert.deepEqual(
    validateWorkerLeaseRequest({
      workerId: "remote-worker-01",
      leaseMs: 60_000,
      operations: ["trace-raster", "optimise-svg", "trace-raster"],
    }),
    {
      workerId: "remote-worker-01",
      leaseMs: 60_000,
      operations: ["trace-raster", "optimise-svg"],
    },
  );
  assert.throws(
    () => validateWorkerLeaseRequest({
      workerId: "remote-worker-01",
      leaseMs: 60_000,
      operations: ["run-batch"],
    }),
    (error: unknown) =>
      error instanceof VectorWorkerProtocolError &&
      error.code === "VECTOR_WORKER_PROTOCOL_OPERATION_UNSUPPORTED",
  );
});

test("rejects unknown fields and malformed lease tokens", () => {
  assert.throws(
    () => validateWorkerLeaseRequest({
      workerId: "worker-01",
      leaseMs: 60_000,
      extra: true,
    }),
    (error: unknown) =>
      error instanceof VectorWorkerProtocolError &&
      error.code === "VECTOR_WORKER_PROTOCOL_REQUEST_INVALID",
  );
  assert.throws(
    () => validateWorkerLeaseTokenRequest({ leaseToken: "too-short" }),
    (error: unknown) =>
      error instanceof VectorWorkerProtocolError &&
      error.code === "VECTOR_WORKER_PROTOCOL_REQUEST_INVALID",
  );
});

test("validates heartbeat, completion and failure payloads", () => {
  assert.deepEqual(
    validateWorkerHeartbeatRequest({
      leaseToken: "01234567-89ab-cdef-0123-456789abcdef",
      leaseMs: 30_000,
    }),
    {
      leaseToken: "01234567-89ab-cdef-0123-456789abcdef",
      leaseMs: 30_000,
    },
  );
  const completion = validateWorkerCompleteRequest({
    leaseToken: "01234567-89ab-cdef-0123-456789abcdef",
    outputs: [
      {
        path: "object://output/mark.svg",
        mimeType: "image/svg+xml",
        bytes: 123,
        sha256: "a".repeat(64),
      },
    ],
    evidence: { approval: "human-review-required" },
  });
  assert.equal(completion.outputs.length, 1);
  assert.equal(completion.evidence?.approval, "human-review-required");

  const failure = validateWorkerFailRequest({
    leaseToken: "01234567-89ab-cdef-0123-456789abcdef",
    code: "TRANSIENT_STORAGE_FAILURE",
    message: "Storage temporarily unavailable",
    retryable: true,
    details: { provider: "test" },
  });
  assert.equal(failure.retryable, true);
  assert.equal(failure.details?.provider, "test");
});

test("requires receipt-backed completion and bounded evidence", () => {
  assert.throws(
    () => validateWorkerCompleteRequest({
      leaseToken: "01234567-89ab-cdef-0123-456789abcdef",
      outputs: [],
    }),
    (error: unknown) =>
      error instanceof VectorWorkerProtocolError &&
      error.code === "VECTOR_WORKER_PROTOCOL_REQUEST_INVALID",
  );
  assert.throws(
    () => validateWorkerCompleteRequest({
      leaseToken: "01234567-89ab-cdef-0123-456789abcdef",
      outputs: [
        {
          path: "object://output/mark.svg",
          mimeType: "image/svg+xml",
          bytes: 123,
          sha256: "a".repeat(64),
        },
      ],
      evidence: { value: "x".repeat(300_000) },
    }),
    (error: unknown) =>
      error instanceof VectorWorkerProtocolError &&
      error.code === "VECTOR_WORKER_PROTOCOL_BODY_TOO_LARGE",
  );
});

test("returns a lease token only in the authenticated acquisition envelope", async () => {
  let jobId = 0;
  let leaseId = 0;
  const controller = new HostedJobController(new MemoryHostedJobStore(), {
    createId: () => `vjob_protocol_${++jobId}`,
    createLeaseToken: () => `01234567-89ab-cdef-0123-${String(++leaseId).padStart(12, "0")}`,
  });
  await controller.create({
    workspaceId: "protocol-tests",
    idempotencyKey: "lease-response",
    operation: "optimise-svg",
    payload: {},
  });
  const leased = await controller.acquireLease({
    workerId: "remote-worker-01",
    leaseMs: 60_000,
    operations: ["optimise-svg"],
  });
  assert.ok(leased);
  const response = workerLeaseResponse(leased);
  assert.match(response.leaseToken, /^[0-9a-f-]{36}$/);
  assert.equal(response.record.lease?.tokenPresent, true);
  assert.equal("token" in (response.record.lease ?? {}), false);
  assert.doesNotMatch(JSON.stringify(response.record), /01234567-89ab/);

  const redacted = workerProtocolRecord(leased);
  assert.equal(redacted.lease?.workerId, "remote-worker-01");
  assert.equal("token" in (redacted.lease ?? {}), false);
});
