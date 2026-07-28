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
    if (!source.includes(token)) fail(`${relativePath} is missing motion contract token: ${token}`);
  }
}

function forbidTokens(relativePath, source, tokens) {
  for (const token of tokens) {
    if (source.includes(token)) fail(`${relativePath} contains prohibited motion contract token: ${token}`);
  }
}

const rootPackage = await readJson("package.json");
const motionPackage = await readJson("packages/motion-engine/package.json");
const cliPackage = await readJson("packages/cli/package.json");
const schema = await readJson("schemas/motion-v1.schema.json");
const fixture = await readJson("fixtures/motion/gentle-entrance.motion.json");
const files = {
  types: "packages/motion-engine/src/types.ts",
  validation: "packages/motion-engine/src/validation.ts",
  animatedSvg: "packages/motion-engine/src/animated-svg.ts",
  errors: "packages/motion-engine/src/errors.ts",
  tests: "packages/motion-engine/src/animated-svg.test.ts",
  cli: "packages/cli/src/index.ts",
  transaction: "packages/cli/src/output-transaction.ts",
  transactionTests: "packages/cli/src/output-transaction.test.ts",
  fixtureSource: "fixtures/motion/gentle-entrance.source.svg",
  docs: "docs/MOTION.md",
};
const sources = Object.fromEntries(
  await Promise.all(Object.entries(files).map(async ([key, relativePath]) => [key, await read(relativePath)])),
);

if (motionPackage?.version !== rootPackage?.version) {
  fail(`Motion package version ${String(motionPackage?.version)} does not match root version ${String(rootPackage?.version)}`);
}
if (motionPackage?.dependencies?.["@evavo/vector-core"] !== "workspace:*") {
  fail("packages/motion-engine must depend on @evavo/vector-core through the workspace.");
}
if (cliPackage?.dependencies?.["@evavo/motion-engine"] !== "workspace:*") {
  fail("packages/cli must depend on @evavo/motion-engine through the workspace.");
}
if (cliPackage?.scripts?.test !== "tsc -p tsconfig.json && node --test dist/*.test.js") {
  fail("packages/cli test must compile and execute the output transaction tests.");
}

for (const [script, expected] of Object.entries({
  "motion:check": "node scripts/check-motion-contract.mjs",
  "vector:motion:validate": "pnpm vector:build && node packages/cli/dist/index.js motion:validate",
  "vector:motion:inspect": "pnpm vector:build && node packages/cli/dist/index.js motion:inspect",
  "vector:animate-svg": "pnpm vector:build && node packages/cli/dist/index.js animate-svg",
})) {
  if (rootPackage?.scripts?.[script] !== expected) fail(`package.json script ${script} must equal: ${expected}`);
}
if (!String(rootPackage?.scripts?.["build:packages"] ?? "").includes("--filter=@evavo/motion-engine")) {
  fail("package.json build:packages must build @evavo/motion-engine.");
}
if (!String(rootPackage?.scripts?.check ?? "").includes("pnpm motion:check")) {
  fail("package.json check must include the dependency-free motion contract gate.");
}

requireTokens(files.types, sources.types, [
  'MOTION_CONTRACT_VERSION = "1.0"',
  "$schema?: string",
  "type NormalizedMotionTrack",
  'approval: "review-required"',
  "reducedMotionFallback: true",
  "deterministicOutput: true",
]);
forbidTokens(files.types, sources.types, [
  "animatesOpacity: boolean",
  "animatesTransform: boolean",
]);
requireTokens(files.validation, sources.validation, [
  'assertKnownKeys(source, ROOT_KEYS, "motion")',
  '"$schema"',
  "keyframe offsets must be strictly increasing",
  "Each motion target may appear in only one track",
  "does not change opacity or transform values",
  "unknownKeys",
  "keyframes,",
]);
requireTokens(files.animatedSvg, sources.animatedSvg, [
  "type PreparedMotionTrack",
  "function prepareTrack",
  'data-evavo-motion-contract',
  "@keyframes",
  "@media(prefers-reduced-motion:reduce)",
  "MOTION_SOURCE_ALREADY_ANIMATED",
  "MOTION_TARGET_BASE_TRANSFORM_UNSUPPORTED",
  "MOTION_HUMAN_REVIEW_REQUIRED",
  'scriptsAdded: false',
  'externalReferencesAdded: false',
  'approval: "review-required"',
]);
requireTokens(files.errors, sources.errors, [
  '"MOTION_SPEC_INVALID"',
  '"MOTION_TARGET_MISSING"',
  '"MOTION_TARGET_BASE_TRANSFORM_UNSUPPORTED"',
]);
requireTokens(files.tests, sources.tests, [
  "deterministic script-free CSS motion",
  "keeps normalized motion plans schema-compatible and reusable",
  "assert.doesNotMatch(serialized, /animatesOpacity|animatesTransform/)",
  "assert.deepEqual(validateAnimatedSvgMotionSpec(JSON.parse(serialized)), normalized)",
  "rejects duplicate target tracks, no-op motion and unknown properties",
  "MOTION_SOURCE_ALREADY_ANIMATED",
  "MOTION_TARGET_BASE_TRANSFORM_UNSUPPORTED",
  "MOTION_REDUCED_FALLBACK_MISSING",
]);
requireTokens(files.cli, sources.cli, [
  '"motion:validate"',
  '"motion:inspect"',
  '"animate-svg"',
  'requiredOption(args, "--motion")',
  'option(args, "--evidence-out")',
  "createAnimatedSvg(source, motionPlan)",
  'animatedSvgAvailable: true',
  'lottieAvailable: false',
  "commitNewOutputFiles",
]);
requireTokens(files.transaction, sources.transaction, [
  "await link(item.temporaryPath, item.targetPath)",
  'flag: "wx"',
  "...committed.map((item) => rm(item.targetPath, { force: true }))",
  'createHash("sha256")',
]);
requireTokens(files.transactionTests, sources.transactionTests, [
  "does not overwrite and rolls back",
  "commits new multi-file output with SHA-256 receipts",
]);
requireTokens(files.docs, sources.docs, [
  "schemas/motion-v1.schema.json",
  "prefers-reduced-motion",
  "motion:validate",
  "animate-svg",
  "new-file-only",
  "The JSON result includes the normalized plan",
  "Lottie remains unavailable",
]);
forbidTokens(files.animatedSvg, sources.animatedSvg, ["<script>", "eval(", "new Function("]);
forbidTokens(files.cli, sources.cli, ["lottieAvailable: true"]);

if (schema?.$schema !== "https://json-schema.org/draft/2020-12/schema") {
  fail(`Motion schema must use JSON Schema 2020-12; received ${String(schema?.$schema)}`);
}
if (schema?.$id !== "https://evavo.com.au/schemas/vector-studio/motion-v1.schema.json") {
  fail(`Unexpected motion schema ID: ${String(schema?.$id)}`);
}
if (schema?.additionalProperties !== false || schema?.properties?.version?.const !== "1.0") {
  fail("Motion schema must reject additional root properties and require version 1.0.");
}
if (!schema?.properties?.$schema || schema?.$defs?.track?.additionalProperties !== false || schema?.$defs?.keyframe?.additionalProperties !== false) {
  fail("Motion schema must explicitly define $schema and reject unknown track and keyframe properties.");
}
if (fixture?.version !== "1.0" || !Array.isArray(fixture?.tracks) || fixture.tracks.length < 1) {
  fail("Motion fixture must contain a v1 plan with at least one track.");
}

const sourceIds = new Map();
for (const match of sources.fixtureSource.matchAll(/\bid\s*=\s*(["'])(.*?)\1/g)) {
  const id = match[2];
  sourceIds.set(id, (sourceIds.get(id) ?? 0) + 1);
}
for (const track of fixture?.tracks ?? []) {
  const targetId = track?.targetId;
  if (typeof targetId !== "string" || sourceIds.get(targetId) !== 1) {
    fail(`Motion fixture target ${String(targetId)} must resolve exactly once in the source fixture.`);
  }
  const frames = track?.keyframes;
  if (!Array.isArray(frames) || frames[0]?.offset !== 0 || frames.at(-1)?.offset !== 1) {
    fail(`Motion fixture track ${String(targetId)} must begin at offset 0 and end at offset 1.`);
  }
}

if (errors.length > 0) {
  process.stderr.write(`${JSON.stringify({
    check: "evavo-vector-studio-motion-contract",
    ok: false,
    motionContractVersion: "1.0",
    errors,
  }, null, 2)}\n`);
  process.exit(1);
}

process.stdout.write(`${JSON.stringify({
  check: "evavo-vector-studio-motion-contract",
  ok: true,
  motionContractVersion: "1.0",
  supportedProperties: ["opacity", "translateX", "translateY", "scale", "rotateDeg"],
  normalizedPlansReusable: true,
  checkedFiles: [...checkedFiles].sort(),
}, null, 2)}\n`);
