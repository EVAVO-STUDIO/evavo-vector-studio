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
    errors.push(`Missing or unreadable capability-discovery file: ${relativePath} (${error instanceof Error ? error.message : String(error)})`);
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
    if (!source.includes(token)) errors.push(`${relativePath} is missing capability-discovery token: ${token}`);
  }
}

function forbidTokens(relativePath, source, tokens) {
  for (const token of tokens) {
    if (source.includes(token)) errors.push(`${relativePath} contains prohibited capability-discovery material: ${token}`);
  }
}

const files = {
  package: "package.json",
  route: "apps/web/app/api/v1/capabilities/route.ts",
  documentation: "docs/CAPABILITIES.md",
  workflow: ".github/workflows/capabilities-api-contract.yml",
};
const sources = Object.fromEntries(
  await Promise.all(Object.entries(files).map(async ([key, relativePath]) => [key, await read(relativePath)])),
);
const packageJson = await readJson(files.package);

if (packageJson?.scripts?.["capabilities-api:check"] !== "node scripts/check-capability-discovery.mjs") {
  errors.push("package.json must expose the capability-discovery contract.");
}
if (!String(packageJson?.scripts?.check ?? "").includes("pnpm capabilities-api:check")) {
  errors.push("package.json check must include capability discovery before dependency-backed gates.");
}

requireTokens(files.route, sources.route, [
  'export const runtime = "nodejs"',
  'export const dynamic = "force-dynamic"',
  'CAPABILITIES_CONTRACT_VERSION = "1.0"',
  'MCP_CONTRACT_VERSION = "1.5"',
  'endpoint: "/api/v1/capabilities"',
  'authentication: "public non-sensitive capability metadata"',
  'headers.set("cache-control", "no-store, max-age=0")',
  'headers.set("x-content-type-options", "nosniff")',
  'generatedBodiesIncluded: false',
  'sensitiveValuesIncluded: false',
  'deliveryProfiles: Object.freeze(["editable", "web", "motion", "print"])',
  'defaultDeliveryProfile: "editable"',
  'stableIdProfiles: Object.freeze(["editable", "motion"])',
  'alphaAwareAnalysis: true',
  'visibleContentBounds: true',
  'safetyRollbackEvidence: true',
  'renderComparison: "alpha-aware-multi-scale"',
  "MOTION_CONTRACT_VERSION",
  "LOTTIE_CONTRACT_VERSION",
  "DOTLOTTIE_CONTRACT_VERSION",
  "BATCH_CONTRACT_VERSION",
  "VECTOR_WORKER_CONTRACT_VERSION",
  "VECTOR_WORKER_SUPPORTED_OPERATIONS",
  'providerQueueDelivery: false',
  'managedRemoteExecution: false',
  'distributedAutoscaling: false',
  'state: "human-review-required"',
  "export function GET(): Response",
]);
forbidTokens(files.route, sources.route, [
  "process.env",
  "console.log(",
  "remoteExecutionAvailable: true",
  "productionAutoApprovalAvailable: true",
  'state: "approved"',
]);

requireTokens(files.documentation, sources.documentation, [
  "# Unified capability discovery",
  "GET /api/v1/capabilities",
  "public metadata",
  "Protected production endpoints retain their existing session or bearer authentication",
  "alpha-aware source analysis and visible-content bounds",
  "editable, web, motion and print delivery profiles",
  "safety rollback evidence",
  "providerQueueDelivery: false",
  "managedRemoteExecution: false",
  "distributedAutoscaling: false",
  "state: human-review-required",
  "pnpm capabilities-api:check",
  "exact dependency installation",
]);
forbidTokens(files.documentation, sources.documentation, [
  "productionAutoApprovalAvailable: true",
  "managedRemoteExecution: true",
  "providerQueueDelivery: true",
]);

requireTokens(files.workflow, sources.workflow, [
  "name: Vector Studio capability discovery",
  "Verify capability discovery contract",
  "node scripts/check-capability-discovery.mjs",
  "pnpm install --frozen-lockfile",
  "pnpm --filter @evavo/vector-web typecheck",
  "pnpm --filter @evavo/vector-web build",
  "api/vector-capabilities-contract",
  "api/vector-capabilities-typecheck",
  "api/vector-capabilities-build",
]);

if (errors.length > 0) {
  process.stderr.write(`${JSON.stringify({
    check: "evavo-vector-studio-capability-discovery",
    ok: false,
    contractVersion: "1.0",
    errors,
  }, null, 2)}\n`);
  process.exit(1);
}

process.stdout.write(`${JSON.stringify({
  check: "evavo-vector-studio-capability-discovery",
  ok: true,
  contractVersion: "1.0",
  endpoint: "/api/v1/capabilities",
  publicNonSensitiveMetadata: true,
  generatedBodiesIncluded: false,
  sensitiveValuesIncluded: false,
  deliveryProfiles: ["editable", "web", "motion", "print"],
  mcpContractVersion: "1.5",
  managedRemoteExecution: false,
  productionAutoApprovalAvailable: false,
  focusedTypecheckAndBuild: true,
  checkedFiles: [...checkedFiles].sort(),
}, null, 2)}\n`);
