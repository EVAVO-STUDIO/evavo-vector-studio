import { Buffer } from "node:buffer";
import { canonicalHostedJobJson } from "./canonical.js";
import { HostedJobController } from "./controller.js";
import { HostedJobError } from "./errors.js";
import {
  HOSTED_JOB_MAX_PAYLOAD_BYTES,
  type HostedJobCompletion,
  type HostedJobRecord,
  type HostedJobStore,
} from "./types.js";
import { validateHostedJobOutputReceipts } from "./validation.js";

export type HostedJobCompletionReplayResult = Readonly<{
  record: HostedJobRecord;
  replayed: boolean;
}>;

type NormalisedCompletion = Readonly<{
  outputs: ReturnType<typeof validateHostedJobOutputReceipts>;
  evidence: Readonly<Record<string, unknown>>;
}>;

function normaliseCompletion(
  completion: HostedJobCompletion,
): NormalisedCompletion {
  const outputs = validateHostedJobOutputReceipts(completion.outputs);
  const evidence = Object.freeze({ ...(completion.evidence ?? {}) });
  const evidenceJson = canonicalHostedJobJson(evidence);
  if (Buffer.byteLength(evidenceJson, "utf8") > HOSTED_JOB_MAX_PAYLOAD_BYTES) {
    throw new HostedJobError(
      "HOSTED_JOB_REQUEST_INVALID",
      "completion.evidence exceeds the hosted job JSON limit.",
      { status: 422 },
    );
  }
  return Object.freeze({ outputs, evidence });
}

function expectedRetainedEvidence(
  record: HostedJobRecord,
  evidence: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    ...evidence,
    ...(record.cancellation
      ? { cancellationRaceResolution: "committed-success-retained" }
      : {}),
  });
}

function completionIdentity(
  outputs: ReturnType<typeof validateHostedJobOutputReceipts>,
  evidence: Readonly<Record<string, unknown>>,
): string {
  return canonicalHostedJobJson({ outputs, evidence });
}

function replayMatch(
  record: HostedJobRecord,
  completion: NormalisedCompletion,
): boolean {
  if (record.status !== "succeeded" || !record.result) return false;
  const retainedIdentity = completionIdentity(
    record.result.outputs,
    record.result.evidence,
  );
  const requestedIdentity = completionIdentity(
    completion.outputs,
    expectedRetainedEvidence(record, completion.evidence),
  );
  return retainedIdentity === requestedIdentity;
}

function completionConflict(record: HostedJobRecord): HostedJobError {
  return new HostedJobError(
    "HOSTED_JOB_COMPLETION_CONFLICT",
    "The hosted job already succeeded with different immutable output receipts or evidence.",
    {
      status: 409,
      details: {
        jobId: record.id,
        retainedCompletedAt: record.result?.completedAt ?? null,
      },
    },
  );
}

async function replayIfRetained(
  store: HostedJobStore,
  jobId: string,
  completion: NormalisedCompletion,
): Promise<HostedJobCompletionReplayResult | null> {
  const retained = await store.get(jobId);
  if (!retained || retained.status !== "succeeded") return null;
  if (!replayMatch(retained, completion)) throw completionConflict(retained);
  return Object.freeze({ record: retained, replayed: true });
}

export async function completeHostedJobIdempotently(
  controller: HostedJobController,
  store: HostedJobStore,
  jobId: string,
  leaseToken: string,
  input: HostedJobCompletion,
): Promise<HostedJobCompletionReplayResult> {
  const completion = normaliseCompletion(input);
  const retained = await replayIfRetained(store, jobId, completion);
  if (retained) return retained;

  try {
    const record = await controller.succeed(jobId, leaseToken, completion);
    return Object.freeze({ record, replayed: false });
  } catch (error) {
    if (
      error instanceof HostedJobError &&
      (
        error.code === "HOSTED_JOB_LEASE_INVALID" ||
        error.code === "HOSTED_JOB_TRANSITION_INVALID" ||
        error.code === "HOSTED_JOB_CANCELLATION_REQUESTED"
      )
    ) {
      const raced = await replayIfRetained(store, jobId, completion);
      if (raced) return raced;
    }
    throw error;
  }
}
