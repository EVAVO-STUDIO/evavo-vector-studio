import { hostedJobIdempotencyDigest } from "./canonical.js";
import { HostedJobError } from "./errors.js";
import type {
  HostedJobRecord,
  HostedJobStore,
  HostedJobStoreCreateResult,
} from "./types.js";

function cloneRecord(record: HostedJobRecord): HostedJobRecord {
  return structuredClone(record) as HostedJobRecord;
}

export class MemoryHostedJobStore implements HostedJobStore {
  readonly #records = new Map<string, HostedJobRecord>();
  readonly #idempotency = new Map<string, string>();

  async create(record: HostedJobRecord): Promise<HostedJobStoreCreateResult> {
    const key = hostedJobIdempotencyDigest(record.workspaceId, record.idempotencyKey);
    const existingId = this.#idempotency.get(key);
    if (existingId) {
      const existing = this.#records.get(existingId);
      if (!existing) {
        throw new HostedJobError(
          "HOSTED_JOB_STORE_CORRUPT",
          "The in-memory idempotency index references a missing job.",
          { status: 500, details: { existingId } },
        );
      }
      return Object.freeze({ record: cloneRecord(existing), created: false });
    }
    if (this.#records.has(record.id)) {
      throw new HostedJobError(
        "HOSTED_JOB_STORE_FAILED",
        "The generated hosted job ID already exists.",
        { status: 500, retryable: true, details: { jobId: record.id } },
      );
    }
    const retained = cloneRecord(record);
    this.#records.set(record.id, retained);
    this.#idempotency.set(key, record.id);
    return Object.freeze({ record: cloneRecord(retained), created: true });
  }

  async get(jobId: string): Promise<HostedJobRecord | null> {
    const record = this.#records.get(jobId);
    return record ? cloneRecord(record) : null;
  }

  async compareAndSwap(
    jobId: string,
    expectedVersion: number,
    next: HostedJobRecord,
  ): Promise<boolean> {
    const current = this.#records.get(jobId);
    if (!current || current.version !== expectedVersion) return false;
    this.#records.set(jobId, cloneRecord(next));
    return true;
  }

  async list(): Promise<readonly HostedJobRecord[]> {
    return Object.freeze(
      [...this.#records.values()].map(cloneRecord),
    );
  }
}
