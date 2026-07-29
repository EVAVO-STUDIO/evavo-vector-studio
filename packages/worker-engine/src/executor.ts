import {
  createDotLottiePackage,
  createLottieFromSvgMotion,
} from "@evavo/lottie-engine";
import { createAnimatedSvg } from "@evavo/motion-engine";
import { traceRaster } from "@evavo/raster-engine";
import { optimiseSvg } from "@evavo/vector-core";
import type {
  HostedJobOutputReceipt,
  HostedJobRecord,
} from "@evavo/job-control";
import {
  VectorWorkerError,
  throwIfWorkerAborted,
  vectorWorkerFailure,
} from "./errors.js";
import {
  validateVectorWorkerPayload,
  type AnimateSvgWorkerPayload,
  type ExportLottieWorkerPayload,
  type OptimiseSvgWorkerPayload,
  type PackageDotLottieWorkerPayload,
  type TraceRasterWorkerPayload,
} from "./payloads.js";
import {
  VECTOR_WORKER_CONTRACT_VERSION,
  VECTOR_WORKER_MAX_MOTION_BYTES,
  VECTOR_WORKER_MAX_SOURCE_BYTES,
  VECTOR_WORKER_SUPPORTED_OPERATIONS,
  type ObjectReceipt,
  type ObjectSourceReference,
  type ObjectWrite,
  type VectorObjectStore,
  type VectorWorkerExecutor,
  type WorkerExecutionContext,
  type WorkerExecutionResult,
} from "./types.js";

const UTF8 = new TextDecoder("utf-8", { fatal: true });
const ENCODER = new TextEncoder();

function jsonBytes(value: unknown): Uint8Array {
  return ENCODER.encode(`${JSON.stringify(value, null, 2)}\n`);
}

function textBytes(value: string): Uint8Array {
  return ENCODER.encode(value);
}

function decodeUtf8(bytes: Uint8Array, objectKey: string): string {
  try {
    return UTF8.decode(bytes);
  } catch (error) {
    throw new VectorWorkerError(
      "VECTOR_WORKER_PAYLOAD_INVALID",
      "A source object is not valid UTF-8 text.",
      {
        details: { objectKey },
        cause: error,
      },
    );
  }
}

async function sourceObject(
  store: VectorObjectStore,
  reference: ObjectSourceReference,
  context: WorkerExecutionContext,
  maximumBytes = VECTOR_WORKER_MAX_SOURCE_BYTES,
) {
  const object = await store.get(reference.objectKey, {
    maximumBytes,
    signal: context.signal,
  });
  if (object.sha256 !== reference.sha256) {
    throw new VectorWorkerError(
      "VECTOR_WORKER_OBJECT_HASH_MISMATCH",
      "The source object does not match the immutable SHA-256 revision in the job payload.",
      {
        details: {
          objectKey: reference.objectKey,
          expectedSha256: reference.sha256,
          actualSha256: object.sha256,
        },
      },
    );
  }
  return object;
}

function jobReceipts(
  receipts: readonly ObjectReceipt[],
): readonly HostedJobOutputReceipt[] {
  return Object.freeze(receipts.map((receipt) => Object.freeze({
    path: receipt.path,
    mimeType: receipt.mimeType,
    bytes: receipt.bytes,
    sha256: receipt.sha256,
  })));
}

function compactOutputs(receipts: readonly ObjectReceipt[]) {
  return Object.freeze(receipts.map((receipt) => Object.freeze({
    objectKey: receipt.objectKey,
    mimeType: receipt.mimeType,
    bytes: receipt.bytes,
    sha256: receipt.sha256,
  })));
}

async function commit(
  store: VectorObjectStore,
  writes: readonly ObjectWrite[],
  context: WorkerExecutionContext,
) {
  throwIfWorkerAborted(context.signal);
  return store.putManyNew(writes, { signal: context.signal });
}

async function executeTrace(
  job: HostedJobRecord,
  payload: TraceRasterWorkerPayload,
  store: VectorObjectStore,
  context: WorkerExecutionContext,
): Promise<WorkerExecutionResult> {
  const source = await sourceObject(store, payload.source, context);
  const result = await traceRaster(source.bytes, {
    ...payload.options,
    sourceName: payload.source.objectKey,
    includeDifferenceArtifact: Boolean(payload.outputs.differenceObjectKey),
    signal: context.signal,
  });
  const writes: ObjectWrite[] = [
    Object.freeze({
      objectKey: payload.outputs.svgObjectKey,
      mimeType: "image/svg+xml",
      bytes: textBytes(result.svg),
    }),
    Object.freeze({
      objectKey: payload.outputs.evidenceObjectKey,
      mimeType: "application/json",
      bytes: jsonBytes({
        workerContractVersion: VECTOR_WORKER_CONTRACT_VERSION,
        jobId: job.id,
        operation: job.operation,
        source: {
          objectKey: source.objectKey,
          bytes: source.byteCount,
          sha256: source.sha256,
        },
        inspection: result.inspection,
        evidence: result.evidence,
        approval: "human-review-required",
      }),
    }),
  ];
  if (payload.outputs.differenceObjectKey) {
    const difference = result.artifacts.differencePng;
    if (!difference) {
      throw new VectorWorkerError(
        "VECTOR_WORKER_EXECUTION_FAILED",
        "The trace job requested difference output but the engine did not return it.",
      );
    }
    writes.push(Object.freeze({
      objectKey: payload.outputs.differenceObjectKey,
      mimeType: "image/png",
      bytes: difference,
    }));
  }
  const receipts = await commit(store, writes, context);
  return Object.freeze({
    jobId: job.id,
    operation: "trace-raster",
    workerContractVersion: VECTOR_WORKER_CONTRACT_VERSION,
    outputs: jobReceipts(receipts),
    evidence: Object.freeze({
      sourceSha256: source.sha256,
      selectedCandidateId: result.evidence.selection.selectedCandidateId,
      renderQuality: result.evidence.comparison.quality,
      outputObjects: compactOutputs(receipts),
      approval: "human-review-required",
    }),
  });
}

async function executeOptimise(
  job: HostedJobRecord,
  payload: OptimiseSvgWorkerPayload,
  store: VectorObjectStore,
  context: WorkerExecutionContext,
): Promise<WorkerExecutionResult> {
  const source = await sourceObject(store, payload.source, context);
  const sourceText = decodeUtf8(source.bytes, source.objectKey);
  throwIfWorkerAborted(context.signal);
  const result = optimiseSvg(sourceText);
  const receipts = await commit(store, [
    Object.freeze({
      objectKey: payload.outputs.svgObjectKey,
      mimeType: "image/svg+xml",
      bytes: textBytes(result.svg),
    }),
    Object.freeze({
      objectKey: payload.outputs.evidenceObjectKey,
      mimeType: "application/json",
      bytes: jsonBytes({
        workerContractVersion: VECTOR_WORKER_CONTRACT_VERSION,
        jobId: job.id,
        operation: job.operation,
        source: {
          objectKey: source.objectKey,
          bytes: source.byteCount,
          sha256: source.sha256,
        },
        beforeBytes: result.beforeBytes,
        afterBytes: result.afterBytes,
        bytesSaved: result.bytesSaved,
        inspection: result.inspection,
        approval: "human-review-required",
      }),
    }),
  ], context);
  return Object.freeze({
    jobId: job.id,
    operation: "optimise-svg",
    workerContractVersion: VECTOR_WORKER_CONTRACT_VERSION,
    outputs: jobReceipts(receipts),
    evidence: Object.freeze({
      sourceSha256: source.sha256,
      bytesSaved: result.bytesSaved,
      outputObjects: compactOutputs(receipts),
      approval: "human-review-required",
    }),
  });
}

async function executeAnimate(
  job: HostedJobRecord,
  payload: AnimateSvgWorkerPayload,
  store: VectorObjectStore,
  context: WorkerExecutionContext,
): Promise<WorkerExecutionResult> {
  const source = await sourceObject(store, payload.source, context);
  const sourceText = decodeUtf8(source.bytes, source.objectKey);
  const motionBytes = jsonBytes(payload.motion);
  if (motionBytes.byteLength > VECTOR_WORKER_MAX_MOTION_BYTES) {
    throw new VectorWorkerError(
      "VECTOR_WORKER_PAYLOAD_INVALID",
      "The inline motion plan exceeds the worker byte limit.",
    );
  }
  throwIfWorkerAborted(context.signal);
  const result = createAnimatedSvg(sourceText, payload.motion);
  const receipts = await commit(store, [
    Object.freeze({
      objectKey: payload.outputs.svgObjectKey,
      mimeType: "image/svg+xml",
      bytes: textBytes(result.svg),
    }),
    Object.freeze({
      objectKey: payload.outputs.evidenceObjectKey,
      mimeType: "application/json",
      bytes: jsonBytes({
        workerContractVersion: VECTOR_WORKER_CONTRACT_VERSION,
        jobId: job.id,
        operation: job.operation,
        inspection: result.inspection,
        evidence: result.evidence,
        approval: "human-review-required",
      }),
    }),
  ], context);
  return Object.freeze({
    jobId: job.id,
    operation: "animate-svg",
    workerContractVersion: VECTOR_WORKER_CONTRACT_VERSION,
    outputs: jobReceipts(receipts),
    evidence: Object.freeze({
      sourceSha256: source.sha256,
      motionId: result.evidence.motion.id,
      outputSha256: result.evidence.output.sha256,
      outputObjects: compactOutputs(receipts),
      approval: "human-review-required",
    }),
  });
}

async function executeLottie(
  job: HostedJobRecord,
  payload: ExportLottieWorkerPayload,
  store: VectorObjectStore,
  context: WorkerExecutionContext,
): Promise<WorkerExecutionResult> {
  const source = await sourceObject(store, payload.source, context);
  const sourceText = decodeUtf8(source.bytes, source.objectKey);
  const motionBytes = jsonBytes(payload.motion);
  if (motionBytes.byteLength > VECTOR_WORKER_MAX_MOTION_BYTES) {
    throw new VectorWorkerError(
      "VECTOR_WORKER_PAYLOAD_INVALID",
      "The inline motion plan exceeds the worker byte limit.",
    );
  }
  throwIfWorkerAborted(context.signal);
  const result = createLottieFromSvgMotion(
    sourceText,
    payload.motion,
    payload.options,
  );
  const receipts = await commit(store, [
    Object.freeze({
      objectKey: payload.outputs.lottieObjectKey,
      mimeType: "video/lottie+json",
      bytes: textBytes(result.json),
    }),
    Object.freeze({
      objectKey: payload.outputs.evidenceObjectKey,
      mimeType: "application/json",
      bytes: jsonBytes({
        workerContractVersion: VECTOR_WORKER_CONTRACT_VERSION,
        jobId: job.id,
        operation: job.operation,
        inspection: result.inspection,
        evidence: result.evidence,
        approval: "human-review-required",
      }),
    }),
  ], context);
  return Object.freeze({
    jobId: job.id,
    operation: "export-lottie",
    workerContractVersion: VECTOR_WORKER_CONTRACT_VERSION,
    outputs: jobReceipts(receipts),
    evidence: Object.freeze({
      sourceSha256: source.sha256,
      outputSha256: result.evidence.output.sha256,
      structuralInspection: result.evidence.compatibility.structuralInspection,
      playerRenderValidation: result.evidence.compatibility.playerRenderValidation,
      outputObjects: compactOutputs(receipts),
      approval: "human-review-required",
    }),
  });
}

async function executeDotLottie(
  job: HostedJobRecord,
  payload: PackageDotLottieWorkerPayload,
  store: VectorObjectStore,
  context: WorkerExecutionContext,
): Promise<WorkerExecutionResult> {
  const source = await sourceObject(store, payload.source, context);
  const sourceText = decodeUtf8(source.bytes, source.objectKey);
  throwIfWorkerAborted(context.signal);
  const result = createDotLottiePackage(sourceText, {
    animationId: payload.animationId,
  });
  const receipts = await commit(store, [
    Object.freeze({
      objectKey: payload.outputs.archiveObjectKey,
      mimeType: "application/zip+dotlottie",
      bytes: result.bytes,
    }),
    Object.freeze({
      objectKey: payload.outputs.evidenceObjectKey,
      mimeType: "application/json",
      bytes: jsonBytes({
        workerContractVersion: VECTOR_WORKER_CONTRACT_VERSION,
        jobId: job.id,
        operation: job.operation,
        manifest: result.manifest,
        inspection: result.inspection,
        evidence: result.evidence,
        approval: "human-review-required",
      }),
    }),
  ], context);
  return Object.freeze({
    jobId: job.id,
    operation: "package-dotlottie",
    workerContractVersion: VECTOR_WORKER_CONTRACT_VERSION,
    outputs: jobReceipts(receipts),
    evidence: Object.freeze({
      sourceSha256: source.sha256,
      archiveSha256: result.evidence.output.sha256,
      manifestVersion: result.manifest.version,
      archiveInspection: result.evidence.compatibility.archiveInspection,
      playerRenderValidation: result.evidence.compatibility.playerRenderValidation,
      outputObjects: compactOutputs(receipts),
      approval: "human-review-required",
    }),
  });
}

export function createVectorWorkerExecutor(
  objectStore: VectorObjectStore,
): VectorWorkerExecutor {
  return Object.freeze({
    supportedOperations: VECTOR_WORKER_SUPPORTED_OPERATIONS,
    async execute(
      job: HostedJobRecord,
      context: WorkerExecutionContext = {},
    ): Promise<WorkerExecutionResult> {
      try {
        throwIfWorkerAborted(context.signal);
        if (job.status !== "running") {
          throw new VectorWorkerError(
            "VECTOR_WORKER_JOB_INVALID",
            "The worker executes only hosted jobs in running state.",
            { details: { jobId: job.id, status: job.status } },
          );
        }
        const payload = validateVectorWorkerPayload(job.operation, job.payload);
        switch (payload.operation) {
          case "trace-raster":
            return executeTrace(job, payload.value, objectStore, context);
          case "optimise-svg":
            return executeOptimise(job, payload.value, objectStore, context);
          case "animate-svg":
            return executeAnimate(job, payload.value, objectStore, context);
          case "export-lottie":
            return executeLottie(job, payload.value, objectStore, context);
          case "package-dotlottie":
            return executeDotLottie(job, payload.value, objectStore, context);
        }
      } catch (error) {
        throw vectorWorkerFailure(error);
      }
    },
  });
}
