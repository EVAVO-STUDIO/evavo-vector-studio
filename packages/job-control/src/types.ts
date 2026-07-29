export const HOSTED_JOB_CONTRACT_VERSION = "1.0" as const;
export const HOSTED_JOB_MAX_PAYLOAD_BYTES = 256 * 1024;
export const HOSTED_JOB_MAX_ATTEMPTS = 10;
export const HOSTED_JOB_MIN_LEASE_MS = 5_000;
export const HOSTED_JOB_MAX_LEASE_MS = 15 * 60 * 1_000;

export const HOSTED_JOB_OPERATIONS = Object.freeze([
  "trace-raster",
  "optimise-svg",
  "animate-svg",
  "export-lottie",
  "package-dotlottie",
  "run-batch",
] as const);

export type HostedJobOperation = typeof HOSTED_JOB_OPERATIONS[number];
export type HostedJobStatus =
  | "queued"
  | "leased"
  | "running"
  | "cancel-requested"
  | "succeeded"
  | "failed"
  | "cancelled";

export type HostedJobCreateRequest = Readonly<{
  workspaceId: string;
  idempotencyKey: string;
  operation: HostedJobOperation;
  payload: Readonly<Record<string, unknown>>;
  priority?: number;
  maxAttempts?: number;
}>;

export type NormalizedHostedJobCreateRequest = Readonly<{
  workspaceId: string;
  idempotencyKey: string;
  operation: HostedJobOperation;
  payload: Readonly<Record<string, unknown>>;
  priority: number;
  maxAttempts: number;
}>;

export type HostedJobLease = Readonly<{
  workerId: string;
  token: string;
  acquiredAt: string;
  heartbeatAt: string;
  expiresAt: string;
}>;

export type HostedJobCancellation = Readonly<{
  requestedAt: string;
  requestedBy: string | null;
  reason: string | null;
}>;

export type HostedJobOutputReceipt = Readonly<{
  path: string;
  mimeType: string;
  bytes: number;
  sha256: string;
}>;

export type HostedJobResult = Readonly<{
  outputs: readonly HostedJobOutputReceipt[];
  evidence: Readonly<Record<string, unknown>>;
  completedAt: string;
}>;

export type HostedJobFailure = Readonly<{
  code: string;
  message: string;
  retryable: boolean;
  details: Readonly<Record<string, unknown>> | null;
  occurredAt: string;
}>;

export type HostedJobRecord = Readonly<{
  contractVersion: typeof HOSTED_JOB_CONTRACT_VERSION;
  id: string;
  version: number;
  workspaceId: string;
  idempotencyKey: string;
  requestSha256: string;
  operation: HostedJobOperation;
  payload: Readonly<Record<string, unknown>>;
  priority: number;
  status: HostedJobStatus;
  attempts: number;
  maxAttempts: number;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  lease: HostedJobLease | null;
  cancellation: HostedJobCancellation | null;
  result: HostedJobResult | null;
  failure: HostedJobFailure | null;
}>;

export type HostedJobCreateResult = Readonly<{
  record: HostedJobRecord;
  reused: boolean;
}>;

export type HostedJobLeaseRequest = Readonly<{
  workerId: string;
  leaseMs: number;
  operations?: readonly HostedJobOperation[];
}>;

export type HostedJobCompletion = Readonly<{
  outputs?: readonly HostedJobOutputReceipt[];
  evidence?: Readonly<Record<string, unknown>>;
}>;

export type HostedJobFailureInput = Readonly<{
  code: string;
  message: string;
  retryable: boolean;
  details?: Readonly<Record<string, unknown>>;
}>;

export type HostedJobStoreCreateResult = Readonly<{
  record: HostedJobRecord;
  created: boolean;
}>;

export type HostedJobStore = Readonly<{
  create: (record: HostedJobRecord) => Promise<HostedJobStoreCreateResult>;
  get: (jobId: string) => Promise<HostedJobRecord | null>;
  compareAndSwap: (
    jobId: string,
    expectedVersion: number,
    next: HostedJobRecord,
  ) => Promise<boolean>;
  list: () => Promise<readonly HostedJobRecord[]>;
}>;

export type HostedJobControllerOptions = Readonly<{
  now?: () => Date;
  createId?: () => string;
  createLeaseToken?: () => string;
  compareAndSwapAttempts?: number;
}>;
