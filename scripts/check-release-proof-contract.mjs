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

function forbidTokens(relativePath, source, tokens) {
  for (const token of tokens) {
    if (source.includes(token)) errors.push(`${relativePath} contains prohibited release-proof token: ${token}`);
  }
}

const files = {
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
  'runChecked("pnpm", ["install", "--frozen-lockfile"]',
  'runChecked("pnpm", ["check"]',
  'runChecked("pnpm", ["--filter", "@evavo/vector-web", "build"]',
  "assertCleanRepository()",
  'sensitiveValuesRecorded: false',
  'flag: "wx"',
  "await link(temporary, absolute)",
]);
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
]);
requireTokens(files.sourceWorkflow, sources.sourceWorkflow, [
  "Vector Studio source release proof",
  "node scripts/check-release-proof-contract.mjs",
  "node scripts/create-source-proof.mjs",
  "actions/upload-artifact@v4",
  "release/vector-source-proof",
]);
requireTokens(files.liveWorkflow, sources.liveWorkflow, [
  "Vector Studio public deployment proof",
  "node scripts/verify-live-deployment.mjs",
  "actions/upload-artifact@v4",
  "release/vector-public-runtime",
  "signed launch is not performed",
]);

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
