import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const errors = [];
const checkedFiles = new Set();
async function read(relativePath) {
  checkedFiles.add(relativePath);
  try { return (await fs.readFile(path.join(root, relativePath), "utf8")).replace(/^\uFEFF/, ""); }
  catch (error) { errors.push(`Missing or unreadable file: ${relativePath} (${error instanceof Error ? error.message : String(error)})`); return ""; }
}
async function readJson(relativePath) { const source = await read(relativePath); if (!source) return null; try { return JSON.parse(source); } catch (error) { errors.push(`Invalid JSON: ${relativePath} (${error instanceof Error ? error.message : String(error)})`); return null; } }
async function requireAbsent(relativePath) { checkedFiles.add(relativePath); try { await fs.access(path.join(root, relativePath)); errors.push(`Retired HTTP-worker workflow must remain absent: ${relativePath}.`); } catch (error) { if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) errors.push(`Could not verify absence of ${relativePath}.`); } }
function requireTokens(relativePath, source, tokens) { for (const token of tokens) if (!source.includes(token)) errors.push(`${relativePath} is missing HTTP-worker token: ${token}`); }
function forbidTokens(relativePath, source, tokens) { for (const token of tokens) if (source.includes(token)) errors.push(`${relativePath} contains prohibited HTTP-worker token: ${token}`); }

const files = {
  rootPackage: "package.json", package: "workers/http-worker/package.json", tsconfig: "workers/http-worker/tsconfig.json",
  errors: "workers/http-worker/src/errors.ts", runner: "workers/http-worker/src/runner.ts", objectStore: "workers/http-worker/src/http-object-store.ts", cli: "workers/http-worker/src/index.ts",
  runnerTests: "workers/http-worker/src/runner.test.ts", runnerCapabilityTests: "workers/http-worker/src/runner-capabilities.test.ts", objectStoreTests: "workers/http-worker/src/http-object-store.test.ts",
  cliTests: "workers/http-worker/src/index.test.ts", cliHttpTests: "workers/http-worker/src/index-http-mode.test.ts", remoteExecutionTests: "workers/http-worker/src/remote-execution.test.ts",
  completionReplay: "packages/job-control/src/completion-replay.ts", controllerErrors: "packages/job-control/src/errors.ts", completionTests: "packages/job-control/src/completion-replay.test.ts",
  completeRoute: "apps/web/app/api/v1/worker/jobs/[jobId]/complete/route.ts", workerClient: "packages/worker-client/src/object-client.ts",
  docs: "docs/HTTP-WORKER.md", objectDocs: "docs/OBJECT-TRANSFER.md", clientDocs: "docs/WORKER-CLIENT.md", environment: ".env.example",
};
const sources = Object.fromEntries(await Promise.all(Object.entries(files).map(async ([key, relativePath]) => [key, await read(relativePath)])));
const rootPackage = await readJson(files.rootPackage); const workerPackage = await readJson(files.package);
await requireAbsent(".github/workflows/http-worker-contract.yml");

if (workerPackage?.version !== rootPackage?.version) errors.push("HTTP worker version must match root release.");
if (workerPackage?.bin?.["evavo-vector-http-worker"] !== "./dist/index.js") errors.push("HTTP worker must expose evavo-vector-http-worker.");
if (workerPackage?.scripts?.test !== "node --test dist/*.test.js") errors.push("HTTP worker must execute compiled tests.");
for (const dependency of ["@evavo/job-control", "@evavo/worker-client", "@evavo/worker-engine", "@evavo/worker-protocol"]) if (workerPackage?.dependencies?.[dependency] !== "workspace:*") errors.push(`HTTP worker must consume ${dependency} through workspace.`);
for (const [script, expected] of Object.entries({
  "http-worker:check": "node scripts/check-http-worker-contract.mjs",
  "http-worker:build": "turbo run build --filter=@evavo/http-worker",
  "http-worker:capabilities": "pnpm http-worker:build && node workers/http-worker/dist/index.js capabilities",
  "http-worker:run-once": "pnpm http-worker:build && node workers/http-worker/dist/index.js run-once",
  "http-worker:run": "pnpm http-worker:build && node workers/http-worker/dist/index.js run",
})) if (rootPackage?.scripts?.[script] !== expected) errors.push(`package.json script ${script} must equal ${expected}.`);
if (!String(rootPackage?.scripts?.["build:packages"] ?? "").includes("--filter=@evavo/http-worker")) errors.push("build:packages must include @evavo/http-worker.");
if (!String(rootPackage?.scripts?.check ?? "").includes("pnpm http-worker:check")) errors.push("package.json check must include http-worker:check.");

requireTokens(files.tsconfig, sources.tsconfig, ['"extends": "../../tsconfig.json"', '"rootDir": "src"', '"outDir": "dist"', '"noEmit": false']);
requireTokens(files.errors, sources.errors, ['"HTTP_WORKER_COMPLETION_UNCERTAIN"', '"HTTP_WORKER_CONTROL_UNCERTAIN"', '"HTTP_WORKER_OBJECT_TRANSFER_UNAVAILABLE"', "VectorWorkerClientError", "httpWorkerFailure"]);
requireTokens(files.runner, sources.runner, ['HTTP_WORKER_CONTRACT_VERSION = "1.0"', 'HttpWorkerObjectTransport = "shared-file" | "worker-api"', "class HttpVectorWorker", "acquireLease({", "client.heartbeat(", "client.complete(", "completeWithReplay", '"HTTP_WORKER_COMPLETION_UNCERTAIN"', "receiptBackedCompletionReplay: true", "queueDeliveryAvailable: false", "managedRemoteExecutionAvailable: false", "generatedBodiesInControlResponses: false", 'approval: "human-review-required"']);
forbidTokens(files.runner, sources.runner, ["queueDeliveryAvailable: true", "managedRemoteExecutionAvailable: true", 'approval: "approved"']);
requireTokens(files.objectStore, sources.objectStore, ['HTTP_OBJECT_STORE_CONTRACT_VERSION = "1.0"', "class HttpVectorObjectStore", "copyWrites", "withRetries", '"VECTOR_WORKER_OBJECT_TRANSACTION_CONFLICT"', "downloadSha256Verification: true", "existingObjectsOverwritten: false"]);
requireTokens(files.cli, sources.cli, ["#!/usr/bin/env node", '"capabilities"', '"run-once"', '"run"', "VECTOR_WORKER_CONTROL_URL", "VECTOR_WORKER_API_TOKEN", "VECTOR_HTTP_WORKER_OBJECT_STORE_MODE", "createVectorWorkerClient", "createVectorWorkerObjectClient", 'objectTransport: objects.transport', "requireObjectTransfer", "tokenReturned: false", "generatedBodiesInConsole: false"]);
forbidTokens(files.cli, sources.cli, ['flag(parsed, "token")', "console.log(", "tokenReturned: true", "generatedBodiesInConsole: true"]);

for (const [file, tokens] of [
  [files.runnerTests, ["returns idle without starting execution", "safely replays a lost completion response", "acknowledges a cancellation observed by heartbeat", "HTTP_WORKER_COMPLETION_UNCERTAIN"]],
  [files.runnerCapabilityTests, ["defaults to the existing shared-file transport", "reports API transfer without claiming queue delivery", "rejects unknown object transports"]],
  [files.objectStoreTests, ["retries a safe download transport failure", "retries one exact copied upload", "does not retry immutable transaction conflicts"]],
  [files.cliTests, ["fails closed when the worker control token is absent", "runs one idle HTTP-coordinated worker cycle"]],
  [files.cliHttpTests, ["runs an idle cycle in verified worker-api object mode", "fails before lease acquisition when object transfer is unavailable"]],
  [files.remoteExecutionTests, ["optimises one SVG using only HTTP control and object transfer", "MemoryHostedJobStore", "MemoryVectorObjectStore", '"--object-store-mode"', '"http"', 'assert.equal(evidence.approval, "human-review-required")']],
]) requireTokens(file, sources[Object.keys(files).find((key) => files[key] === file)], tokens);

requireTokens(files.completionReplay, sources.completionReplay, ["completeHostedJobIdempotently", "replayIfRetained", '"HOSTED_JOB_COMPLETION_CONFLICT"']);
requireTokens(files.controllerErrors, sources.controllerErrors, ['"HOSTED_JOB_COMPLETION_CONFLICT"']);
requireTokens(files.completionTests, sources.completionTests, ["replays an exact receipt-backed completion", "rejects a changed completion replay", "HOSTED_JOB_COMPLETION_CONFLICT"]);
requireTokens(files.completeRoute, sources.completeRoute, ["completeHostedJobIdempotently", "idempotentReplay: completed.replayed", "generatedBodiesAccepted: false"]);
requireTokens(files.workerClient, sources.workerClient, ["createVectorWorkerObjectClient", "actualSha256 !== digest"]);
requireTokens(files.docs, sources.docs, ["HTTP worker contract `1.0`", "evavo-vector-http-worker", "Worker-API object mode", "Receipt-backed completion reconciliation", "queueDeliveryAvailable: false", "managedRemoteExecutionAvailable: false"]);
requireTokens(files.objectDocs, sources.objectDocs, ["Worker object-transfer contract `1.0`"]); requireTokens(files.clientDocs, sources.clientDocs, ["createVectorWorkerObjectClient", "verifies SHA-256 before exposing bytes"]);
requireTokens(files.environment, sources.environment, ["VECTOR_WORKER_CONTROL_URL", "VECTOR_WORKER_API_TOKEN", "VECTOR_HTTP_WORKER_OBJECT_STORE_MODE=file", "VECTOR_OBJECT_STORE_PATH"]);

if (errors.length > 0) {
  process.stderr.write(`${JSON.stringify({ check: "evavo-vector-studio-http-worker-contract", ok: false, httpWorkerContractVersion: "2.0", errors }, null, 2)}\n`);
  process.exit(1);
}
process.stdout.write(`${JSON.stringify({
  check: "evavo-vector-studio-http-worker-contract", ok: true, httpWorkerContractVersion: "2.0", providerFreeValidation: true, retiredWorkflowAbsent: true,
  objectTransports: ["shared-file", "worker-api"], verifiedHttpObjectTransfer: true, queueDeliveryAvailable: false, managedRemoteExecutionAvailable: false,
  receiptBackedCompletionReplay: true, generatedBodiesInControlResponses: false, checkedFiles: [...checkedFiles].sort(),
}, null, 2)}\n`);
