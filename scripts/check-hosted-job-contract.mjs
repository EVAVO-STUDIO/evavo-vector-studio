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
    if (!source.includes(token)) errors.push(`${relativePath} is missing hosted job token: ${token}`);
  }
}

function forbidTokens(relativePath, source, tokens) {
  for (const token of tokens) {
    if (source.includes(token)) errors.push(`${relativePath} contains prohibited hosted job token: ${token}`);
  }
}

const files = {
  rootPackage: "package.json",
  webPackage: "apps/web/package.json",
  package: "packages/job-control/package.json",
  types: "packages/job-control/src/types.ts",
  canonical: "packages/job-control/src/canonical.ts",
  validation: "packages/job-control/src/validation.ts",
  errors: "packages/job-control/src/errors.ts",
  memoryStore: "packages/job-control/src/memory-store.ts",
  fileStore: "packages/job-control/src/file-store.ts",
  controller: "packages/job-control/src/controller.ts",
  index: "packages/job-control/src/index.ts",
  validationTests: "packages/job-control/src/validation.test.ts",
  controllerTests: "packages/job-control/src/controller.test.ts",
  fileStoreTests: "packages/job-control/src/file-store.test.ts",
  apiSecurity: "apps/web/lib/api-security.ts",
  apiRuntime: "apps/web/lib/hosted-job-control.ts",
  apiHelpers: "apps/web/lib/hosted-job-api.ts",
  jobsRoute: "apps/web/app/api/v1/jobs/route.ts",
  jobRoute: "apps/web/app/api/v1/jobs/[jobId]/route.ts",
  docs: "docs/HOSTED-JOBS.md",
  apiDocs: "docs/API.md",
  architecture: "docs/ARCHITECTURE.md",
  readme: "README.md",
  environment: ".env.example",
  workflow: ".github/workflows/quality.yml",
};
const sources = Object.fromEntries(
  await Promise.all(Object.entries(files).map(async ([key, relativePath]) => [key, await read(relativePath)])),
);
const rootPackage = await readJson(files.rootPackage);
const webPackage = await readJson(files.webPackage);
const jobPackage = await readJson(files.package);

if (jobPackage?.version !== rootPackage?.version) {
  errors.push(`Job-control version ${String(jobPackage?.version)} does not match root ${String(rootPackage?.version)}.`);
}
if (jobPackage?.scripts?.test !== "node --test dist/*.test.js") {
  errors.push("packages/job-control must compile and execute its generated tests.");
}
if (webPackage?.dependencies?.["@evavo/job-control"] !== "workspace:*") {
  errors.push("apps/web must depend on @evavo/job-control through the workspace.");
}
if (rootPackage?.scripts?.["hosted-jobs:check"] !== "node scripts/check-hosted-job-contract.mjs") {
  errors.push("package.json must expose hosted-jobs:check.");
}
if (!String(rootPackage?.scripts?.check ?? "").includes("pnpm hosted-jobs:check")) {
  errors.push("package.json check must include hosted-jobs:check before dependency-backed gates.");
}
if (!String(rootPackage?.scripts?.["build:packages"] ?? "").includes("--filter=@evavo/job-control")) {
  errors.push("package.json build:packages must build @evavo/job-control.");
}

requireTokens(files.types, sources.types, [
  'HOSTED_JOB_CONTRACT_VERSION = "1.0"',
  "HOSTED_JOB_MAX_PAYLOAD_BYTES = 256 * 1024",
  "HOSTED_JOB_MAX_ATTEMPTS = 10",
  "HOSTED_JOB_MIN_LEASE_MS = 5_000",
  "HOSTED_JOB_MAX_LEASE_MS = 15 * 60 * 1_000",
  '"trace-raster"',
  '"run-batch"',
  '"cancel-requested"',
  "type HostedJobStore",
  "compareAndSwap",
]);
requireTokens(files.canonical, sources.canonical, [
  "canonicalHostedJobJson",
  "hostedJobSha256",
  "hostedJobIdempotencyDigest",
  'createHash("sha256")',
  ".sort()",
]);
requireTokens(files.validation, sources.validation, [
  "validateHostedJobCreateRequest",
  "validateHostedJobOutputReceipts",
  "parseHostedJobRecord",
  "payload exceeds the hosted job JSON limit",
  "Output receipt paths must be unique",
]);
requireTokens(files.errors, sources.errors, [
  '"HOSTED_JOB_IDEMPOTENCY_CONFLICT"',
  '"HOSTED_JOB_CONCURRENCY_CONFLICT"',
  '"HOSTED_JOB_LEASE_EXPIRED"',
  '"HOSTED_JOB_STORE_BUSY"',
  '"HOSTED_JOB_STORE_CORRUPT"',
]);
requireTokens(files.memoryStore, sources.memoryStore, [
  "MemoryHostedJobStore",
  "hostedJobIdempotencyDigest",
  "compareAndSwap",
]);
requireTokens(files.fileStore, sources.fileStore, [
  "FileHostedJobStore",
  'open(lockPath, "wx", 0o600)',
  "STALE_LOCK_MS",
  "atomicWriteJson",
  "await handle.sync()",
  "hostedJobIdempotencyDigest",
  "compareAndSwap",
  "parseHostedJobRecord",
]);
requireTokens(files.controller, sources.controller, [
  "HostedJobController",
  "HOSTED_JOB_IDEMPOTENCY_CONFLICT",
  "reclaimExpiredLeases",
  "acquireLease",
  "requestCancellation",
  "acknowledgeCancellation",
  "heartbeat",
  "succeed",
  "fail",
  "compareAndSwap",
]);
requireTokens(files.index, sources.index, [
  'export * from "./controller.js"',
  'export * from "./file-store.js"',
  'export * from "./memory-store.js"',
]);
requireTokens(files.validationTests, sources.validationTests, [
  "canonicalises equivalent hosted job requests",
  "oversized payloads",
  "distinct SHA-256 output receipts",
]);
requireTokens(files.controllerTests, sources.controllerTests, [
  "creates idempotently",
  "leases, starts, heartbeats and succeeds",
  "cancels queued work immediately",
  "requeues retryable failures",
  "reclaimExpiredLeases",
]);
requireTokens(files.fileStoreTests, sources.fileStoreTests, [
  "persists idempotency, state transitions and receipts",
  "concurrent idempotent creation",
  "corrupted retained job JSON",
]);

requireTokens(files.apiSecurity, sources.apiSecurity, [
  "apiAuthorisationFailure",
  "timingSafeEqual",
  "VECTOR_API_TOKEN",
  "no-store",
]);
requireTokens(files.apiRuntime, sources.apiRuntime, [
  'VECTOR_JOB_STORE_MODE',
  'mode !== "file"',
  "VECTOR_JOB_FILE_STORE_PERSISTENT",
  "FileHostedJobStore.open",
  "remoteExecutionAvailable: false",
]);
forbidTokens(files.apiRuntime, sources.apiRuntime, [
  'remoteExecutionAvailable: true',
  'mode: "memory"',
]);
requireTokens(files.apiHelpers, sources.apiHelpers, [
  "HOSTED_JOB_STORE_NOT_CONFIGURED",
  "execution",
  "hostedWorkerAvailable: false",
  "hostedJobErrorResponse",
]);
requireTokens(files.jobsRoute, sources.jobsRoute, [
  "apiAuthorisationFailure",
  "requireHostedJobRuntime",
  "controller.create",
  "idempotentReplay",
  "executionScheduled: false",
  "remoteExecutionAvailable: false",
  "HOSTED_JOB_INVALID_JSON",
]);
forbidTokens(files.jobsRoute, sources.jobsRoute, [
  "VECTOR_DURABLE_QUEUE_NOT_AVAILABLE",
  "executionScheduled: true",
  "remoteExecutionAvailable: true",
]);
requireTokens(files.jobRoute, sources.jobRoute, [
  "export async function GET",
  "export async function DELETE",
  "requestCancellation",
  'record.status === "cancel-requested" ? 202 : 200',
  "HOSTED_JOB_CANCELLATION_INVALID",
]);

requireTokens(files.docs, sources.docs, [
  "Hosted job control contract `1.0`",
  "executionScheduled: false",
  "remoteExecutionAvailable: false",
  "HOSTED_JOB_IDEMPOTENCY_CONFLICT",
  "VECTOR_JOB_STORE_MODE=disabled",
  "VECTOR_JOB_FILE_STORE_PERSISTENT=true",
  "not a hosted background queue",
  "worker leases and heartbeats",
]);
requireTokens(files.apiDocs, sources.apiDocs, [
  "/api/v1/jobs",
]);
requireTokens(files.architecture, sources.architecture, [
  "hosted job",
]);
requireTokens(files.readme, sources.readme, [
  "Hosted job",
]);
requireTokens(files.environment, sources.environment, [
  "VECTOR_JOB_STORE_MODE=disabled",
  "VECTOR_JOB_STORE_PATH",
  "VECTOR_JOB_FILE_STORE_PERSISTENT=false",
]);
requireTokens(files.workflow, sources.workflow, [
  "Verify hosted job control contract",
  "node scripts/check-hosted-job-contract.mjs",
]);

forbidTokens(files.docs, sources.docs, [
  "hosted execution is available",
  "remote worker is deployed",
]);
forbidTokens(files.jobsRoute, sources.jobsRoute, [
  'approval: "approved"',
]);

if (errors.length > 0) {
  process.stderr.write(`${JSON.stringify({
    check: "evavo-vector-studio-hosted-job-contract",
    ok: false,
    hostedJobContractVersion: "1.0",
    errors,
  }, null, 2)}\n`);
  process.exit(1);
}

process.stdout.write(`${JSON.stringify({
  check: "evavo-vector-studio-hosted-job-contract",
  ok: true,
  hostedJobContractVersion: "1.0",
  recordCreationAvailableWhenConfigured: true,
  remoteExecutionAvailable: false,
  productionFailClosed: true,
  checkedFiles: [...checkedFiles].sort(),
}, null, 2)}\n`);
