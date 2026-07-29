#!/usr/bin/env node

import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  createVectorWorkerClient,
  VectorWorkerClientError,
} from "@evavo/worker-client";
import {
  FileVectorObjectStore,
  VECTOR_WORKER_SUPPORTED_OPERATIONS,
  createVectorWorkerExecutor,
} from "@evavo/worker-engine";
import type { VectorWorkerProtocolOperation } from "@evavo/worker-protocol";
import {
  HttpWorkerError,
  httpWorkerFailure,
} from "./errors.js";
import {
  DEFAULT_HTTP_WORKER_COMPLETION_ATTEMPTS,
  DEFAULT_HTTP_WORKER_COMPLETION_RETRY_MS,
  DEFAULT_HTTP_WORKER_HEARTBEAT_MS,
  DEFAULT_HTTP_WORKER_LEASE_MS,
  DEFAULT_HTTP_WORKER_POLL_MS,
  HTTP_WORKER_CONTRACT_VERSION,
  HttpVectorWorker,
  type HttpWorkResult,
} from "./runner.js";

export * from "./errors.js";
export * from "./runner.js";

const COMMANDS = Object.freeze(["capabilities", "run-once", "run"] as const);
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
        throw new HttpWorkerError(
          "HTTP_WORKER_CONFIG_INVALID",
          "CLI flags must be unique and include a non-empty value.",
          { details: { flag: value } },
        );
      }
      flags.set(name, flagValue);
      continue;
    }
    const name = value.slice(2);
    if (!name || flags.has(name)) {
      throw new HttpWorkerError(
        "HTTP_WORKER_CONFIG_INVALID",
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

function flag(parsed: ParsedArguments, name: string): string | undefined {
  const value = parsed.flags.get(name);
  if (value === true) {
    throw new HttpWorkerError(
      "HTTP_WORKER_CONFIG_INVALID",
      `--${name} requires a value.`,
      { details: { flag: name } },
    );
  }
  return value;
}

function booleanFlag(parsed: ParsedArguments, name: string): boolean {
  return parsed.flags.get(name) === true;
}

function integerFlag(parsed: ParsedArguments, name: string): number | undefined {
  const value = flag(parsed, name);
  if (value === undefined) return undefined;
  const parsedValue = Number(value);
  if (!Number.isSafeInteger(parsedValue)) {
    throw new HttpWorkerError(
      "HTTP_WORKER_CONFIG_INVALID",
      `--${name} must be a safe integer.`,
      { details: { flag: name, value } },
    );
  }
  return parsedValue;
}

function ensureNoPositionals(parsed: ParsedArguments): void {
  if (parsed.positionals.length > 0) {
    throw new HttpWorkerError(
      "HTTP_WORKER_CONFIG_INVALID",
      "The HTTP worker commands do not accept positional arguments.",
      { details: { positionals: parsed.positionals } },
    );
  }
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new HttpWorkerError(
      "HTTP_WORKER_CONFIG_INVALID",
      `${name} is required.`,
      { details: { environmentVariable: name } },
    );
  }
  return value;
}

function controlUrl(parsed: ParsedArguments): string {
  return flag(parsed, "url") ?? requiredEnvironment("VECTOR_WORKER_CONTROL_URL");
}

function controlToken(): string {
  return requiredEnvironment("VECTOR_WORKER_API_TOKEN");
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
  return `http:${host}:${process.pid}`;
}

function workerId(parsed: ParsedArguments): string {
  return flag(parsed, "worker-id") ??
    process.env.VECTOR_WORKER_ID?.trim() ??
    defaultWorkerId();
}

function operations(parsed: ParsedArguments): readonly VectorWorkerProtocolOperation[] | undefined {
  const value = flag(parsed, "operations");
  if (value === undefined) return undefined;
  const selected = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean) as VectorWorkerProtocolOperation[];
  if (selected.length < 1) {
    throw new HttpWorkerError(
      "HTTP_WORKER_CONFIG_INVALID",
      "--operations must contain at least one comma-separated operation.",
    );
  }
  return Object.freeze(selected);
}

function writeJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function writeNdjson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

async function runtime(parsed: ParsedArguments) {
  const objects = await FileVectorObjectStore.open(objectStorePath(parsed));
  const client = createVectorWorkerClient({
    baseUrl: controlUrl(parsed),
    token: controlToken(),
    timeoutMs: integerFlag(parsed, "control-timeout-ms") ?? 10_000,
    maximumResponseBytes:
      integerFlag(parsed, "maximum-response-bytes") ?? 512 * 1024,
    allowInsecureHttp: booleanFlag(parsed, "allow-insecure-http"),
  });
  const executor = createVectorWorkerExecutor(objects);
  const worker = new HttpVectorWorker(client, executor, {
    workerId: workerId(parsed),
    leaseMs: integerFlag(parsed, "lease-ms") ?? DEFAULT_HTTP_WORKER_LEASE_MS,
    heartbeatMs:
      integerFlag(parsed, "heartbeat-ms") ??
      DEFAULT_HTTP_WORKER_HEARTBEAT_MS,
    pollMs: integerFlag(parsed, "poll-ms") ?? DEFAULT_HTTP_WORKER_POLL_MS,
    operations: operations(parsed),
    completionAttempts:
      integerFlag(parsed, "completion-attempts") ??
      DEFAULT_HTTP_WORKER_COMPLETION_ATTEMPTS,
    completionRetryMs:
      integerFlag(parsed, "completion-retry-ms") ??
      DEFAULT_HTTP_WORKER_COMPLETION_RETRY_MS,
  });
  return Object.freeze({ objects, client, executor, worker });
}

function publicResult(work: HttpWorkResult) {
  return Object.freeze({
    ...work,
    leaseTokenPresent: work.record?.lease?.tokenPresent ?? false,
    generatedBodiesInConsole: false,
  });
}

async function commandCapabilities(parsed: ParsedArguments): Promise<void> {
  ensureNoPositionals(parsed);
  const opened = await runtime(parsed);
  const server = await opened.client.capabilities();
  writeJson({
    command: "capabilities",
    httpWorkerContractVersion: HTTP_WORKER_CONTRACT_VERSION,
    commands: COMMANDS,
    objectStore: opened.objects.rootPath,
    worker: opened.worker.capabilities,
    server,
    security: {
      workerTokenSource: "VECTOR_WORKER_API_TOKEN",
      tokenPresent: true,
      tokenReturned: false,
      generatedBodiesInConsole: false,
      existingObjectsOverwritten: false,
    },
  });
}

async function commandRunOnce(parsed: ParsedArguments): Promise<void> {
  ensureNoPositionals(parsed);
  const opened = await runtime(parsed);
  const work = await opened.worker.runOne();
  writeJson({ command: "run-once", result: publicResult(work) });
  if (work.outcome === "control-uncertain") process.exitCode = 75;
  else if (work.outcome === "failed") process.exitCode = 2;
}

async function commandRun(parsed: ParsedArguments): Promise<void> {
  ensureNoPositionals(parsed);
  const opened = await runtime(parsed);
  const abort = new AbortController();
  const stop = () => abort.abort(new Error("http-worker-stop"));
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    writeNdjson({
      type: "http-worker-started",
      contractVersion: HTTP_WORKER_CONTRACT_VERSION,
      worker: opened.worker.capabilities,
      objectStore: opened.objects.rootPath,
      controlBaseUrl: opened.client.baseUrl,
      tokenPresent: true,
      tokenReturned: false,
      generatedBodiesInConsole: false,
    });
    const summary = await opened.worker.run({
      signal: abort.signal,
      maxJobs: integerFlag(parsed, "max-jobs"),
      idleExitMs: integerFlag(parsed, "idle-exit-ms"),
      onResult(work) {
        writeNdjson({ type: "http-worker-result", result: publicResult(work) });
      },
    });
    writeNdjson({ type: "http-worker-summary", summary });
    if (summary.controlUncertain > 0) process.exitCode = 75;
    else if (summary.failed > 0) process.exitCode = 2;
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
  }
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const parsed = parseArguments(argv);
  if (!parsed.command || !COMMANDS.includes(parsed.command as Command)) {
    throw new HttpWorkerError(
      "HTTP_WORKER_CONFIG_INVALID",
      `Expected one command: ${COMMANDS.join(", ")}.`,
      { details: { command: parsed.command } },
    );
  }
  if (parsed.command === "capabilities") return commandCapabilities(parsed);
  if (parsed.command === "run-once") return commandRunOnce(parsed);
  return commandRun(parsed);
}

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : null;
if (invokedPath === import.meta.url) {
  main().catch((error: unknown) => {
    const failure = httpWorkerFailure(error);
    process.stderr.write(`${JSON.stringify({
      ok: false,
      error: failure,
      tokenReturned: false,
      generatedBodiesInConsole: false,
    })}\n`);
    process.exitCode = failure.retryable ? 75 : 2;
  });
}
