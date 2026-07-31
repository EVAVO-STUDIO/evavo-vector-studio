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
    if (!source.includes(token)) errors.push(`${relativePath} is missing durable batch token: ${token}`);
  }
}

function forbidTokens(relativePath, source, tokens) {
  for (const token of tokens) {
    if (source.includes(token)) errors.push(`${relativePath} contains prohibited durable batch token: ${token}`);
  }
}

const files = {
  rootPackage: "package.json",
  jobPackage: "packages/job-engine/package.json",
  cliPackage: "packages/cli/package.json",
  schema: "schemas/batch-v1.schema.json",
  index: "packages/job-engine/src/index.ts",
  types: "packages/job-engine/src/types.ts",
  errors: "packages/job-engine/src/errors.ts",
  manifest: "packages/job-engine/src/manifest.ts",
  pathPolicy: "packages/job-engine/src/path-policy.ts",
  store: "packages/job-engine/src/store.ts",
  runner: "packages/job-engine/src/runner.ts",
  inspection: "packages/job-engine/src/inspection.ts",
  manifestTests: "packages/job-engine/src/manifest.test.ts",
  pathTests: "packages/job-engine/src/path-policy.test.ts",
  runnerTests: "packages/job-engine/src/runner.test.ts",
  operations: "packages/cli/src/batch-operations.ts",
  cli: "packages/cli/src/batch-cli.ts",
  cliTests: "packages/cli/src/batch-cli.test.ts",
  jobsIndex: "packages/vector-jobs/src/index.ts",
  docs: "docs/BATCH.md",
  deliveryDocs: "docs/DELIVERY-PROFILES.md",
  pathDocs: "docs/BATCH-PATH-SAFETY.md",
  architecture: "docs/ARCHITECTURE.md",
  readme: "README.md",
  workflow: ".github/workflows/quality.yml",
};
const sources = Object.fromEntries(
  await Promise.all(Object.entries(files).map(async ([key, relativePath]) => [key, await read(relativePath)])),
);
const rootPackage = await readJson(files.rootPackage);
const jobPackage = await readJson(files.jobPackage);
const cliPackage = await readJson(files.cliPackage);
const schema = await readJson(files.schema);

if (jobPackage?.version !== rootPackage?.version) {
  errors.push(`Job-engine version ${String(jobPackage?.version)} does not match root ${String(rootPackage?.version)}.`);
}
if (jobPackage?.scripts?.test !== "tsc -p tsconfig.json && node --test dist/*.test.js") {
  errors.push("packages/job-engine must compile and execute its generated tests.");
}
if (cliPackage?.dependencies?.["@evavo/job-engine"] !== "workspace:*") {
  errors.push("packages/cli must depend on @evavo/job-engine through the workspace.");
}
if (cliPackage?.bin?.["evavo-vector-batch"] !== "./dist/batch-cli.js") {
  errors.push("packages/cli must expose the evavo-vector-batch binary.");
}
for (const [script, expected] of Object.entries({
  "batch:check": "node scripts/check-batch-contract.mjs",
  "vector:batch:run": "pnpm vector:build && node packages/cli/dist/batch-cli.js run",
  "vector:batch:inspect": "pnpm vector:build && node packages/cli/dist/batch-cli.js inspect",
  "vector:batch:capabilities": "pnpm vector:build && node packages/cli/dist/batch-cli.js capabilities",
})) {
  if (rootPackage?.scripts?.[script] !== expected) {
    errors.push(`package.json script ${script} must equal: ${expected}`);
  }
}
if (!String(rootPackage?.scripts?.check ?? "").includes("pnpm batch:check")) {
  errors.push("package.json check must include batch:check before dependency-backed gates.");
}
if (!String(rootPackage?.scripts?.["build:packages"] ?? "").includes("--filter=@evavo/job-engine")) {
  errors.push("package.json build:packages must build @evavo/job-engine.");
}

if (schema?.$schema !== "https://json-schema.org/draft/2020-12/schema") {
  errors.push("Batch schema must use JSON Schema 2020-12.");
}
if (schema?.$id !== "https://evavo.com.au/schemas/vector-studio/batch-v1.schema.json") {
  errors.push(`Unexpected batch schema ID: ${String(schema?.$id)}`);
}
if (
  schema?.additionalProperties !== false ||
  schema?.properties?.version?.const !== "1.0" ||
  schema?.properties?.items?.maxItems !== 1000 ||
  schema?.$defs?.item?.additionalProperties !== false
) {
  errors.push("Batch schema must require v1, reject unknown root/item fields and cap items at 1000.");
}

requireTokens(files.index, sources.index, [
  'export * from "./runner.js"',
  'export * from "./inspection.js"',
  'export * from "./path-policy.js"',
]);
requireTokens(files.types, sources.types, [
  'BATCH_CONTRACT_VERSION = "1.0"',
  "MAX_BATCH_ITEMS = 1_000",
  "DEFAULT_STALE_LOCK_MS = 6 * 60 * 60 * 1_000",
  'type BatchFailureMode = "continue" | "fail-fast"',
  "type BatchOutputReceipt",
  "type BatchOperationHandler",
  "type BatchJobState",
]);
requireTokens(files.errors, sources.errors, [
  '"BATCH_MANIFEST_CHANGED"',
  '"BATCH_JOB_LOCKED"',
  '"BATCH_ITEM_REVISION_MISMATCH"',
  '"BATCH_COMPLETED_OUTPUT_INVALID"',
  '"BATCH_CANCELLED"',
  '"BATCH_ROOT_INVALID"',
  '"BATCH_PATH_OUTSIDE_ROOT"',
  '"BATCH_INPUT_NOT_FOUND"',
  '"BATCH_OUTPUT_PARENT_INVALID"',
  '"BATCH_PATH_COLLISION"',
]);
requireTokens(files.manifest, sources.manifest, [
  "validateBatchManifest",
  "canonicalBatchManifest",
  "batchManifestSha256",
  '"$schema"',
  "Batch item identifiers must be unique",
  "Object.keys(source)",
  ".sort()",
]);
requireTokens(files.pathPolicy, sources.pathPolicy, [
  "canonicalBatchRoot",
  "createBatchPathPolicy",
  "await realpath(absolute)",
  "nearestExistingDirectory",
  "resolveInputFile",
  "resolveOutputPath",
  "information.isSymbolicLink()",
  "A durable batch output path may not be a symbolic link",
  "BATCH_PATH_OUTSIDE_ROOT",
  "BATCH_OUTPUT_PARENT_INVALID",
  "BATCH_PATH_COLLISION",
]);
requireTokens(files.store, sources.store, [
  'path.join(resolvedRoot, ".evavo-vector-jobs")',
  'path.join(jobDirectory, "state.json")',
  'path.join(jobDirectory, "events.ndjson")',
  'path.join(jobDirectory, "runner.lock")',
  'open(paths.lockPath, "wx", 0o600)',
  "await rename(temporaryPath, statePath)",
  "await rename(paths.lockPath, stalePath)",
  "verifyBatchOutputReceipts",
]);
requireTokens(files.runner, sources.runner, [
  "runDurableBatch",
  "canonicalBatchRoot",
  "recoverInterruptedItems",
  "validateDescriptor",
  "validateResult",
  "item-reused",
  "BATCH_ITEM_REVISION_MISMATCH",
  "BATCH_COMPLETED_OUTPUT_INVALID",
  'state.failureMode === "fail-fast"',
  "releaseBatchLock(lock)",
]);
requireTokens(files.inspection, sources.inspection, [
  "inspectDurableBatch",
  "canonicalBatchRoot(options.rootPath)",
  "percentComplete",
  "recentEvents",
  "lock",
]);
requireTokens(files.manifestTests, sources.manifestTests, [
  "canonicalizes equivalent manifests",
  "accepts the schema annotation",
  "duplicate IDs",
  "unsafe operation names",
]);
requireTokens(files.pathTests, sources.pathTests, [
  "resolves canonical inputs",
  "rejects lexical paths outside",
  "symlink escapes",
  "output path that is itself a symlink",
  "BATCH_PATH_OUTSIDE_ROOT",
  "BATCH_OUTPUT_PARENT_INVALID",
]);
requireTokens(files.runnerTests, sources.runnerTests, [
  "reuses verified completed items",
  "output receipt no longer verifies",
  "changed manifest",
  "continue mode and stops in fail-fast mode",
  "recovers an interrupted running item",
  "enforces exclusive job locks",
]);
requireTokens(files.operations, sources.operations, [
  '"trace-raster"',
  '"optimise-svg"',
  '"animate-svg"',
  '"export-lottie"',
  '"package-dotlottie"',
  "createVectorBatchOperationRegistry",
  "createBatchPathPolicy",
  "policy.resolveInputFile",
  "policy.resolveOutputPath",
  "policy.assertDistinct",
  "canonicalRoot: policy.root",
  "traceRaster",
  "optimiseSvg",
  "createAnimatedSvg",
  "createLottieFromSvgMotion",
  "createDotLottiePackage",
  "commitNewOutputFiles",
  "must stay inside the batch root",
  "type RasterDeliveryProfile",
  "const DELIVERY_PROFILES",
  '"deliveryProfile"',
  '"stableIdPrefix"',
  "function deliveryOptions",
  "stableIdPrefix is available only for editable or motion delivery profiles",
  "const delivery = deliveryOptions(context)",
  "...delivery",
  "optimiseSvg(source, delivery)",
  "deliveryProfile: result.evidence.output.deliveryProfile",
  "deliveryProfile: result.evidence.profile",
  "stablePathIdCount",
  "rootDimensions",
  "safetyRollbackApplied",
]);
requireTokens(files.cli, sources.cli, [
  "EVAVO Vector Studio durable batch CLI",
  '"run"',
  '"inspect"',
  '"capabilities"',
  "runDurableBatch",
  "inspectDurableBatch",
  "createVectorBatchOperationRegistry",
  "completedOutputReverification: true",
  'approval: "human-review-required"',
  "delivery: Object.freeze({",
  'profiles: Object.freeze(["editable", "web", "motion", "print"])',
  'stableIdProfiles: Object.freeze(["editable", "motion"])',
  "alphaAwareRasterAnalysis: true",
  "immutableManifestRevision: true",
  "deliveryEvidenceRetained: true",
]);
requireTokens(files.cliTests, sources.cliTests, [
  "runs, inspects and resumes",
  "rejects input revision drift",
  "BATCH_ITEM_REVISION_MISMATCH",
  'deliveryProfile: "motion"',
  'stableIdPrefix: "batch-mark"',
  'id=\\"batch-mark-0001\\"',
  "rejects a stable ID prefix for a compact web delivery batch",
  "deliveryEvidenceRetained",
  'deepEqual(contract.delivery?.profiles, ["editable", "web", "motion", "print"])',
]);
requireTokens(files.jobsIndex, sources.jobsIndex, [
  'from "@evavo/vector-cli/batch-operations"',
  "createVectorBatchOperationRegistry",
]);
requireTokens(files.docs, sources.docs, [
  "schemas/batch-v1.schema.json",
  "vector:batch:run",
  "vector:batch:inspect",
  "trace-raster",
  "package-dotlottie",
  "deliveryProfile",
  "stableIdPrefix",
  "editable",
  "motion",
  "BATCH_MANIFEST_CHANGED",
  "BATCH_ITEM_REVISION_MISMATCH",
  "BATCH_COMPLETED_OUTPUT_INVALID",
  "crash-resumable local runner",
  "not yet a hosted background queue",
]);
requireTokens(files.deliveryDocs, sources.deliveryDocs, [
  "Editable master",
  "Web compact",
  "Motion ready",
  "Print safe",
  "Durable batch manifests",
]);
requireTokens(files.pathDocs, sources.pathDocs, [
  "canonical execution root",
  "input symlink",
  "output-directory symlink",
  "existing regular output",
  "BATCH_PATH_OUTSIDE_ROOT",
  "BATCH_OUTPUT_PARENT_INVALID",
  "hostile local account",
]);
requireTokens(files.architecture, sources.architecture, [
  "Durable batch",
  "canonical",
]);
requireTokens(files.readme, sources.readme, [
  "vector:batch:run",
  "resumable",
]);
requireTokens(files.workflow, sources.workflow, [
  "Verify durable batch contract",
  "node scripts/check-batch-contract.mjs",
]);

forbidTokens(files.runner, sources.runner, [
  'approval: "approved"',
  "eval(",
  "new Function(",
]);
forbidTokens(files.operations, sources.operations, [
  'approval: "approved"',
  "eval(",
  "new Function(",
]);
forbidTokens(files.pathPolicy, sources.pathPolicy, [
  "eval(",
  "new Function(",
]);

if (errors.length > 0) {
  process.stderr.write(`${JSON.stringify({
    check: "evavo-vector-studio-durable-batch-contract",
    ok: false,
    batchContractVersion: "1.0",
    errors,
  }, null, 2)}\n`);
  process.exit(1);
}

process.stdout.write(`${JSON.stringify({
  check: "evavo-vector-studio-durable-batch-contract",
  ok: true,
  batchContractVersion: "1.0",
  operations: [
    "trace-raster",
    "optimise-svg",
    "animate-svg",
    "export-lottie",
    "package-dotlottie",
  ],
  deliveryProfiles: ["editable", "web", "motion", "print"],
  stableIdProfiles: ["editable", "motion"],
  alphaAwareRasterAnalysis: true,
  sharedWorkerRegistry: true,
  durability: {
    manifestImmutable: true,
    canonicalRoot: true,
    symlinkEscapesRejected: true,
    outputSymlinksRejected: true,
    inputRevisionVerified: true,
    completedOutputsReverified: true,
    interruptedItemsResumable: true,
    exclusiveLock: true,
    staleLockRecovery: true,
    appendOnlyEvents: true,
  },
  hostedBackgroundQueue: false,
  checkedFiles: [...checkedFiles].sort(),
}, null, 2)}\n`);
