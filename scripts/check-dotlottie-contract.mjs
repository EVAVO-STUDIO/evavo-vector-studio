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
    if (!source.includes(token)) errors.push(`${relativePath} is missing dotLottie contract token: ${token}`);
  }
}

function forbidTokens(relativePath, source, tokens) {
  for (const token of tokens) {
    if (source.includes(token)) errors.push(`${relativePath} contains prohibited dotLottie contract token: ${token}`);
  }
}

const files = {
  rootPackage: "package.json",
  lottiePackage: "packages/lottie-engine/package.json",
  cliPackage: "packages/cli/package.json",
  index: "packages/lottie-engine/src/index.ts",
  errors: "packages/lottie-engine/src/errors.ts",
  engine: "packages/lottie-engine/src/dotlottie.ts",
  tests: "packages/lottie-engine/src/dotlottie.test.ts",
  cli: "packages/cli/src/dotlottie-cli.ts",
  cliTests: "packages/cli/src/dotlottie-cli.test.ts",
  docs: "docs/DOTLOTTIE.md",
  lottieDocs: "docs/LOTTIE.md",
  readme: "README.md",
  workflow: ".github/workflows/quality.yml",
};
const sources = Object.fromEntries(
  await Promise.all(Object.entries(files).map(async ([key, relativePath]) => [key, await read(relativePath)])),
);
const rootPackage = await readJson(files.rootPackage);
const lottiePackage = await readJson(files.lottiePackage);
const cliPackage = await readJson(files.cliPackage);

if (lottiePackage?.dependencies?.fflate !== "0.8.3") {
  errors.push("packages/lottie-engine must pin fflate to the reviewed 0.8.3 deterministic ZIP boundary.");
}
if (cliPackage?.bin?.["evavo-dotlottie"] !== "./dist/dotlottie-cli.js") {
  errors.push("packages/cli must expose the evavo-dotlottie binary.");
}
for (const [script, expected] of Object.entries({
  "dotlottie:check": "node scripts/check-dotlottie-contract.mjs",
  "vector:dotlottie:package": "pnpm vector:build && node packages/cli/dist/dotlottie-cli.js package",
  "vector:dotlottie:inspect": "pnpm vector:build && node packages/cli/dist/dotlottie-cli.js inspect",
  "vector:dotlottie:capabilities": "pnpm vector:build && node packages/cli/dist/dotlottie-cli.js capabilities",
})) {
  if (rootPackage?.scripts?.[script] !== expected) {
    errors.push(`package.json script ${script} must equal: ${expected}`);
  }
}
if (!String(rootPackage?.scripts?.check ?? "").includes("pnpm dotlottie:check")) {
  errors.push("package.json check must include dotlottie:check before dependency-backed gates.");
}

requireTokens(files.index, sources.index, [
  'export * from "./dotlottie.js"',
]);
requireTokens(files.errors, sources.errors, [
  '"DOTLOTTIE_OPTIONS_INVALID"',
  '"DOTLOTTIE_SOURCE_INVALID"',
  '"DOTLOTTIE_ARCHIVE_INVALID"',
  '"DOTLOTTIE_OUTPUT_INVALID"',
  '"DOTLOTTIE_OUTPUT_TOO_LARGE"',
]);
requireTokens(files.engine, sources.engine, [
  'DOTLOTTIE_CONTRACT_VERSION = "1.0"',
  'DOTLOTTIE_MANIFEST_VERSION = "2"',
  'DOTLOTTIE_MIME_TYPE = "application/zip+dotlottie"',
  'DOTLOTTIE_EXTENSION = ".lottie"',
  "MAX_DOTLOTTIE_LOTTIE_BYTES = 20 * 1024 * 1024",
  "MAX_DOTLOTTIE_ARCHIVE_BYTES = 25 * 1024 * 1024",
  "MAX_DOTLOTTIE_TOTAL_UNCOMPRESSED_BYTES = 24 * 1024 * 1024",
  "MAX_DOTLOTTIE_MANIFEST_BYTES = 64 * 1024",
  "MAX_DOTLOTTIE_ENTRY_COUNT = 16",
  "new Date(1980, 0, 1, 0, 0, 0)",
  "zipSync",
  "unzipSync",
  "END_OF_CENTRAL_DIRECTORY_SIGNATURE",
  "CENTRAL_DIRECTORY_SIGNATURE",
  "LOCAL_FILE_HEADER_SIGNATURE",
  "safeEntryName",
  "Duplicate ZIP entry names are not permitted",
  "ZIP64 archives are outside",
  "Encrypted ZIP entries are not permitted",
  "Multi-disk ZIP archives are not supported",
  "Every governed dotLottie entry must use DEFLATE compression",
  "The inspector rejects oversized declared content before decompression",
  "createDotLottiePackage",
  "inspectDotLottie",
  'compression: "deflate"',
  'manifestVersion: "2"',
  'deterministic: true',
  'playerRenderValidation: "not-yet-performed"',
  'browserArchiveLoadValidation: "not-yet-performed"',
  'approval: "review-required"',
]);
forbidTokens(files.engine, sources.engine, [
  'playerRenderValidation: "passed"',
  'browserArchiveLoadValidation: "passed"',
  'approval: "approved"',
  "Date.now(",
  "randomUUID(",
]);
requireTokens(files.tests, sources.tests, [
  "creates deterministic dotLottie v2 bytes with audited evidence",
  "rejects traversal, unexpected entries and missing initial animation files",
  "rejects duplicate entry names before decompression",
  "rejects oversized declared output before inflating it",
  "rejects invalid embedded Lottie JSON and unsupported manifest semantics",
  "assert.deepEqual(first.bytes, second.bytes)",
]);
requireTokens(files.cli, sources.cli, [
  '"EVAVO dotLottie CLI"',
  '"package"',
  '"inspect"',
  '"capabilities"',
  '"--animation-id"',
  '"--evidence-out"',
  "createDotLottiePackage",
  "inspectDotLottie",
  "commitNewOutputFiles",
  "DOTLOTTIE_MIME_TYPE",
  'outputMode: "new-files-only"',
  'playerRenderValidation: false',
  'browserArchiveLoadValidation: false',
  'approval: "human-review-required"',
]);
requireTokens(files.cliTests, sources.cliTests, [
  "packages and inspects dotLottie through the CLI without overwriting",
  "reports machine-readable capabilities and governed option failures",
  '"VECTOR_OUTPUT_TRANSACTION_FAILED"',
  '"DOTLOTTIE_OPTIONS_INVALID"',
]);
requireTokens(files.docs, sources.docs, [
  "dotLottie v2",
  "manifest.json",
  "a/<animation-id>.json",
  "application/zip+dotlottie",
  "vector:dotlottie:package",
  "vector:dotlottie:inspect",
  "vector:dotlottie:capabilities",
  "DEFLATE",
  "1980-01-01 00:00:00",
  "playerRenderValidation: not-yet-performed",
  "browserArchiveLoadValidation: not-yet-performed",
  "Production approval remains unavailable",
]);
requireTokens(files.lottieDocs, sources.lottieDocs, [
  "dotLottie packaging",
]);
requireTokens(files.readme, sources.readme, [
  "dotLottie packaging",
  "vector:dotlottie:package",
]);
requireTokens(files.workflow, sources.workflow, [
  "Verify dotLottie archive contract",
  "node scripts/check-dotlottie-contract.mjs",
]);

if (errors.length > 0) {
  process.stderr.write(`${JSON.stringify({
    check: "evavo-vector-studio-dotlottie-contract",
    ok: false,
    dotLottieContractVersion: "1.0",
    manifestVersion: "2",
    errors,
  }, null, 2)}\n`);
  process.exit(1);
}

process.stdout.write(`${JSON.stringify({
  check: "evavo-vector-studio-dotlottie-contract",
  ok: true,
  dotLottieContractVersion: "1.0",
  manifestVersion: "2",
  deterministic: true,
  entryLayout: ["manifest.json", "a/<animation-id>.json"],
  compatibility: {
    archiveInspection: true,
    embeddedLottieInspection: true,
    playerRenderValidation: false,
    browserArchiveLoadValidation: false,
  },
  checkedFiles: [...checkedFiles].sort(),
}, null, 2)}\n`);
