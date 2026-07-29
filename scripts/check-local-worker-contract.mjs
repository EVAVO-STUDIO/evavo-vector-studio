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
    if (!source.includes(token)) errors.push(`${relativePath} is missing local-worker token: ${token}`);
  }
}

function forbidTokens(relativePath, source, tokens) {
  for (const token of tokens) {
    if (source.includes(token)) errors.push(`${relativePath} contains prohibited local-worker token: ${token}`);
  }
}

const files = {
  rootPackage: "package.json",
  package: "workers/local-worker/package.json",
  tsconfig: "workers/local-worker/tsconfig.json",
  runner: "workers/local-worker/src/runner.ts",
  cli: "workers/local-worker/src/index.ts",
  runnerTests: "workers/local-worker/src/runner.test.ts",
  cliTests: "workers/local-worker/src/index.test.ts",
  controller: "packages/job-control/src/controller.ts",
  controllerTests: "packages/job-control/src/controller.test.ts",
  workerTypes: "packages/worker-engine/src/types.ts",
  docs: "docs/LOCAL-WORKER.md",
  hostedDocs: "docs/HOSTED-JOBS.md",
  architecture: "docs/ARCHITECTURE.md",
  readme: "README.md",
  environment: ".env.example",
  workflow: ".github/workflows/quality.yml",
};
const sources = Object.fromEntries(
  await Promise.all(Object.entries(files).map(async ([key, relativePath]) => [key, await read(relativePath)])),
);
const rootPackage = await readJson(files.rootPackage);
const localPackage = await readJson(files.package);

if (localPackage?.version !== rootPackage?.version) {
  errors.push(`Local worker version ${String(localPackage?.version)} does not match root ${String(rootPackage?.version)}.`);
}
if (localPackage?.bin?.["evavo-vector-worker"] !== "./dist/index.js") {
  errors.push("workers/local-worker must expose evavo-vector-worker.");
}
if (localPackage?.scripts?.test !== "tsc -p tsconfig.json && node --test dist/*.test.js") {
  errors.push("workers/local-worker must compile and execute generated tests.");
}
for (const dependency of ["@evavo/job-control", "@evavo/worker-engine"]) {
  if (localPackage?.dependencies?.[dependency] !== "workspace:*") {
    errors.push(`workers/local-worker must consume ${dependency} through the workspace.`);
  }
}

for (const [script, expected] of Object.entries({
  "local-worker:check": "node scripts/check-local-worker-contract.mjs",
  "worker:build": "turbo run build --filter=@evavo/local-worker",
  "worker:capabilities": "pnpm worker:build && node workers/local-worker/dist/index.js capabilities",
  "worker:import": "pnpm worker:build && node workers/local-worker/dist/index.js import",
  "worker:submit": "pnpm worker:build && node workers/local-worker/dist/index.js submit",
  "worker:inspect": "pnpm worker:build && node workers/local-worker/dist/index.js inspect",
  "worker:list": "pnpm worker:build && node workers/local-worker/dist/index.js list",
  "worker:cancel": "pnpm worker:build && node workers/local-worker/dist/index.js cancel",
  "worker:reclaim": "pnpm worker:build && node workers/local-worker/dist/index.js reclaim",
  "worker:run-once": "pnpm worker:build && node workers/local-worker/dist/index.js run-once",
  "worker:run": "pnpm worker:build && node workers/local-worker/dist/index.js run",
})) {
  if (rootPackage?.scripts?.[script] !== expected) {
    errors.push(`package.json script ${script} must equal: ${expected}`);
  }
}
if (!String(rootPackage?.scripts?.["build:packages"] ?? "").includes("--filter=@evavo/local-worker")) {
  errors.push("package.json build:packages must include @evavo/local-worker.");
}
if (!String(rootPackage?.scripts?.check ?? "").includes("pnpm local-worker:check")) {
  errors.push("package.json check must include local-worker:check before dependency-backed checks.");
}

requireTokens(files.tsconfig, sources.tsconfig, [
  '"rootDir": "src"',
  '"outDir": "dist"',
  '"noEmit": false',
]);
requireTokens(files.runner, sources.runner, [
  'LOCAL_WORKER_CONTRACT_VERSION = "1.0"',
  "DEFAULT_LOCAL_WORKER_LEASE_MS = 60_000",
  "DEFAULT_LOCAL_WORKER_HEARTBEAT_MS = 15_000",
  "DEFAULT_LOCAL_WORKER_POLL_MS = 1_000",
  "class LocalVectorWorker",
  "acquireLease({",
  "this.#controller.start(",
  "this.#controller.heartbeat(",
  "this.#controller.succeedCommitted(",
  "this.#controller.acknowledgeCancellation(",
  "this.#controller.fail(",
  "hostedBackgroundQueue: false",
  "remoteExecutionAvailable: false",
  'stoppedBy: "signal" | "max-jobs" | "idle-timeout"',
  "worker-result",
]);
forbidTokens(files.runner, sources.runner, [
  "remoteExecutionAvailable: true",
  "hostedBackgroundQueue: true",
  "this.#controller.succeed(\n",
]);
requireTokens(files.cli, sources.cli, [
  "#!/usr/bin/env node",
  '"capabilities"',
  '"import"',
  '"submit"',
  '"inspect"',
  '"list"',
  '"cancel"',
  '"reclaim"',
  '"run-once"',
  '"run"',
  "FileHostedJobStore.open",
  "FileVectorObjectStore.open",
  "createVectorWorkerExecutor",
  "VECTOR_JOB_STORE_PATH",
  "VECTOR_OBJECT_STORE_PATH",
  "VECTOR_WORKER_ID",
  'type: "worker-started"',
  'type: "worker-result"',
  'type: "worker-summary"',
  "process.once(\"SIGINT\"",
  "process.once(\"SIGTERM\"",
  "tokenPresent: true",
  "generatedBodiesInConsole: false",
  "existingObjectsOverwritten: false",
  "process.exitCode = failure.retryable ? 75 : 2",
]);
forbidTokens(files.cli, sources.cli, [
  "console.log(",
  "remoteExecutionAvailable: true",
  "generatedBodiesInConsole: true",
]);
requireTokens(files.runnerTests, sources.runnerTests, [
  "leases, executes and records receipt-backed local work",
  "retains committed success when cancellation races",
  "committed-success-retained",
  "requeues retryable execution failure",
  "exits an idle polling loop deterministically",
]);
requireTokens(files.cliTests, sources.cliTests, [
  "imports, submits, executes, inspects and cancels through the local CLI",
  '"run-once"',
  '"worker-summary"',
  "doesNotMatch(executed.stdout, /<svg",
  "Superseded fixture",
]);
requireTokens(files.controller, sources.controller, [
  "async succeedCommitted(",
  "Committed worker success requires at least one immutable output receipt.",
  'current.status !== "running" && current.status !== "cancel-requested"',
]);
requireTokens(files.controllerTests, sources.controllerTests, [
  "records committed success when cancellation races after immutable output commit",
  "committed-success-retained",
]);
requireTokens(files.workerTypes, sources.workerTypes, [
  "outputs: readonly HostedJobOutputReceipt[]",
  "evidence: Readonly<Record<string, unknown>>",
]);
requireTokens(files.docs, sources.docs, [
  "local worker contract `1.0`",
  "evavo-vector-worker",
  "pnpm worker:import",
  "pnpm worker:submit",
  "pnpm worker:run-once",
  "pnpm worker:run",
  "NDJSON",
  "SIGINT and SIGTERM",
  "committed-success-retained",
  "Generated SVG, PNG, Lottie JSON and archive bodies",
  "hostedBackgroundQueue: false",
  "remoteExecutionAvailable: false",
]);
requireTokens(files.hostedDocs, sources.hostedDocs, [
  "local worker",
]);
requireTokens(files.architecture, sources.architecture, [
  "Local worker",
]);
requireTokens(files.readme, sources.readme, [
  "Local worker",
  "worker:run",
]);
requireTokens(files.environment, sources.environment, [
  "VECTOR_OBJECT_STORE_PATH",
  "VECTOR_WORKER_ID",
]);
requireTokens(files.workflow, sources.workflow, [
  "Verify local worker process contract",
  "node scripts/check-local-worker-contract.mjs",
]);

if (errors.length > 0) {
  process.stderr.write(`${JSON.stringify({
    check: "evavo-vector-studio-local-worker-contract",
    ok: false,
    localWorkerContractVersion: "1.0",
    errors,
  }, null, 2)}\n`);
  process.exit(1);
}

process.stdout.write(`${JSON.stringify({
  check: "evavo-vector-studio-local-worker-contract",
  ok: true,
  localWorkerContractVersion: "1.0",
  commands: [
    "capabilities",
    "import",
    "submit",
    "inspect",
    "list",
    "cancel",
    "reclaim",
    "run-once",
    "run",
  ],
  remoteExecutionAvailable: false,
  hostedBackgroundQueue: false,
  generatedBodiesInConsole: false,
  checkedFiles: [...checkedFiles].sort(),
}, null, 2)}\n`);
