import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const errors = [];
const checkedFiles = new Set();

async function read(relativePath) {
  checkedFiles.add(relativePath);
  try {
    return (await fs.readFile(path.join(root, relativePath), "utf8")).replace(/^\uFEFF/, "");
  } catch (error) {
    errors.push(`Missing or unreadable file: ${relativePath} (${error instanceof Error ? error.message : String(error)})`);
    return "";
  }
}

async function readJson(relativePath) {
  const source = await read(relativePath);
  if (!source) return null;
  try {
    return JSON.parse(source);
  } catch (error) {
    errors.push(`Invalid JSON: ${relativePath} (${error instanceof Error ? error.message : String(error)})`);
    return null;
  }
}

function requireTokens(relativePath, source, tokens) {
  for (const token of tokens) {
    if (!source.includes(token)) errors.push(`${relativePath} is missing HTTP-worker token: ${token}`);
  }
}

function forbidTokens(relativePath, source, tokens) {
  for (const token of tokens) {
    if (source.includes(token)) errors.push(`${relativePath} contains prohibited HTTP-worker token: ${token}`);
  }
}

const files = {
  rootPackage: "package.json",
  package: "workers/http-worker/package.json",
  tsconfig: "workers/http-worker/tsconfig.json",
  errors: "workers/http-worker/src/errors.ts",
  runner: "workers/http-worker/src/runner.ts",
  objectStore: "workers/http-worker/src/http-object-store.ts",
  cli: "workers/http-worker/src/index.ts",
  runnerTests: "workers/http-worker/src/runner.test.ts",
  runnerCapabilityTests: "workers/http-worker/src/runner-capabilities.test.ts",
  objectStoreTests: "workers/http-worker/src/http-object-store.test.ts",
  cliTests: "workers/http-worker/src/index.test.ts",
  cliHttpTests: "workers/http-worker/src/index-http-mode.test.ts",
  remoteExecutionTests: "workers/http-worker/src/remote-execution.test.ts",
  completionReplay: "packages/job-control/src/completion-replay.ts",
  controllerErrors: "packages/job-control/src/errors.ts",
  completionTests: "packages/job-control/src/completion-replay.test.ts",
  completeRoute: "apps/web/app/api/v1/worker/jobs/[jobId]/complete/route.ts",
  workerClient: "packages/worker-client/src/object-client.ts",
  docs: "docs/HTTP-WORKER.md",
  objectDocs: "docs/OBJECT-TRANSFER.md",
  clientDocs: "docs/WORKER-CLIENT.md",
  environment: ".env.example",
  workflow: ".github/workflows/http-worker-contract.yml",
};
const sources = Object.fromEntries(
  await Promise.all(Object.entries(files).map(async ([key, relativePath]) => [key, await read(relativePath)])),
);
const rootPackage = await readJson(files.rootPackage);
const workerPackage = await readJson(files.package);

if (workerPackage?.version !== rootPackage?.version) {
  errors.push(`HTTP worker version ${String(workerPackage?.version)} does not match root ${String(rootPackage?.version)}.`);
}
if (workerPackage?.bin?.["evavo-vector-http-worker"] !== "./dist/index.js") {
  errors.push("workers/http-worker must expose evavo-vector-http-worker.");
}
if (workerPackage?.scripts?.test !== "node --test dist/*.test.js") {
  errors.push("workers/http-worker must compile and execute generated tests.");
}
for (const dependency of [
  "@evavo/job-control",
  "@evavo/worker-client",
  "@evavo/worker-engine",
  "@evavo/worker-protocol",
]) {
  if (workerPackage?.dependencies?.[dependency] !== "workspace:*") {
    errors.push(`workers/http-worker must consume ${dependency} through the workspace.`);
  }
}
for (const [script, expected] of Object.entries({
  "http-worker:check": "node scripts/check-http-worker-contract.mjs",
  "http-worker:build": "turbo run build --filter=@evavo/http-worker",
  "http-worker:capabilities": "pnpm http-worker:build && node workers/http-worker/dist/index.js capabilities",
  "http-worker:run-once": "pnpm http-worker:build && node workers/http-worker/dist/index.js run-once",
  "http-worker:run": "pnpm http-worker:build && node workers/http-worker/dist/index.js run",
})) {
  if (rootPackage?.scripts?.[script] !== expected) {
    errors.push(`package.json script ${script} must equal: ${expected}`);
  }
}
if (!String(rootPackage?.scripts?.["build:packages"] ?? "").includes("--filter=@evavo/http-worker")) {
  errors.push("package.json build:packages must include @evavo/http-worker.");
}
if (!String(rootPackage?.scripts?.check ?? "").includes("pnpm http-worker:check")) {
  errors.push("package.json check must include http-worker:check before dependency-backed checks.");
}

requireTokens(files.tsconfig, sources.tsconfig, [
  '"extends": "../../tsconfig.json"',
  '"rootDir": "src"',
  '"outDir": "dist"',
  '"noEmit": false',
]);
requireTokens(files.errors, sources.errors, [
  '"HTTP_WORKER_COMPLETION_UNCERTAIN"',
  '"HTTP_WORKER_CONTROL_UNCERTAIN"',
  '"HTTP_WORKER_OBJECT_TRANSFER_UNAVAILABLE"',
  "VectorWorkerClientError",
  "VectorWorkerError",
  "httpWorkerFailure",
]);
requireTokens(files.runner, sources.runner, [
  'HTTP_WORKER_CONTRACT_VERSION = "1.0"',
  'HttpWorkerObjectTransport = "shared-file" | "worker-api"',
  "class HttpVectorWorker",
  "acquireLease({",
  "this.#client.start(",
  "client.heartbeat(",
  "client.complete(",
  "client.acknowledgeCancellation(",
  "this.#client.fail(",
  "completeWithReplay",
  "safeToReplayCompletion",
  '"VECTOR_WORKER_CLIENT_TIMEOUT"',
  '"VECTOR_WORKER_CLIENT_NETWORK_FAILED"',
  '"VECTOR_WORKER_CLIENT_RESPONSE_INVALID"',
  '"HTTP_WORKER_COMPLETION_UNCERTAIN"',
  '"control-uncertain"',
  "objectTransport: HttpWorkerObjectTransport",
  'execution: this.#config.objectTransport === "worker-api"',
  "receiptBackedCompletionReplay: true",
  'this.#config.objectTransport === "shared-file"',
  'this.#config.objectTransport === "worker-api"',
  "queueDeliveryAvailable: false",
  "managedRemoteExecutionAvailable: false",
  "generatedBodiesInControlResponses: false",
  'approval: "human-review-required"',
]);
forbidTokens(files.runner, sources.runner, [
  '"VECTOR_WORKER_CLIENT_HTTP_FAILED",',
  "queueDeliveryAvailable: true",
  "managedRemoteExecutionAvailable: true",
  'approval: "approved"',
]);

requireTokens(files.objectStore, sources.objectStore, [
  'HTTP_OBJECT_STORE_CONTRACT_VERSION = "1.0"',
  "class HttpVectorObjectStore",
  "type VectorWorkerObjectClient",
  "copyWrites",
  "withRetries",
  "safeToRetry",
  '"VECTOR_WORKER_CLIENT_TIMEOUT"',
  '"VECTOR_WORKER_CLIENT_NETWORK_FAILED"',
  '"VECTOR_WORKER_CLIENT_RESPONSE_INVALID"',
  '"VECTOR_WORKER_OBJECT_TRANSACTION_CONFLICT"',
  "this.#client.downloadObject",
  "this.#client.uploadObjects",
  "exactUploadReplay: true",
  "downloadSha256Verification: true",
  "sharedFilesystemRequired: false",
  "existingObjectsOverwritten: false",
]);
forbidTokens(files.objectStore, sources.objectStore, [
  "console.log(",
  "existingObjectsOverwritten: true",
  "managedRemoteExecutionAvailable: true",
]);

requireTokens(files.cli, sources.cli, [
  "#!/usr/bin/env node",
  '"capabilities"',
  '"run-once"',
  '"run"',
  "VECTOR_WORKER_CONTROL_URL",
  "VECTOR_WORKER_API_TOKEN",
  "VECTOR_HTTP_WORKER_OBJECT_STORE_MODE",
  "VECTOR_OBJECT_STORE_PATH",
  "VECTOR_WORKER_ID",
  "createVectorWorkerClient",
  "createVectorWorkerObjectClient",
  "FileVectorObjectStore.open",
  "new HttpVectorObjectStore",
  "requireObjectTransfer",
  'object-store-mode must be file or http',
  'objectTransport: objects.transport',
  'objectTransferAvailable !== true',
  '"object-download-attempts"',
  '"object-upload-attempts"',
  '"object-retry-ms"',
  "createVectorWorkerExecutor",
  'type: "http-worker-started"',
  'type: "http-worker-result"',
  'type: "http-worker-summary"',
  'process.once("SIGINT"',
  'process.once("SIGTERM"',
  "tokenReturned: false",
  "generatedBodiesInConsole: false",
  "process.exitCode = 75",
]);
forbidTokens(files.cli, sources.cli, [
  'flag(parsed, "token")',
  "console.log(",
  "tokenReturned: true",
  "generatedBodiesInConsole: true",
]);

requireTokens(files.runnerTests, sources.runnerTests, [
  "returns idle without starting execution",
  "safely replays a lost completion response",
  "acknowledges a cancellation observed by heartbeat",
  "does not report failure when immutable output completion remains uncertain",
  "HTTP_WORKER_COMPLETION_UNCERTAIN",
  "doesNotMatch(JSON.stringify(result), /<svg",
]);
requireTokens(files.runnerCapabilityTests, sources.runnerCapabilityTests, [
  "defaults to the existing shared-file transport",
  "reports API transfer without claiming queue delivery",
  "rejects unknown object transports",
  '"http-coordinated-object-transfer"',
]);
requireTokens(files.objectStoreTests, sources.objectStoreTests, [
  "retries a safe download transport failure",
  "retries one exact copied upload",
  "does not retry immutable transaction conflicts",
  "maps missing downloads",
  "stops before network access",
  "worker-object-transfer-api",
]);
requireTokens(files.cliTests, sources.cliTests, [
  "fails closed when the worker control token is absent",
  "runs one idle HTTP-coordinated worker cycle",
  "VECTOR_WORKER_API_TOKEN is required",
  "doesNotMatch(result.stdout, new RegExp(TOKEN))",
]);
requireTokens(files.cliHttpTests, sources.cliHttpTests, [
  "runs an idle cycle in verified worker-api object mode",
  "fails before lease acquisition when object transfer is unavailable",
  "HTTP_WORKER_OBJECT_TRANSFER_UNAVAILABLE",
  "objectTransferAvailable: true",
  "objectTransferAvailable: false",
]);
requireTokens(files.remoteExecutionTests, sources.remoteExecutionTests, [
  "optimises one SVG using only HTTP control and object transfer",
  "MemoryHostedJobStore",
  "MemoryVectorObjectStore",
  "completeHostedJobIdempotently",
  "decodeVectorObjectTransaction",
  "commitVectorObjectTransactionIdempotently",
  '"--object-store-mode"',
  '"http"',
  "output/mark.optimised.svg",
  "output/mark.evidence.json",
  "doesNotMatch(result.stdout, /<svg",
  "doesNotMatch(result.stdout, new RegExp(TOKEN))",
  'assert.equal(evidence.approval, "human-review-required")',
]);

requireTokens(files.completionReplay, sources.completionReplay, [
  "completeHostedJobIdempotently",
  "replayIfRetained",
  "completionIdentity",
  '"HOSTED_JOB_COMPLETION_CONFLICT"',
  "controller.succeed(",
]);
requireTokens(files.controllerErrors, sources.controllerErrors, [
  '"HOSTED_JOB_COMPLETION_CONFLICT"',
]);
requireTokens(files.completionTests, sources.completionTests, [
  "replays an exact receipt-backed completion",
  "rejects a changed completion replay",
  "replays the same cancellation-raced completion",
  "completeHostedJobIdempotently",
  "HOSTED_JOB_COMPLETION_CONFLICT",
]);
requireTokens(files.completeRoute, sources.completeRoute, [
  "completeHostedJobIdempotently",
  "idempotentReplay: completed.replayed",
  "generatedBodiesAccepted: false",
]);
requireTokens(files.workerClient, sources.workerClient, [
  "createVectorWorkerObjectClient",
  "actualSha256 !== digest",
]);
requireTokens(files.docs, sources.docs, [
  "HTTP worker contract `1.0`",
  "evavo-vector-http-worker",
  "pnpm http-worker:run-once",
  "pnpm http-worker:run",
  "Shared-file mode",
  "Worker-API object mode",
  "VECTOR_HTTP_WORKER_OBJECT_STORE_MODE",
  "HTTP_WORKER_OBJECT_TRANSFER_UNAVAILABLE",
  "Receipt-backed completion reconciliation",
  "HOSTED_JOB_COMPLETION_CONFLICT",
  "HTTP_WORKER_COMPLETION_UNCERTAIN",
  "objectTransport: shared-file | worker-api",
  "queueDeliveryAvailable: false",
  "managedRemoteExecutionAvailable: false",
]);
requireTokens(files.objectDocs, sources.objectDocs, [
  "Worker object-transfer contract `1.0`",
]);
requireTokens(files.clientDocs, sources.clientDocs, [
  "createVectorWorkerObjectClient",
  "verifies SHA-256 before exposing bytes",
]);
requireTokens(files.environment, sources.environment, [
  "VECTOR_WORKER_CONTROL_URL",
  "VECTOR_WORKER_API_TOKEN",
  "VECTOR_HTTP_WORKER_OBJECT_STORE_MODE=file",
  "VECTOR_OBJECT_STORE_PATH",
]);
requireTokens(files.workflow, sources.workflow, [
  "HTTP Worker contract",
  "Verify HTTP-coordinated worker contract",
  "node scripts/check-http-worker-contract.mjs",
]);

if (errors.length > 0) {
  process.stderr.write(`${JSON.stringify({
    check: "evavo-vector-studio-http-worker-contract",
    ok: false,
    httpWorkerContractVersion: "1.0",
    errors,
  }, null, 2)}\n`);
  process.exit(1);
}

process.stdout.write(`${JSON.stringify({
  check: "evavo-vector-studio-http-worker-contract",
  ok: true,
  httpWorkerContractVersion: "1.0",
  objectTransports: ["shared-file", "worker-api"],
  verifiedHttpObjectTransfer: true,
  queueDeliveryAvailable: false,
  managedRemoteExecutionAvailable: false,
  receiptBackedCompletionReplay: true,
  generatedBodiesInControlResponses: false,
  checkedFiles: [...checkedFiles].sort(),
}, null, 2)}\n`);
