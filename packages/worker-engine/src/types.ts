import type {
  HostedJobOperation,
  HostedJobOutputReceipt,
  HostedJobRecord,
} from "@evavo/job-control";

export const VECTOR_WORKER_CONTRACT_VERSION = "1.0" as const;
export const VECTOR_WORKER_MAX_SOURCE_BYTES = 32 * 1024 * 1024;
export const VECTOR_WORKER_MAX_MOTION_BYTES = 256 * 1024;
export const VECTOR_WORKER_MAX_OUTPUT_BYTES = 32 * 1024 * 1024;

export const VECTOR_WORKER_SUPPORTED_OPERATIONS = Object.freeze([
  "trace-raster",
  "optimise-svg",
  "animate-svg",
  "export-lottie",
  "package-dotlottie",
] as const satisfies readonly HostedJobOperation[]);

export type VectorWorkerOperation =
  typeof VECTOR_WORKER_SUPPORTED_OPERATIONS[number];

export type ObjectSourceReference = Readonly<{
  objectKey: string;
  sha256: string;
}>;

export type StoredObject = Readonly<{
  objectKey: string;
  mimeType: string;
  bytes: Uint8Array;
  byteCount: number;
  sha256: string;
}>;

export type ObjectWrite = Readonly<{
  objectKey: string;
  mimeType: string;
  bytes: Uint8Array;
}>;

export type ObjectReceipt = Readonly<{
  objectKey: string;
  path: string;
  mimeType: string;
  bytes: number;
  sha256: string;
}>;

export type VectorObjectStore = Readonly<{
  get: (
    objectKey: string,
    options?: Readonly<{ maximumBytes?: number; signal?: AbortSignal }>,
  ) => Promise<StoredObject>;
  putManyNew: (
    writes: readonly ObjectWrite[],
    options?: Readonly<{ signal?: AbortSignal }>,
  ) => Promise<readonly ObjectReceipt[]>;
}>;

export type WorkerExecutionContext = Readonly<{
  signal?: AbortSignal;
}>;

export type WorkerExecutionResult = Readonly<{
  jobId: string;
  operation: VectorWorkerOperation;
  workerContractVersion: typeof VECTOR_WORKER_CONTRACT_VERSION;
  outputs: readonly HostedJobOutputReceipt[];
  evidence: Readonly<Record<string, unknown>>;
}>;

export type VectorWorkerExecutor = Readonly<{
  supportedOperations: readonly VectorWorkerOperation[];
  execute: (
    job: HostedJobRecord,
    context?: WorkerExecutionContext,
  ) => Promise<WorkerExecutionResult>;
}>;
