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
    if (!source.includes(token)) errors.push(`${relativePath} is missing worker-API token: ${token}`);
  }
}

function forbidTokens(relativePath, source, tokens) {
  for (const token of tokens) {
    if (source.includes(token)) errors.push(`${relativePath} contains prohibited worker-API token: ${token}`);
  }
}

const files = {
  rootPackage: "package.json",
  package: "packages/worker-protocol/package.json",
  webPackage: "apps/web/package.json",
  types: "packages/worker-protocol/src/types.ts",
  errors: "packages/worker-protocol/src/errors.ts",
  validation: "packages/worker-protocol/src/validation.ts",
  tests: "packages/worker-protocol/src/validation.test.ts",
  index: "packages/worker-protocol/src/index.ts",
  completionReplay: "packages/job-control/src/completion-replay.ts",
  security: "apps/web/lib/api-security.ts",
  adapter: "apps/web/lib/worker-api.ts",
  objectRuntime: "apps/web/lib/worker-object-store.ts",
  discovery: "apps/web/app/api/v1/worker/route.ts",
  lease: "apps/web/app/api/v1/worker/lease/route.ts",
  start: "apps/web/app/api/v1/worker/jobs/[jobId]/start/route.ts",
  heartbeat: "apps/web/app/api/v1/worker/jobs/[jobId]/heartbeat/route.ts",
  complete: "apps/web/app/api/v1/worker/jobs/[jobId]/complete/route.ts",
  fail: "apps/web/app/api/v1/worker/jobs/[jobId]/fail/route.ts",
  cancel: "apps/web/app/api/v1/worker/jobs/[jobId]/acknowledge-cancellation/route.ts",
  docs: "docs/WORKER-API.md",
  apiDocs: "docs/API.md",
  hostedDocs: "docs/HOSTED-JOBS.md",
  readme: "README.md",
  environment: ".env.example",
  workflow: ".github/workflows/quality.yml",
};
const sources = Object.fromEntries(
  await Promise.all(Object.entries(files).map(async ([key, relativePath]) => [key, await read(relativePath)])),
);
const rootPackage = await readJson(files.rootPackage);
const protocolPackage = await readJson(files.package);
const webPackage = await readJson(files.webPackage);

if (protocolPackage?.version !== rootPackage?.version) {
  errors.push(`Worker protocol version ${String(protocolPackage?.version)} does not match root ${String(rootPackage?.version)}.`);
}
if (protocolPackage?.dependencies?.["@evavo/job-control"] !== "workspace:*") {
  errors.push("packages/worker-protocol must consume @evavo/job-control through the workspace.");
}
if (protocolPackage?.scripts?.test !== "node --test dist/*.test.js") {
  errors.push("packages/worker-protocol must compile and execute generated tests.");
}
if (webPackage?.dependencies?.["@evavo/worker-protocol"] !== "workspace:*") {
  errors.push("apps/web must consume @evavo/worker-protocol through the workspace.");
}
if (webPackage?.dependencies?.["@evavo/worker-engine"] !== "workspace:*") {
  errors.push("apps/web must consume the dependency-light worker object store through the workspace.");
}
if (rootPackage?.scripts?.["worker-api:check"] !== "node scripts/check-worker-api-contract.mjs") {
  errors.push("package.json must expose worker-api:check.");
}
if (!String(rootPackage?.scripts?.check ?? "").includes("pnpm worker-api:check")) {
  errors.push("package.json check must include worker-api:check before dependency-backed checks.");
}
if (!String(rootPackage?.scripts?.["build:packages"] ?? "").includes("--filter=@evavo/worker-protocol")) {
  errors.push("package.json build:packages must include @evavo/worker-protocol.");
}

requireTokens(files.types, sources.types, [
  'VECTOR_WORKER_PROTOCOL_VERSION = "1.0"',
  "VECTOR_WORKER_PROTOCOL_MAX_BODY_BYTES = 256 * 1024 + 16 * 1024",
  '"trace-raster"',
  '"package-dotlottie"',
  "VectorWorkerLeaseRequest",
  "VectorWorkerCompleteRequest",
  "VectorWorkerFailRequest",
  "tokenPresent: true",
]);
forbidTokens(files.types, sources.types, ['"run-batch"']);
requireTokens(files.errors, sources.errors, [
  '"VECTOR_WORKER_PROTOCOL_REQUEST_INVALID"',
  '"VECTOR_WORKER_PROTOCOL_OPERATION_UNSUPPORTED"',
  '"VECTOR_WORKER_PROTOCOL_BODY_TOO_LARGE"',
  '"VECTOR_WORKER_OBJECT_TRANSACTION_INVALID"',
]);
requireTokens(files.validation, sources.validation, [
  "validateWorkerLeaseRequest",
  "validateWorkerLeaseTokenRequest",
  "validateWorkerHeartbeatRequest",
  "validateWorkerCompleteRequest",
  "validateWorkerFailRequest",
  "validateHostedJobOutputReceipts",
  "operations contains an unsupported worker operation",
  "Worker completion requires at least one immutable output receipt",
  "workerProtocolRecord",
  "workerLeaseResponse",
  "tokenPresent: true as const",
]);
requireTokens(files.tests, sources.tests, [
  "rejects unsupported run-batch",
  "requires receipt-backed completion",
  "returns a lease token only in the authenticated acquisition envelope",
  "doesNotMatch(JSON.stringify(response.record)",
]);
requireTokens(files.index, sources.index, [
  'export * from "./errors.js"',
  'export * from "./object-transfer.js"',
  'export * from "./types.js"',
  'export * from "./validation.js"',
]);
requireTokens(files.completionReplay, sources.completionReplay, [
  "completeHostedJobIdempotently",
  "replayIfRetained",
  "completionIdentity",
  '"HOSTED_JOB_COMPLETION_CONFLICT"',
]);

requireTokens(files.security, sources.security, [
  "workerApiAuthorisationFailure",
  "VECTOR_WORKER_API_TOKEN",
  'error: "VECTOR_WORKER_API_NOT_CONFIGURED"',
  'error: "VECTOR_WORKER_API_UNAUTHORISED"',
  "secureEqual(configuredToken, suppliedToken)",
]);
requireTokens(files.adapter, sources.adapter, [
  "VECTOR_WORKER_PROTOCOL_MAX_BODY_BYTES",
  'contentType !== "application/json"',
  'Buffer.byteLength(source, "utf8")',
  "workerProtocolRecord(record)",
  "objectTransferAvailable",
  'objects: "/api/v1/worker/objects"',
  'objectDownload: "/api/v1/worker/objects?key={objectKey}"',
  "queueDeliveryAvailable: false",
  "remoteExecutionAvailable: false",
  "failClosedWithoutObjectStore: true",
  "leaseTokensReturnedOnlyByAcquisition: true",
  "VECTOR_WORKER_JOB_STORE_NOT_CONFIGURED",
  "VectorWorkerProtocolError",
  "HostedJobError",
]);
requireTokens(files.objectRuntime, sources.objectRuntime, [
  "getWorkerObjectStoreRuntime",
  "objectTransferAvailable: true",
  "VECTOR_OBJECT_STORE_MODE",
]);

for (const route of [
  files.discovery,
  files.lease,
  files.start,
  files.heartbeat,
  files.complete,
  files.fail,
  files.cancel,
]) {
  const sourceKey = Object.keys(files).find((key) => files[key] === route);
  const routeSource = sourceKey ? sources[sourceKey] : "";
  requireTokens(route, routeSource, [
    "workerApiAuthorisationFailure(request)",
    'runtime = "nodejs"',
    'dynamic = "force-dynamic"',
  ]);
  forbidTokens(route, routeSource, [
    "request.formData()",
    "remoteExecutionAvailable: true",
  ]);
}
requireTokens(files.discovery, sources.discovery, [
  'service: "evavo-vector-studio-worker-control"',
  "getWorkerObjectStoreRuntime",
  "workerObjectRuntimeView(objectRuntime)",
  "workerRuntimeView(runtimeValue, objectRuntime)",
]);
requireTokens(files.lease, sources.lease, [
  "validateWorkerLeaseRequest",
  "acquireLease(input)",
  "status: 204",
  "workerLeaseResponse(leased)",
  "getWorkerObjectStoreRuntime",
  "objectTransferAvailable: objectRuntime.objectTransferAvailable",
  'objectTransferEndpoint: "/api/v1/worker/objects"',
]);
requireTokens(files.start, sources.start, [
  "validateWorkerLeaseTokenRequest",
  ".start(",
  "workerRecordView(record)",
]);
requireTokens(files.heartbeat, sources.heartbeat, [
  "validateWorkerHeartbeatRequest",
  ".heartbeat(",
  'cancellationRequested: record.status === "cancel-requested"',
]);
requireTokens(files.complete, sources.complete, [
  "validateWorkerCompleteRequest",
  "completeHostedJobIdempotently",
  "idempotentReplay: completed.replayed",
  "generatedBodiesAccepted: false",
  'approval: "human-review-required"',
]);
forbidTokens(files.complete, sources.complete, [".succeed("]);
requireTokens(files.fail, sources.fail, [
  "validateWorkerFailRequest",
  ".fail(",
]);
requireTokens(files.cancel, sources.cancel, [
  "validateWorkerLeaseTokenRequest",
  ".acknowledgeCancellation(",
]);

requireTokens(files.docs, sources.docs, [
  "Worker control protocol `1.0`",
  "VECTOR_WORKER_API_TOKEN",
  "POST /api/v1/worker/lease",
  "/start",
  "/heartbeat",
  "/complete",
  "/fail",
  "/acknowledge-cancellation",
  "/api/v1/worker/objects",
  "objectTransferAvailable: configured-runtime-dependent",
  "queueDeliveryAvailable: false",
  "remoteExecutionAvailable: false",
  "run-batch",
  "leaseToken",
  "tokenPresent: true",
]);
requireTokens(files.apiDocs, sources.apiDocs, [
  "/api/v1/worker",
  "/api/v1/worker/objects",
  "VECTOR_WORKER_API_TOKEN",
]);
requireTokens(files.hostedDocs, sources.hostedDocs, ["worker control API"]);
requireTokens(files.readme, sources.readme, [
  "Worker control API",
  "/api/v1/worker/lease",
  "/api/v1/worker/objects",
]);
requireTokens(files.environment, sources.environment, [
  "VECTOR_WORKER_API_TOKEN",
  "VECTOR_OBJECT_STORE_MODE=disabled",
]);
requireTokens(files.workflow, sources.workflow, [
  "Verify worker control API contract",
  "node scripts/check-worker-api-contract.mjs",
]);

if (errors.length > 0) {
  process.stderr.write(`${JSON.stringify({
    check: "evavo-vector-studio-worker-api-contract",
    ok: false,
    workerProtocolVersion: "1.0",
    errors,
  }, null, 2)}\n`);
  process.exit(1);
}

process.stdout.write(`${JSON.stringify({
  check: "evavo-vector-studio-worker-api-contract",
  ok: true,
  workerProtocolVersion: "1.0",
  endpoints: [
    "/api/v1/worker",
    "/api/v1/worker/lease",
    "/api/v1/worker/jobs/{jobId}/start",
    "/api/v1/worker/jobs/{jobId}/heartbeat",
    "/api/v1/worker/jobs/{jobId}/complete",
    "/api/v1/worker/jobs/{jobId}/fail",
    "/api/v1/worker/jobs/{jobId}/acknowledge-cancellation",
    "/api/v1/worker/objects",
  ],
  idempotentCompletionReplay: true,
  objectTransferAvailable: "configured-runtime-dependent",
  queueDeliveryAvailable: false,
  remoteExecutionAvailable: false,
  checkedFiles: [...checkedFiles].sort(),
}, null, 2)}\n`);
