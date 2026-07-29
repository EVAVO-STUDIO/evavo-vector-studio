import type {
  HostedJobFailureInput,
  HostedJobLeaseRequest,
  HostedJobOutputReceipt,
  HostedJobRecord,
} from "@evavo/job-control";

export const VECTOR_WORKER_PROTOCOL_VERSION = "1.0" as const;
export const VECTOR_WORKER_PROTOCOL_MAX_BODY_BYTES = 256 * 1024 + 16 * 1024;

export const VECTOR_WORKER_PROTOCOL_OPERATIONS = Object.freeze([
  "trace-raster",
  "optimise-svg",
  "animate-svg",
  "export-lottie",
  "package-dotlottie",
] as const satisfies readonly HostedJobLeaseRequest["operations"]);

export type VectorWorkerProtocolOperation =
  typeof VECTOR_WORKER_PROTOCOL_OPERATIONS[number];

export type VectorWorkerLeaseRequest = Readonly<{
  workerId: string;
  leaseMs: number;
  operations?: readonly VectorWorkerProtocolOperation[];
}>;

export type VectorWorkerLeaseTokenRequest = Readonly<{
  leaseToken: string;
}>;

export type VectorWorkerHeartbeatRequest = Readonly<{
  leaseToken: string;
  leaseMs: number;
}>;

export type VectorWorkerCompleteRequest = Readonly<{
  leaseToken: string;
  outputs: readonly HostedJobOutputReceipt[];
  evidence?: Readonly<Record<string, unknown>>;
}>;

export type VectorWorkerFailRequest = Readonly<{
  leaseToken: string;
  code: string;
  message: string;
  retryable: boolean;
  details?: Readonly<Record<string, unknown>>;
}>;

export type VectorWorkerProtocolRecord = Readonly<
  Omit<HostedJobRecord, "lease"> & {
    lease: null | Readonly<{
      workerId: string;
      acquiredAt: string;
      heartbeatAt: string;
      expiresAt: string;
      tokenPresent: true;
    }>;
  }
>;

export type VectorWorkerLeaseResponse = Readonly<{
  protocolVersion: typeof VECTOR_WORKER_PROTOCOL_VERSION;
  leaseToken: string;
  record: VectorWorkerProtocolRecord;
}>;

export type VectorWorkerFailureInput = HostedJobFailureInput;
