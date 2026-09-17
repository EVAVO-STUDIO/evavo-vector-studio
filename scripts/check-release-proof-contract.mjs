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

async function mustBeAbsent(relativePath) {
  checkedFiles.add(relativePath);
  try {
    await fs.stat(path.join(root, relativePath));
    errors.push(`${relativePath} is retired and must remain absent.`);
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) {
      errors.push(`Unable to verify retired path ${relativePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

function requireTokens(relativePath, source, tokens) {
  for (const token of tokens) {
    if (!source.includes(token)) errors.push(`${relativePath} is missing release-proof token: ${token}`);
  }
}

function requireOrderedTokens(relativePath, source, tokens) {
  let offset = 0;
  for (const token of tokens) {
    const index = source.indexOf(token, offset);
    if (index === -1) {
      errors.push(`${relativePath} is missing ordered release-proof token after byte ${offset}: ${token}`);
      return;
    }
    offset = index + token.length;
  }
}

function forbidTokens(relativePath, source, tokens) {
  for (const token of tokens) {
    if (source.includes(token)) errors.push(`${relativePath} contains prohibited release-proof token: ${token}`);
  }
}

function requireExactValidationCleanup(relativePath, source) {
  const block = source.match(/const VALIDATION_GENERATED_PATHS = Object\.freeze\(\[([\s\S]*?)\]\);/)?.[1] ?? null;
  if (block === null) {
    errors.push(`${relativePath} must declare the exact bounded validation-generated path list.`);
    return;
  }
  const entryPattern = /Object\.freeze\(\{\s*relativePath:\s*"([^"]+)",\s*recursive:\s*(true|false)\s*\}\)/g;
  const entries = [...block.matchAll(entryPattern)].map((match) => ({ relativePath: match[1], recursive: match[2] === "true" }));
  const expected = [
    { relativePath: ".turbo", recursive: true },
    { relativePath: "apps/web/next-env.d.ts", recursive: false },
    { relativePath: "apps/web/tsconfig.tsbuildinfo", recursive: false },
  ];
  if (JSON.stringify(entries) !== JSON.stringify(expected)) {
    errors.push(`${relativePath} must clean exactly ${expected.map((entry) => entry.relativePath).join(", ")} after validation.`);
  }
  const residue = block.replace(entryPattern, "").replace(/[\s,]/g, "");
  if (residue) errors.push(`${relativePath} contains an unrecognised validation cleanup entry: ${residue.slice(0, 80)}`);
}

function forbidBroadRepositoryCleanup(relativePath, source) {
  const prohibitedPatterns = [
    { pattern: /(?:commandOutput|runChecked|execFileSync|spawnSync)\(\s*["']git["']\s*,\s*\[\s*["'](?:clean|reset|restore|checkout)["']/g, label: "Git clean/reset/restore/checkout cleanup" },
    { pattern: /(?:commandOutput|runChecked|execFileSync|spawnSync)\(\s*["'](?:rm|rmdir)["']\s*,/g, label: "shell-level recursive deletion" },
    { pattern: /\brm\(\s*ROOT\s*,/g, label: "repository-root deletion" },
    { pattern: /\brm\(\s*process\.cwd\(\)\s*,/g, label: "current-working-directory deletion" },
    { pattern: /\brm\(\s*path\.resolve\(\s*["']\.["']\s*\)\s*,/g, label: "resolved repository-root deletion" },
  ];
  for (const { pattern, label } of prohibitedPatterns) {
    if (pattern.test(source)) errors.push(`${relativePath} contains prohibited broad cleanup: ${label}.`);
  }
  const awaitedRmCallCount = [...source.matchAll(/\bawait\s+rm\(/g)].length;
  if (awaitedRmCallCount !== 2) errors.push(`${relativePath} must retain exactly two bounded awaited rm calls, found ${awaitedRmCallCount}.`);
}

const files = {
  nvmrc: ".nvmrc",
  package: "package.json",
  sourceSchema: "schemas/source-proof-v1.schema.json",
  deploymentSchema: "schemas/deployment-proof-v1.schema.json",
  sourceProof: "scripts/create-source-proof.mjs",
  liveProof: "scripts/verify-live-deployment.mjs",
  docs: "docs/RELEASE-PROOF.md",
};
const sources = Object.fromEntries(await Promise.all(Object.entries(files).map(async ([key, relativePath]) => [key, await read(relativePath)])));
const packageJson = await readJson(files.package);
const sourceSchema = await readJson(files.sourceSchema);
const deploymentSchema = await readJson(files.deploymentSchema);

await mustBeAbsent(".github/workflows/source-release-proof.yml");
await mustBeAbsent(".github/workflows/public-deployment-proof.yml");

if (sources.nvmrc.trim() !== "22.16.0") errors.push(".nvmrc must retain governed Node.js 22.16.0.");
if (packageJson?.scripts?.["release-proof:check"] !== "node scripts/check-release-proof-contract.mjs") errors.push("package.json must expose release-proof:check.");
if (packageJson?.scripts?.["release:source-proof"] !== "node scripts/create-source-proof.mjs") errors.push("package.json must expose release:source-proof.");
if (packageJson?.scripts?.["release:live-proof"] !== "node scripts/verify-live-deployment.mjs") errors.push("package.json must expose release:live-proof.");
if (!String(packageJson?.scripts?.check ?? "").includes("pnpm release-proof:check")) errors.push("package.json check must include release-proof:check.");

if (sourceSchema?.properties?.sensitiveValuesRecorded?.const !== false) errors.push("Source proof schema must forbid sensitive values.");
if (deploymentSchema?.properties?.sensitiveValuesRecorded?.const !== false) errors.push("Deployment proof schema must forbid sensitive values.");
if (deploymentSchema?.properties?.origin?.const !== "https://vector.evavo.com.au") errors.push("Deployment proof schema must bind canonical production origin.");

requireTokens(files.sourceProof, sources.sourceProof, [
  'REPOSITORY = "EVAVO-STUDIO/evavo-vector-studio"',
  "SOURCE_PROOF_REPOSITORY_DIRTY",
  "SOURCE_PROOF_CLEANUP_PATH_INVALID",
  'const ROOT = path.resolve(".");',
  "const VALIDATION_GENERATED_PATHS = Object.freeze([",
  "function resolveRepositoryPath(relativePath)",
  'runChecked("pnpm", ["install", "--frozen-lockfile"]',
  'runChecked("pnpm", ["check"]',
  'runChecked("pnpm", ["--filter", "@evavo/vector-web", "build"]',
  "await removeValidationGeneratedPaths();",
  "assertCleanRepository()",
  "pnpmVersion !== \"10.14.0\"",
  "sensitiveValuesRecorded: false",
  'flag: "wx"',
]);
requireExactValidationCleanup(files.sourceProof, sources.sourceProof);
requireOrderedTokens(files.sourceProof, sources.sourceProof, [
  'runChecked("pnpm", ["install", "--frozen-lockfile"]',
  'runChecked("pnpm", ["check"]',
  'runChecked("pnpm", ["--filter", "@evavo/vector-web", "build"]',
  "await removeValidationGeneratedPaths();",
  "assertCleanRepository();",
]);
forbidTokens(files.sourceProof, sources.sourceProof, ["git clean", "git reset", "git restore", "git checkout", "rmSync("]);
forbidBroadRepositoryCleanup(files.sourceProof, sources.sourceProof);

requireTokens(files.liveProof, sources.liveProof, [
  'CANONICAL_ORIGIN = "https://vector.evavo.com.au"',
  'LAUNCH_TOKEN_ENV = "VECTOR_DEPLOYMENT_PROOF_LAUNCH_TOKEN"',
  'SOURCE_PROOF_ENV = "VECTOR_DEPLOYMENT_SOURCE_PROOF"',
  'redirect: "manual"',
  '"accept-encoding": "identity"',
  "readBoundedBody",
  "workspaceCookie",
  'replayLocation === "/access?reason=used"',
  "providerDirectPrivateStorageConfigured === false",
  "sensitiveValuesRecorded: false",
  "serialized.includes(token)",
  "serialized.includes(sessionCookie)",
  'flag: "wx"',
]);
forbidTokens(files.liveProof, sources.liveProof, ["process.stdout.write(token", "console.log(token", "tokenValue:", "sessionCookie:"]);

requireTokens(files.docs, sources.docs, [
  "Provider-free evidence custody",
  "source proof",
  "live deployment proof",
  "VECTOR_DEPLOYMENT_PROOF_LAUNCH_TOKEN",
  "Development Studio remains repository publication authority",
  "GitHub Actions, hosted runner identity, workflow artifacts",
  "source-release-proof.yml",
  "public-deployment-proof.yml",
  "human review",
]);
forbidTokens(files.docs, sources.docs, [
  "CI runs the same generator",
  "## CI workflows",
  "release/vector-source-proof",
  "release/vector-public-runtime",
]);

if (errors.length > 0) {
  process.stderr.write(`${JSON.stringify({ check: "evavo-vector-studio-release-proof", ok: false, contractVersion: "2.0", errors }, null, 2)}\n`);
  process.exit(1);
}

process.stdout.write(`${JSON.stringify({
  check: "evavo-vector-studio-release-proof",
  ok: true,
  contractVersion: "2.0",
  canonicalOrigin: "https://vector.evavo.com.au",
  providerFreeEvidence: true,
  retiredWorkflowWrappersRequiredAbsent: true,
  sensitiveValuesRecorded: false,
  automaticClientPromotion: false,
  repositoryPublicationAuthority: "development.repository.publish",
  checkedFiles: [...checkedFiles].sort(),
}, null, 2)}\n`);
