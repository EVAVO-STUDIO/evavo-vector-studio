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
  try { return JSON.parse(source); } catch (error) {
    errors.push(`Invalid JSON: ${relativePath} (${error instanceof Error ? error.message : String(error)})`);
    return null;
  }
}
async function requireAbsent(relativePath) {
  checkedFiles.add(relativePath);
  try {
    await fs.stat(path.join(root, relativePath));
    errors.push(`Retired readiness workflow must remain absent: ${relativePath}.`);
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) {
      errors.push(`Unable to verify retired path ${relativePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
function requireTokens(relativePath, source, tokens) {
  for (const token of tokens) if (!source.includes(token)) errors.push(`${relativePath} is missing readiness token: ${token}`);
}
function forbidTokens(relativePath, source, tokens) {
  for (const token of tokens) if (source.includes(token)) errors.push(`${relativePath} contains prohibited readiness token: ${token}`);
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
  releaseCheck: "scripts/check-release-proof-contract.mjs",
  docs: "docs/READINESS.md",
  hygieneDocs: "docs/REPOSITORY-HYGIENE.md",
  isolationDocs: "docs/TEST-BUILD-ISOLATION.md",
  apiDocs: "docs/API.md",
  capabilityDocs: "docs/CAPABILITIES.md",
  printDocs: "docs/PRINT-PREFLIGHT.md",
  readme: "README.md",
});
const sources = Object.fromEntries(await Promise.all(Object.entries(files).map(async ([key, relativePath]) => [key, await read(relativePath)])));
const packageJson = await readJson(files.package);
await requireAbsent(".github/workflows/readiness-contract.yml");

if (packageJson?.scripts?.["readiness:check"] !== "node scripts/check-readiness-contract.mjs") errors.push("package.json must expose readiness:check.");
const checkScript = String(packageJson?.scripts?.check ?? "");
for (const command of ["pnpm release-proof:check", "pnpm hygiene:check", "pnpm test-build-isolation:check", "pnpm readiness:check", "pnpm lint", "pnpm typecheck", "pnpm test", "pnpm build"]) {
  if (!checkScript.includes(command)) errors.push(`package.json check must include ${command}.`);
}

const expectedAuthorities = Object.freeze(["EVAVO_CLIENT_APP_LAUNCH_SECRET", "EVAVO_VECTOR_PRIVATE_SIGNING_SECRET", "VECTOR_API_TOKEN", "VECTOR_WORKER_API_TOKEN"]);
const expectedApplicationEnvironment = Object.freeze(["EVAVO_CLIENT_APP_LAUNCH_SECRET", "EVAVO_VECTOR_PRIVATE_SIGNING_SECRET", "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN", "VECTOR_API_TOKEN", "VECTOR_WORKER_API_TOKEN"]);
exactArray("runtime authority list", frozenStringArray(files.readiness, sources.readiness, "VECTOR_RUNTIME_AUTHORITY_KEYS"), expectedAuthorities);
exactArray("provisioning authority list", frozenStringArray(files.provisioning, sources.provisioning, "AUTHORITY_KEYS"), expectedAuthorities);
exactArray("provider access list", frozenStringArray(files.provisioning, sources.provisioning, "PROVIDER_ACCESS_KEYS"), ["VERCEL_TOKEN"]);
exactArray("application environment list", frozenStringArray(files.provisioning, sources.provisioning, "APPLICATION_ENVIRONMENT_KEYS"), expectedApplicationEnvironment);
requireTokens(files.provisioning, sources.provisioning, ["providerAccess:", "applicationAuthorities:", "providerOnlyInspectionSupported: true", "applicationAuthoritiesRequiredForApply: true"]);

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
forbidTokens(files.readiness, sources.readiness, ["sensitiveValuesIncluded: true", "clientReleaseEligible: true", "providerQueueDelivery: true", "managedRemoteExecution: true", "distributedAutoscaling: true", "return environment", "JSON.stringify(environment)"]);

requireTokens(files.route, sources.route, ['export const runtime = "nodejs"', 'export const dynamic = "force-dynamic"', "vectorRuntimeReadinessPublicView()", "noStoreHeaders", '"x-evavo-vector-readiness"', "export function GET(): Response"]);
forbidTokens(files.route, sources.route, ["process.env", "apiAuthorisationFailure", "EVAVO_CLIENT_APP_LAUNCH_SECRET", "EVAVO_VECTOR_PRIVATE_SIGNING_SECRET", "UPSTASH_REDIS_REST_TOKEN", "VECTOR_API_TOKEN", "VECTOR_WORKER_API_TOKEN"]);
requireTokens(files.capabilities, sources.capabilities, ['readiness: "/api/v1/readiness"']);
requireTokens(files.mcpCheck, sources.mcpCheck, ["MCP contract `1.6` exposes sixteen tools", "vector_preflight_svg_print", "GET /api/v1/readiness"]);
requireTokens(files.capabilityCheck, sources.capabilityCheck, ['readiness: "/api/v1/readiness"', "GET /api/v1/readiness"]);
requireTokens(files.hygieneCheck, sources.hygieneCheck, ["retiredReadinessWorkflowAbsent: true", "generatedStateTracked: false"]);
requireTokens(files.isolationCheck, sources.isolationCheck, ["retiredReadinessWorkflowAbsent: true", "testCompilationWritesSharedDist: false"]);
requireTokens(files.releaseCheck, sources.releaseCheck, ["providerFreeEvidence: true", 'repositoryPublicationAuthority: "development.repository.publish"']);

requireTokens(files.hygieneDocs, sources.hygieneDocs, ["pnpm hygiene:check", "checked-in `.mjs` launch shims", "retired readiness workflow absence"]);
requireTokens(files.isolationDocs, sources.isolationDocs, ["empty test-output declaration", "No GitHub workflow is required"]);
requireTokens(files.docs, sources.docs, ["GET /api/v1/readiness", "public non-sensitive", "interactive.ready", "automation.ready", "clientReleaseEligible: false", "sensitiveValuesIncluded: false", "Provider-free validation", "repository hygiene", "test/build isolation"]);
requireTokens(files.apiDocs, sources.apiDocs, ["GET /api/v1/readiness"]);
requireTokens(files.capabilityDocs, sources.capabilityDocs, ["GET /api/v1/readiness"]);
requireTokens(files.printDocs, sources.printDocs, ["vector_preflight_svg_print"]);
requireTokens(files.readme, sources.readme, ["MCP contract `1.6` exposes sixteen tools", "vector_preflight_svg_print", "GET  /api/v1/capabilities", "GET /api/v1/readiness", "POST /api/v1/print/preflight", "docs/READINESS.md"]);
forbidTokens(files.readme, sources.readme, ["MCP contract `1.5` exposes fifteen tools"]);

if (errors.length > 0) {
  process.stderr.write(`${JSON.stringify({ check: "evavo-vector-studio-runtime-readiness", ok: false, contractVersion: "2.0", errors }, null, 2)}\n`);
  process.exit(1);
}
process.stdout.write(`${JSON.stringify({
  check: "evavo-vector-studio-runtime-readiness",
  ok: true,
  contractVersion: "2.0",
  endpoint: "/api/v1/readiness",
  publicNonSensitive: true,
  interactiveReadiness: true,
  automationReadiness: true,
  repositoryHygieneGoverned: true,
  testBuildIsolationGoverned: true,
  providerFreeReleaseProofGoverned: true,
  retiredReadinessWorkflowAbsent: true,
  automaticClientPromotion: false,
  sensitiveValuesIncluded: false,
  checkedFiles: [...checkedFiles].sort(),
}, null, 2)}\n`);
