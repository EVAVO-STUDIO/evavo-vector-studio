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
    errors.push(`Missing or unreadable capabilities file: ${relativePath} (${error instanceof Error ? error.message : String(error)})`);
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
    if (!source.includes(token)) errors.push(`${relativePath} is missing capabilities token: ${token}`);
  }
}

function forbidTokens(relativePath, source, tokens) {
  for (const token of tokens) {
    if (source.includes(token)) errors.push(`${relativePath} contains prohibited capabilities material: ${token}`);
  }
}

const files = {
  package: "package.json",
  route: "apps/web/app/api/v1/capabilities/route.ts",
  readme: "README.md",
  apiDocs: "docs/API.md",
  workflow: ".github/workflows/quality.yml",
};
const sources = Object.fromEntries(
  await Promise.all(Object.entries(files).map(async ([key, relativePath]) => [key, await read(relativePath)])),
);
const packageJson = await readJson(files.package);

if (packageJson?.scripts?.["capabilities-api:check"] !== "node scripts/check-capabilities-api-contract.mjs") {
  errors.push("package.json must expose capabilities-api:check.");
}
if (!String(packageJson?.scripts?.check ?? "").includes("pnpm capabilities-api:check")) {
  errors.push("package.json check must include capabilities-api:check before dependency-backed gates.");
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
  'hostedRecordControlPlane: "configured-runtime-dependent"',
  'workerObjectTransfer: "configured-runtime-dependent"',
  'providerQueueDelivery: false',
  'managedRemoteExecution: false',
  'distributedAutoscaling: false',
  'state: "human-review-required"',
  "export function GET(): Response",
]);
forbidTokens(files.route, sources.route, [
  "process.env",
  "VECTOR_API_TOKEN",
  "VECTOR_WORKER_API_TOKEN",
  "EVAVO_CLIENT_APP_LAUNCH_SECRET",
  "EVAVO_VECTOR_PRIVATE_SIGNING_SECRET",
  "UPSTASH_REDIS_REST_TOKEN",
  "console.log(",
  "remoteExecutionAvailable: true",
  "productionAutoApprovalAvailable: true",
  'state: "approved"',
]);
requireTokens(files.readme, sources.readme, [
  "/api/v1/capabilities",
  "Unified capability discovery",
]);
requireTokens(files.apiDocs, sources.apiDocs, [
  "GET /api/v1/capabilities",
  "non-sensitive",
  "human-review-required",
]);
requireTokens(files.workflow, sources.workflow, [
  "Verify capability discovery contract",
  "node scripts/check-capabilities-api-contract.mjs",
]);

if (errors.length > 0) {
  process.stderr.write(`${JSON.stringify({
    check: "evavo-vector-studio-capabilities-api",
    ok: false,
    contractVersion: "1.0",
    errors,
  }, null, 2)}\n`);
  process.exit(1);
}

process.stdout.write(`${JSON.stringify({
  check: "evavo-vector-studio-capabilities-api",
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
  checkedFiles: [...checkedFiles].sort(),
}, null, 2)}\n`);
