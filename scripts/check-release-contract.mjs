import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const errors = [];
const checkedFiles = new Set();

function fail(message) {
  errors.push(message);
}

async function read(relativePath) {
  checkedFiles.add(relativePath);
  try {
    return (await fs.readFile(path.join(root, relativePath), "utf8")).replace(/^\uFEFF/, "");
  } catch (error) {
    fail(`Missing or unreadable file: ${relativePath} (${error instanceof Error ? error.message : String(error)})`);
    return "";
  }
}

async function readJson(relativePath) {
  const source = await read(relativePath);
  if (!source) return null;
  try {
    return JSON.parse(source);
  } catch (error) {
    fail(`Invalid JSON: ${relativePath} (${error instanceof Error ? error.message : String(error)})`);
    return null;
  }
}

function requireTokens(relativePath, source, tokens) {
  for (const token of tokens) {
    if (!source.includes(token)) fail(`${relativePath} is missing required contract token: ${token}`);
  }
}

function forbidTokens(relativePath, source, tokens) {
  for (const token of tokens) {
    if (source.includes(token)) fail(`${relativePath} contains stale contract token: ${token}`);
  }
}

const rootPackage = await readJson("package.json");
const packagePaths = [
  "packages/vector-core/package.json",
  "packages/raster-engine/package.json",
  "packages/motion-engine/package.json",
  "packages/lottie-engine/package.json",
  "packages/job-engine/package.json",
  "packages/job-control/package.json",
  "packages/worker-engine/package.json",
  "packages/worker-protocol/package.json",
  "packages/worker-client/package.json",
  "packages/vector-jobs/package.json",
  "workers/local-worker/package.json",
  "workers/http-worker/package.json",
  "packages/cli/package.json",
  "packages/mcp/package.json",
  "apps/web/package.json",
];
const packageDocuments = await Promise.all(
  packagePaths.map(async (relativePath) => [relativePath, await readJson(relativePath)]),
);

const releaseVersion = rootPackage?.version;
if (typeof releaseVersion !== "string" || !/^\d+\.\d+\.\d+$/.test(releaseVersion)) {
  fail(`Root package version must be a plain semantic version; received ${String(releaseVersion)}`);
}
if (rootPackage?.packageManager !== "pnpm@10.14.0") {
  fail(`Root packageManager must remain pnpm@10.14.0; received ${String(rootPackage?.packageManager)}`);
}
for (const [relativePath, document] of packageDocuments) {
  if (document?.version !== releaseVersion) {
    fail(`${relativePath} version ${String(document?.version)} does not match root version ${String(releaseVersion)}`);
  }
}

if (rootPackage?.scripts?.["contract:check"] !== "node scripts/check-release-contract.mjs") {
  fail("package.json must expose contract:check through the dependency-free release gate.");
}
if (!String(rootPackage?.scripts?.check ?? "").startsWith("pnpm contract:check &&")) {
  fail("package.json check must execute contract:check before dependency-backed gates.");
}

const files = {
  coreIndex: "packages/vector-core/src/index.ts",
  verifier: "packages/vector-core/src/difference-artifact-verification.ts",
  types: "packages/raster-engine/src/types.ts",
  engine: "packages/raster-engine/src/engine.ts",
  difference: "packages/raster-engine/src/difference.ts",
  inputPolicy: "packages/raster-engine/src/input-policy.ts",
  rasterIndex: "packages/raster-engine/src/index.ts",
  cli: "packages/cli/src/index.ts",
  api: "apps/web/app/api/v1/trace/route.ts",
  inputPolicyApi: "apps/web/app/api/v1/input-policy/route.ts",
  workspace: "apps/web/app/components/TraceWorkspace.tsx",
  workspaceStyles: "apps/web/app/components/TraceWorkspace.module.css",
  page: "apps/web/app/page.tsx",
  readme: "README.md",
  cliDocs: "docs/CLI.md",
  apiDocs: "docs/API.md",
  architecture: "docs/ARCHITECTURE.md",
  qualityDocs: "docs/QUALITY-EVIDENCE.md",
  inputSafetyDocs: "docs/INPUT-SAFETY.md",
};
const sources = Object.fromEntries(
  await Promise.all(Object.entries(files).map(async ([key, relativePath]) => [key, await read(relativePath)])),
);

requireTokens(files.coreIndex, sources.coreIndex, [
  'export * from "./difference-artifact-verification.js"',
  'export * from "./svg-topology.js"',
]);

requireTokens(files.verifier, sources.verifier, [
  "DifferenceArtifactVerificationError",
  "verifyDifferenceArtifactPayload",
  '"DIFFERENCE_CANDIDATE_MISMATCH"',
  '"DIFFERENCE_PNG_INVALID"',
  'cryptoApi.subtle.digest("SHA-256", bytes)',
]);

requireTokens(files.types, sources.types, [
  'contractVersion: "1.4"',
  'adapterVersion: "0.4.0"',
  "includeDifferenceArtifact?: boolean",
  "differenceMaxDimension?: number",
  "differenceArtifact: DifferenceArtifactEvidence | null",
  'differenceArtifact: "available" | "not-requested"',
  "differencePng?: Uint8Array",
]);

requireTokens(files.engine, sources.engine, [
  'import { createDifferenceArtifact } from "./difference.js"',
  'contractVersion: "1.4"',
  'adapterVersion: "0.4.0"',
  "options.includeDifferenceArtifact",
  "differenceArtifact?.evidence ?? null",
  'differenceArtifact: differenceArtifact ? "available" : "not-requested"',
  "differencePng: differenceArtifact.png",
]);

requireTokens(files.difference, sources.difference, [
  "DEFAULT_DIFFERENCE_MAX_DIMENSION",
  "MAX_DIFFERENCE_DIMENSION",
  'kind: "visual-difference-heatmap"',
  'colourMap: "white-to-red"',
  'sourceSampling: "bilinear"',
  "selectedCandidateId",
  'createHash("sha256")',
]);

requireTokens(files.inputPolicy, sources.inputPolicy, [
  'mode: "one-static-image-per-trace"',
  '"multi-frame-apng"',
  '"animated-gif"',
  '"animated-webp"',
  '"jpeg-mpo"',
  '"multi-page-tiff"',
]);

requireTokens(files.rasterIndex, sources.rasterIndex, [
  'export * from "./difference.js"',
  'export * from "./input-policy.js"',
]);

requireTokens(files.cli, sources.cli, [
  `const VERSION = "${releaseVersion}"`,
  'contractVersion: "1.4"',
  'motionContractVersion: "1.0"',
  'lottieContractVersion: "1.0"',
  '"--diff-out"',
  '"--difference-max-dimension"',
  "VECTOR_OUTPUT_PATH_COLLISION",
  "VECTOR_DIFFERENCE_ARTIFACT_MISSING",
  "commitNewOutputFiles",
  'existingOutputsOverwritten: false',
  'animatedSvgAvailable: true',
  '"lottie:inspect"',
  '"lottie:export"',
  "createLottieFromSvgMotion",
  "inspectLottie",
  'lottieJsonExportAvailable: true',
  'lottiePlayerRenderValidationAvailable: false',
  'dotLottieAvailable: false',
]);

requireTokens(files.api, sources.api, [
  'contractVersion: "1.4"',
  'booleanField(form, "includeDifference", false)',
  'integerField(form, "differenceMaxDimension")',
  'includeDifferenceArtifact: includeDifference',
  'encoding: "base64" as const',
  'Buffer.from(differencePng).toString("base64")',
  'format === "svg" && includeDifference',
]);

requireTokens(files.inputPolicyApi, sources.inputPolicyApi, [
  "RASTER_INPUT_POLICY",
  'errorCode: "RASTER_MULTI_IMAGE_UNSUPPORTED"',
  "maxDecodedPixels: DEFAULT_MAX_PIXELS",
]);

requireTokens(files.workspace, sources.workspace, [
  "verifyDifferenceArtifactPayload,",
  "type DifferenceArtifactPayload",
  'form.set("includeDifference", String(includeDifference))',
  'form.set("differenceMaxDimension", String(differenceMaxDimension))',
  "await verifyDifferenceArtifactPayload(",
  "White-to-red visual difference heatmap",
  "Download difference PNG",
  "Animated containers and multi-page TIFF are rejected before decoding",
]);

requireTokens(files.workspaceStyles, sources.workspaceStyles, [
  ".differenceFigure",
  ".differenceChecker",
  ".differenceLegend",
  ".differenceEvidence",
  ".downloadGroup",
]);

requireTokens(files.page, sources.page, [
  "optional difference PNG evidence",
  'includeDifference=true',
  'differenceMaxDimension=512',
]);

for (const [relativePath, source, tokens] of [
  [files.readme, sources.readme, ["visual-difference heatmap", "--diff-out", "base64 difference PNG", "multi-page TIFF"]],
  [files.cliDocs, sources.cliDocs, ["Difference PNG artefacts", "--difference-max-dimension", "selected candidate ID"]],
  [files.apiDocs, sources.apiDocs, ["includeDifference", "differenceMaxDimension", '"encoding": "base64"']],
  [files.architecture, sources.architecture, ["Selected-candidate difference evidence", "SHA-256", "Production auto-approval"]],
  [files.qualityDocs, sources.qualityDocs, ["Topology and editability evidence", "Difference-image evidence", "Production approved"]],
  [files.inputSafetyDocs, sources.inputSafetyDocs, ["one static raster reconstruction per trace", "RASTER_MULTI_IMAGE_UNSUPPORTED", "multi-page TIFF"]],
]) {
  requireTokens(relativePath, source, tokens);
}

const operationalFiles = [
  [files.types, sources.types],
  [files.engine, sources.engine],
  [files.cli, sources.cli],
  [files.api, sources.api],
  [files.workspace, sources.workspace],
];
for (const [relativePath, source] of operationalFiles) {
  forbidTokens(relativePath, source, [
    'contractVersion: "1.3"',
    'adapterVersion: "0.3.1"',
    'const VERSION = "0.2.0"',
    'const VERSION = "0.3.0"',
    "withheld-pending-render-comparison",
  ]);
}

if (errors.length > 0) {
  process.stderr.write(`${JSON.stringify({
    check: "evavo-vector-studio-release-contract",
    ok: false,
    releaseVersion,
    contractVersion: "1.4",
    errors,
  }, null, 2)}\n`);
  process.exit(1);
}

process.stdout.write(`${JSON.stringify({
  check: "evavo-vector-studio-release-contract",
  ok: true,
  releaseVersion,
  contractVersion: "1.4",
  checkedPackages: packagePaths,
  checkedFiles: [...checkedFiles].sort(),
}, null, 2)}\n`);
