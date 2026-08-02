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
  const entries = [...block.matchAll(entryPattern)].map((match) => ({
    relativePath: match[1],
    recursive: match[2] === "true",
  }));
  const expected = [
    { relativePath: ".turbo", recursive: true },
    { relativePath: "apps/web/next-env.d.ts", recursive: false },
    { relativePath: "apps/web/tsconfig.tsbuildinfo", recursive: false },
  ];
  if (JSON.stringify(entries) !== JSON.stringify(expected)) {
    errors.push(`${relativePath} must clean exactly ${expected.map((entry) => entry.relativePath).join(", ")} after validation.`);
  }

  const residue = block.replace(entryPattern, "").replace(/[\s,]/g, "");
  if (residue) {
    errors.push(`${relativePath} contains an unrecognised validation cleanup entry: ${residue.slice(0, 80)}`);
  }
}

function forbidBroadRepositoryCleanup(relativePath, source) {
  const prohibitedPatterns = [
    {
      pattern: /(?:commandOutput|runChecked|execFileSync|spawnSync)\(\s*["']git["']\s*,\s*\[\s*["'](?:clean|reset|restore|checkout)["']/g,
      label: "Git clean/reset/restore/checkout cleanup",
    },
    {
      pattern: /(?:commandOutput|runChecked|execFileSync|spawnSync)\(\s*["'](?:rm|rmdir)["']\s*,/g,
      label: "shell-level recursive deletion",
    },
    { pattern: /\brm\(\s*ROOT\s*,/g, label: "repository-root deletion" },
    { pattern: /\brm\(\s*process\.cwd\(\)\s*,/g, label: "current-working-directory deletion" },
    { pattern: /\brm\(\s*path\.resolve\(\s*["']\.["']\s*\)\s*,/g, label: "resolved repository-root deletion" },
  ];
  for (const { pattern, label } of prohibitedPatterns) {
    if (pattern.test(source)) errors.push(`${relativePath} contains prohibited broad cleanup: ${label}.`);
  }

  const awaitedRmCallCount = [...source.matchAll(/\bawait\s+rm\(/g)].length;
  if (awaitedRmCallCount !== 2) {
    errors.push(`${relativePath} must retain exactly two bounded awaited rm calls, found ${awaitedRmCallCount}.`);
  }
}

const files = {
  nvmrc: ".nvmrc",
  package: "package.json",
  sourceSchema: "schemas/source-proof-v1.schema.json",
  deploymentSchema: "schemas/deployment-proof-v1.schema.json",
  sourceProof: "scripts/create-source-proof.mjs",
  liveProof: "scripts/verify-live-deployment.mjs",
  docs: "docs/RELEASE-PROOF.md",
  sourceWorkflow: ".github/workflows/source-release-proof.yml",
  liveWorkflow: ".github/workflows/public-deployment-proof.yml",
};
const sources = Object.fromEntries(
  await Promise.all(Object.entries(files).map(async ([key, relativePath]) => [key, await read(relativePath)])),
);
const packageJson = await readJson(files.package);
const sourceSchema = await readJson(files.sourceSchema);
const deploymentSchema = await readJson(files.deploymentSchema);

if (sources.nvmrc.trim() !== "22.16.0") {
  errors.push(".nvmrc must retain the governed Node.js 22.16.0 release runtime.");
}
if (packageJson?.scripts?.["release-proof:check"] !== "node scripts/check-release-proof-contract.mjs") {
  errors.push("package.json must expose release-proof:check.");
}
if (packageJson?.scripts?.["release:source-proof"] !== "node scripts/create-source-proof.mjs") {
  errors.push("package.json must expose release:source-proof.");
}
if (packageJson?.scripts?.["release:live-proof"] !== "node scripts/verify-live-deployment.mjs") {
  errors.push("package.json must expose release:live-proof.");
}
if (!String(packageJson?.scripts?.check ?? "").includes("pnpm release-proof:check")) {
  errors.push("package.json check must include release-proof:check before dependency-backed gates.");
}

if (sourceSchema?.properties?.sensitiveValuesRecorded?.const !== false) {
  errors.push("The source proof schema must forbid sensitive values.");
}
if (deploymentSchema?.properties?.sensitiveValuesRecorded?.const !== false) {
  errors.push("The deployment proof schema must forbid sensitive values.");
}
if (deploymentSchema?.properties?.origin?.const !== "https://vector.evavo.com.au") {
  errors.push("The deployment proof schema must bind the canonical production origin.");
}

requireTokens(files.sourceProof, sources.sourceProof, [
  'REPOSITORY = "EVAVO-STUDIO/evavo-vector-studio"',
  "SOURCE_PROOF_REPOSITORY_DIRTY",
  "SOURCE_PROOF_CLEANUP_PATH_INVALID",
  'const ROOT = path.resolve(".");',
  "const VALIDATION_GENERATED_PATHS = Object.freeze([",
  "function resolveRepositoryPath(relativePath)",
  'relative === ".."',
  "relative.startsWith(`..${path.sep}`)",
  "path.isAbsolute(relative)",
  "function removeValidationGeneratedPaths()",
  "await rm(resolveRepositoryPath(relativePath), { recursive, force: true });",
  'runChecked("pnpm", ["install", "--frozen-lockfile"]',
  'runChecked("pnpm", ["check"]',
  'runChecked("pnpm", ["--filter", "@evavo/vector-web", "build"]',
  "await removeValidationGeneratedPaths();",
  "assertCleanRepository()",
  'sensitiveValuesRecorded: false',
  'flag: "wx"',
  "await link(temporary, absolute)",
  "await rm(temporary, { force: true });",
]);
requireExactValidationCleanup(files.sourceProof, sources.sourceProof);
requireOrderedTokens(files.sourceProof, sources.sourceProof, [
  'runChecked("pnpm", ["install", "--frozen-lockfile"]',
  'runChecked("pnpm", ["check"]',
  'runChecked("pnpm", ["--filter", "@evavo/vector-web", "build"]',
  "await removeValidationGeneratedPaths();",
  "assertCleanRepository();",
]);
forbidTokens(files.sourceProof, sources.sourceProof, [
  "git clean",
  "git reset",
  "git restore",
  "git checkout",
  "rmSync(",
]);
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
  'sensitiveValuesRecorded: false',
  "serialized.includes(token)",
  "serialized.includes(sessionCookie)",
  'flag: "wx"',
  "await link(temporary, absolute)",
]);
forbidTokens(files.liveProof, sources.liveProof, [
  "process.stdout.write(token",
  "console.log(token",
  "tokenValue:",
  "sessionCookie:",
]);

requireTokens(files.docs, sources.docs, [
  "source proof",
  "live deployment proof",
  "VECTOR_DEPLOYMENT_PROOF_LAUNCH_TOKEN",
  "never appears in command arguments",
  "clientReleaseEligible",
  "human review",
  "include-hidden-files: true",
]);

const exactWorkflowTokens = [
  "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
  "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020",
  "node-version-file: .nvmrc",
  "package-manager-cache: false",
  "corepack prepare pnpm@10.14.0 --activate",
  'test "$(pnpm --version)" = "10.14.0"',
  "git diff --exit-code",
  "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a",
  "include-hidden-files: true",
  "actions/github-script@3a2844b7e9c422d3c10d287c895573f7108da1b3",
];
const prohibitedWorkflowTokens = [
  "pnpm/action-setup@",
  "actions/checkout@v",
  "actions/setup-node@v",
  "actions/upload-artifact@v",
  "actions/github-script@v",
  "node-version: 22",
  "cache: pnpm",
];

requireTokens(files.sourceWorkflow, sources.sourceWorkflow, [
  "Vector Studio source release proof",
  ...exactWorkflowTokens,
  "node scripts/check-release-proof-contract.mjs",
  "node scripts/create-source-proof.mjs",
  "path: .ci/vector-source-proof.json\n          include-hidden-files: true\n          if-no-files-found: error",
  "release/vector-source-proof",
]);
requireTokens(files.liveWorkflow, sources.liveWorkflow, [
  "Vector Studio public deployment proof",
  ...exactWorkflowTokens,
  "node scripts/verify-live-deployment.mjs",
  "path: |\n            .ci/vector-source-proof.json\n            .ci/vector-private-response-proof.json\n            .ci/vector-public-deployment-proof.json\n          include-hidden-files: true\n          if-no-files-found: error",
  "release/vector-public-runtime",
  "signed launch is not performed",
]);
forbidTokens(files.sourceWorkflow, sources.sourceWorkflow, prohibitedWorkflowTokens);
forbidTokens(files.liveWorkflow, sources.liveWorkflow, prohibitedWorkflowTokens);

if (errors.length > 0) {
  process.stderr.write(`${JSON.stringify({
    check: "evavo-vector-studio-release-proof",
    ok: false,
    contractVersion: "1.0",
    errors,
  }, null, 2)}\n`);
  process.exit(1);
}

process.stdout.write(`${JSON.stringify({
  check: "evavo-vector-studio-release-proof",
  ok: true,
  contractVersion: "1.0",
  canonicalOrigin: "https://vector.evavo.com.au",
  sensitiveValuesRecorded: false,
  automaticClientPromotion: false,
  checkedFiles: [...checkedFiles].sort(),
}, null, 2)}\n`);
