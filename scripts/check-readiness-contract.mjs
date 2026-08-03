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
    errors.push(`Missing or unreadable readiness file: ${relativePath} (${error instanceof Error ? error.message : String(error)})`);
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
    if (!source.includes(token)) errors.push(`${relativePath} is missing readiness token: ${token}`);
  }
}

function forbidTokens(relativePath, source, tokens) {
  for (const token of tokens) {
    if (source.includes(token)) errors.push(`${relativePath} contains prohibited readiness token: ${token}`);
  }
}

function frozenStringArray(relativePath, source, name) {
  const expression = new RegExp(`(?:export\\s+)?const\\s+${name}\\s*=\\s*Object\\.freeze\\(\\[([\\s\\S]*?)\\](?:\\s+as\\s+const)?\\s*\\)\\s*;`);
  const block = source.match(expression)?.[1] ?? null;
  if (block === null) {
    errors.push(`${relativePath} does not expose ${name} as a frozen string array.`);
    return [];
  }
  return [...block.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
}

function exactArray(label, actual, expected) {
  if (actual.length !== expected.length || actual.some((value, index) => value !== expected[index])) {
    errors.push(`${label} must equal ${JSON.stringify(expected)}; received ${JSON.stringify(actual)}.`);
  }
}

const files = Object.freeze({
  package: "package.json",
  readiness: "apps/web/lib/readiness.ts",
  route: "apps/web/app/api/v1/readiness/route.ts",
  capabilities: "apps/web/app/api/v1/capabilities/route.ts",
  provisioning: "scripts/plan-vector-studio-vercel-provisioning.mjs",
  mcpCheck: "scripts/check-mcp-contract.mjs",
  capabilityCheck: "scripts/check-capability-discovery.mjs",
  hygieneCheck: "scripts/check-repository-hygiene.mjs",
  isolationCheck: "scripts/check-test-build-isolation.mjs",
  workflow: ".github/workflows/readiness-contract.yml",
  docs: "docs/READINESS.md",
  hygieneDocs: "docs/REPOSITORY-HYGIENE.md",
  isolationDocs: "docs/TEST-BUILD-ISOLATION.md",
  apiDocs: "docs/API.md",
  capabilityDocs: "docs/CAPABILITIES.md",
  printDocs: "docs/PRINT-PREFLIGHT.md",
  readme: "README.md",
});
const sources = Object.fromEntries(
  await Promise.all(Object.entries(files).map(async ([key, relativePath]) => [key, await read(relativePath)])),
);
const packageJson = await readJson(files.package);

if (packageJson?.scripts?.["readiness:check"] !== "node scripts/check-readiness-contract.mjs") {
  errors.push("package.json must expose readiness:check.");
}
if (!String(packageJson?.scripts?.check ?? "").includes("pnpm readiness:check")) {
  errors.push("package.json check must include readiness:check before dependency-backed gates.");
}

const expectedAuthorities = Object.freeze([
  "EVAVO_CLIENT_APP_LAUNCH_SECRET",
  "EVAVO_VECTOR_PRIVATE_SIGNING_SECRET",
  "VECTOR_API_TOKEN",
  "VECTOR_WORKER_API_TOKEN",
]);
exactArray("runtime authority list", frozenStringArray(files.readiness, sources.readiness, "VECTOR_RUNTIME_AUTHORITY_KEYS"), expectedAuthorities);
exactArray("provisioning authority list", frozenStringArray(files.provisioning, sources.provisioning, "AUTHORITY_KEYS"), expectedAuthorities);
const requiredProvisioning = frozenStringArray(files.provisioning, sources.provisioning, "REQUIRED_SECRETS");
for (const name of ["VERCEL_TOKEN", ...expectedAuthorities, "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"]) {
  if (!requiredProvisioning.includes(name)) errors.push(`${files.provisioning} is missing governed provisioning credential ${name}.`);
}

requireTokens(files.readiness, sources.readiness, [
  'VECTOR_RUNTIME_READINESS_CONTRACT_VERSION = "1.0"',
  'VECTOR_RUNTIME_CANONICAL_ORIGIN = "https://vector.evavo.com.au"',
  "VECTOR_RUNTIME_AUTHORITY_KEYS",
  "credentialReady",
  "validHttpsEndpoint",
  "separatedAuthorities",
  'environmentValue(environment, "VERCEL") === "1"',
  'environmentValue(environment, "VERCEL_ENV") === "production"',
  'environmentValue(environment, "VECTOR_PUBLIC_ORIGIN")',
  'environmentValue(environment, "VECTOR_HUB_REPLAY_MODE")',
  '"UPSTASH_REDIS_REST_URL"',
  '"UPSTASH_REDIS_REST_TOKEN"',
  'environmentValue(environment, "VECTOR_JOB_STORE_MODE")',
  'environmentValue(environment, "VECTOR_OBJECT_STORE_MODE")',
  "interactiveReady",
  "automationReady",
  "clientReleaseEligible: false",
  "providerQueueDelivery: false",
  "managedRemoteExecution: false",
  "distributedAutoscaling: false",
  "sourceProofRequired: true",
  "publicRuntimeProofRequired: true",
  "ownerLaunchProofRequired: true",
  "clientLaunchProofRequired: true",
  "replayRejectionProofRequired: true",
  "centralHumanPromotionRequired: true",
  "sensitiveValuesIncluded: false",
  'approval: "human-review-required"',
]);
forbidTokens(files.readiness, sources.readiness, [
  "sensitiveValuesIncluded: true",
  "clientReleaseEligible: true",
  "providerQueueDelivery: true",
  "managedRemoteExecution: true",
  "distributedAutoscaling: true",
  "return environment",
  "JSON.stringify(environment)",
]);

requireTokens(files.route, sources.route, [
  'export const runtime = "nodejs"',
  'export const dynamic = "force-dynamic"',
  "vectorRuntimeReadinessPublicView()",
  "noStoreHeaders",
  '"x-evavo-vector-readiness"',
  "export function GET(): Response",
]);
forbidTokens(files.route, sources.route, [
  "process.env",
  "apiAuthorisationFailure",
  "EVAVO_CLIENT_APP_LAUNCH_SECRET",
  "EVAVO_VECTOR_PRIVATE_SIGNING_SECRET",
  "UPSTASH_REDIS_REST_TOKEN",
  "VECTOR_API_TOKEN",
  "VECTOR_WORKER_API_TOKEN",
]);

requireTokens(files.capabilities, sources.capabilities, ['readiness: "/api/v1/readiness"']);
requireTokens(files.mcpCheck, sources.mcpCheck, ["MCP contract `1.6` exposes sixteen tools", "vector_preflight_svg_print", "GET /api/v1/readiness"]);
requireTokens(files.capabilityCheck, sources.capabilityCheck, ['readiness: "/api/v1/readiness"', "GET /api/v1/readiness"]);
requireTokens(files.hygieneCheck, sources.hygieneCheck, ["api/vector-repository-hygiene", "Verify clean tracked and untracked boundary"]);
requireTokens(files.isolationCheck, sources.isolationCheck, ["api/vector-test-build-isolation", "focused readiness workflow"]);

requireTokens(files.workflow, sources.workflow, [
  "name: Vector Studio runtime readiness",
  "Verify repository hygiene contract",
  "node scripts/check-repository-hygiene.mjs",
  "Verify test and build output isolation",
  "node scripts/check-test-build-isolation.mjs",
  "Verify lockfile bytes and YAML stream boundary",
  "node scripts/check-lockfile-integrity.mjs",
  "node scripts/check-readiness-contract.mjs",
  "pnpm install --frozen-lockfile",
  "Failed to create bin",
  "pnpm build:packages",
  "pnpm --filter @evavo/vector-web typecheck",
  "pnpm --filter @evavo/vector-web build",
  "Verify clean tracked and untracked boundary",
  "api/vector-readiness-toolchain",
  "api/vector-repository-hygiene",
  "api/vector-test-build-isolation",
  "api/vector-readiness-lockfile",
  "api/vector-readiness-contract",
  "api/vector-readiness-dependencies",
  "api/vector-readiness-typecheck",
  "api/vector-readiness-build",
  "api/vector-readiness-clean-tree",
]);
forbidTokens(files.workflow, sources.workflow, ["pnpm/action-setup@", "node-version: 22", "cache: pnpm", "contents: write", "git push"]);

requireTokens(files.hygieneDocs, sources.hygieneDocs, ["pnpm hygiene:check", "checked-in `.mjs` launch shims"]);
requireTokens(files.isolationDocs, sources.isolationDocs, ["empty test-output declaration", "focused readiness workflow"]);
requireTokens(files.docs, sources.docs, [
  "GET /api/v1/readiness",
  "public non-sensitive",
  "interactive.ready",
  "automation.ready",
  "clientReleaseEligible: false",
  "sensitiveValuesIncluded: false",
  "live release proof",
  "repository hygiene",
  "test/build isolation",
]);
requireTokens(files.apiDocs, sources.apiDocs, ["GET /api/v1/readiness"]);
requireTokens(files.capabilityDocs, sources.capabilityDocs, ["GET /api/v1/readiness"]);
requireTokens(files.printDocs, sources.printDocs, ["vector_preflight_svg_print"]);
requireTokens(files.readme, sources.readme, [
  "MCP contract `1.6` exposes sixteen tools",
  "vector_preflight_svg_print",
  "GET  /api/v1/capabilities",
  "GET /api/v1/readiness",
  "POST /api/v1/print/preflight",
  "docs/READINESS.md",
]);
forbidTokens(files.readme, sources.readme, ["MCP contract `1.5` exposes fifteen tools"]);

if (errors.length > 0) {
  process.stderr.write(`${JSON.stringify({ check: "evavo-vector-studio-runtime-readiness", ok: false, contractVersion: "1.1", errors }, null, 2)}\n`);
  process.exit(1);
}

process.stdout.write(`${JSON.stringify({
  check: "evavo-vector-studio-runtime-readiness",
  ok: true,
  contractVersion: "1.1",
  endpoint: "/api/v1/readiness",
  publicNonSensitive: true,
  interactiveReadiness: true,
  automationReadiness: true,
  repositoryHygieneGoverned: true,
  testBuildIsolationGoverned: true,
  automaticClientPromotion: false,
  sensitiveValuesIncluded: false,
  checkedFiles: [...checkedFiles].sort(),
}, null, 2)}\n`);
