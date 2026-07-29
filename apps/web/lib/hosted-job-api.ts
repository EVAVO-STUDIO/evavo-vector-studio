import {
  HOSTED_JOB_CONTRACT_VERSION,
  HOSTED_JOB_MAX_PAYLOAD_BYTES,
  HOSTED_JOB_OPERATIONS,
  HostedJobError,
  type HostedJobRecord,
} from "@evavo/job-control";
import { apiJson } from "./api-security";
import {
  getHostedJobRuntime,
  type HostedJobRuntime,
} from "./hosted-job-control";

export const HOSTED_JOB_REQUEST_MAX_BYTES = HOSTED_JOB_MAX_PAYLOAD_BYTES + 16 * 1024;

export function hostedJobLinks(jobId: string): Readonly<Record<string, string>> {
  return Object.freeze({
    self: `/api/v1/jobs/${encodeURIComponent(jobId)}`,
    cancel: `/api/v1/jobs/${encodeURIComponent(jobId)}`,
  });
}

export function hostedJobView(record: HostedJobRecord): Readonly<Record<string, unknown>> {
  return Object.freeze({
    ...record,
    links: hostedJobLinks(record.id),
    execution: Object.freeze({
      remoteExecutionAvailable: false,
      workerLeaseRequired: record.status === "queued",
    }),
    approval: record.status === "succeeded"
      ? "human-review-required"
      : "not-yet-applicable",
  });
}

export function hostedJobRuntimeView(runtime: HostedJobRuntime): Readonly<Record<string, unknown>> {
  return Object.freeze({
    contractVersion: HOSTED_JOB_CONTRACT_VERSION,
    recordCreationAvailable: runtime.available,
    persistentRecords: runtime.persistentRecords,
    remoteExecutionAvailable: runtime.remoteExecutionAvailable,
    storeMode: runtime.mode,
    storePathConfigured: runtime.storePath !== null,
    reason: runtime.reason,
    operations: HOSTED_JOB_OPERATIONS,
    endpoints: Object.freeze({
      create: "/api/v1/jobs",
      inspect: "/api/v1/jobs/{jobId}",
      cancel: "/api/v1/jobs/{jobId}",
    }),
    productionPolicy: Object.freeze({
      failClosedWithoutStore: true,
      fileStoreRequiresPersistentVolumeAcknowledgement: true,
      hostedWorkerAvailable: false,
    }),
  });
}

export async function requireHostedJobRuntime(): Promise<
  | Readonly<{ runtime: HostedJobRuntime; response: null }>
  | Readonly<{ runtime: HostedJobRuntime; response: Response }>
> {
  const runtime = await getHostedJobRuntime();
  return runtime.available && runtime.controller
    ? Object.freeze({ runtime, response: null })
    : Object.freeze({
        runtime,
        response: apiJson(
          {
            error: "HOSTED_JOB_STORE_NOT_CONFIGURED",
            message: runtime.reason,
            contract: hostedJobRuntimeView(runtime),
          },
          503,
        ),
      });
}

export function hostedJobErrorResponse(error: unknown): Response {
  if (error instanceof HostedJobError) {
    return apiJson(
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
  return apiJson(
    {
      error: "HOSTED_JOB_OPERATION_FAILED",
      message: error instanceof Error ? error.message : String(error),
      retryable: false,
    },
    500,
  );
}
