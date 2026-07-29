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
    if (!source.includes(token)) errors.push(`${relativePath} is missing worker-client token: ${token}`);
  }
}

function forbidTokens(relativePath, source, tokens) {
  for (const token of tokens) {
    if (source.includes(token)) errors.push(`${relativePath} contains prohibited worker-client token: ${token}`);
  }
}

const files = {
  rootPackage: "package.json",
  package: "packages/worker-client/package.json",
  tsconfig: "packages/worker-client/tsconfig.json",
  types: "packages/worker-client/src/types.ts",
  errors: "packages/worker-client/src/errors.ts",
  client: "packages/worker-client/src/client.ts",
  tests: "packages/worker-client/src/client.test.ts",
  index: "packages/worker-client/src/index.ts",
  docs: "docs/WORKER-CLIENT.md",
  workerApiDocs: "docs/WORKER-API.md",
  readme: "README.md",
  workflow: ".github/workflows/quality.yml",
};
const sources = Object.fromEntries(
  await Promise.all(Object.entries(files).map(async ([key, relativePath]) => [key, await read(relativePath)])),
);
const rootPackage = await readJson(files.rootPackage);
const clientPackage = await readJson(files.package);

if (clientPackage?.version !== rootPackage?.version) {
  errors.push(`Worker client version ${String(clientPackage?.version)} does not match root ${String(rootPackage?.version)}.`);
}
for (const dependency of ["@evavo/job-control", "@evavo/worker-protocol"]) {
  if (clientPackage?.dependencies?.[dependency] !== "workspace:*") {
    errors.push(`packages/worker-client must consume ${dependency} through the workspace.`);
  }
}
if (clientPackage?.scripts?.test !== "tsc -p tsconfig.json && node --test dist/*.test.js") {
  errors.push("packages/worker-client must compile and execute generated tests.");
}
if (rootPackage?.scripts?.["worker-client:check"] !== "node scripts/check-worker-client-contract.mjs") {
  errors.push("package.json must expose worker-client:check.");
}
if (!String(rootPackage?.scripts?.check ?? "").includes("pnpm worker-client:check")) {
  errors.push("package.json check must include worker-client:check before dependency-backed checks.");
}
if (!String(rootPackage?.scripts?.["build:packages"] ?? "").includes("--filter=@evavo/worker-client")) {
  errors.push("package.json build:packages must include @evavo/worker-client.");
}

requireTokens(files.tsconfig, sources.tsconfig, [
  '"extends": "../../tsconfig.json"',
  '"rootDir": "src"',
  '"outDir": "dist"',
]);
requireTokens(files.types, sources.types, [
  'VECTOR_WORKER_CLIENT_VERSION = "1.0"',
  "DEFAULT_WORKER_CLIENT_TIMEOUT_MS = 30_000",
  "DEFAULT_WORKER_CLIENT_MAX_RESPONSE_BYTES = 512 * 1024",
  "VectorWorkerClientOptions",
  "VectorWorkerClient",
  "acquireLease",
  "acknowledgeCancellation",
]);
requireTokens(files.errors, sources.errors, [
  '"VECTOR_WORKER_CLIENT_OPTIONS_INVALID"',
  '"VECTOR_WORKER_CLIENT_ABORTED"',
  '"VECTOR_WORKER_CLIENT_TIMEOUT"',
  '"VECTOR_WORKER_CLIENT_NETWORK_FAILED"',
  '"VECTOR_WORKER_CLIENT_HTTP_FAILED"',
  '"VECTOR_WORKER_CLIENT_RESPONSE_TOO_LARGE"',
  '"VECTOR_WORKER_CLIENT_RESPONSE_INVALID"',
]);
requireTokens(files.client, sources.client, [
  "createVectorWorkerClient",
  "LOCAL_HOSTS",
  'url.protocol === "http:"',
  "allowInsecureHttp",
  "authorization: `Bearer ${token}`",
  'redirect: "error"',
  'cache: "no-store"',
  "setTimeout(() =>",
  "maximumResponseBytes",
  'response.headers.get("x-vector-worker-protocol")',
  "protocolRecord",
  '"token" in leaseRecord',
  'request("POST", "api/v1/worker/lease"',
  'jobPath(jobId, "heartbeat")',
  'jobPath(jobId, "complete")',
  'jobPath(jobId, "acknowledge-cancellation")',
]);
forbidTokens(files.client, sources.client, [
  "console.log(",
  "setInterval(",
  "retry(",
  "token:",
  "authorization: token",
]);
requireTokens(files.tests, sources.tests, [
  "rejects insecure non-local URLs",
  "sends the worker token without exposing it",
  "returns null for an empty lease",
  "never retries automatically",
  "without leaking the client token",
  "rejects oversized and wrong-version success responses",
  "distinguishes caller cancellation from request timeout",
  "doesNotMatch(JSON.stringify(leased?.record)",
]);
requireTokens(files.index, sources.index, [
  'export * from "./client.js"',
  'export * from "./errors.js"',
  'export * from "./types.js"',
]);
requireTokens(files.docs, sources.docs, [
  "Worker control client `1.0`",
  "createVectorWorkerClient",
  "non-local control URLs require HTTPS",
  "No automatic mutation retries",
  "X-Vector-Worker-Protocol: 1.0",
  "VECTOR_WORKER_CLIENT_TIMEOUT",
  "Object transfer unavailable",
  "Managed remote execution unavailable",
]);
requireTokens(files.workerApiDocs, sources.workerApiDocs, [
  "worker control API",
]);
requireTokens(files.readme, sources.readme, [
  "Worker control client",
  "@evavo/worker-client",
]);
requireTokens(files.workflow, sources.workflow, [
  "Verify worker control client contract",
  "node scripts/check-worker-client-contract.mjs",
]);

if (errors.length > 0) {
  process.stderr.write(`${JSON.stringify({
    check: "evavo-vector-studio-worker-client-contract",
    ok: false,
    workerClientVersion: "1.0",
    errors,
  }, null, 2)}\n`);
  process.exit(1);
}

process.stdout.write(`${JSON.stringify({
  check: "evavo-vector-studio-worker-client-contract",
  ok: true,
  workerClientVersion: "1.0",
  automaticMutationRetries: false,
  objectTransferAvailable: false,
  managedRemoteExecutionAvailable: false,
  checkedFiles: [...checkedFiles].sort(),
}, null, 2)}\n`);
