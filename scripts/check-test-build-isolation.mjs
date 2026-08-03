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
    errors.push(`Missing or unreadable test-build isolation file: ${relativePath} (${error instanceof Error ? error.message : String(error)})`);
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
    if (!source.includes(token)) errors.push(`${relativePath} is missing test-build isolation token: ${token}`);
  }
}

const packageJson = await readJson("package.json");
const turboJson = await readJson("turbo.json");
const quality = await read(".github/workflows/quality.yml");
const documentation = await read("docs/TEST-BUILD-ISOLATION.md");
const readme = await read("README.md");

if (packageJson?.scripts?.["test-build-isolation:check"] !== "node scripts/check-test-build-isolation.mjs") {
  errors.push("package.json must expose test-build-isolation:check.");
}
if (!String(packageJson?.scripts?.check ?? "").includes("pnpm test-build-isolation:check")) {
  errors.push("package.json check must include test-build-isolation:check before dependency-backed gates.");
}

const testDependencies = turboJson?.tasks?.test?.dependsOn;
if (
  !Array.isArray(testDependencies) ||
  testDependencies.length !== 2 ||
  testDependencies[0] !== "build" ||
  testDependencies[1] !== "^build"
) {
  errors.push('turbo.json test must depend on same-package "build" before dependency "^build".');
}

const manifestPaths = [];
for (const directory of ["apps", "packages", "workers"]) {
  let entries = [];
  try {
    entries = await fs.readdir(path.join(root, directory), { withFileTypes: true });
  } catch {
    continue;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) manifestPaths.push(`${directory}/${entry.name}/package.json`);
  }
}
manifestPaths.sort();

const builtTestPackages = [];
for (const relativePath of manifestPaths) {
  const manifest = await readJson(relativePath);
  if (!manifest) continue;
  const build = String(manifest.scripts?.build ?? "").trim();
  const test = String(manifest.scripts?.test ?? "").trim();
  if (!test) continue;

  if (/\btsc\b/.test(test)) {
    errors.push(`${relativePath} test must not compile into a shared output directory: ${test}`);
  }
  if (/\b(?:rm|rimraf|rmdir|del)\b/.test(test)) {
    errors.push(`${relativePath} test must not clean shared build output: ${test}`);
  }
  if (test.includes("node --test dist/")) {
    builtTestPackages.push(String(manifest.name ?? relativePath));
    if (!build) errors.push(`${relativePath} consumes dist tests without a build script.`);
    if (!/^tsc\s+-p\s+tsconfig\.json(?:\s|$)/.test(build)) {
      errors.push(`${relativePath} dist tests require the governed TypeScript build script; received ${build}.`);
    }
  }
}

if (builtTestPackages.length < 1) {
  errors.push("No workspace package consumes immutable dist test output.");
}

requireTokens(".github/workflows/quality.yml", quality, [
  "Verify test and build output isolation",
  "id: contract_test_build_isolation",
  "node scripts/check-test-build-isolation.mjs",
  "CONTRACT_TEST_BUILD_ISOLATION_OUTCOME",
]);
requireTokens("docs/TEST-BUILD-ISOLATION.md", documentation, [
  "same-package `build`",
  "immutable `dist` output",
  "must not invoke `tsc`",
  "pnpm test-build-isolation:check",
]);
requireTokens("README.md", readme, [
  "docs/TEST-BUILD-ISOLATION.md",
]);

if (errors.length > 0) {
  process.stderr.write(`${JSON.stringify({
    check: "evavo-vector-studio-test-build-isolation",
    ok: false,
    contractVersion: "1.0",
    errors,
  }, null, 2)}\n`);
  process.exit(1);
}

process.stdout.write(`${JSON.stringify({
  check: "evavo-vector-studio-test-build-isolation",
  ok: true,
  contractVersion: "1.0",
  samePackageBuildRequired: true,
  testCompilationWritesSharedDist: false,
  builtTestPackages: builtTestPackages.sort(),
  checkedFiles: [...checkedFiles].sort(),
}, null, 2)}\n`);
