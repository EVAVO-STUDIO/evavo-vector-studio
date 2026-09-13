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
  try { return JSON.parse(source); } catch (error) {
    errors.push(`Invalid JSON: ${relativePath} (${error instanceof Error ? error.message : String(error)})`);
    return null;
  }
}
function requireTokens(relativePath, source, tokens) {
  for (const token of tokens) if (!source.includes(token)) errors.push(`${relativePath} is missing Vercel deployment token: ${token}`);
}
function forbidTokens(relativePath, source, tokens) {
  for (const token of tokens) if (source.includes(token)) errors.push(`${relativePath} contains prohibited Vercel deployment token: ${token}`);
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
  exactMain: "scripts/check-exact-current-main.mjs",
  providerEnforcer: "scripts/enforce-vercel-provider-inspection-receipt.mjs",
  provisioning: "scripts/run-vector-vercel-provisioning-local.mjs",
  production: "scripts/run-vector-vercel-production-local.mjs",
  retirementPlan: ".evavo/workflow-retirement-plan.json",
  retirementCheck: "scripts/check-workflow-retirement.mjs",
});
const sources = Object.fromEntries(await Promise.all(Object.entries(files).map(async ([key, relativePath]) => [key, await read(relativePath)])));
const rootPackage = await readJson(files.rootPackage);
const vercelConfig = await readJson(files.vercelConfig);
const deploymentManifest = await readJson(files.deploymentManifest);
const turbo = await readJson(files.turbo);
const retirementPlan = await readJson(files.retirementPlan);

if (!sources.lockfile.trim()) errors.push("pnpm-lock.yaml must exist before a frozen Vercel deployment can be claimed.");
if (rootPackage?.packageManager !== "pnpm@10.14.0") errors.push("The Vercel contract requires pnpm@10.14.0.");
if (rootPackage?.scripts?.["vercel:check"] !== "node scripts/check-vercel-deployment-contract.mjs") errors.push("package.json must expose vercel:check.");
if (!String(rootPackage?.scripts?.check ?? "").includes("pnpm vercel:check")) errors.push("package.json check must include vercel:check before dependency-backed gates.");

if (vercelConfig?.framework !== "nextjs") errors.push("apps/web/vercel.json must use the Next.js framework preset.");
if (vercelConfig?.installCommand !== "cd ../.. && pnpm install --frozen-lockfile") errors.push("apps/web/vercel.json must install the complete workspace from the repository root with a frozen lockfile.");
if (vercelConfig?.buildCommand !== "cd ../.. && pnpm exec turbo run build --filter=@evavo/vector-web") errors.push("apps/web/vercel.json must build only the governed Vector web workspace through Turbo.");

requireTokens(files.deploymentProfile, sources.deploymentProfile, [
  'VECTOR_DEPLOYMENT_PROFILE_VERSION = "1.0"',
  "VERCEL_FUNCTION_BODY_LIMIT_BYTES = 4_500_000",
  "VERCEL_SAFE_REQUEST_BYTES = 4_000_000",
  "VERCEL_SAFE_RESPONSE_BYTES = 4_000_000",
  "VERCEL_SAFE_MULTIPART_FILE_BYTES = 3_250_000",
  "VERCEL_SAFE_BASE64_BINARY_BYTES = 2_750_000",
  "resolveVectorInteractivePayloadPolicy",
  "providerDirectPrivateStorageConfigured: false",
]);
requireTokens(files.traceRoute, sources.traceRoute, [
  'from "../../../../lib/deployment-profile"',
  "export const maxDuration = 60",
  "TRACE_PAYLOAD_POLICY.maxRequestBytes",
  "TRACE_PAYLOAD_POLICY.maxFileBytes",
  "TRACE_PAYLOAD_POLICY.maxResponseBytes",
  '"VECTOR_INTERACTIVE_PAYLOAD_TOO_LARGE"',
  '"VECTOR_INTERACTIVE_RESPONSE_TOO_LARGE"',
  'largeObjectTransport: "local CLI, MCP, self-hosted worker, or provider-direct private storage"',
]);
requireTokens(files.healthRoute, sources.healthRoute, ["vectorDeploymentPublicView", "deployment:", 'promotionStatus: "staged"', "clientReleaseEligible: false"]);

if (deploymentManifest?.schemaVersion !== 2) errors.push("Deployment metadata must use schema version 2.");
if (deploymentManifest?.productionOrigin !== "https://vector.evavo.com.au") errors.push("Deployment metadata must retain the canonical private origin.");
if (deploymentManifest?.platform?.provider !== "vercel") errors.push("Deployment metadata must identify Vercel as the staged provider.");
if (deploymentManifest?.platform?.projectId !== "prj_Nb5IcrF5Fd0xhwDoUfZPJYmwSo6L") errors.push("Deployment metadata must retain the pinned Vercel project identifier.");
if (deploymentManifest?.platform?.projectRoot !== "apps/web") errors.push("Deployment metadata must identify apps/web as the project root.");
if (deploymentManifest?.platform?.expectedNodeVersion !== "22.x") errors.push("Deployment metadata must retain the governed Node.js version.");
if (deploymentManifest?.platform?.sourceControlMode !== "api-managed-or-exact-github") errors.push("Deployment metadata must retain governed source-control modes.");
if (deploymentManifest?.platform?.installCommand !== "pnpm install --frozen-lockfile") errors.push("Deployment metadata must retain frozen installation.");
if (deploymentManifest?.promotionState?.status !== "staged") errors.push("Client promotion must remain staged until separate human approval.");
if (deploymentManifest?.promotionState?.clientReleaseEligible !== false) errors.push("Client release must remain ineligible by source contract.");
if (deploymentManifest?.largeObjectTransport?.providerDirectPrivateStorageConfigured !== false) errors.push("Provider-direct private storage must remain unavailable until implemented.");

const outputs = turbo?.tasks?.build?.outputs;
if (!Array.isArray(outputs) || !outputs.includes(".next/**") || !outputs.includes("!.next/cache/**")) errors.push("turbo.json must retain Next.js output while excluding the mutable .next cache.");
if (!Array.isArray(turbo?.tasks?.build?.dependsOn) || !turbo.tasks.build.dependsOn.includes("^build")) errors.push("Turbo build must retain the workspace dependency build graph.");

requireTokens(files.exactMain, sources.exactMain, [
  'const REPOSITORY = "EVAVO-STUDIO/evavo-vector-studio"',
  'git", ["ls-remote", "--heads", "origin", "refs/heads/main"]',
  'VECTOR_MAIN_REMOTE_MISMATCH',
  'mutationPerformed: false',
  'repositoryPublicationAuthority: false',
]);
requireTokens(files.providerEnforcer, sources.providerEnforcer, [
  'const ENFORCER_CHECK = "vector-studio-vercel-provider-inspection-receipt"',
  'plan.inspectionAvailable !== true',
  'project.identity?.passed !== true',
  'project.gitLink?.acceptable !== true',
  'receipt.deploymentPerformed !== false',
  'receipt.mutationPerformed !== false',
  'receipt.sensitiveValuesRecorded !== false',
]);
forbidTokens(files.providerEnforcer, sources.providerEnforcer, ["fetch(", "process.env.VERCEL_TOKEN", 'method: "POST"', 'method: "PATCH"', 'method: "DELETE"']);
requireTokens(files.provisioning, sources.provisioning, [
  '["plan", "settings", "apply"]',
  '"scripts/check-exact-current-main.mjs"',
  '"scripts/run-vector-vercel-settings-source.mjs"',
  '"scripts/plan-vector-studio-vercel-provisioning.mjs"',
  '"scripts/enforce-vercel-provider-inspection-receipt.mjs"',
  '"scripts/provision-vector-studio-vercel.mjs"',
  'deploymentPerformed: false',
  'githubActionsAuthority: false',
]);
requireTokens(files.production, sources.production, [
  'const DEPLOY_CONFIRMATION = "deploy-evavo-vector-studio"',
  '"scripts/check-exact-current-main.mjs"',
  '"scripts/create-source-proof.mjs"',
  '"scripts/deploy-vector-studio-vercel.mjs"',
  '"scripts/verify-live-private-response.mjs"',
  '"scripts/verify-live-deployment.mjs"',
  '"scripts/verify-live-capability-discovery.mjs"',
  'runLaunchProof("owner"',
  'runLaunchProof("client"',
  'automaticClientPromotion: false',
  'githubActionsAuthority: false',
]);

requireTokens(files.retirementCheck, sources.retirementCheck, [
  'check: "evavo-vector-studio-workflow-retirement"',
  'Retired workflow plan requires zero active workflows',
  'githubActionsRoutineAuthority: false',
  'githubWorkflowPublicationAuthority: false',
]);
if (retirementPlan?.state !== "retired") errors.push("Vector workflow retirement plan must be retired.");
if (!Array.isArray(retirementPlan?.allowedMigrationDebt) || retirementPlan.allowedMigrationDebt.length !== 0) errors.push("Vector workflow retirement plan must have zero migration debt.");
if (retirementPlan?.githubActionsRoutineAuthority !== false || retirementPlan?.githubWorkflowPublicationAuthority !== false) errors.push("Vector retirement plan cannot grant GitHub Actions validation or publication authority.");

let workflowFiles = [];
try {
  const entries = await fs.readdir(path.join(root, ".github", "workflows"), { withFileTypes: true });
  workflowFiles = entries.filter((entry) => entry.isFile() && /\.ya?ml$/u.test(entry.name)).map((entry) => entry.name).sort();
} catch (error) {
  if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) errors.push(`Unable to inspect workflow directory: ${error instanceof Error ? error.message : String(error)}`);
}
if (workflowFiles.length !== 0) errors.push(`GitHub Actions YAML must remain absent; found: ${workflowFiles.join(", ")}.`);

forbidTokens(files.vercelConfig, sources.vercelConfig, ['"installCommand": "npm install"', '"installCommand": "pnpm install --no-frozen-lockfile"']);
forbidTokens(files.provisioning, sources.provisioning, ["actions/", "git push", "vercel --prod", "vercel deploy"]);
forbidTokens(files.production, sources.production, ["actions/", "contents: write", "git push", "vercel --prod", "vercel deploy"]);

if (errors.length > 0) {
  process.stderr.write(`${JSON.stringify({ check: "evavo-vector-studio-vercel-deployment", ok: false, contractVersion: "2.0", errors }, null, 2)}\n`);
  process.exit(1);
}
process.stdout.write(`${JSON.stringify({
  check: "evavo-vector-studio-vercel-deployment",
  ok: true,
  contractVersion: "2.0",
  projectName: "evavo-vector-studio",
  projectRoot: "apps/web",
  productionOrigin: "https://vector.evavo.com.au",
  promotionStatus: "staged",
  clientReleaseEligible: false,
  providerFreeExecution: true,
  providerOnlyInspectionGoverned: true,
  applicationAuthoritiesSeparatedFromProviderAccess: true,
  exactCurrentMainRequired: true,
  productionLiveProofsGoverned: true,
  githubActionsAuthority: false,
  activeWorkflowCount: 0,
  checkedFiles: [...checkedFiles].sort(),
}, null, 2)}\n`);
