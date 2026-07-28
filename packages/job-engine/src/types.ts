export const BATCH_CONTRACT_VERSION = "1.0" as const;
export const MAX_BATCH_ITEMS = 1_000;
export const DEFAULT_STALE_LOCK_MS = 6 * 60 * 60 * 1_000;

export type BatchFailureMode = "continue" | "fail-fast";
export type BatchJobStatus = "pending" | "running" | "complete" | "failed" | "cancelled";
export type BatchItemStatus = "pending" | "running" | "complete" | "failed" | "skipped";

export type BatchManifestItem = Readonly<{
  id: string;
  operation: string;
  spec: Readonly<Record<string, unknown>>;
}>;

export type BatchManifest = Readonly<{
  version: "1.0";
  id: string;
  name: string;
  failureMode: BatchFailureMode;
  items: readonly BatchManifestItem[];
}>;

export type BatchOutputReceipt = Readonly<{
  path: string;
  mimeType: string;
  bytes: number;
  sha256: string;
}>;

export type BatchOperationDescriptor = Readonly<{
  revision: string;
  inputPaths: readonly string[];
  outputPaths: readonly string[];
  summary?: Readonly<Record<string, unknown>>;
}>;

export type BatchOperationResult = Readonly<{
  revision: string;
  outputs: readonly BatchOutputReceipt[];
  evidence?: Readonly<Record<string, unknown>>;
}>;

export type BatchOperationContext = Readonly<{
  rootPath: string;
  jobDirectory: string;
  manifest: BatchManifest;
  item: BatchManifestItem;
  attempt: number;
  signal?: AbortSignal;
}>;

export type BatchOperationHandler = Readonly<{
  describe: (
    context: BatchOperationContext,
  ) => Promise<BatchOperationDescriptor> | BatchOperationDescriptor;
  execute: (
    context: BatchOperationContext,
    descriptor: BatchOperationDescriptor,
  ) => Promise<BatchOperationResult>;
}>;

export type BatchOperationRegistry = Readonly<Record<string, BatchOperationHandler>>;

export type BatchItemError = Readonly<{
  code: string;
  message: string;
  details?: Readonly<Record<string, unknown>>;
}>;

export type BatchItemState = Readonly<{
  id: string;
  operation: string;
  status: BatchItemStatus;
  attempts: number;
  revision: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  outputs: readonly BatchOutputReceipt[];
  evidence: Readonly<Record<string, unknown>> | null;
  error: BatchItemError | null;
}>;

export type BatchJobState = Readonly<{
  contractVersion: "1.0";
  jobId: string;
  manifestPath: string;
  manifestSha256: string;
  rootPath: string;
  failureMode: BatchFailureMode;
  status: BatchJobStatus;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  items: readonly BatchItemState[];
}>;

export type BatchJobEvent = Readonly<{
  at: string;
  type: string;
  jobId: string;
  itemId?: string;
  details?: Readonly<Record<string, unknown>>;
}>;

export type RunDurableBatchOptions = Readonly<{
  manifestPath: string;
  rootPath?: string;
  stateRootPath?: string;
  handlers: BatchOperationRegistry;
  staleLockMs?: number;
  signal?: AbortSignal;
}>;

export type DurableBatchResult = Readonly<{
  jobDirectory: string;
  state: BatchJobState;
}>;
