import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalHostedJobJson,
  hostedJobSha256,
} from "./canonical.js";
import { HostedJobError } from "./errors.js";
import {
  validateHostedJobCreateRequest,
  validateHostedJobOutputReceipts,
} from "./validation.js";

function request(payload: Readonly<Record<string, unknown>>) {
  return {
    workspaceId: "evavo-studio",
    idempotencyKey: "brand-mark:revision-01",
    operation: "trace-raster",
    payload,
  } as const;
}

test("canonicalises equivalent hosted job requests deterministically", () => {
  const first = validateHostedJobCreateRequest(request({
    source: { path: "source/mark.png", sha256: "abc" },
    options: { maxColours: 8, optimise: true },
  }));
  const second = validateHostedJobCreateRequest(request({
    options: { optimise: true, maxColours: 8 },
    source: { sha256: "abc", path: "source/mark.png" },
  }));

  assert.equal(canonicalHostedJobJson(first), canonicalHostedJobJson(second));
  assert.equal(hostedJobSha256(first), hostedJobSha256(second));
  assert.match(hostedJobSha256(first), /^[a-f0-9]{64}$/);
  assert.equal(first.priority, 5);
  assert.equal(first.maxAttempts, 3);
});

test("rejects unknown fields, unsupported operations and oversized payloads", () => {
  assert.throws(
    () => validateHostedJobCreateRequest({
      ...request({ source: "mark.png" }),
      unexpected: true,
    }),
    (error: unknown) =>
      error instanceof HostedJobError &&
      error.code === "HOSTED_JOB_REQUEST_INVALID" &&
      error.status === 422,
  );

  assert.throws(
    () => validateHostedJobCreateRequest({
      ...request({ source: "mark.png" }),
      operation: "unknown-operation",
    }),
    (error: unknown) =>
      error instanceof HostedJobError &&
      error.code === "HOSTED_JOB_REQUEST_INVALID",
  );

  assert.throws(
    () => validateHostedJobCreateRequest(request({
      source: "x".repeat(300 * 1024),
    })),
    (error: unknown) =>
      error instanceof HostedJobError &&
      error.code === "HOSTED_JOB_REQUEST_INVALID",
  );
});

test("validates distinct SHA-256 output receipts", () => {
  const receipts = validateHostedJobOutputReceipts([
    {
      path: "/output/mark.svg",
      mimeType: "image/svg+xml",
      bytes: 123,
      sha256: "a".repeat(64),
    },
  ]);
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0]?.bytes, 123);

  assert.throws(
    () => validateHostedJobOutputReceipts([
      {
        path: "/output/mark.svg",
        mimeType: "image/svg+xml",
        bytes: 123,
        sha256: "a".repeat(64),
      },
      {
        path: "/output/mark.svg",
        mimeType: "application/json",
        bytes: 5,
        sha256: "b".repeat(64),
      },
    ]),
    (error: unknown) =>
      error instanceof HostedJobError &&
      error.code === "HOSTED_JOB_REQUEST_INVALID",
  );
});
