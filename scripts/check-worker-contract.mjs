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
    if (!source.includes(token)) errors.push(`${relativePath} is missing worker token: ${token}`);
  }
}

function forbidTokens(relativePath, source, tokens) {
  for (const token of tokens) {
    if (source.includes(token)) errors.push(`${relativePath} contains prohibited worker token: ${token}`);
  }
}

const files = {
  rootPackage: "package.json",
  package: "packages/worker-engine/package.json",
  types: "packages/worker-engine/src/types.ts",
  errors: "packages/worker-engine/src/errors.ts",
  payloads: "packages/worker-engine/src/payloads.ts",
  fileStore: "packages/worker-engine/src/file-object-store.ts",
  memoryStore: "packages/worker-engine/src/memory-object-store.ts",
  executor: "packages/worker-engine/src/executor.ts",
  index: "packages/worker-engine/src/index.ts",
  fileStoreTests: "packages/worker-engine/src/file-object-store.test.ts",
  executorTests: "packages/worker-engine/src/executor.test.ts",
  docs: "docs/WORKER.md",
  hostedDocs: "docs/HOSTED-JOBS.md",
  architecture: "docs/ARCHITECTURE.md",
  readme: "README.md",
  workflow: ".github/workflows/quality.yml",
};
const sources = Object.fromEntries(
  await Promise.all(Object.entries(files).map(async ([key, relativePath]) => [key, await read(relativePath)])),
);
const rootPackage = await readJson(files.rootPackage);
const workerPackage = await readJson(files.package);

if (workerPackage?.version !== rootPackage?.version) {
  errors.push(`Worker version ${String(workerPackage?.version)} does not match root ${String(rootPackage?.version)}.`);
}
if (workerPackage?.scripts?.test !== "tsc -p tsconfig.json && node --test dist/*.test.js") {
  errors.push("packages/worker-engine must compile and execute its generated tests.");
}
for (const dependency of [
  "@evavo/job-control",
  "@evavo/lottie-engine",
  "@evavo/motion-engine",
  "@evavo/raster-engine",
  "@evavo/vector-core",
]) {
  if (workerPackage?.dependencies?.[dependency] !== "workspace:*") {
    errors.push(`packages/worker-engine must consume ${dependency} through the workspace.`);
  }
}
if (rootPackage?.scripts?.["worker:check"] !== "node scripts/check-worker-contract.mjs") {
  errors.push("package.json must expose worker:check.");
}
if (!String(rootPackage?.scripts?.check ?? "").includes("pnpm worker:check")) {
  errors.push("package.json check must include worker:check before dependency-backed gates.");
}
if (!String(rootPackage?.scripts?.["build:packages"] ?? "").includes("--filter=@evavo/worker-engine")) {
  errors.push("package.json build:packages must build @evavo/worker-engine.");
}

requireTokens(files.types, sources.types, [
  'VECTOR_WORKER_CONTRACT_VERSION = "1.0"',
  "VECTOR_WORKER_MAX_SOURCE_BYTES = 32 * 1024 * 1024",
  "VECTOR_WORKER_MAX_MOTION_BYTES = 256 * 1024",
  "VECTOR_WORKER_MAX_OUTPUT_BYTES = 32 * 1024 * 1024",
  '"trace-raster"',
  '"package-dotlottie"',
  "type VectorObjectStore",
  "putManyNew",
  "type VectorWorkerExecutor",
]);
requireTokens(files.errors, sources.errors, [
  '"VECTOR_WORKER_OBJECT_HASH_MISMATCH"',
  '"VECTOR_WORKER_OBJECT_EXISTS"',
  '"VECTOR_WORKER_OBJECT_COLLISION"',
  '"VECTOR_WORKER_CANCELLED"',
  "RasterRuntimeGuardError",
  "MotionEngineError",
  "LottieEngineError",
]);
requireTokens(files.payloads, sources.payloads, [
  "validateVectorWorkerPayload",
  "TraceRasterWorkerPayload",
  "OptimiseSvgWorkerPayload",
  "AnimateSvgWorkerPayload",
  "ExportLottieWorkerPayload",
  "PackageDotLottieWorkerPayload",
  "differenceMaxDimension requires differenceObjectKey",
  "VECTOR_WORKER_OPERATION_UNSUPPORTED",
]);
requireTokens(files.fileStore, sources.fileStore, [
  "FileVectorObjectStore",
  "validateObjectKey",
  "await realpath(absolute)",
  "nearestExistingDirectory",
  "await link(item.temporaryPath, item.targetPath)",
  "committed.map((item) => rm(item.targetPath, { force: true }))",
  'open(item.temporaryPath, "wx", 0o600)',
  "throwIfWorkerAborted(options.signal)",
]);
requireTokens(files.memoryStore, sources.memoryStore, [
  "MemoryVectorObjectStore",
  "putManyNew",
  "Immutable object storage never overwrites",
]);
requireTokens(files.executor, sources.executor, [
  "createVectorWorkerExecutor",
  'job.status !== "running"',
  "validateVectorWorkerPayload",
  "VECTOR_WORKER_OBJECT_HASH_MISMATCH",
  "traceRaster",
  "optimiseSvg",
  "createAnimatedSvg",
  "createLottieFromSvgMotion",
  "createDotLottiePackage",
  "outputObjects: compactOutputs",
  'approval: "human-review-required"',
]);
requireTokens(files.index, sources.index, [
  'export * from "./executor.js"',
  'export * from "./file-object-store.js"',
  'export * from "./memory-object-store.js"',
]);
requireTokens(files.fileStoreTests, sources.fileStoreTests, [
  "immutable multi-object transactions",
  "source symlink escapes",
  "output parent symlink escapes",
  "aborts before committing any object",
]);
requireTokens(files.executorTests, sources.executorTests, [
  "executes optimise, animated SVG, Lottie and dotLottie jobs",
  "rejects source hash drift",
  "VECTOR_WORKER_OBJECT_HASH_MISMATCH",
  "VECTOR_WORKER_OPERATION_UNSUPPORTED",
  "VECTOR_WORKER_CANCELLED",
  "doesNotMatch(JSON.stringify(lottieCompletion)",
]);
requireTokens(files.docs, sources.docs, [
  "Vector worker contract `1.0`",
  "trace-raster",
  "package-dotlottie",
  "run-batch",
  "not yet accepted",
  "immutable source-object SHA-256 verification",
  "atomic multi-object output commit",
  "Generated SVG, PNG, Lottie JSON or archive bodies",
  "remoteExecutionAvailable",
]);
requireTokens(files.hostedDocs, sources.hostedDocs, [
  "worker",
]);
requireTokens(files.architecture, sources.architecture, [
  "worker",
]);
requireTokens(files.readme, sources.readme, [
  "worker",
]);
requireTokens(files.workflow, sources.workflow, [
  "Verify worker execution contract",
  "node scripts/check-worker-contract.mjs",
]);

forbidTokens(files.executor, sources.executor, [
  'approval: "approved"',
  "remoteExecutionAvailable: true",
]);
forbidTokens(files.docs, sources.docs, [
  "hosted worker process is available",
  "remoteExecutionAvailable: true",
]);

if (errors.length > 0) {
  process.stderr.write(`${JSON.stringify({
    check: "evavo-vector-studio-worker-contract",
    ok: false,
    workerContractVersion: "1.0",
    errors,
  }, null, 2)}\n`);
  process.exit(1);
}

process.stdout.write(`${JSON.stringify({
  check: "evavo-vector-studio-worker-contract",
  ok: true,
  workerContractVersion: "1.0",
  supportedOperations: [
    "trace-raster",
    "optimise-svg",
    "animate-svg",
    "export-lottie",
    "package-dotlottie",
  ],
  runBatchAvailable: false,
  hostedWorkerProcessAvailable: false,
  generatedBodiesInJobRecord: false,
  checkedFiles: [...checkedFiles].sort(),
}, null, 2)}\n`);
