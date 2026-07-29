import type {
  HostedJobFailureInput,
  HostedJobOutputReceipt,
} from "@evavo/job-control";
import type {
  VectorWorkerLeaseRequest,
  VectorWorkerLeaseResponse,
  VectorWorkerProtocolRecord,
} from "@evavo/worker-protocol";

export const VECTOR_WORKER_CLIENT_VERSION = "1.0" as const;
export const DEFAULT_WORKER_CLIENT_TIMEOUT_MS = 30_000;
export const DEFAULT_WORKER_CLIENT_MAX_RESPONSE_BYTES = 512 * 1024;

export type VectorWorkerFetch = typeof fetch;

export type VectorWorkerClientOptions = Readonly<{
  baseUrl: string;
  token: string;
  fetch?: VectorWorkerFetch;
  timeoutMs?: number;
  maximumResponseBytes?: number;
  allowInsecureHttp?: boolean;
}>;

export type VectorWorkerRequestOptions = Readonly<{
  signal?: AbortSignal;
}>;

export type VectorWorkerCapabilitiesResponse = Readonly<{
  service: string;
  contract: Readonly<Record<string, unknown>>;
}>;

export type VectorWorkerRecordResponse = Readonly<{
  record: VectorWorkerProtocolRecord;
  [key: string]: unknown;
}>;

export type VectorWorkerHeartbeatResponse = VectorWorkerRecordResponse & Readonly<{
  cancellationRequested: boolean;
}>;

export type VectorWorkerCompleteInput = Readonly<{
  leaseToken: string;
  outputs: readonly HostedJobOutputReceipt[];
  evidence?: Readonly<Record<string, unknown>>;
}>;

export type VectorWorkerClient = Readonly<{
  version: typeof VECTOR_WORKER_CLIENT_VERSION;
  baseUrl: string;
  capabilities: (
    options?: VectorWorkerRequestOptions,
  ) => Promise<VectorWorkerCapabilitiesResponse>;
  acquireLease: (
    request: VectorWorkerLeaseRequest,
    options?: VectorWorkerRequestOptions,
  ) => Promise<VectorWorkerLeaseResponse | null>;
  start: (
    jobId: string,
    leaseToken: string,
    options?: VectorWorkerRequestOptions,
  ) => Promise<VectorWorkerRecordResponse>;
  heartbeat: (
    jobId: string,
    leaseToken: string,
    leaseMs: number,
    options?: VectorWorkerRequestOptions,
  ) => Promise<VectorWorkerHeartbeatResponse>;
  complete: (
    jobId: string,
    completion: VectorWorkerCompleteInput,
    options?: VectorWorkerRequestOptions,
  ) => Promise<VectorWorkerRecordResponse>;
  fail: (
    jobId: string,
    leaseToken: string,
    failure: HostedJobFailureInput,
    options?: VectorWorkerRequestOptions,
  ) => Promise<VectorWorkerRecordResponse>;
  acknowledgeCancellation: (
    jobId: string,
    leaseToken: string,
    options?: VectorWorkerRequestOptions,
  ) => Promise<VectorWorkerRecordResponse>;
}>;
