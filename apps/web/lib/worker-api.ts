import {
  HOSTED_JOB_CONTRACT_VERSION,
  HostedJobError,
  type HostedJobRecord,
} from "@evavo/job-control";
import {
  VECTOR_WORKER_PROTOCOL_MAX_BODY_BYTES,
  VECTOR_WORKER_PROTOCOL_OPERATIONS,
  VECTOR_WORKER_PROTOCOL_VERSION,
  VectorWorkerProtocolError,
  workerProtocolRecord,
} from "@evavo/worker-protocol";
import { apiJson } from "./api-security";
import {
  getHostedJobRuntime,
  type HostedJobRuntime,
} from "./hosted-job-control";
import type { WorkerObjectStoreRuntime } from "./worker-object-store";

export const runtime = "nodejs";

export function workerProtocolHeaders(extra: HeadersInit = {}): Headers {
  const headers = new Headers(extra);
  headers.set("x-vector-worker-protocol", VECTOR_WORKER_PROTOCOL_VERSION);
  return headers;
}

export function workerJson(
  value: unknown,
  status = 200,
  extraHeaders: HeadersInit = {},
): Response {
  return apiJson(value, status, workerProtocolHeaders(extraHeaders));
}

export async function parseWorkerJson(request: Request): Promise<unknown> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") {
    throw new VectorWorkerProtocolError(
      "VECTOR_WORKER_PROTOCOL_REQUEST_INVALID",
      "Worker control requests require Content-Type: application/json.",
      { status: 415, details: { contentType: contentType ?? null } },
    );
  }
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > VECTOR_WORKER_PROTOCOL_MAX_BODY_BYTES
  ) {
    throw new VectorWorkerProtocolError(
      "VECTOR_WORKER_PROTOCOL_BODY_TOO_LARGE",
      "The worker control request exceeds the configured JSON limit.",
      {
        status: 413,
        details: {
          declaredLength,
          maximum: VECTOR_WORKER_PROTOCOL_MAX_BODY_BYTES,
        },
      },
    );
  }
  const source = await request.text();
  const bytes = Buffer.byteLength(source, "utf8");
  if (bytes < 2) {
    throw new VectorWorkerProtocolError(
      "VECTOR_WORKER_PROTOCOL_REQUEST_INVALID",
      "The worker control request body is empty.",
      { status: 400 },
    );
  }
  if (bytes > VECTOR_WORKER_PROTOCOL_MAX_BODY_BYTES) {
    throw new VectorWorkerProtocolError(
      "VECTOR_WORKER_PROTOCOL_BODY_TOO_LARGE",
      "The worker control request exceeds the configured JSON limit.",
      {
        status: 413,
        details: { bytes, maximum: VECTOR_WORKER_PROTOCOL_MAX_BODY_BYTES },
      },
    );
  }
  try {
    return JSON.parse(source) as unknown;
  } catch (error) {
    throw new VectorWorkerProtocolError(
      "VECTOR_WORKER_PROTOCOL_REQUEST_INVALID",
      "The worker control request is not valid JSON.",
      { status: 400, cause: error },
    );
  }
}

export function workerRecordView(
  record: HostedJobRecord,
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    ...workerProtocolRecord(record),
    protocolVersion: VECTOR_WORKER_PROTOCOL_VERSION,
    remoteExecutionAvailable: false,
    objectTransferAvailable: "service-discovery-required",
    approval: record.status === "succeeded"
      ? "human-review-required"
      : "not-yet-applicable",
  });
}

export function workerRuntimeView(
  runtimeValue: HostedJobRuntime,
  objectRuntime?: WorkerObjectStoreRuntime,
): Readonly<Record<string, unknown>> {
  const objectTransferAvailable = objectRuntime?.objectTransferAvailable ?? false;
  return Object.freeze({
    protocolVersion: VECTOR_WORKER_PROTOCOL_VERSION,
    hostedJobContractVersion: HOSTED_JOB_CONTRACT_VERSION,
    controlApiAvailable: runtimeValue.available,
    persistentRecords: runtimeValue.persistentRecords,
    storeMode: runtimeValue.mode,
    workerAuthentication: "Bearer VECTOR_WORKER_API_TOKEN",
    supportedOperations: VECTOR_WORKER_PROTOCOL_OPERATIONS,
    objectTransferAvailable,
    persistentObjects: objectRuntime?.persistentObjects ?? false,
    objectStoreMode: objectRuntime?.mode ?? "disabled",
    objectStorePathConfigured: objectRuntime?.storePath !== null &&
      objectRuntime?.storePath !== undefined,
    objectStoreReason: objectRuntime?.reason ??
      "Object-store capability was not loaded for this response.",
    queueDeliveryAvailable: false,
    remoteExecutionAvailable: false,
    endpoints: Object.freeze({
      capabilities: "/api/v1/worker",
      lease: "/api/v1/worker/lease",
      objects: "/api/v1/worker/objects",
      objectDownload: "/api/v1/worker/objects?key={objectKey}",
      start: "/api/v1/worker/jobs/{jobId}/start",
      heartbeat: "/api/v1/worker/jobs/{jobId}/heartbeat",
      complete: "/api/v1/worker/jobs/{jobId}/complete",
      fail: "/api/v1/worker/jobs/{jobId}/fail",
      acknowledgeCancellation:
        "/api/v1/worker/jobs/{jobId}/acknowledge-cancellation",
    }),
    productionPolicy: Object.freeze({
      separateWorkerTokenRequired: true,
      failClosedWithoutJobStore: true,
      failClosedWithoutObjectStore: true,
      generatedBodiesInControlResponses: false,
      objectBodiesUseDedicatedBinaryRoutes: true,
      leaseTokensReturnedOnlyByAcquisition: true,
      humanReviewRequired: true,
    }),
  });
}

export async function requireWorkerRuntime(): Promise<
  | Readonly<{ runtime: HostedJobRuntime; response: null }>
  | Readonly<{ runtime: HostedJobRuntime; response: Response }>
> {
  const runtimeValue = await getHostedJobRuntime();
  return runtimeValue.available && runtimeValue.controller
    ? Object.freeze({ runtime: runtimeValue, response: null })
    : Object.freeze({
        runtime: runtimeValue,
        response: workerJson(
          {
            error: "VECTOR_WORKER_JOB_STORE_NOT_CONFIGURED",
            message: runtimeValue.reason,
            contract: workerRuntimeView(runtimeValue),
          },
          503,
        ),
      });
}

export function workerErrorResponse(error: unknown): Response {
  if (error instanceof VectorWorkerProtocolError) {
    return workerJson(
      {
        error: error.code,
        message: error.message,
        retryable: error.retryable,
        details: error.details,
      },
      error.status,
      error.retryable ? { "retry-after": "1" } : {},
    );
  }
  if (error instanceof HostedJobError) {
    return workerJson(
      {
        error: error.code,
        message: error.message,
        retryable: error.retryable,
        details: error.details,
      },
      error.status,
      error.retryable ? { "retry-after": "1" } : {},
    );
  }
  return workerJson(
    {
      error: "VECTOR_WORKER_PROTOCOL_OPERATION_FAILED",
      message: error instanceof Error ? error.message : String(error),
      retryable: false,
    },
    500,
  );
}
