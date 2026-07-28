#!/usr/bin/env node
import path from "node:path";
import {
  BATCH_CONTRACT_VERSION,
  BatchEngineError,
  inspectDurableBatch,
  readBatchManifest,
  runDurableBatch,
} from "@evavo/job-engine";
import {
  VECTOR_BATCH_OPERATION_NAMES,
  createVectorBatchOperationRegistry,
} from "./batch-operations.js";

const VERSION = "0.4.0";

function print(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function fail(value: unknown, code = 1): never {
  process.stderr.write(
    `${typeof value === "string" ? value : JSON.stringify(value, null, 2)}\n`,
  );
  process.exit(code);
}

function usage(): string {
  return [
    "EVAVO Vector Studio durable batch CLI",
    "",
    "Usage:",
    "  evavo-vector-batch run <manifest.json> [--root path] [--state-root path]",
    "  evavo-vector-batch inspect <manifest.json> [--root path] [--state-root path] [--event-limit 0..1000]",
    "  evavo-vector-batch capabilities",
    "  evavo-vector-batch --version",
    "",
    "The same manifest job ID resumes its retained state. Completed items are reused only when input revision and output receipts still verify.",
  ].join("\n");
}

function option(args: readonly string[], name: string): string | null {
  const index = args.indexOf(name);
  if (index < 0) return null;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    fail({ error: "VECTOR_BATCH_OPTION_VALUE_REQUIRED", option: name }, 2);
  }
  return value;
}

function integerOption(
  args: readonly string[],
  name: string,
  minimum: number,
  maximum: number,
): number | undefined {
  const raw = option(args, name);
  if (raw === null) return undefined;
  const value = Number(raw);
  if (
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    fail({
      error: "VECTOR_BATCH_OPTION_INVALID",
      option: name,
      value: raw,
      range: [minimum, maximum],
    }, 2);
  }
  return value;
}

function capabilities() {
  return Object.freeze({
    name: "evavo-vector-batch",
    version: VERSION,
    batchContractVersion: BATCH_CONTRACT_VERSION,
    commands: Object.freeze(["run", "inspect", "capabilities"]),
    operations: VECTOR_BATCH_OPERATION_NAMES,
    durability: Object.freeze({
      persistentState: true,
      appendOnlyEvents: true,
      resumableItems: true,
      manifestImmutableAfterCreation: true,
      exclusiveRunnerLock: true,
      staleLockRecovery: true,
      completedOutputReverification: true,
      inputRevisionReverification: true,
      failureModes: Object.freeze(["continue", "fail-fast"]),
    }),
    outputs: Object.freeze({
      perItemAtomicCommit: true,
      existingFilesOverwritten: false,
      receipts: Object.freeze(["path", "mimeType", "bytes", "sha256"]),
      evidenceFilesRequired: true,
    }),
    approval: "human-review-required",
  });
}

function addSignalHandlers(controller: AbortController): () => void {
  const abort = () => controller.abort();
  process.once("SIGINT", abort);
  process.once("SIGTERM", abort);
  return () => {
    process.removeListener("SIGINT", abort);
    process.removeListener("SIGTERM", abort);
  };
}

async function runManifest(
  manifestArgument: string,
  args: readonly string[],
): Promise<void> {
  const manifestPath = path.resolve(manifestArgument);
  const rootPath = path.resolve(
    option(args, "--root") ?? path.dirname(manifestPath),
  );
  const stateRoot = option(args, "--state-root");
  const stateRootPath = stateRoot ? path.resolve(stateRoot) : undefined;
  const controller = new AbortController();
  const cleanup = addSignalHandlers(controller);
  try {
    const result = await runDurableBatch({
      manifestPath,
      rootPath,
      stateRootPath,
      handlers: createVectorBatchOperationRegistry(),
      signal: controller.signal,
    });
    print({
      command: "run",
      manifestPath,
      rootPath,
      jobDirectory: result.jobDirectory,
      state: result.state,
    });
    if (result.state.status !== "complete") process.exitCode = 2;
  } finally {
    cleanup();
  }
}

async function inspectManifest(
  manifestArgument: string,
  args: readonly string[],
): Promise<void> {
  const manifestPath = path.resolve(manifestArgument);
  const manifestFile = await readBatchManifest(manifestPath);
  const rootPath = path.resolve(
    option(args, "--root") ?? path.dirname(manifestPath),
  );
  const stateRoot = option(args, "--state-root");
  const stateRootPath = stateRoot ? path.resolve(stateRoot) : undefined;
  const inspection = await inspectDurableBatch({
    jobId: manifestFile.manifest.id,
    rootPath,
    stateRootPath,
    eventLimit: integerOption(args, "--event-limit", 0, 1_000),
  });
  print({
    command: "inspect",
    manifestPath,
    manifestSha256: manifestFile.sha256,
    ...inspection,
  });
  if (inspection.state.status === "failed") process.exitCode = 2;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];
  if (!command || command === "help" || command === "--help") {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  if (command === "version" || command === "--version") {
    process.stdout.write(`${VERSION}\n`);
    return;
  }
  if (command === "capabilities" || command === "manifest") {
    print(capabilities());
    return;
  }
  const manifestPath = args[1];
  if (!manifestPath) fail(`Missing manifest path.\n\n${usage()}`, 2);
  const commandArgs = args.slice(2);
  if (command === "run" || command === "resume") {
    return runManifest(manifestPath, commandArgs);
  }
  if (command === "inspect" || command === "status") {
    return inspectManifest(manifestPath, commandArgs);
  }
  fail(`Unknown command: ${command}\n\n${usage()}`, 2);
}

main().catch((error: unknown) => {
  if (error instanceof BatchEngineError) {
    fail({
      error: error.code,
      message: error.message,
      retryable: error.retryable,
      details: error.details,
    }, 2);
  }
  fail({
    error: "VECTOR_BATCH_FAILED",
    message: error instanceof Error ? error.message : String(error),
  });
});
