#!/usr/bin/env node

import { readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  FileHostedJobStore,
  HostedJobController,
  HostedJobError,
  HOSTED_JOB_MAX_PAYLOAD_BYTES,
  type HostedJobCreateRequest,
  type HostedJobOperation,
} from "@evavo/job-control";
import {
  FileVectorObjectStore,
  VECTOR_WORKER_MAX_SOURCE_BYTES,
  VECTOR_WORKER_SUPPORTED_OPERATIONS,
  VectorWorkerError,
  createVectorWorkerExecutor,
  vectorWorkerFailure,
} from "@evavo/worker-engine";
import {
  DEFAULT_LOCAL_WORKER_HEARTBEAT_MS,
  DEFAULT_LOCAL_WORKER_LEASE_MS,
  DEFAULT_LOCAL_WORKER_POLL_MS,
  LOCAL_WORKER_CONTRACT_VERSION,
  LocalVectorWorker,
  type LocalWorkResult,
} from "./runner.js";

export * from "./runner.js";

const COMMANDS = Object.freeze([
  "capabilities",
  "import",
  "submit",
  "inspect",
  "list",
  "cancel",
  "reclaim",
  "run-once",
  "run",
] as const);

type Command = typeof COMMANDS[number];

type ParsedArguments = Readonly<{
  command: string | null;
  positionals: readonly string[];
  flags: ReadonlyMap<string, string | true>;
}>;

function parseArguments(argv: readonly string[]): ParsedArguments {
  const command = argv[0] ?? null;
  const positionals: string[] = [];
  const flags = new Map<string, string | true>();
  for (let index = 1; index < argv.length; index += 1) {
    const value = argv[index]!;
    if (!value.startsWith("--")) {
      positionals.push(value);
      continue;
    }
    const equals = value.indexOf("=");
    if (equals > 2) {
      const name = value.slice(2, equals);
      const flagValue = value.slice(equals + 1);
      if (!name || !flagValue || flags.has(name)) {
        throw new VectorWorkerError(
          "LOCAL_WORKER_ARGUMENT_INVALID",
          "CLI flags must be unique and include a non-empty value.",
          { details: { flag: value } },
        );
      }
      flags.set(name, flagValue);
      continue;
    }
    const name = value.slice(2);
    if (!name || flags.has(name)) {
      throw new VectorWorkerError(
        "LOCAL_WORKER_ARGUMENT_INVALID",
        "CLI flags must be unique and use a non-empty name.",
        { details: { flag: value } },
      );
    }
    const next = argv[index + 1];
    if (next !== undefined && !next.startsWith("--")) {
      flags.set(name, next);
      index += 1;
    } else {
      flags.set(name, true);
    }
  }
  return Object.freeze({
    command,
    positionals: Object.freeze(positionals),
    flags,
  });
}

function flag(
  parsed: ParsedArguments,
  name: string,
): string | undefined {
  const value = parsed.flags.get(name);
  if (value === true) {
    throw new VectorWorkerError(
      "LOCAL_WORKER_ARGUMENT_INVALID",
      `--${name} requires a value.`,
      { details: { flag: name } },
    );
  }
  return value;
}

function integerFlag(
  parsed: ParsedArguments,
  name: string,
): number | undefined {
  const value = flag(parsed, name);
  if (value === undefined) return undefined;
  const parsedValue = Number(value);
  if (!Number.isSafeInteger(parsedValue)) {
    throw new VectorWorkerError(
      "LOCAL_WORKER_ARGUMENT_INVALID",
      `--${name} must be a safe integer.`,
      { details: { flag: name, value } },
    );
  }
  return parsedValue;
}

function requirePosition(
  parsed: ParsedArguments,
  index: number,
  label: string,
): string {
  const value = parsed.positionals[index]?.trim();
  if (!value) {
    throw new VectorWorkerError(
      "LOCAL_WORKER_ARGUMENT_INVALID",
      `${label} is required.`,
      { details: { label } },
    );
  }
  return value;
}

function ensureNoExtraPositionals(
  parsed: ParsedArguments,
  expected: number,
): void {
  if (parsed.positionals.length !== expected) {
    throw new VectorWorkerError(
      "LOCAL_WORKER_ARGUMENT_INVALID",
      `Expected ${expected} positional argument${expected === 1 ? "" : "s"}.`,
      {
        details: {
          expected,
          received: parsed.positionals.length,
          positionals: parsed.positionals,
        },
      },
    );
  }
}

function jobStorePath(parsed: ParsedArguments): string {
  return path.resolve(
    flag(parsed, "job-store") ??
      process.env.VECTOR_JOB_STORE_PATH?.trim() ??
      ".evavo-vector-hosted-jobs",
  );
}

function objectStorePath(parsed: ParsedArguments): string {
  return path.resolve(
    flag(parsed, "object-store") ??
      process.env.VECTOR_OBJECT_STORE_PATH?.trim() ??
      ".evavo-vector-objects",
  );
}

function defaultWorkerId(): string {
  const host = os.hostname().replace(/[^A-Za-z0-9._:-]+/g, "-").slice(0, 80) || "host";
  return `local:${host}:${process.pid}`;
}

function workerId(parsed: ParsedArguments): string {
  return (
    flag(parsed, "worker-id") ??
    process.env.VECTOR_WORKER_ID?.trim() ??
    defaultWorkerId()
  );
}

function operationSelection(
  parsed: ParsedArguments,
): readonly HostedJobOperation[] | undefined {
  const value = flag(parsed, "operations");
  if (value === undefined) return undefined;
  const operations = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean) as HostedJobOperation[];
  if (operations.length < 1) {
    throw new VectorWorkerError(
      "LOCAL_WORKER_ARGUMENT_INVALID",
      "--operations must contain at least one comma-separated operation.",
    );
  }
  return Object.freeze(operations);
}

function mimeTypeFor(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".svg") return "image/svg+xml";
  if (extension === ".png") return "image/png";
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".webp") return "image/webp";
  if (extension === ".gif") return "image/gif";
  if (extension === ".json") return "application/json";
  if (extension === ".lottie") return "application/zip+dotlottie";
  return "application/octet-stream";
}

function writeJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function writeNdjson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

async function readJsonDocument(
  filePath: string,
  maximumBytes = HOSTED_JOB_MAX_PAYLOAD_BYTES,
): Promise<unknown> {
  const absolute = path.resolve(filePath);
  const information = await stat(absolute);
  if (!information.isFile()) {
    throw new VectorWorkerError(
      "LOCAL_WORKER_ARGUMENT_INVALID",
      "The JSON input path must be a regular file.",
      { details: { filePath: absolute } },
    );
  }
  if (information.size > maximumBytes) {
    throw new VectorWorkerError(
      "LOCAL_WORKER_ARGUMENT_INVALID",
      "The JSON input exceeds the configured byte limit.",
      { details: { filePath: absolute, bytes: information.size, maximumBytes } },
    );
  }
  try {
    return JSON.parse(await readFile(absolute, "utf8")) as unknown;
  } catch (error) {
    throw new VectorWorkerError(
      "LOCAL_WORKER_ARGUMENT_INVALID",
      "The JSON input could not be parsed.",
      {
        details: {
          filePath: absolute,
          cause: error instanceof Error ? error.message : String(error),
        },
        cause: error,
      },
    );
  }
}

async function openJobRuntime(parsed: ParsedArguments) {
  const store = await FileHostedJobStore.open(jobStorePath(parsed));
  const controller = new HostedJobController(store);
  return Object.freeze({ store, controller });
}

async function openWorkerRuntime(parsed: ParsedArguments) {
  const jobs = await openJobRuntime(parsed);
  const objects = await FileVectorObjectStore.open(objectStorePath(parsed));
  const executor = createVectorWorkerExecutor(objects);
  const worker = new LocalVectorWorker(jobs.controller, executor, {
    workerId: workerId(parsed),
    leaseMs: integerFlag(parsed, "lease-ms") ?? DEFAULT_LOCAL_WORKER_LEASE_MS,
    heartbeatMs:
      integerFlag(parsed, "heartbeat-ms") ??
      DEFAULT_LOCAL_WORKER_HEARTBEAT_MS,
    pollMs: integerFlag(parsed, "poll-ms") ?? DEFAULT_LOCAL_WORKER_POLL_MS,
    operations: operationSelection(parsed),
  });
  return Object.freeze({ ...jobs, objects, executor, worker });
}

function publicRecord(record: Awaited<ReturnType<HostedJobController["get"]>>) {
  return Object.freeze({
    ...record,
    lease: record.lease
      ? Object.freeze({
          workerId: record.lease.workerId,
          acquiredAt: record.lease.acquiredAt,
          heartbeatAt: record.lease.heartbeatAt,
          expiresAt: record.lease.expiresAt,
          tokenPresent: true,
        })
      : null,
  });
}

async function commandCapabilities(parsed: ParsedArguments): Promise<void> {
  ensureNoExtraPositionals(parsed, 0);
  const runtime = await openWorkerRuntime(parsed);
  writeJson({
    command: "capabilities",
    localWorkerContractVersion: LOCAL_WORKER_CONTRACT_VERSION,
    commands: COMMANDS,
    paths: {
      jobStore: runtime.store.rootPath,
      objectStore: runtime.objects.rootPath,
    },
    worker: runtime.worker.capabilities,
    output: {
      commandResponses: "JSON",
      pollingResults: "NDJSON",
      generatedBodiesInConsole: false,
      existingObjectsOverwritten: false,
    },
  });
}

async function commandImport(parsed: ParsedArguments): Promise<void> {
  ensureNoExtraPositionals(parsed, 1);
  const sourcePath = path.resolve(requirePosition(parsed, 0, "source file"));
  const objectKey = flag(parsed, "key");
  if (!objectKey) {
    throw new VectorWorkerError(
      "LOCAL_WORKER_ARGUMENT_INVALID",
      "--key is required for immutable object import.",
    );
  }
  const information = await stat(sourcePath);
  if (!information.isFile()) {
    throw new VectorWorkerError(
      "LOCAL_WORKER_ARGUMENT_INVALID",
      "The import source must be a regular file.",
      { details: { sourcePath } },
    );
  }
  if (information.size > VECTOR_WORKER_MAX_SOURCE_BYTES) {
    throw new VectorWorkerError(
      "VECTOR_WORKER_OBJECT_TOO_LARGE",
      "The import source exceeds the worker source limit.",
      {
        details: {
          sourcePath,
          bytes: information.size,
          maximumBytes: VECTOR_WORKER_MAX_SOURCE_BYTES,
        },
      },
    );
  }
  const objects = await FileVectorObjectStore.open(objectStorePath(parsed));
  const receipts = await objects.putManyNew([
    Object.freeze({
      objectKey,
      mimeType: flag(parsed, "mime") ?? mimeTypeFor(sourcePath),
      bytes: new Uint8Array(await readFile(sourcePath)),
    }),
  ]);
  writeJson({
    command: "import",
    sourcePath,
    objectStore: objects.rootPath,
    receipt: receipts[0],
  });
}

async function commandSubmit(parsed: ParsedArguments): Promise<void> {
  ensureNoExtraPositionals(parsed, 1);
  const requestPath = requirePosition(parsed, 0, "hosted job request JSON");
  const request = (await readJsonDocument(requestPath)) as HostedJobCreateRequest;
  const runtime = await openJobRuntime(parsed);
  const created = await runtime.controller.create(request);
  writeJson({
    command: "submit",
    reused: created.reused,
    executionScheduled: false,
    remoteExecutionAvailable: false,
    record: publicRecord(created.record),
  });
}

async function commandInspect(parsed: ParsedArguments): Promise<void> {
  ensureNoExtraPositionals(parsed, 1);
  const jobId = requirePosition(parsed, 0, "job ID");
  const runtime = await openJobRuntime(parsed);
  writeJson({
    command: "inspect",
    record: publicRecord(await runtime.controller.get(jobId)),
  });
}

async function commandList(parsed: ParsedArguments): Promise<void> {
  ensureNoExtraPositionals(parsed, 0);
  const runtime = await openJobRuntime(parsed);
  const status = flag(parsed, "status");
  const limit = integerFlag(parsed, "limit") ?? 100;
  if (limit < 1 || limit > 1_000) {
    throw new VectorWorkerError(
      "LOCAL_WORKER_ARGUMENT_INVALID",
      "--limit must be an integer from 1 to 1000.",
      { details: { limit } },
    );
  }
  const records = (await runtime.store.list())
    .filter((record) => status === undefined || record.status === status)
    .sort((left, right) =>
      right.createdAt.localeCompare(left.createdAt) ||
      left.id.localeCompare(right.id)
    )
    .slice(0, limit)
    .map(publicRecord);
  writeJson({
    command: "list",
    filter: { status: status ?? null, limit },
    count: records.length,
    records,
  });
}

async function commandCancel(parsed: ParsedArguments): Promise<void> {
  ensureNoExtraPositionals(parsed, 1);
  const jobId = requirePosition(parsed, 0, "job ID");
  const runtime = await openJobRuntime(parsed);
  const record = await runtime.controller.requestCancellation(jobId, {
    requestedBy: flag(parsed, "requested-by"),
    reason: flag(parsed, "reason"),
  });
  writeJson({
    command: "cancel",
    record: publicRecord(record),
  });
}

async function commandReclaim(parsed: ParsedArguments): Promise<void> {
  ensureNoExtraPositionals(parsed, 0);
  const runtime = await openJobRuntime(parsed);
  const reclaimed = await runtime.controller.reclaimExpiredLeases();
  writeJson({ command: "reclaim", reclaimed });
}

function processSignals(): Readonly<{
  signal: AbortSignal;
  dispose: () => void;
}> {
  const controller = new AbortController();
  const stop = (name: string) => {
    if (!controller.signal.aborted) controller.abort(new Error(name));
  };
  const onInterrupt = () => stop("SIGINT");
  const onTerminate = () => stop("SIGTERM");
  process.once("SIGINT", onInterrupt);
  process.once("SIGTERM", onTerminate);
  return Object.freeze({
    signal: controller.signal,
    dispose: () => {
      process.removeListener("SIGINT", onInterrupt);
      process.removeListener("SIGTERM", onTerminate);
    },
  });
}

async function commandRunOnce(parsed: ParsedArguments): Promise<void> {
  ensureNoExtraPositionals(parsed, 0);
  const runtime = await openWorkerRuntime(parsed);
  const signals = processSignals();
  try {
    const result = await runtime.worker.runOne(signals.signal);
    writeJson({ command: "run-once", result });
    if (result.outcome === "failed") process.exitCode = 2;
  } finally {
    signals.dispose();
  }
}

async function commandRun(parsed: ParsedArguments): Promise<void> {
  ensureNoExtraPositionals(parsed, 0);
  const runtime = await openWorkerRuntime(parsed);
  const signals = processSignals();
  try {
    writeNdjson({
      type: "worker-started",
      worker: runtime.worker.capabilities,
      paths: {
        jobStore: runtime.store.rootPath,
        objectStore: runtime.objects.rootPath,
      },
    });
    const summary = await runtime.worker.run({
      signal: signals.signal,
      maxJobs: integerFlag(parsed, "max-jobs"),
      idleExitMs: integerFlag(parsed, "idle-exit-ms"),
      onResult: (result: LocalWorkResult) => {
        writeNdjson({ type: "worker-result", result });
      },
    });
    writeNdjson({ type: "worker-summary", summary });
  } finally {
    signals.dispose();
  }
}

function help(): Readonly<Record<string, unknown>> {
  return Object.freeze({
    name: "evavo-vector-worker",
    contractVersion: LOCAL_WORKER_CONTRACT_VERSION,
    usage: [
      "evavo-vector-worker capabilities [--job-store PATH] [--object-store PATH]",
      "evavo-vector-worker import FILE --key OBJECT_KEY [--mime MIME]",
      "evavo-vector-worker submit REQUEST.json",
      "evavo-vector-worker inspect JOB_ID",
      "evavo-vector-worker list [--status STATUS] [--limit N]",
      "evavo-vector-worker cancel JOB_ID [--requested-by NAME] [--reason TEXT]",
      "evavo-vector-worker reclaim",
      "evavo-vector-worker run-once [worker options]",
      "evavo-vector-worker run [--max-jobs N] [--idle-exit-ms MS] [worker options]",
    ],
    commonFlags: [
      "--job-store PATH",
      "--object-store PATH",
      "--worker-id ID",
      "--lease-ms MS",
      "--heartbeat-ms MS",
      "--poll-ms MS",
      "--operations trace-raster,optimise-svg,animate-svg,export-lottie,package-dotlottie",
    ],
    environment: [
      "VECTOR_JOB_STORE_PATH",
      "VECTOR_OBJECT_STORE_PATH",
      "VECTOR_WORKER_ID",
    ],
    output: "JSON for commands; NDJSON for run",
  });
}

export async function runLocalWorkerCli(
  argv: readonly string[] = process.argv.slice(2),
): Promise<void> {
  const parsed = parseArguments(argv);
  if (parsed.command === null || parsed.command === "help" || parsed.command === "--help") {
    writeJson(help());
    return;
  }
  if (!COMMANDS.includes(parsed.command as Command)) {
    throw new VectorWorkerError(
      "LOCAL_WORKER_ARGUMENT_INVALID",
      "Unknown local worker command.",
      { details: { command: parsed.command, commands: COMMANDS } },
    );
  }
  switch (parsed.command as Command) {
    case "capabilities":
      return commandCapabilities(parsed);
    case "import":
      return commandImport(parsed);
    case "submit":
      return commandSubmit(parsed);
    case "inspect":
      return commandInspect(parsed);
    case "list":
      return commandList(parsed);
    case "cancel":
      return commandCancel(parsed);
    case "reclaim":
      return commandReclaim(parsed);
    case "run-once":
      return commandRunOnce(parsed);
    case "run":
      return commandRun(parsed);
  }
}

function cliFailure(error: unknown) {
  if (error instanceof HostedJobError) {
    return Object.freeze({
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      details: error.details ?? null,
    });
  }
  const failure = vectorWorkerFailure(error);
  return Object.freeze({
    code: failure.code,
    message: failure.message,
    retryable: failure.retryable,
    details: failure.details ?? null,
  });
}

const entryPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : null;
if (entryPath === import.meta.url) {
  runLocalWorkerCli().catch((error) => {
    const failure = cliFailure(error);
    writeJson({ ok: false, error: failure });
    process.exitCode = failure.retryable ? 75 : 2;
  });
}
