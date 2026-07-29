import { Buffer } from "node:buffer";
import { HostedJobError } from "./errors.js";
import { canonicalHostedJobJson } from "./canonical.js";
import {
  HOSTED_JOB_CONTRACT_VERSION,
  HOSTED_JOB_MAX_ATTEMPTS,
  HOSTED_JOB_MAX_PAYLOAD_BYTES,
  HOSTED_JOB_OPERATIONS,
  type HostedJobCreateRequest,
  type HostedJobOperation,
  type HostedJobOutputReceipt,
  type HostedJobRecord,
  type HostedJobStatus,
  type NormalizedHostedJobCreateRequest,
} from "./types.js";

const WORKSPACE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const JOB_ID = /^vjob_[A-Za-z0-9_-]{12,96}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const STATUSES = new Set<HostedJobStatus>([
  "queued",
  "leased",
  "running",
  "cancel-requested",
  "succeeded",
  "failed",
  "cancelled",
]);
const OPERATIONS = new Set<HostedJobOperation>(HOSTED_JOB_OPERATIONS);
const CREATE_KEYS = new Set([
  "workspaceId",
  "idempotencyKey",
  "operation",
  "payload",
  "priority",
  "maxAttempts",
]);

function plainRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function invalid(message: string, details: Readonly<Record<string, unknown>> = {}): never {
  throw new HostedJobError(
    "HOSTED_JOB_REQUEST_INVALID",
    message,
    { status: 422, details },
  );
}

export function validateHostedJobCreateRequest(
  value: unknown,
): NormalizedHostedJobCreateRequest {
  const source = plainRecord(value);
  if (!source) invalid("The hosted job request must be an object.");
  const unknownKeys = Object.keys(source).filter((key) => !CREATE_KEYS.has(key));
  if (unknownKeys.length > 0) {
    invalid("The hosted job request contains unsupported fields.", { unknownKeys });
  }

  const workspaceId = source.workspaceId;
  if (typeof workspaceId !== "string" || !WORKSPACE_ID.test(workspaceId)) {
    invalid("workspaceId must be a portable 1 to 64 character identifier.", { workspaceId });
  }
  const idempotencyKey = source.idempotencyKey;
  if (typeof idempotencyKey !== "string" || !IDEMPOTENCY_KEY.test(idempotencyKey)) {
    invalid("idempotencyKey must be a portable 1 to 128 character key.", { idempotencyKey });
  }
  const operation = source.operation;
  if (typeof operation !== "string" || !OPERATIONS.has(operation as HostedJobOperation)) {
    invalid("operation is not supported.", { operation, supported: HOSTED_JOB_OPERATIONS });
  }
  const payload = plainRecord(source.payload);
  if (!payload) invalid("payload must be a JSON-compatible object.");
  const canonicalPayload = canonicalHostedJobJson(payload);
  const payloadBytes = Buffer.byteLength(canonicalPayload, "utf8");
  if (payloadBytes > HOSTED_JOB_MAX_PAYLOAD_BYTES) {
    invalid("payload exceeds the hosted job JSON limit.", {
      payloadBytes,
      maximum: HOSTED_JOB_MAX_PAYLOAD_BYTES,
    });
  }

  const priority = source.priority ?? 5;
  if (!Number.isSafeInteger(priority) || Number(priority) < 0 || Number(priority) > 9) {
    invalid("priority must be an integer from 0 to 9.", { priority });
  }
  const maxAttempts = source.maxAttempts ?? 3;
  if (
    !Number.isSafeInteger(maxAttempts) ||
    Number(maxAttempts) < 1 ||
    Number(maxAttempts) > HOSTED_JOB_MAX_ATTEMPTS
  ) {
    invalid(`maxAttempts must be an integer from 1 to ${HOSTED_JOB_MAX_ATTEMPTS}.`, {
      maxAttempts,
    });
  }

  return Object.freeze({
    workspaceId,
    idempotencyKey,
    operation: operation as HostedJobOperation,
    payload: Object.freeze({ ...payload }),
    priority: Number(priority),
    maxAttempts: Number(maxAttempts),
  });
}

export function validateHostedJobOutputReceipts(
  value: readonly HostedJobOutputReceipt[] | undefined,
): readonly HostedJobOutputReceipt[] {
  if (value === undefined) return Object.freeze([]);
  if (!Array.isArray(value) || value.length > 32) {
    invalid("outputs must contain no more than 32 receipts.");
  }
  const seen = new Set<string>();
  return Object.freeze(value.map((receipt, index) => {
    const source = plainRecord(receipt);
    if (!source) invalid("Every output receipt must be an object.", { index });
    const path = source.path;
    const mimeType = source.mimeType;
    const bytes = source.bytes;
    const sha256 = source.sha256;
    if (typeof path !== "string" || path.length < 1 || path.length > 4096 || path.includes("\0")) {
      invalid("Output receipt paths must contain 1 to 4096 characters.", { index });
    }
    if (seen.has(path)) invalid("Output receipt paths must be unique.", { path, index });
    seen.add(path);
    if (typeof mimeType !== "string" || mimeType.length < 1 || mimeType.length > 160) {
      invalid("Output receipt MIME types must contain 1 to 160 characters.", { index });
    }
    if (!Number.isSafeInteger(bytes) || Number(bytes) < 0) {
      invalid("Output receipt bytes must be a non-negative safe integer.", { index });
    }
    if (typeof sha256 !== "string" || !SHA256.test(sha256)) {
      invalid("Output receipt SHA-256 values must be lowercase hexadecimal.", { index });
    }
    return Object.freeze({ path, mimeType, bytes: Number(bytes), sha256 });
  }));
}

function assertIso(value: unknown, field: string, nullable = false): void {
  if (nullable && value === null) return;
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new HostedJobError(
      "HOSTED_JOB_STORE_CORRUPT",
      `Stored hosted job field ${field} is not a valid timestamp.`,
      { status: 500, details: { field, value } },
    );
  }
}

export function parseHostedJobRecord(value: unknown): HostedJobRecord {
  const source = plainRecord(value);
  if (!source) {
    throw new HostedJobError("HOSTED_JOB_STORE_CORRUPT", "Stored hosted job is not an object.", { status: 500 });
  }
  if (source.contractVersion !== HOSTED_JOB_CONTRACT_VERSION) {
    throw new HostedJobError(
      "HOSTED_JOB_STORE_CORRUPT",
      "Stored hosted job uses an unsupported contract version.",
      { status: 500, details: { contractVersion: source.contractVersion } },
    );
  }
  if (typeof source.id !== "string" || !JOB_ID.test(source.id)) {
    throw new HostedJobError("HOSTED_JOB_STORE_CORRUPT", "Stored hosted job ID is invalid.", { status: 500 });
  }
  if (!Number.isSafeInteger(source.version) || Number(source.version) < 1) {
    throw new HostedJobError("HOSTED_JOB_STORE_CORRUPT", "Stored hosted job version is invalid.", { status: 500 });
  }
  if (typeof source.workspaceId !== "string" || !WORKSPACE_ID.test(source.workspaceId)) {
    throw new HostedJobError("HOSTED_JOB_STORE_CORRUPT", "Stored workspace ID is invalid.", { status: 500 });
  }
  if (typeof source.idempotencyKey !== "string" || !IDEMPOTENCY_KEY.test(source.idempotencyKey)) {
    throw new HostedJobError("HOSTED_JOB_STORE_CORRUPT", "Stored idempotency key is invalid.", { status: 500 });
  }
  if (typeof source.requestSha256 !== "string" || !SHA256.test(source.requestSha256)) {
    throw new HostedJobError("HOSTED_JOB_STORE_CORRUPT", "Stored request SHA-256 is invalid.", { status: 500 });
  }
  if (typeof source.operation !== "string" || !OPERATIONS.has(source.operation as HostedJobOperation)) {
    throw new HostedJobError("HOSTED_JOB_STORE_CORRUPT", "Stored operation is invalid.", { status: 500 });
  }
  if (!STATUSES.has(source.status as HostedJobStatus)) {
    throw new HostedJobError("HOSTED_JOB_STORE_CORRUPT", "Stored status is invalid.", { status: 500 });
  }
  const payload = plainRecord(source.payload);
  if (!payload) {
    throw new HostedJobError("HOSTED_JOB_STORE_CORRUPT", "Stored payload is invalid.", { status: 500 });
  }
  for (const field of ["createdAt", "updatedAt"] as const) assertIso(source[field], field);
  assertIso(source.startedAt, "startedAt", true);
  assertIso(source.finishedAt, "finishedAt", true);
  return source as unknown as HostedJobRecord;
}

export function isHostedJobCreateRequest(value: unknown): value is HostedJobCreateRequest {
  try {
    validateHostedJobCreateRequest(value);
    return true;
  } catch {
    return false;
  }
}
