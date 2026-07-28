import path from "node:path";
import { BatchEngineError, batchFailure } from "./errors.js";
import { readBatchManifest } from "./manifest.js";
import { canonicalBatchRoot } from "./path-policy.js";
import {
  acquireBatchLock,
  appendBatchEvent,
  batchJobPaths,
  readOrCreateBatchState,
  releaseBatchLock,
  verifyBatchOutputReceipts,
  writeBatchState,
  type BatchJobPaths,
} from "./store.js";
import {
  BATCH_CONTRACT_VERSION,
  type BatchItemError,
  type BatchItemState,
  type BatchJobState,
  type BatchManifest,
  type BatchManifestItem,
  type BatchOperationContext,
  type BatchOperationDescriptor,
  type BatchOperationRegistry,
  type BatchOperationResult,
  type DurableBatchResult,
  type RunDurableBatchOptions,
} from "./types.js";

const SHA256 = /^[a-f0-9]{64}$/;
const MAX_OUTPUTS_PER_ITEM = 16;

function isoNow(): string {
  return new Date().toISOString();
}

function freezeItems(items: readonly BatchItemState[]): readonly BatchItemState[] {
  return Object.freeze(items.map((item) => Object.freeze({
    ...item,
    outputs: Object.freeze([...item.outputs]),
    evidence: item.evidence ? Object.freeze({ ...item.evidence }) : null,
    error: item.error ? Object.freeze({ ...item.error }) : null,
  })));
}

function nextState(
  state: BatchJobState,
  patch: Partial<BatchJobState>,
  items = state.items,
): BatchJobState {
  return Object.freeze({
    ...state,
    ...patch,
    updatedAt: isoNow(),
    items: freezeItems(items),
  });
}

function replaceItem(
  state: BatchJobState,
  itemId: string,
  replacement: BatchItemState,
  patch: Partial<BatchJobState> = {},
): BatchJobState {
  const index = state.items.findIndex((item) => item.id === itemId);
  if (index < 0) {
    throw new BatchEngineError(
      "BATCH_JOB_STATE_INVALID",
      "The durable state is missing a manifest item.",
      { details: { jobId: state.jobId, itemId } },
    );
  }
  const items = [...state.items];
  items[index] = replacement;
  return nextState(state, patch, items);
}

function serializedError(error: unknown): BatchItemError {
  const failure = batchFailure(error);
  return Object.freeze({
    code: failure.code,
    message: failure.message,
    ...(failure.details ? { details: failure.details } : {}),
  });
}

function throwIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new BatchEngineError(
      "BATCH_CANCELLED",
      "The durable batch run was cancelled.",
      { retryable: true },
    );
  }
}

function validateRetainedState(
  state: BatchJobState,
  manifest: BatchManifest,
): void {
  if (
    state.contractVersion !== BATCH_CONTRACT_VERSION ||
    state.items.length !== manifest.items.length
  ) {
    throw new BatchEngineError(
      "BATCH_JOB_STATE_INVALID",
      "The durable batch state does not match the manifest item set.",
      {
        details: {
          stateContractVersion: state.contractVersion,
          manifestContractVersion: manifest.version,
          stateItemCount: state.items.length,
          manifestItemCount: manifest.items.length,
        },
      },
    );
  }
  for (let index = 0; index < manifest.items.length; index += 1) {
    const manifestItem = manifest.items[index]!;
    const stateItem = state.items[index]!;
    if (
      manifestItem.id !== stateItem.id ||
      manifestItem.operation !== stateItem.operation
    ) {
      throw new BatchEngineError(
        "BATCH_JOB_STATE_INVALID",
        "The durable batch item order or operation changed.",
        {
          details: {
            index,
            manifestItem: {
              id: manifestItem.id,
              operation: manifestItem.operation,
            },
            stateItem: {
              id: stateItem.id,
              operation: stateItem.operation,
            },
          },
        },
      );
    }
  }
}

function recoverInterruptedItems(state: BatchJobState): BatchJobState {
  let changed = false;
  const items = state.items.map((item) => {
    if (item.status !== "running") return item;
    changed = true;
    return Object.freeze({
      ...item,
      status: "pending" as const,
      startedAt: null,
      finishedAt: null,
      error: Object.freeze({
        code: "BATCH_OPERATION_FAILED",
        message: "The previous runner stopped while this item was active; the item is pending retry.",
        details: Object.freeze({ interrupted: true }),
      }),
    });
  });
  return changed
    ? nextState(state, {
        status: "pending",
        finishedAt: null,
      }, items)
    : state;
}

function resolvedKeys(values: readonly string[]): readonly string[] {
  return Object.freeze(values.map((value) => {
    const resolved = path.resolve(value);
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
  }));
}

function validateDescriptor(
  descriptor: BatchOperationDescriptor,
  item: BatchManifestItem,
): void {
  if (!SHA256.test(descriptor.revision)) {
    throw new BatchEngineError(
      "BATCH_OPERATION_FAILED",
      "A batch operation descriptor must use a lowercase SHA-256 revision.",
      { details: { itemId: item.id, revision: descriptor.revision } },
    );
  }
  if (
    descriptor.outputPaths.length < 1 ||
    descriptor.outputPaths.length > MAX_OUTPUTS_PER_ITEM
  ) {
    throw new BatchEngineError(
      "BATCH_OPERATION_FAILED",
      `A batch item must declare 1 to ${MAX_OUTPUTS_PER_ITEM} outputs.`,
      {
        details: {
          itemId: item.id,
          outputCount: descriptor.outputPaths.length,
        },
      },
    );
  }
  const inputKeys = resolvedKeys(descriptor.inputPaths);
  const outputKeys = resolvedKeys(descriptor.outputPaths);
  if (new Set(outputKeys).size !== outputKeys.length) {
    throw new BatchEngineError(
      "BATCH_OPERATION_FAILED",
      "A batch operation descriptor contains duplicate output paths.",
      { details: { itemId: item.id, outputPaths: descriptor.outputPaths } },
    );
  }
  if (outputKeys.some((key) => inputKeys.includes(key))) {
    throw new BatchEngineError(
      "BATCH_OPERATION_FAILED",
      "A batch operation cannot overwrite one of its declared inputs.",
      {
        details: {
          itemId: item.id,
          inputPaths: descriptor.inputPaths,
          outputPaths: descriptor.outputPaths,
        },
      },
    );
  }
}

function validateResult(
  result: BatchOperationResult,
  descriptor: BatchOperationDescriptor,
  item: BatchManifestItem,
): void {
  if (result.revision !== descriptor.revision) {
    throw new BatchEngineError(
      "BATCH_ITEM_REVISION_MISMATCH",
      "The batch operation result revision differs from its preflight descriptor.",
      {
        details: {
          itemId: item.id,
          descriptorRevision: descriptor.revision,
          resultRevision: result.revision,
        },
      },
    );
  }
  const declared = resolvedKeys(descriptor.outputPaths);
  const received = resolvedKeys(result.outputs.map((output) => output.path));
  if (
    received.length !== declared.length ||
    received.some((key, index) => key !== declared[index])
  ) {
    throw new BatchEngineError(
      "BATCH_OPERATION_FAILED",
      "The batch operation receipts do not match the declared output order.",
      {
        details: {
          itemId: item.id,
          declaredOutputPaths: descriptor.outputPaths,
          receivedOutputPaths: result.outputs.map((output) => output.path),
        },
      },
    );
  }
  for (const output of result.outputs) {
    if (
      !output.mimeType.trim() ||
      !Number.isSafeInteger(output.bytes) ||
      output.bytes < 0 ||
      !SHA256.test(output.sha256)
    ) {
      throw new BatchEngineError(
        "BATCH_OPERATION_FAILED",
        "A batch operation returned an invalid output receipt.",
        { details: { itemId: item.id, output } },
      );
    }
  }
}

async function persist(
  paths: BatchJobPaths,
  state: BatchJobState,
  event: Readonly<{
    type: string;
    itemId?: string;
    details?: Readonly<Record<string, unknown>>;
  }>,
): Promise<void> {
  await writeBatchState(paths.statePath, state);
  await appendBatchEvent(paths.eventsPath, {
    type: event.type,
    jobId: state.jobId,
    ...(event.itemId ? { itemId: event.itemId } : {}),
    ...(event.details ? { details: event.details } : {}),
  });
}

function operationContext(options: Readonly<{
  rootPath: string;
  paths: BatchJobPaths;
  manifest: BatchManifest;
  item: BatchManifestItem;
  attempt: number;
  signal?: AbortSignal;
}>): BatchOperationContext {
  return Object.freeze({
    rootPath: options.rootPath,
    jobDirectory: options.paths.jobDirectory,
    manifest: options.manifest,
    item: options.item,
    attempt: options.attempt,
    signal: options.signal,
  });
}

export async function runDurableBatch(
  options: RunDurableBatchOptions,
): Promise<DurableBatchResult> {
  const manifestFile = await readBatchManifest(options.manifestPath);
  const rootPath = await canonicalBatchRoot(
    options.rootPath ?? path.dirname(manifestFile.path),
  );
  const paths = batchJobPaths(
    rootPath,
    manifestFile.manifest.id,
    options.stateRootPath,
  );
  const lock = await acquireBatchLock(paths, options.staleLockMs);
  let state: BatchJobState;

  try {
    const retained = await readOrCreateBatchState({
      paths,
      manifest: manifestFile.manifest,
      manifestPath: manifestFile.path,
      manifestSha256: manifestFile.sha256,
      rootPath,
    });
    state = retained.state;
    validateRetainedState(state, manifestFile.manifest);

    const recovered = recoverInterruptedItems(state);
    if (recovered !== state) {
      state = recovered;
      await persist(paths, state, {
        type: "job-recovered",
        details: { interruptedItemsReset: true },
      });
    }

    if (retained.created) {
      await appendBatchEvent(paths.eventsPath, {
        type: "job-created",
        jobId: state.jobId,
        details: {
          manifestSha256: state.manifestSha256,
          itemCount: state.items.length,
        },
      });
    }

    throwIfCancelled(options.signal);
    state = nextState(state, {
      status: "running",
      startedAt: state.startedAt ?? isoNow(),
      finishedAt: null,
    });
    await persist(paths, state, { type: "job-started" });

    let failFastTriggered = false;
    for (const manifestItem of manifestFile.manifest.items) {
      if (failFastTriggered) break;
      throwIfCancelled(options.signal);

      const handler = options.handlers[manifestItem.operation];
      if (!handler) {
        const failure = new BatchEngineError(
          "BATCH_HANDLER_MISSING",
          "No batch operation handler is registered for this manifest item.",
          {
            details: {
              itemId: manifestItem.id,
              operation: manifestItem.operation,
            },
          },
        );
        const retainedItem = state.items.find((item) => item.id === manifestItem.id)!;
        const failedItem: BatchItemState = Object.freeze({
          ...retainedItem,
          status: "failed",
          finishedAt: isoNow(),
          error: serializedError(failure),
        });
        state = replaceItem(state, manifestItem.id, failedItem);
        await persist(paths, state, {
          type: "item-failed",
          itemId: manifestItem.id,
          details: { error: failedItem.error },
        });
        failFastTriggered = state.failureMode === "fail-fast";
        continue;
      }

      const retainedItem = state.items.find((item) => item.id === manifestItem.id)!;
      const attempt = retainedItem.attempts + 1;
      const context = operationContext({
        rootPath,
        paths,
        manifest: manifestFile.manifest,
        item: manifestItem,
        attempt,
        signal: options.signal,
      });

      try {
        const descriptor = await handler.describe(context);
        validateDescriptor(descriptor, manifestItem);

        if (retainedItem.status === "complete") {
          if (retainedItem.revision !== descriptor.revision) {
            throw new BatchEngineError(
              "BATCH_ITEM_REVISION_MISMATCH",
              "A completed batch item no longer matches its input revision.",
              {
                details: {
                  itemId: manifestItem.id,
                  retainedRevision: retainedItem.revision,
                  currentRevision: descriptor.revision,
                },
              },
            );
          }
          if (!(await verifyBatchOutputReceipts(retainedItem.outputs))) {
            throw new BatchEngineError(
              "BATCH_COMPLETED_OUTPUT_INVALID",
              "A completed batch item has a missing or modified output.",
              {
                details: {
                  itemId: manifestItem.id,
                  outputs: retainedItem.outputs,
                },
              },
            );
          }
          await appendBatchEvent(paths.eventsPath, {
            type: "item-reused",
            jobId: state.jobId,
            itemId: manifestItem.id,
            details: { revision: descriptor.revision },
          });
          continue;
        }

        const runningItem: BatchItemState = Object.freeze({
          ...retainedItem,
          status: "running",
          attempts: attempt,
          revision: descriptor.revision,
          startedAt: isoNow(),
          finishedAt: null,
          outputs: Object.freeze([]),
          evidence: null,
          error: null,
        });
        state = replaceItem(state, manifestItem.id, runningItem);
        await persist(paths, state, {
          type: "item-started",
          itemId: manifestItem.id,
          details: {
            attempt,
            revision: descriptor.revision,
            inputPaths: descriptor.inputPaths,
            outputPaths: descriptor.outputPaths,
          },
        });

        throwIfCancelled(options.signal);
        const result = await handler.execute(context, descriptor);
        validateResult(result, descriptor, manifestItem);
        if (!(await verifyBatchOutputReceipts(result.outputs))) {
          throw new BatchEngineError(
            "BATCH_COMPLETED_OUTPUT_INVALID",
            "A batch operation returned output receipts that could not be verified.",
            {
              details: {
                itemId: manifestItem.id,
                outputs: result.outputs,
              },
            },
          );
        }

        const completedItem: BatchItemState = Object.freeze({
          ...runningItem,
          status: "complete",
          finishedAt: isoNow(),
          outputs: Object.freeze([...result.outputs]),
          evidence: result.evidence
            ? Object.freeze({ ...result.evidence })
            : null,
          error: null,
        });
        state = replaceItem(state, manifestItem.id, completedItem);
        await persist(paths, state, {
          type: "item-completed",
          itemId: manifestItem.id,
          details: {
            attempt,
            revision: descriptor.revision,
            outputs: completedItem.outputs,
          },
        });
      } catch (error) {
        const failure = batchFailure(error);
        const currentItem = state.items.find((item) => item.id === manifestItem.id)!;
        const failedItem: BatchItemState = Object.freeze({
          ...currentItem,
          status: "failed",
          finishedAt: isoNow(),
          error: serializedError(failure),
        });
        state = replaceItem(state, manifestItem.id, failedItem);
        await persist(paths, state, {
          type: "item-failed",
          itemId: manifestItem.id,
          details: {
            attempt: failedItem.attempts,
            error: failedItem.error,
          },
        });
        if (failure.code === "BATCH_CANCELLED") {
          state = nextState(state, {
            status: "cancelled",
            finishedAt: isoNow(),
          });
          await persist(paths, state, { type: "job-cancelled" });
          throw failure;
        }
        failFastTriggered = state.failureMode === "fail-fast";
      }
    }

    const complete = state.items.every((item) => item.status === "complete");
    const failed = state.items.some((item) => item.status === "failed");
    state = nextState(state, {
      status: complete ? "complete" : failed ? "failed" : "pending",
      finishedAt: complete || failed ? isoNow() : null,
    });
    await persist(paths, state, {
      type: complete ? "job-completed" : failed ? "job-failed" : "job-paused",
      details: {
        completeItems: state.items.filter((item) => item.status === "complete").length,
        failedItems: state.items.filter((item) => item.status === "failed").length,
        pendingItems: state.items.filter((item) => item.status === "pending").length,
      },
    });

    return Object.freeze({ jobDirectory: paths.jobDirectory, state });
  } catch (error) {
    const failure = batchFailure(error);
    throw failure;
  } finally {
    await releaseBatchLock(lock);
  }
}
