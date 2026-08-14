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
    if (!source.includes(token)) errors.push(`${relativePath} is missing Vercel deployment token: ${token}`);
  }
}

function forbidTokens(relativePath, source, tokens) {
  for (const token of tokens) {
    if (source.includes(token)) errors.push(`${relativePath} contains prohibited Vercel deployment token: ${token}`);
  }
}

const files = Object.freeze({
  rootPackage: "package.json",
  lockfile: "pnpm-lock.yaml",
  vercelConfig: "apps/web/vercel.json",
  deploymentProfile: "apps/web/lib/deployment-profile.ts",
  traceRoute: "apps/web/app/api/v1/trace/route.ts",
  healthRoute: "apps/web/app/api/health/route.ts",
  deploymentManifest: "apps/web/public/hub/evavo-vector-studio.deployment.json",
  turbo: "turbo.json",
  docs: "docs/VERCEL-DEPLOYMENT.md",
  workflow: ".github/workflows/vercel-deployment-contract.yml",
  preflightWorkflow: ".github/workflows/vector-vercel-provisioning-preflight.yml",
  preflightMarker: ".github/vector-vercel-preflight.trigger",
  providerEnforcer: "scripts/enforce-vercel-provider-inspection-receipt.mjs",
});
const sources = Object.fromEntries(
  await Promise.all(Object.entries(files).map(async ([key, relativePath]) => [key, await read(relativePath)])),
);
const rootPackage = await readJson(files.rootPackage);
const vercelConfig = await readJson(files.vercelConfig);
const deploymentManifest = await readJson(files.deploymentManifest);
const turbo = await readJson(files.turbo);

if (!sources.lockfile.trim()) errors.push("pnpm-lock.yaml must exist before a frozen Vercel deployment can be claimed.");
if (rootPackage?.packageManager !== "pnpm@10.14.0") errors.push("The Vercel contract requires pnpm@10.14.0.");
if (rootPackage?.scripts?.["vercel:check"] !== "node scripts/check-vercel-deployment-contract.mjs") {
  errors.push("package.json must expose vercel:check.");
}
if (!String(rootPackage?.scripts?.check ?? "").includes("pnpm vercel:check")) {
  errors.push("package.json check must include vercel:check before dependency-backed gates.");
}

if (vercelConfig?.framework !== "nextjs") errors.push("apps/web/vercel.json must use the Next.js framework preset.");
if (vercelConfig?.installCommand !== "cd ../.. && pnpm install --frozen-lockfile") {
  errors.push("apps/web/vercel.json must install the complete workspace from the repository root with a frozen lockfile.");
}
if (vercelConfig?.buildCommand !== "cd ../.. && pnpm exec turbo run build --filter=@evavo/vector-web") {
  errors.push("apps/web/vercel.json must build only the governed Vector web workspace through Turbo.");
}

requireTokens(files.deploymentProfile, sources.deploymentProfile, [
  'VECTOR_DEPLOYMENT_PROFILE_VERSION = "1.0"',
  "VERCEL_FUNCTION_BODY_LIMIT_BYTES = 4_500_000",
  "VERCEL_SAFE_REQUEST_BYTES = 4_000_000",
  "VERCEL_SAFE_RESPONSE_BYTES = 4_000_000",
  "VERCEL_SAFE_MULTIPART_FILE_BYTES = 3_250_000",
  "VERCEL_SAFE_BASE64_BINARY_BYTES = 2_750_000",
  "resolveVectorInteractivePayloadPolicy",
  "providerDirectPrivateStorageConfigured: false",
  '"provider-direct-private-storage-pending"',
]);
requireTokens(files.traceRoute, sources.traceRoute, [
  'from "../../../../lib/deployment-profile"',
  "export const maxDuration = 60",
  "TRACE_PAYLOAD_POLICY.maxRequestBytes",
  "TRACE_PAYLOAD_POLICY.maxFileBytes",
  "TRACE_PAYLOAD_POLICY.maxResponseBytes",
  '"VECTOR_INTERACTIVE_PAYLOAD_TOO_LARGE"',
  '"VECTOR_INTERACTIVE_RESPONSE_TOO_LARGE"',
  "encodedJsonBytes(payload)",
  "encodedTextBytes(body)",
  'largeObjectTransport: "local CLI, MCP, self-hosted worker, or provider-direct private storage"',
]);
forbidTokens(files.traceRoute, sources.traceRoute, [
  "file.size > DEFAULT_MAX_INPUT_BYTES",
  "contentLength > DEFAULT_MAX_INPUT_BYTES + MULTIPART_OVERHEAD_ALLOWANCE",
]);
requireTokens(files.healthRoute, sources.healthRoute, [
  "vectorDeploymentPublicView",
  "deployment:",
  'promotionStatus: "staged"',
  "clientReleaseEligible: false",
]);

if (deploymentManifest?.schemaVersion !== 2) errors.push("Deployment metadata must use schema version 2.");
if (deploymentManifest?.productionOrigin !== "https://vector.evavo.com.au") errors.push("Deployment metadata must retain the canonical private origin.");
if (deploymentManifest?.platform?.provider !== "vercel") errors.push("Deployment metadata must identify Vercel as the staged provider.");
if (deploymentManifest?.platform?.projectId !== "prj_Nb5IcrF5Fd0xhwDoUfZPJYmwSo6L") errors.push("Deployment metadata must retain the pinned Vercel project identifier.");
if (deploymentManifest?.platform?.projectRoot !== "apps/web") errors.push("Deployment metadata must identify apps/web as the project root.");
if (deploymentManifest?.platform?.expectedNodeVersion !== "22.x") errors.push("Deployment metadata must retain the governed Node.js version.");
if (deploymentManifest?.platform?.sourceControlMode !== "api-managed-or-exact-github") errors.push("Deployment metadata must retain the governed source-control modes.");
if (deploymentManifest?.platform?.installCommand !== "pnpm install --frozen-lockfile") errors.push("Deployment metadata must retain frozen installation.");
if (deploymentManifest?.promotionState?.status !== "staged") errors.push("Deployment promotion must remain staged.");
if (deploymentManifest?.promotionState?.clientReleaseEligible !== false) errors.push("Client release must remain ineligible.");
if (deploymentManifest?.promotionState?.vercelProjectProvisioned !== true) errors.push("The created Vercel project must remain recorded while later release evidence stays staged.");
if (deploymentManifest?.promotionState?.productionDomainProvisioned !== false) errors.push("The production domain cannot be marked verified.");
if (deploymentManifest?.largeObjectTransport?.providerDirectPrivateStorageConfigured !== false) errors.push("Provider-direct private storage must remain unavailable until implemented.");
for (const [key, value] of Object.entries(deploymentManifest?.promotionState ?? {})) {
  if (key.endsWith("Verified") && value !== false) errors.push(`Staged deployment evidence ${key} cannot be true.`);
}

const outputs = turbo?.tasks?.build?.outputs;
if (!Array.isArray(outputs) || !outputs.includes(".next/**") || !outputs.includes("!.next/cache/**")) {
  errors.push("turbo.json must retain Next.js output while excluding the mutable .next cache.");
}
if (!Array.isArray(turbo?.tasks?.build?.dependsOn) || !turbo.tasks.build.dependsOn.includes("^build")) {
  errors.push("Turbo build must retain the workspace dependency build graph.");
}

requireTokens(files.docs, sources.docs, [
  "Project ID              prj_Nb5IcrF5Fd0xhwDoUfZPJYmwSo6L",
  "Minimum state           project-created",
  "Production deployments  0",
  "The standalone Vercel project now exists",
  "vector-vercel-provisioning-preflight.yml",
  "Provider access requires only `VERCEL_TOKEN`",
  "Application authorities remain a separate apply gate",
  "provider inspection can pass while `readyToApply` remains false",
  "performed no Vercel mutation",
  "manual-only",
  "exact current `main` SHA",
  "Actions minutes",
  "inert compatibility marker",
  "4.5 MB",
  "3,250,000",
  "pnpm install --frozen-lockfile",
  "Provider-direct private storage",
  "Client release remains withheld",
]);
requireTokens(files.workflow, sources.workflow, [
  "Vector Studio Vercel deployment contract",
  "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
  "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020",
  "actions/github-script@3a2844b7e9c422d3c10d287c895573f7108da1b3",
  "node-version-file: .nvmrc",
  "corepack prepare pnpm@10.14.0 --activate",
  "node scripts/check-lockfile-integrity.mjs",
  "node scripts/check-vercel-deployment-contract.mjs",
  "node scripts/check-vercel-project-provisioning-contract.mjs",
  "node scripts/check-vercel-provisioning-plan-receipt-contract.mjs",
  "node scripts/enforce-vercel-provider-inspection-receipt.mjs --self-test",
  "node scripts/check-private-response-contract.mjs",
  "pnpm install --frozen-lockfile",
  "pnpm --filter @evavo/vector-web typecheck",
  "pnpm exec turbo run build --filter=@evavo/vector-web",
  "git diff --exit-code",
]);
forbidTokens(files.workflow, sources.workflow, [
  "pnpm --filter @evavo/vector-web build",
  "pnpm/action-setup@",
  "node-version: 22",
]);

requireTokens(files.preflightWorkflow, sources.preflightWorkflow, [
  "Vector Studio Vercel provisioning preflight",
  "run-name: Vector provider preflight @ ${{ inputs.commit }}",
  ".github/vector-vercel-preflight.trigger",
  "workflow_dispatch:",
  "commit:",
  "environment: vector-studio-production",
  "Check out exact current main",
  "ref: ${{ inputs.commit }}",
  "Resolve exact current main",
  'test "$CURRENT_MAIN_SHA" = "${{ inputs.commit }}"',
  "Verify exact current main identity",
  "node-version-file: .nvmrc",
  "corepack prepare pnpm@10.14.0 --activate",
  'VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}',
  'EVAVO_CLIENT_APP_LAUNCH_SECRET: ${{ secrets.EVAVO_CLIENT_APP_LAUNCH_SECRET }}',
  'EVAVO_VECTOR_PRIVATE_SIGNING_SECRET: ${{ secrets.EVAVO_VECTOR_PRIVATE_SIGNING_SECRET }}',
  'UPSTASH_REDIS_REST_URL: ${{ secrets.UPSTASH_REDIS_REST_URL }}',
  'UPSTASH_REDIS_REST_TOKEN: ${{ secrets.UPSTASH_REDIS_REST_TOKEN }}',
  'VECTOR_API_TOKEN: ${{ secrets.VECTOR_API_TOKEN }}',
  'VECTOR_WORKER_API_TOKEN: ${{ secrets.VECTOR_WORKER_API_TOKEN }}',
  "Create bounded no-mutation provider plan",
  "node scripts/plan-vector-studio-vercel-provisioning.mjs",
  "Enforce bounded provider inspection receipt",
  "node scripts/enforce-vercel-provider-inspection-receipt.mjs",
  "read-only Vector provider inspection passed",
  'context: "deploy/vector-studio-vercel-preflight"',
]);
forbidTokens(files.preflightWorkflow, sources.preflightWorkflow, [
  "node <<'NODE'",
  "fetch(`https://api.vercel.com",
  "vercel project add",
  "vercel deploy",
  "vercel --prod",
  'method: "POST"',
  'method: "PATCH"',
  'method: "DELETE"',
  "contents: write",
  "\n  push:",
  "\n  pull_request:",
  "\n  schedule:",
]);
requireTokens(files.preflightMarker, sources.preflightMarker, [
  "retired compatibility marker",
  "manual-only through workflow_dispatch",
  "performs no automatic dispatch",
]);
requireTokens(files.providerEnforcer, sources.providerEnforcer, [
  'const ENFORCER_CHECK = "vector-studio-vercel-provider-inspection-receipt"',
  'const PROJECT_ID = "prj_Nb5IcrF5Fd0xhwDoUfZPJYmwSo6L"',
  "plan.inspectionAvailable !== true",
  "project.identity?.passed !== true",
  "project.gitLink?.acceptable !== true",
  "receipt.deploymentPerformed !== false",
  "receipt.mutationPerformed !== false",
  "receipt.sensitiveValuesRecorded !== false",
]);
forbidTokens(files.providerEnforcer, sources.providerEnforcer, [
  "fetch(",
  "process.env.VERCEL_TOKEN",
  'method: "POST"',
  'method: "PATCH"',
  'method: "DELETE"',
]);
forbidTokens(files.vercelConfig, sources.vercelConfig, [
  '"installCommand": "npm install"',
  '"installCommand": "pnpm install --no-frozen-lockfile"',
]);

if (errors.length > 0) {
  process.stderr.write(`${JSON.stringify({
    check: "evavo-vector-studio-vercel-deployment",
    ok: false,
    contractVersion: "1.1",
    errors,
  }, null, 2)}\n`);
  process.exit(1);
}

process.stdout.write(`${JSON.stringify({
  check: "evavo-vector-studio-vercel-deployment",
  ok: true,
  contractVersion: "1.1",
  projectName: "evavo-vector-studio",
  projectRoot: "apps/web",
  productionOrigin: "https://vector.evavo.com.au",
  promotionStatus: "staged",
  clientReleaseEligible: false,
  vercelProjectProvisioned: true,
  providerDirectPrivateStorageConfigured: false,
  providerOnlyInspectionGoverned: true,
  applicationAuthoritiesSeparatedFromProviderAccess: true,
  canonicalProviderReceiptEnforced: true,
  checkedFiles: [...checkedFiles].sort(),
}, null, 2)}\n`);
