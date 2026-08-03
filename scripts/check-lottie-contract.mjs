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
    if (!source.includes(token)) errors.push(`${relativePath} is missing Lottie contract token: ${token}`);
  }
}

function forbidTokens(relativePath, source, tokens) {
  for (const token of tokens) {
    if (source.includes(token)) errors.push(`${relativePath} contains prohibited Lottie contract token: ${token}`);
  }
}

const rootPackage = await readJson("package.json");
const lottiePackage = await readJson("packages/lottie-engine/package.json");
const cliPackage = await readJson("packages/cli/package.json");
const files = {
  index: "packages/lottie-engine/src/index.ts",
  errors: "packages/lottie-engine/src/errors.ts",
  types: "packages/lottie-engine/src/types.ts",
  pathData: "packages/lottie-engine/src/path-data.ts",
  source: "packages/lottie-engine/src/svg-source.ts",
  generator: "packages/lottie-engine/src/generator.ts",
  inspection: "packages/lottie-engine/src/inspection.ts",
  pathTests: "packages/lottie-engine/src/path-data.test.ts",
  sourceTests: "packages/lottie-engine/src/svg-source.test.ts",
  generatorTests: "packages/lottie-engine/src/generator.test.ts",
  cli: "packages/cli/src/index.ts",
  docs: "docs/LOTTIE.md",
  cliDocs: "docs/CLI.md",
  workflow: ".github/workflows/quality.yml",
};
const sources = Object.fromEntries(
  await Promise.all(Object.entries(files).map(async ([key, relativePath]) => [key, await read(relativePath)])),
);

if (lottiePackage?.version !== rootPackage?.version) {
  errors.push(`Lottie package version ${String(lottiePackage?.version)} does not match root version ${String(rootPackage?.version)}`);
}
if (lottiePackage?.dependencies?.["@evavo/motion-engine"] !== "workspace:*") {
  errors.push("packages/lottie-engine must depend on @evavo/motion-engine through the workspace.");
}
if (lottiePackage?.dependencies?.["@evavo/vector-core"] !== "workspace:*") {
  errors.push("packages/lottie-engine must depend on @evavo/vector-core through the workspace.");
}
if (lottiePackage?.scripts?.test !== "node --test dist/*.test.js") {
  errors.push("packages/lottie-engine test must compile and execute its generated tests.");
}
if (cliPackage?.dependencies?.["@evavo/lottie-engine"] !== "workspace:*") {
  errors.push("packages/cli must depend on @evavo/lottie-engine through the workspace.");
}
if (rootPackage?.scripts?.["lottie:check"] !== "node scripts/check-lottie-contract.mjs") {
  errors.push("package.json must expose lottie:check through the dependency-free Lottie gate.");
}
if (rootPackage?.scripts?.["vector:lottie:inspect"] !== "pnpm vector:build && node packages/cli/dist/index.js lottie:inspect") {
  errors.push("package.json must expose vector:lottie:inspect through the governed CLI.");
}
if (rootPackage?.scripts?.["vector:lottie:export"] !== "pnpm vector:build && node packages/cli/dist/index.js lottie:export") {
  errors.push("package.json must expose vector:lottie:export through the governed CLI.");
}
if (!String(rootPackage?.scripts?.["build:packages"] ?? "").includes("--filter=@evavo/lottie-engine")) {
  errors.push("package.json build:packages must build @evavo/lottie-engine.");
}
if (!String(rootPackage?.scripts?.check ?? "").includes("pnpm lottie:check")) {
  errors.push("package.json check must include pnpm lottie:check before dependency-backed gates.");
}

requireTokens(files.index, sources.index, [
  'export * from "./generator.js"',
  'export * from "./inspection.js"',
  'export * from "./path-data.js"',
  'export { prepareSvgSourceForLottie } from "./svg-source.js"',
]);
requireTokens(files.errors, sources.errors, [
  '"LOTTIE_SOURCE_UNSUPPORTED"',
  '"LOTTIE_MOTION_UNSUPPORTED"',
  '"LOTTIE_OUTPUT_INVALID"',
]);
requireTokens(files.types, sources.types, [
  'LOTTIE_CONTRACT_VERSION = "1.0"',
  'playerRenderValidation: "not-yet-performed"',
  'dotLottiePackaging: "not-yet-available"',
  'approval: "review-required"',
]);
requireTokens(files.pathData, sources.pathData, [
  "parseSvgPathDataToLottie",
  "arcAsCubics",
  "quadraticAsCubic",
  'const COMMAND = /^[AaCcHhLlMmQqSsTtVvZz]$/',
  '"LOTTIE_PATH_INVALID"',
  "const upper: string = command!.toUpperCase()",
  "const control: Point =",
]);
requireTokens(files.source, sources.source, [
  "prepareSvgSourceForLottie",
  'export type { LottiePathBounds } from "./path-data.js"',
  "SVG transforms must be flattened into path geometry",
  "Group opacity cannot be flattened without changing overlap compositing",
  "Dashed strokes are not supported by Lottie export v1",
  '"LOTTIE_TARGET_OVERLAP"',
]);
requireTokens(files.generator, sources.generator, [
  "createLottieFromSvgMotion",
  "validateAnimatedSvgMotionSpec",
  "validateMotionSubset",
  "ver: 10001",
  "shapeLayersOnly: true",
  'playerRenderValidation: "not-yet-performed"',
  'dotLottiePackaging: "not-yet-available"',
  'approval: "review-required"',
  "LOTTIE_PLAYER_RENDER_VALIDATION_REQUIRED",
  "LOTTIE_REDUCED_MOTION_NOT_EMBEDDED",
]);
requireTokens(files.inspection, sources.inspection, [
  "inspectLottie",
  "LOTTIE_GROUP_TRANSFORM_MISSING",
  "LOTTIE_EXPRESSIONS_UNSUPPORTED",
  "LOTTIE_LAYER_UNSUPPORTED",
  "LOTTIE_PATH_ANIMATION_UNSUPPORTED",
]);
requireTokens(files.pathTests, sources.pathTests, [
  "converts relative closed geometry",
  "elliptical arc commands",
  "exact cubic extrema",
  "rejects malformed path tokens",
]);
requireTokens(files.sourceTests, sources.sourceTests, [
  "extracts source-ordered static and animated path render units",
  "rejects unflattened transforms",
  "rejects missing and overlapping motion targets",
]);
requireTokens(files.generatorTests, sources.generatorTests, [
  "creates deterministic shape-layer Lottie JSON with audited evidence",
  "structural inspection rejects expressions",
  "rejects playback and SVG features outside the governed v1 subset",
  'first.animation.ver, 10001',
]);
requireTokens(files.cli, sources.cli, [
  '"lottie:inspect"',
  '"lottie:export"',
  'requiredOption(args, "--motion")',
  'parseIntegerOption(args, "--frame-rate")',
  'parseIntegerOption(args, "--precision")',
  "createLottieFromSvgMotion(source, motionPlan, options)",
  "inspectLottie(source)",
  'mimeType: "video/lottie+json"',
  "commitNewOutputFiles",
  'lottieJsonExportAvailable: true',
  'lottiePlayerRenderValidationAvailable: false',
  'dotLottieAvailable: false',
]);
requireTokens(files.docs, sources.docs, [
  "@evavo/lottie-engine",
  "pnpm vector:lottie:export",
  "pnpm vector:lottie:inspect",
  "playerRenderValidation: not-yet-performed",
  "dotLottiePackaging: not-yet-available",
  "Production availability will not be claimed",
  "reverse stack order",
]);
requireTokens(files.cliDocs, sources.cliDocs, [
  "Governed Lottie JSON",
  "vector:lottie:export",
  "vector:lottie:inspect",
  "lottiePlayerRenderValidationAvailable: false",
  "dotLottieAvailable: false",
]);
requireTokens(files.workflow, sources.workflow, [
  "Verify Lottie core contract",
  "node scripts/check-lottie-contract.mjs",
]);

forbidTokens(files.generator, sources.generator, [
  'playerRenderValidation: "passed"',
  'dotLottiePackaging: "available"',
  'approval: "approved"',
  "eval(",
  "new Function(",
]);
forbidTokens(files.inspection, sources.inspection, ["eval(", "new Function("]);
forbidTokens(files.cli, sources.cli, [
  'lottiePlayerRenderValidationAvailable: true',
  'dotLottieAvailable: true',
]);

if (errors.length > 0) {
  process.stderr.write(`${JSON.stringify({
    check: "evavo-vector-studio-lottie-core-contract",
    ok: false,
    lottieContractVersion: "1.0",
    errors,
  }, null, 2)}\n`);
  process.exit(1);
}

process.stdout.write(`${JSON.stringify({
  check: "evavo-vector-studio-lottie-core-contract",
  ok: true,
  lottieContractVersion: "1.0",
  surfaces: ["core", "cli"],
  supportedSubset: [
    "path geometry",
    "solid fill",
    "solid stroke",
    "opacity",
    "translation",
    "uniform scale",
    "rotation",
  ],
  compatibility: {
    structuralInspection: "passed-by-contract",
    playerRenderValidation: "not-yet-performed",
    dotLottiePackaging: "not-yet-available",
  },
  checkedFiles: [...checkedFiles].sort(),
}, null, 2)}\n`);
