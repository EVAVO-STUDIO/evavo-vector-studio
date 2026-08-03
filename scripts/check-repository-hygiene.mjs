import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = process.cwd();
const errors = [];
const checkedFiles = new Set();

async function read(relativePath) {
  checkedFiles.add(relativePath);
  try {
    return await fs.readFile(path.join(root, relativePath), "utf8");
  } catch (error) {
    errors.push(`Missing or unreadable repository-hygiene file: ${relativePath} (${error instanceof Error ? error.message : String(error)})`);
    return "";
  }
}

async function readJson(relativePath) {
  const source = await read(relativePath);
  if (!source) return null;
  try {
    return JSON.parse(source.replace(/^\uFEFF/, ""));
  } catch (error) {
    errors.push(`Invalid JSON: ${relativePath} (${error instanceof Error ? error.message : String(error)})`);
    return null;
  }
}

function requireTokens(relativePath, source, tokens) {
  for (const token of tokens) {
    if (!source.includes(token)) errors.push(`${relativePath} is missing repository-hygiene token: ${token}`);
  }
}

const files = Object.freeze({
  gitignore: ".gitignore",
  package: "package.json",
  cliPackage: "packages/cli/package.json",
  turbo: "turbo.json",
  readinessWorkflow: ".github/workflows/readiness-contract.yml",
  documentation: "docs/REPOSITORY-HYGIENE.md",
});
const sources = Object.fromEntries(
  await Promise.all(Object.entries(files).map(async ([key, relativePath]) => [key, await read(relativePath)])),
);
const packageJson = await readJson(files.package);
const cliPackage = await readJson(files.cliPackage);
const turboJson = await readJson(files.turbo);

if (sources.gitignore.startsWith("\uFEFF")) errors.push(".gitignore must not contain a UTF-8 BOM.");
const ignoreLines = new Set(sources.gitignore.replace(/^\uFEFF/, "").split(/\r?\n/).map((line) => line.trim()));
for (const required of [".turbo/", ".ci/", ".vercel/", "*.tsbuildinfo", "next-env.d.ts"]) {
  if (!ignoreLines.has(required)) errors.push(`.gitignore must include exact generated-state rule ${required}.`);
}

if (packageJson?.scripts?.["hygiene:check"] !== "node scripts/check-repository-hygiene.mjs") {
  errors.push("package.json must expose hygiene:check.");
}
if (!String(packageJson?.scripts?.check ?? "").includes("pnpm hygiene:check")) {
  errors.push("package.json check must include hygiene:check before dependency-backed validation.");
}

const expectedBins = Object.freeze({
  "evavo-vector": "./bin/evavo-vector.mjs",
  "evavo-vector-print": "./bin/evavo-vector-print.mjs",
  "evavo-dotlottie": "./bin/evavo-dotlottie.mjs",
  "evavo-vector-batch": "./bin/evavo-vector-batch.mjs",
});
if (JSON.stringify(cliPackage?.bin ?? null) !== JSON.stringify(expectedBins)) {
  errors.push(`packages/cli/package.json bin map must equal ${JSON.stringify(expectedBins)}.`);
}
const shimTargets = Object.freeze({
  "packages/cli/bin/evavo-vector.mjs": "../dist/index.js",
  "packages/cli/bin/evavo-vector-print.mjs": "../dist/print-cli.js",
  "packages/cli/bin/evavo-dotlottie.mjs": "../dist/dotlottie-cli.js",
  "packages/cli/bin/evavo-vector-batch.mjs": "../dist/batch-cli.js",
});
for (const [relativePath, target] of Object.entries(shimTargets)) {
  const source = await read(relativePath);
  const expected = `#!/usr/bin/env node\nimport "${target}";\n`;
  if (source !== expected) errors.push(`${relativePath} must be the exact checked-in launch shim for ${target}.`);
}

const testTask = turboJson?.tasks?.test;
if (JSON.stringify(testTask?.dependsOn ?? null) !== JSON.stringify(["build", "^build"])) {
  errors.push('turbo.json test.dependsOn must equal ["build", "^build"].');
}
if (!Array.isArray(testTask?.outputs) || testTask.outputs.length !== 0) {
  errors.push("turbo.json test.outputs must be an empty array because tests produce no retained cache output.");
}

requireTokens(files.readinessWorkflow, sources.readinessWorkflow, [
  "Verify repository hygiene contract",
  "node scripts/check-repository-hygiene.mjs",
  "api/vector-repository-hygiene",
  "Verify clean tracked and untracked boundary",
]);
requireTokens(files.documentation, sources.documentation, [
  "# Repository hygiene",
  ".turbo/",
  "next-env.d.ts",
  "checked-in `.mjs` launch shims",
  "pnpm hygiene:check",
]);

let tracked = [];
try {
  const { stdout } = await execFileAsync("git", ["ls-files", "-z"], {
    cwd: root,
    encoding: null,
    maxBuffer: 16 * 1024 * 1024,
  });
  tracked = stdout.toString("utf8").split("\0").filter(Boolean);
} catch (error) {
  errors.push(`Unable to inspect tracked repository paths (${error instanceof Error ? error.message : String(error)}).`);
}
const temporaryPaths = new Set([
  ".github/workflows/publish-reviewed-runtime-readiness-v1.yml",
  "ops/reviewed/apply-runtime-readiness-v1.py",
  "ops/reviewed/apply-test-build-isolation-v1.py",
  "ops/reviewed/align-test-isolation-contracts-v1.py",
  "ops/reviewed/vector-runtime-readiness-v1.ready",
]);
const generatedTracked = tracked.filter((relativePath) =>
  relativePath.startsWith(".turbo/") ||
  relativePath.startsWith(".ci/") ||
  relativePath.startsWith(".vercel/") ||
  relativePath.endsWith(".tsbuildinfo") ||
  relativePath === "next-env.d.ts" ||
  relativePath.endsWith("/next-env.d.ts")
);
for (const relativePath of generatedTracked) errors.push(`Generated repository state must not be tracked: ${relativePath}.`);
for (const relativePath of tracked) {
  if (temporaryPaths.has(relativePath)) errors.push(`Superseded reviewed-publisher material must be absent: ${relativePath}.`);
}

if (errors.length > 0) {
  process.stderr.write(`${JSON.stringify({
    check: "evavo-vector-studio-repository-hygiene",
    ok: false,
    contractVersion: "1.0",
    errors,
  }, null, 2)}\n`);
  process.exit(1);
}

process.stdout.write(`${JSON.stringify({
  check: "evavo-vector-studio-repository-hygiene",
  ok: true,
  contractVersion: "1.0",
  generatedStateIgnored: true,
  generatedStateTracked: false,
  checkedInCliLaunchShims: Object.keys(shimTargets),
  turboTestOutputsRetained: false,
  temporaryPublisherAbsent: true,
  sensitiveValuesRecorded: false,
  checkedFiles: [...checkedFiles].sort(),
}, null, 2)}\n`);
