import assert from "node:assert/strict";
import test from "node:test";
import {
  createVectorWorkerClient,
  VectorWorkerClientError,
} from "./index.js";

const TOKEN = "worker-test-token-with-at-least-24-characters";
const JOB_ID = "vjob_remote_01";
const LEASE_TOKEN = "01234567-89ab-cdef-0123-456789abcdef";

function response(
  body: unknown,
  status = 200,
  headers: HeadersInit = {},
): Response {
  const resolvedHeaders = new Headers(headers);
  resolvedHeaders.set("content-type", "application/json");
  if (!resolvedHeaders.has("x-vector-worker-protocol")) {
    resolvedHeaders.set("x-vector-worker-protocol", "1.0");
  }
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: resolvedHeaders,
  });
}

function record(status = "leased") {
  return {
    contractVersion: "1.0",
    id: JOB_ID,
    version: 2,
    workspaceId: "worker-tests",
    idempotencyKey: "remote-worker-test",
    requestSha256: "a".repeat(64),
    operation: "optimise-svg",
    payload: {},
    priority: 5,
    status,
    attempts: 1,
    maxAttempts: 3,
    createdAt: "2026-07-29T00:00:00.000Z",
    updatedAt: "2026-07-29T00:00:00.000Z",
    startedAt: null,
    finishedAt: null,
    lease: {
      workerId: "remote-worker-01",
      acquiredAt: "2026-07-29T00:00:00.000Z",
      heartbeatAt: "2026-07-29T00:00:00.000Z",
      expiresAt: "2026-07-29T00:01:00.000Z",
      tokenPresent: true,
    },
    cancellation: null,
    result: null,
    failure: null,
  };
}

test("rejects insecure non-local URLs and accepts localhost HTTP", () => {
  assert.throws(
    () => createVectorWorkerClient({
      baseUrl: "http://worker.example.com",
      token: TOKEN,
    }),
    (error: unknown) =>
      error instanceof VectorWorkerClientError &&
      error.code === "VECTOR_WORKER_CLIENT_OPTIONS_INVALID",
  );
  const client = createVectorWorkerClient({
    baseUrl: "http://localhost:3000",
    token: TOKEN,
    fetch: async () => response({ service: "worker", contract: {} }),
  });
  assert.equal(client.baseUrl, "http://localhost:3000/");
});

test("reads capabilities and sends the worker token without exposing it", async () => {
  const requests: Request[] = [];
  const client = createVectorWorkerClient({
    baseUrl: "https://worker.example.com/base/",
    token: TOKEN,
    fetch: async (input, init) => {
      requests.push(new Request(input, init));
      return response({
        service: "evavo-vector-studio-worker-control",
        contract: { remoteExecutionAvailable: false },
      });
    },
  });
  const result = await client.capabilities();
  assert.equal(result.service, "evavo-vector-studio-worker-control");
  assert.equal(requests[0]?.url, "https://worker.example.com/base/api/v1/worker");
  assert.equal(requests[0]?.headers.get("authorization"), `Bearer ${TOKEN}`);
  assert.doesNotMatch(JSON.stringify(result), new RegExp(TOKEN));
});

test("returns null for an empty lease and parses one redacted lease response", async () => {
  let count = 0;
  const client = createVectorWorkerClient({
    baseUrl: "https://worker.example.com",
    token: TOKEN,
    fetch: async () => {
      count += 1;
      return count === 1
        ? new Response(null, { status: 204 })
        : response({
            protocolVersion: "1.0",
            leaseToken: LEASE_TOKEN,
            record: record(),
          });
    },
  });
  assert.equal(
    await client.acquireLease({ workerId: "remote-worker-01", leaseMs: 60_000 }),
    null,
  );
  const leased = await client.acquireLease({
    workerId: "remote-worker-01",
    leaseMs: 60_000,
    operations: ["optimise-svg"],
  });
  assert.equal(leased?.leaseToken, LEASE_TOKEN);
  assert.equal(leased?.record.lease?.tokenPresent, true);
  assert.equal("token" in (leased?.record.lease ?? {}), false);
  assert.doesNotMatch(JSON.stringify(leased?.record), new RegExp(LEASE_TOKEN));
});

test("uses exact mutation paths and never retries automatically", async () => {
  const paths: string[] = [];
  const bodies: unknown[] = [];
  const client = createVectorWorkerClient({
    baseUrl: "https://worker.example.com",
    token: TOKEN,
    fetch: async (input, init) => {
      const request = new Request(input, init);
      paths.push(new URL(request.url).pathname);
      bodies.push(JSON.parse(await request.text()) as unknown);
      const route = new URL(request.url).pathname;
      return response({
        record: record(route.endsWith("/heartbeat") ? "running" : "succeeded"),
        ...(route.endsWith("/heartbeat") ? { cancellationRequested: false } : {}),
      });
    },
  });
  await client.start(JOB_ID, LEASE_TOKEN);
  await client.heartbeat(JOB_ID, LEASE_TOKEN, 60_000);
  await client.complete(JOB_ID, {
    leaseToken: LEASE_TOKEN,
    outputs: [{
      path: "object://output/mark.svg",
      mimeType: "image/svg+xml",
      bytes: 123,
      sha256: "b".repeat(64),
    }],
    evidence: { approval: "human-review-required" },
  });
  await client.fail(
    JOB_ID,
    LEASE_TOKEN,
    {
      code: "TRANSIENT_FAILURE",
      message: "Temporary failure",
      retryable: true,
    },
  );
  await client.acknowledgeCancellation(JOB_ID, LEASE_TOKEN);

  assert.deepEqual(paths, [
    `/api/v1/worker/jobs/${JOB_ID}/start`,
    `/api/v1/worker/jobs/${JOB_ID}/heartbeat`,
    `/api/v1/worker/jobs/${JOB_ID}/complete`,
    `/api/v1/worker/jobs/${JOB_ID}/fail`,
    `/api/v1/worker/jobs/${JOB_ID}/acknowledge-cancellation`,
  ]);
  assert.equal(paths.length, 5);
  assert.equal((bodies[0] as { leaseToken?: string }).leaseToken, LEASE_TOKEN);
  assert.equal((bodies[2] as { outputs?: unknown[] }).outputs?.length, 1);
});

test("returns bounded stable server failures without leaking the client token", async () => {
  const client = createVectorWorkerClient({
    baseUrl: "https://worker.example.com",
    token: TOKEN,
    fetch: async () => response({
      error: "HOSTED_JOB_LEASE_EXPIRED",
      message: "The lease expired.",
      retryable: true,
      details: { jobId: JOB_ID },
    }, 409),
  });
  await assert.rejects(
    client.start(JOB_ID, LEASE_TOKEN),
    (error: unknown) => {
      assert.ok(error instanceof VectorWorkerClientError);
      assert.equal(error.code, "VECTOR_WORKER_CLIENT_HTTP_FAILED");
      assert.equal(error.status, 409);
      assert.equal(error.retryable, true);
      assert.equal(error.details?.serverCode, "HOSTED_JOB_LEASE_EXPIRED");
      assert.doesNotMatch(JSON.stringify(error.details), new RegExp(TOKEN));
      assert.doesNotMatch(error.message, new RegExp(TOKEN));
      return true;
    },
  );
});

test("rejects oversized and wrong-version success responses", async () => {
  const oversized = createVectorWorkerClient({
    baseUrl: "https://worker.example.com",
    token: TOKEN,
    maximumResponseBytes: 1_024,
    fetch: async () => response({ value: "x".repeat(2_000) }),
  });
  await assert.rejects(
    oversized.capabilities(),
    (error: unknown) =>
      error instanceof VectorWorkerClientError &&
      error.code === "VECTOR_WORKER_CLIENT_RESPONSE_TOO_LARGE",
  );

  const wrongVersion = createVectorWorkerClient({
    baseUrl: "https://worker.example.com",
    token: TOKEN,
    fetch: async () => response(
      { service: "worker", contract: {} },
      200,
      { "x-vector-worker-protocol": "9.9" },
    ),
  });
  await assert.rejects(
    wrongVersion.capabilities(),
    (error: unknown) =>
      error instanceof VectorWorkerClientError &&
      error.code === "VECTOR_WORKER_CLIENT_RESPONSE_INVALID",
  );
});

test("distinguishes caller cancellation from request timeout", async () => {
  const hangingFetch: typeof fetch = async (_input, init) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener(
        "abort",
        () => reject(init.signal?.reason ?? new Error("aborted")),
        { once: true },
      );
    });

  const cancelled = createVectorWorkerClient({
    baseUrl: "https://worker.example.com",
    token: TOKEN,
    fetch: hangingFetch,
    timeoutMs: 10_000,
  });
  const controller = new AbortController();
  const promise = cancelled.capabilities({ signal: controller.signal });
  controller.abort();
  await assert.rejects(
    promise,
    (error: unknown) =>
      error instanceof VectorWorkerClientError &&
      error.code === "VECTOR_WORKER_CLIENT_ABORTED",
  );

  const timedOut = createVectorWorkerClient({
    baseUrl: "https://worker.example.com",
    token: TOKEN,
    fetch: hangingFetch,
    timeoutMs: 1_000,
  });
  await assert.rejects(
    timedOut.capabilities(),
    (error: unknown) =>
      error instanceof VectorWorkerClientError &&
      error.code === "VECTOR_WORKER_CLIENT_TIMEOUT",
  );
});
