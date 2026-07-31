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

function stringConstant(relativePath, source, name) {
  const expression = new RegExp(`(?:export\\s+)?const\\s+${name}\\s*=\\s*\"([^\"]+)\"(?:\\s+as\\s+const)?\\s*;`);
  const value = source.match(expression)?.[1] ?? null;
  if (!value) errors.push(`${relativePath} does not expose ${name} as a canonical string constant.`);
  return value;
}

function integerConstant(relativePath, source, name) {
  const expression = new RegExp(`(?:export\\s+)?const\\s+${name}\\s*=\\s*([0-9_]+)\\s*;`);
  const raw = source.match(expression)?.[1] ?? null;
  if (!raw) {
    errors.push(`${relativePath} does not expose ${name} as a canonical integer constant.`);
    return null;
  }
  const value = Number(raw.replaceAll("_", ""));
  if (!Number.isSafeInteger(value)) {
    errors.push(`${relativePath} exposes an unsafe integer for ${name}.`);
    return null;
  }
  return value;
}

function stringArrayConstant(relativePath, source, name) {
  const expression = new RegExp(
    `(?:export\\s+)?const\\s+${name}\\s*=\\s*Object\\.freeze\\(\\[([\\s\\S]*?)\\]\\s*as\\s+const\\s*\\)\\s*;`,
  );
  const block = source.match(expression)?.[1] ?? null;
  if (block === null) {
    errors.push(`${relativePath} does not expose ${name} as a canonical frozen string array.`);
    return [];
  }
  const values = [...block.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  if (values.length < 1) errors.push(`${relativePath} exposes an empty ${name} array.`);
  return values;
}

function directlyRegisteredToolNames(relativePath, source) {
  const values = [...source.matchAll(/server\.registerTool\(\s*"([^"]+)"/g)].map((match) => match[1]);
  if (values.length < 1) errors.push(`${relativePath} does not directly register any MCP tools.`);
  return values;
}

async function requireAbsent(relativePath) {
  checkedFiles.add(relativePath);
  try {
    await fs.access(path.join(root, relativePath));
    errors.push(`${relativePath} is superseded and must remain absent.`);
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) {
      errors.push(`Could not verify absence of ${relativePath} (${error instanceof Error ? error.message : String(error)}).`);
    }
  }
}

const files = {
  package: "package.json",
  webPackage: "apps/web/package.json",
  route: "apps/web/app/api/v1/capabilities/route.ts",
  batchTypes: "packages/job-engine/src/types.ts",
  mcpServer: "packages/mcp/src/server.ts",
  mcpLottieTools: "packages/mcp/src/lottie-tools.ts",
  mcpDotLottieTools: "packages/mcp/src/dotlottie-tools.ts",
  mcpBatchTools: "packages/mcp/src/batch-tools.ts",
  documentation: "docs/CAPABILITIES.md",
  workflow: ".github/workflows/capabilities-api-contract.yml",
};
const sources = Object.fromEntries(
  await Promise.all(Object.entries(files).map(async ([key, relativePath]) => [key, await read(relativePath)])),
);
const packageJson = await readJson(files.package);
const webPackageJson = await readJson(files.webPackage);
await requireAbsent("scripts/check-capabilities-api-contract.mjs");

if (packageJson?.scripts?.["capabilities-api:check"] !== "node scripts/check-capability-discovery.mjs") {
  errors.push("package.json must expose the canonical capability-discovery contract.");
}
if (!String(packageJson?.scripts?.check ?? "").includes("pnpm capabilities-api:check")) {
  errors.push("package.json check must include capability discovery before dependency-backed gates.");
}
if (packageJson?.scripts?.["build:packages"] === undefined) {
  errors.push("package.json must expose build:packages for focused web dependency compilation.");
}

const routeVersion = stringConstant(files.route, sources.route, "VECTOR_STUDIO_VERSION");
if (routeVersion && packageJson?.version !== routeVersion) {
  errors.push(`Capability service version ${routeVersion} does not match root package version ${String(packageJson?.version)}.`);
}

const canonicalBatchVersion = stringConstant(files.batchTypes, sources.batchTypes, "BATCH_CONTRACT_VERSION");
const routeBatchVersion = stringConstant(files.route, sources.route, "BATCH_CONTRACT_VERSION");
if (canonicalBatchVersion && routeBatchVersion && canonicalBatchVersion !== routeBatchVersion) {
  errors.push(`Capability batch contract ${routeBatchVersion} does not match job-engine ${canonicalBatchVersion}.`);
}
const canonicalMaximumBatchItems = integerConstant(files.batchTypes, sources.batchTypes, "MAX_BATCH_ITEMS");
const routeMaximumBatchItems = integerConstant(files.route, sources.route, "MAX_BATCH_ITEMS");
if (
  canonicalMaximumBatchItems !== null &&
  routeMaximumBatchItems !== null &&
  canonicalMaximumBatchItems !== routeMaximumBatchItems
) {
  errors.push(`Capability maximum batch items ${routeMaximumBatchItems} does not match job-engine ${canonicalMaximumBatchItems}.`);
}

const canonicalMcpVersion = stringConstant(
  files.mcpServer,
  sources.mcpServer,
  "VECTOR_MCP_SERVER_CONTRACT_VERSION",
);
const routeMcpVersion = stringConstant(files.route, sources.route, "MCP_CONTRACT_VERSION");
if (canonicalMcpVersion && routeMcpVersion && canonicalMcpVersion !== routeMcpVersion) {
  errors.push(`Capability MCP contract ${routeMcpVersion} does not match MCP server ${canonicalMcpVersion}.`);
}
const canonicalMcpMaximumBatchItems = integerConstant(
  files.mcpBatchTools,
  sources.mcpBatchTools,
  "VECTOR_MCP_BATCH_MAX_ITEMS",
);
const routeMcpMaximumBatchItems = integerConstant(files.route, sources.route, "MCP_MAX_BATCH_ITEMS");
if (
  canonicalMcpMaximumBatchItems !== null &&
  routeMcpMaximumBatchItems !== null &&
  canonicalMcpMaximumBatchItems !== routeMcpMaximumBatchItems
) {
  errors.push(`Capability MCP batch maximum ${routeMcpMaximumBatchItems} does not match MCP source ${canonicalMcpMaximumBatchItems}.`);
}

const mcpToolNames = [
  ...directlyRegisteredToolNames(files.mcpServer, sources.mcpServer),
  ...stringArrayConstant(files.mcpLottieTools, sources.mcpLottieTools, "VECTOR_MCP_LOTTIE_TOOL_NAMES"),
  ...stringArrayConstant(files.mcpDotLottieTools, sources.mcpDotLottieTools, "VECTOR_MCP_DOTLOTTIE_TOOL_NAMES"),
  ...stringArrayConstant(files.mcpBatchTools, sources.mcpBatchTools, "VECTOR_MCP_BATCH_TOOL_NAMES"),
].sort();
const uniqueMcpToolNames = [...new Set(mcpToolNames)];
if (uniqueMcpToolNames.length !== mcpToolNames.length) {
  errors.push("MCP capability sources contain duplicate tool names.");
}
const routeMcpToolCount = integerConstant(files.route, sources.route, "MCP_TOOL_COUNT");
if (routeMcpToolCount !== null && routeMcpToolCount !== uniqueMcpToolNames.length) {
  errors.push(`Capability MCP tool count ${routeMcpToolCount} does not match ${uniqueMcpToolNames.length} source tool names.`);
}

const declaredDependencies = new Set([
  ...Object.keys(webPackageJson?.dependencies ?? {}),
  ...Object.keys(webPackageJson?.devDependencies ?? {}),
  ...Object.keys(webPackageJson?.peerDependencies ?? {}),
  ...Object.keys(webPackageJson?.optionalDependencies ?? {}),
]);
const workspaceImports = [...new Set(
  [...sources.route.matchAll(/\bfrom\s+["'](@evavo\/[^"']+)["']/g)].map((match) => match[1]),
)].sort();
for (const dependency of workspaceImports) {
  if (!declaredDependencies.has(dependency)) {
    errors.push(`${files.route} imports undeclared web workspace dependency: ${dependency}`);
  }
}

requireTokens(files.route, sources.route, [
  'export const runtime = "nodejs"',
  'export const dynamic = "force-dynamic"',
  'CAPABILITIES_CONTRACT_VERSION = "1.0"',
  "MCP_CONTRACT_VERSION",
  "MCP_TOOL_COUNT",
  "MCP_MAX_BATCH_ITEMS",
  "BATCH_CONTRACT_VERSION",
  "MAX_BATCH_ITEMS",
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
  'from "@evavo/job-engine"',
  'from "@evavo/vector-mcp"',
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

requireTokens(files.batchTypes, sources.batchTypes, [
  'export const BATCH_CONTRACT_VERSION = "1.0" as const;',
  "export const MAX_BATCH_ITEMS = 1_000;",
]);
requireTokens(files.mcpServer, sources.mcpServer, [
  'export const VECTOR_MCP_SERVER_CONTRACT_VERSION = "1.5" as const;',
  "registerVectorMcpLottieTools",
  "registerVectorMcpDotLottieTools",
  "registerVectorMcpBatchTools",
]);
requireTokens(files.mcpBatchTools, sources.mcpBatchTools, [
  "VECTOR_MCP_BATCH_MAX_ITEMS",
  "VECTOR_MCP_BATCH_TOOL_NAMES",
]);

requireTokens(files.documentation, sources.documentation, [
  "# Unified capability discovery",
  "GET /api/v1/capabilities",
  "public metadata",
  "Protected production endpoints retain their existing session or bearer authentication",
  "alpha-aware source analysis and visible-content bounds",
  "editable, web, motion and print delivery profiles",
  "safety rollback evidence",
  "dependency-light runtime route",
  "workspace import is declared",
  "batch contract version and maximum item count",
  "MCP contract version, tool count and MCP batch ceiling",
  "packages/mcp/**",
  "pnpm build:packages",
  "compiled workspace entrypoints",
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
  '"packages/mcp/**"',
  "Verify capability discovery contract",
  "node scripts/check-capability-discovery.mjs",
  "pnpm install --frozen-lockfile",
  "Build Vector workspace dependencies",
  "pnpm build:packages",
  "pnpm --filter @evavo/vector-web typecheck",
  "pnpm --filter @evavo/vector-web build",
  "api/vector-capabilities-contract",
  "api/vector-capabilities-dependencies",
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
  mcpContractVersion: routeMcpVersion,
  mcpToolCount: uniqueMcpToolNames.length,
  mcpMaximumBatchItems: routeMcpMaximumBatchItems,
  managedRemoteExecution: false,
  productionAutoApprovalAvailable: false,
  focusedTypecheckAndBuild: true,
  workspaceDependencyBuildRequired: true,
  dependencyLightRoute: true,
  workspaceImportDependencyClosure: true,
  batchMetadataSourceAgreement: true,
  mcpMetadataSourceAgreement: true,
  obsoleteCheckerAbsent: true,
  checkedFiles: [...checkedFiles].sort(),
}, null, 2)}\n`);
