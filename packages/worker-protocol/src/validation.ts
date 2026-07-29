import { Buffer } from "node:buffer";
import {
  HOSTED_JOB_MAX_LEASE_MS,
  HOSTED_JOB_MAX_PAYLOAD_BYTES,
  HOSTED_JOB_MIN_LEASE_MS,
  canonicalHostedJobJson,
  validateHostedJobOutputReceipts,
  type HostedJobRecord,
} from "@evavo/job-control";
import { VectorWorkerProtocolError } from "./errors.js";
import {
  VECTOR_WORKER_PROTOCOL_OPERATIONS,
  VECTOR_WORKER_PROTOCOL_VERSION,
  type VectorWorkerCompleteRequest,
  type VectorWorkerFailRequest,
  type VectorWorkerHeartbeatRequest,
  type VectorWorkerLeaseRequest,
  type VectorWorkerLeaseResponse,
  type VectorWorkerLeaseTokenRequest,
  type VectorWorkerProtocolOperation,
  type VectorWorkerProtocolRecord,
} from "./types.js";

const WORKER_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const LEASE_TOKEN = /^\S{16,256}$/;
const OPERATION_SET = new Set<VectorWorkerProtocolOperation>(
  VECTOR_WORKER_PROTOCOL_OPERATIONS,
);

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function strictKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
): void {
  const allowedSet = new Set(allowed);
  const unknown = Object.keys(value).filter((key) => !allowedSet.has(key));
  if (unknown.length > 0) {
    throw new VectorWorkerProtocolError(
      "VECTOR_WORKER_PROTOCOL_REQUEST_INVALID",
      `${label} contains unsupported fields.`,
      { details: { unknownFields: unknown.sort() } },
    );
  }
}

function requiredString(
  value: unknown,
  field: string,
  maximum: number,
): string {
  if (typeof value !== "string" || !value.trim() || value.length > maximum) {
    throw new VectorWorkerProtocolError(
      "VECTOR_WORKER_PROTOCOL_REQUEST_INVALID",
      `${field} must contain 1 to ${maximum} characters.`,
      { details: { field } },
    );
  }
  return value.trim();
}

function leaseToken(value: unknown): string {
  const token = requiredString(value, "leaseToken", 256);
  if (!LEASE_TOKEN.test(token)) {
    throw new VectorWorkerProtocolError(
      "VECTOR_WORKER_PROTOCOL_REQUEST_INVALID",
      "leaseToken must be an opaque 16 to 256 character value without whitespace.",
    );
  }
  return token;
}

function leaseDuration(value: unknown): number {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < HOSTED_JOB_MIN_LEASE_MS ||
    (value as number) > HOSTED_JOB_MAX_LEASE_MS
  ) {
    throw new VectorWorkerProtocolError(
      "VECTOR_WORKER_PROTOCOL_REQUEST_INVALID",
      `leaseMs must be an integer from ${HOSTED_JOB_MIN_LEASE_MS} to ${HOSTED_JOB_MAX_LEASE_MS}.`,
      { details: { leaseMs: value } },
    );
  }
  return value as number;
}

function boundedJson(
  value: unknown,
  field: string,
): Readonly<Record<string, unknown>> {
  const parsed = value === undefined ? {} : record(value);
  if (!parsed) {
    throw new VectorWorkerProtocolError(
      "VECTOR_WORKER_PROTOCOL_REQUEST_INVALID",
      `${field} must be a JSON object.`,
      { details: { field } },
    );
  }
  let source: string;
  try {
    source = canonicalHostedJobJson(parsed);
  } catch (error) {
    throw new VectorWorkerProtocolError(
      "VECTOR_WORKER_PROTOCOL_REQUEST_INVALID",
      `${field} must contain canonical finite JSON values.`,
      { details: { field }, cause: error },
    );
  }
  const bytes = Buffer.byteLength(source, "utf8");
  if (bytes > HOSTED_JOB_MAX_PAYLOAD_BYTES) {
    throw new VectorWorkerProtocolError(
      "VECTOR_WORKER_PROTOCOL_BODY_TOO_LARGE",
      `${field} exceeds the hosted job JSON limit.`,
      { status: 413, details: { field, bytes, maximum: HOSTED_JOB_MAX_PAYLOAD_BYTES } },
    );
  }
  return Object.freeze({ ...parsed });
}

export function validateWorkerLeaseRequest(
  input: unknown,
): VectorWorkerLeaseRequest {
  const value = record(input);
  if (!value) {
    throw new VectorWorkerProtocolError(
      "VECTOR_WORKER_PROTOCOL_REQUEST_INVALID",
      "Worker lease input must be a JSON object.",
    );
  }
  strictKeys(value, ["workerId", "leaseMs", "operations"], "Worker lease input");
  const workerId = requiredString(value.workerId, "workerId", 128);
  if (!WORKER_ID.test(workerId)) {
    throw new VectorWorkerProtocolError(
      "VECTOR_WORKER_PROTOCOL_REQUEST_INVALID",
      "workerId must use portable ASCII letters, digits, dots, underscores, colons or hyphens.",
      { details: { workerId } },
    );
  }
  let operations: readonly VectorWorkerProtocolOperation[] | undefined;
  if (value.operations !== undefined) {
    if (!Array.isArray(value.operations) || value.operations.length < 1) {
      throw new VectorWorkerProtocolError(
        "VECTOR_WORKER_PROTOCOL_REQUEST_INVALID",
        "operations must contain at least one supported worker operation.",
      );
    }
    const selected = new Set<VectorWorkerProtocolOperation>();
    for (const operation of value.operations) {
      if (typeof operation !== "string" || !OPERATION_SET.has(operation as VectorWorkerProtocolOperation)) {
        throw new VectorWorkerProtocolError(
          "VECTOR_WORKER_PROTOCOL_OPERATION_UNSUPPORTED",
          "operations contains an unsupported worker operation.",
          { details: { operation, supported: VECTOR_WORKER_PROTOCOL_OPERATIONS } },
        );
      }
      selected.add(operation as VectorWorkerProtocolOperation);
    }
    operations = Object.freeze([...selected]);
  }
  return Object.freeze({
    workerId,
    leaseMs: leaseDuration(value.leaseMs),
    ...(operations ? { operations } : {}),
  });
}

export function validateWorkerLeaseTokenRequest(
  input: unknown,
): VectorWorkerLeaseTokenRequest {
  const value = record(input);
  if (!value) {
    throw new VectorWorkerProtocolError(
      "VECTOR_WORKER_PROTOCOL_REQUEST_INVALID",
      "Worker transition input must be a JSON object.",
    );
  }
  strictKeys(value, ["leaseToken"], "Worker transition input");
  return Object.freeze({ leaseToken: leaseToken(value.leaseToken) });
}

export function validateWorkerHeartbeatRequest(
  input: unknown,
): VectorWorkerHeartbeatRequest {
  const value = record(input);
  if (!value) {
    throw new VectorWorkerProtocolError(
      "VECTOR_WORKER_PROTOCOL_REQUEST_INVALID",
      "Worker heartbeat input must be a JSON object.",
    );
  }
  strictKeys(value, ["leaseToken", "leaseMs"], "Worker heartbeat input");
  return Object.freeze({
    leaseToken: leaseToken(value.leaseToken),
    leaseMs: leaseDuration(value.leaseMs),
  });
}

export function validateWorkerCompleteRequest(
  input: unknown,
): VectorWorkerCompleteRequest {
  const value = record(input);
  if (!value) {
    throw new VectorWorkerProtocolError(
      "VECTOR_WORKER_PROTOCOL_REQUEST_INVALID",
      "Worker completion input must be a JSON object.",
    );
  }
  strictKeys(value, ["leaseToken", "outputs", "evidence"], "Worker completion input");
  const outputs = validateHostedJobOutputReceipts(value.outputs);
  if (outputs.length < 1) {
    throw new VectorWorkerProtocolError(
      "VECTOR_WORKER_PROTOCOL_REQUEST_INVALID",
      "Worker completion requires at least one immutable output receipt.",
    );
  }
  return Object.freeze({
    leaseToken: leaseToken(value.leaseToken),
    outputs,
    evidence: boundedJson(value.evidence, "evidence"),
  });
}

export function validateWorkerFailRequest(
  input: unknown,
): VectorWorkerFailRequest {
  const value = record(input);
  if (!value) {
    throw new VectorWorkerProtocolError(
      "VECTOR_WORKER_PROTOCOL_REQUEST_INVALID",
      "Worker failure input must be a JSON object.",
    );
  }
  strictKeys(
    value,
    ["leaseToken", "code", "message", "retryable", "details"],
    "Worker failure input",
  );
  if (typeof value.retryable !== "boolean") {
    throw new VectorWorkerProtocolError(
      "VECTOR_WORKER_PROTOCOL_REQUEST_INVALID",
      "retryable must be a boolean.",
    );
  }
  return Object.freeze({
    leaseToken: leaseToken(value.leaseToken),
    code: requiredString(value.code, "code", 160),
    message: requiredString(value.message, "message", 2_000),
    retryable: value.retryable,
    details: boundedJson(value.details, "details"),
  });
}

export function workerProtocolRecord(
  recordValue: HostedJobRecord,
): VectorWorkerProtocolRecord {
  return Object.freeze({
    ...recordValue,
    lease: recordValue.lease
      ? Object.freeze({
          workerId: recordValue.lease.workerId,
          acquiredAt: recordValue.lease.acquiredAt,
          heartbeatAt: recordValue.lease.heartbeatAt,
          expiresAt: recordValue.lease.expiresAt,
          tokenPresent: true as const,
        })
      : null,
  });
}

export function workerLeaseResponse(
  recordValue: HostedJobRecord,
): VectorWorkerLeaseResponse {
  if (!recordValue.lease?.token) {
    throw new VectorWorkerProtocolError(
      "VECTOR_WORKER_PROTOCOL_REQUEST_INVALID",
      "A leased job record must contain a lease token.",
      { status: 500, details: { jobId: recordValue.id } },
    );
  }
  return Object.freeze({
    protocolVersion: VECTOR_WORKER_PROTOCOL_VERSION,
    leaseToken: recordValue.lease.token,
    record: workerProtocolRecord(recordValue),
  });
}
