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

function requireTokens(relativePath, source, tokens) {
  for (const token of tokens) {
    if (!source.includes(token)) errors.push(`${relativePath} is missing Vercel provisioning token: ${token}`);
  }
}

function forbidTokens(relativePath, source, tokens) {
  for (const token of tokens) {
    if (source.includes(token)) errors.push(`${relativePath} contains prohibited Vercel provisioning token: ${token}`);
  }
}

function workflowStep(source, name) {
  const marker = `      - name: ${name}\n`;
  const start = source.indexOf(marker);
  if (start < 0) return null;
  const tail = source.slice(start + marker.length);
  const next = tail.indexOf("\n      - name: ");
  return next < 0 ? tail : tail.slice(0, next);
}

const files = Object.freeze({
  package: "package.json",
  provisioner: "scripts/provision-vector-studio-vercel.mjs",
  planWrapper: "scripts/plan-vector-studio-vercel-provisioning.mjs",
  providerEnforcer: "scripts/enforce-vercel-provider-inspection-receipt.mjs",
  workflow: ".github/workflows/vector-vercel-project-provisioning.yml",
  preflightWorkflow: ".github/workflows/vector-vercel-provisioning-preflight.yml",
  deploymentWorkflow: ".github/workflows/vercel-deployment-contract.yml",
  docs: "docs/VERCEL-DEPLOYMENT.md",
  receiptDocs: "docs/VERCEL-PROVISIONING-PLAN-RECEIPTS.md",
});
const sources = Object.fromEntries(
  await Promise.all(Object.entries(files).map(async ([key, relativePath]) => [key, await read(relativePath)])),
);

let packageJson = null;
try {
  packageJson = JSON.parse(sources.package || "{}");
} catch (error) {
  errors.push(`Invalid JSON: ${files.package} (${error instanceof Error ? error.message : String(error)})`);
}
if (
  packageJson?.scripts?.["vercel-provision:check"] !==
  "node scripts/check-vercel-project-provisioning-contract.mjs"
) {
  errors.push("package.json must expose vercel-provision:check.");
}
if (!String(packageJson?.scripts?.check ?? "").includes("pnpm vercel-provision:check")) {
  errors.push("package.json check must include vercel-provision:check.");
}

requireTokens(files.provisioner, sources.provisioner, [
  'const CONTRACT_VERSION = "1.0"',
  'const TEAM_ID = "team_ckKLAnG3MGJK0mMpIVpjbogl"',
  'const PROJECT_ID = "prj_Nb5IcrF5Fd0xhwDoUfZPJYmwSo6L"',
  'const PROJECT_NAME = "evavo-vector-studio"',
  'const REPOSITORY = "EVAVO-STUDIO/evavo-vector-studio"',
  'const ROOT_DIRECTORY = "apps/web"',
  'const NODE_VERSION = "22.x"',
  'const PRODUCTION_DOMAIN = "vector.evavo.com.au"',
  'const SETTINGS_CONFIRMATION = "reconcile-evavo-vector-studio-project-settings"',
  'const APPLY_CONFIRMATION = "provision-evavo-vector-studio"',
  '["plan", "settings", "apply"]',
  'const PROVIDER_ACCESS_KEYS = Object.freeze([',
  'const APPLICATION_ENVIRONMENT_KEYS = Object.freeze([',
  'const ALL_SECRET_KEYS = Object.freeze([',
  'const AUTHORITY_KEYS = Object.freeze([',
  '"VERCEL_TOKEN"',
  '"EVAVO_CLIENT_APP_LAUNCH_SECRET"',
  '"EVAVO_VECTOR_PRIVATE_SIGNING_SECRET"',
  '"UPSTASH_REDIS_REST_URL"',
  '"UPSTASH_REDIS_REST_TOKEN"',
  '"VECTOR_API_TOKEN"',
  '"VECTOR_WORKER_API_TOKEN"',
  '"VERCEL_PROVISION_PROVIDER_ACCESS_INVALID"',
  '"VERCEL_PROVISION_APPLICATION_AUTHORITIES_INCOMPLETE"',
  'options.mode === "apply" && !credentials.applicationAuthorities.ready',
  'process.env.VECTOR_VERCEL_OPERATION_CONFIRM ??',
  'process.env.VECTOR_VERCEL_APPLY_CONFIRM ??',
  '/v9/projects/${encodeURIComponent(PROJECT_ID)}',
  'function projectIdentity(project)',
  'function planFromInspection(inspection, credentials)',
  'inspectionAvailable: true',
  'action: "inspection-complete"',
  'readyToReconcileSettings',
  'readyToApply: blockers.length === 0',
  'action: credentials.applicationAuthorities.ready',
  '"blocked-incomplete-authorities"',
  'sourceControlMode: gitLink.mode',
  'link.type === "github"',
  'linkState.present && !linkState.matched',
  '/v9/projects/${encodeURIComponent(projectId)}?teamId=${encodeURIComponent(TEAM_ID)}',
  '/v10/projects/${encodeURIComponent(projectId)}/env?upsert=true',
  '/v10/projects/${encodeURIComponent(projectId)}/domains',
  '/verify?teamId=${encodeURIComponent(TEAM_ID)}',
  'nodeVersion: NODE_VERSION',
  'previewDeploymentsDisabled: true',
  'enablePreviewFeedback: false',
  'enableProductionFeedback: false',
  'target: Object.freeze(["production"])',
  'createHash("sha256").update(value)',
  '"VERCEL_PROVISION_PROJECT_GIT_CONFLICT"',
  '"VERCEL_PROVISION_SECRET_LEAK"',
  'providerOnlyInspectionSupported: true',
  'providerOnlySettingsApplySupported: true',
  'applicationAuthoritiesRequiredForApply: true',
  'mutationAttempted',
  'deploymentPerformed: false',
  'sensitiveValuesRecorded: false',
]);
forbidTokens(files.provisioner, sources.provisioner, [
  "console.log(process.env",
  "JSON.stringify(process.env",
  "deploymentPerformed: true",
  'target: Object.freeze(["preview"])',
  "VERCEL_TOKEN: process.env.VERCEL_TOKEN",
  '/v10/projects?teamId=${encodeURIComponent(TEAM_ID)}',
  "gitRepository: {",
]);

requireTokens(files.planWrapper, sources.planWrapper, [
  'const CHILD_SCRIPT = "scripts/provision-vector-studio-vercel.mjs"',
  'const PROVIDER_ACCESS_KEYS = Object.freeze([',
  'const APPLICATION_ENVIRONMENT_KEYS = Object.freeze([',
  'const ALL_SECRET_KEYS = Object.freeze([',
  'const AUTHORITY_KEYS = Object.freeze([',
  'function credentialReadiness(environment = process.env)',
  'code: "VERCEL_PROVISION_PROVIDER_ACCESS_INVALID"',
  'inspectionAvailable: false',
  'action: "inspection-unavailable"',
  'providerOnlyInspectionSupported: true',
  'diagnosticReceiptOnProviderFailure: true',
  'canonicalReceiptProduced: true',
  'spawnSync(',
  'CHILD_SCRIPT',
  '"--mode"',
  '"plan"',
  'mutationAttempted: false',
]);
forbidTokens(files.planWrapper, sources.planWrapper, [
  'VECTOR_VERCEL_APPLY_CONFIRM',
  'method: "POST"',
  'method: "PATCH"',
  'fetch(',
  'mutationAttempted: true',
  'mutationPerformed: true',
]);

requireTokens(files.providerEnforcer, sources.providerEnforcer, [
  'const ENFORCER_CHECK = "vector-studio-vercel-provider-inspection-receipt"',
  'const PROJECT_ID = "prj_Nb5IcrF5Fd0xhwDoUfZPJYmwSo6L"',
  '"--receipt"',
  '"--commit"',
  'plan.inspectionAvailable !== true',
  'project.identity?.passed !== true',
  'project.gitLink?.acceptable !== true',
  'receipt.deploymentPerformed !== false',
  'receipt.mutationPerformed !== false',
  'receipt.sensitiveValuesRecorded !== false',
  'providerOnlyCanonicalReceiptAccepted: true',
]);
forbidTokens(files.providerEnforcer, sources.providerEnforcer, [
  'fetch(',
  'process.env.VERCEL_TOKEN',
  'method: "POST"',
  'method: "PATCH"',
  'method: "DELETE"',
]);

requireTokens(files.workflow, sources.workflow, [
  'Vector Studio Vercel project provisioning',
  'workflow_dispatch:',
  'environment: vector-studio-production',
  'Resolve exact current main',
  'test "$(git rev-parse HEAD)" = "$CURRENT_MAIN_SHA"',
  'Verify provisioner, wrapper and provider-receipt self-tests',
  'node scripts/enforce-vercel-provider-inspection-receipt.mjs --self-test',
  'Create bounded no-mutation plan',
  'node scripts/plan-vector-studio-vercel-provisioning.mjs',
  'Enforce exact provider inspection receipt',
  'node scripts/enforce-vercel-provider-inspection-receipt.mjs',
  'Reconcile provider-only Vercel project settings',
  '--mode settings',
  'Apply full Vercel production configuration',
  '--mode apply',
  'VECTOR_VERCEL_OPERATION_CONFIRM: ${{ inputs.confirmation }}',
  'context: "deploy/vector-studio-vercel-provision-plan"',
  'context: "deploy/vector-studio-vercel-project-settings"',
  'context: "deploy/vector-studio-vercel-provision-apply"',
  'include-hidden-files: true',
]);
forbidTokens(files.workflow, sources.workflow, [
  '\n  push:',
  '\n  pull_request:',
  'contents: write',
  'git fetch --no-tags origin main',
  'vercel --prod',
  'vercel deploy',
  'echo $VERCEL_TOKEN',
  'printenv',
]);

const settingsStep = workflowStep(
  sources.workflow,
  "Reconcile provider-only Vercel project settings",
);
const fullApplyStep = workflowStep(
  sources.workflow,
  "Apply full Vercel production configuration",
);
if (!settingsStep) {
  errors.push("The provider-only project-settings step is missing.");
} else {
  requireTokens(files.workflow, settingsStep, [
    'VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}',
    'VECTOR_VERCEL_OPERATION_CONFIRM: ${{ inputs.confirmation }}',
    '--mode settings',
  ]);
  forbidTokens(files.workflow, settingsStep, [
    'EVAVO_CLIENT_APP_LAUNCH_SECRET',
    'EVAVO_VECTOR_PRIVATE_SIGNING_SECRET',
    'UPSTASH_REDIS_REST_URL',
    'UPSTASH_REDIS_REST_TOKEN',
    'VECTOR_API_TOKEN',
    'VECTOR_WORKER_API_TOKEN',
  ]);
}
if (!fullApplyStep) {
  errors.push("The full production apply step is missing.");
} else {
  requireTokens(files.workflow, fullApplyStep, [
    'VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}',
    'EVAVO_CLIENT_APP_LAUNCH_SECRET: ${{ secrets.EVAVO_CLIENT_APP_LAUNCH_SECRET }}',
    'EVAVO_VECTOR_PRIVATE_SIGNING_SECRET: ${{ secrets.EVAVO_VECTOR_PRIVATE_SIGNING_SECRET }}',
    'UPSTASH_REDIS_REST_URL: ${{ secrets.UPSTASH_REDIS_REST_URL }}',
    'UPSTASH_REDIS_REST_TOKEN: ${{ secrets.UPSTASH_REDIS_REST_TOKEN }}',
    'VECTOR_API_TOKEN: ${{ secrets.VECTOR_API_TOKEN }}',
    'VECTOR_WORKER_API_TOKEN: ${{ secrets.VECTOR_WORKER_API_TOKEN }}',
    '--mode apply',
  ]);
}

requireTokens(files.preflightWorkflow, sources.preflightWorkflow, [
  'Vector Studio Vercel provisioning preflight',
  'Check out exact current main',
  'node-version-file: .nvmrc',
  'corepack prepare pnpm@10.14.0 --activate',
  'Create bounded no-mutation provider plan',
  'node scripts/plan-vector-studio-vercel-provisioning.mjs',
  'Enforce bounded provider inspection receipt',
  'node scripts/enforce-vercel-provider-inspection-receipt.mjs',
  'read-only Vector provider inspection passed',
  'context: "deploy/vector-studio-vercel-preflight"',
]);
forbidTokens(files.preflightWorkflow, sources.preflightWorkflow, [
  "node <<'NODE'",
  'fetch(`https://api.vercel.com',
  'method: "POST"',
  'method: "PATCH"',
  'method: "DELETE"',
  'contents: write',
  'vercel deploy',
  'vercel --prod',
]);

requireTokens(files.deploymentWorkflow, sources.deploymentWorkflow, [
  '"scripts/enforce-vercel-provider-inspection-receipt.mjs"',
  'node scripts/enforce-vercel-provider-inspection-receipt.mjs --self-test',
  'node scripts/check-vercel-project-provisioning-contract.mjs',
  'node scripts/check-vercel-provisioning-plan-receipt-contract.mjs',
]);
requireTokens(files.docs, sources.docs, [
  'Provider access requires only `VERCEL_TOKEN`',
  'Provider-only project settings',
  'Application authorities remain a separate full-apply gate',
  'reconcile-evavo-vector-studio-project-settings',
  'provider inspection can pass while `readyToApply` remains false',
  'exact current `main` commit',
  'API-managed',
  'Node.js 22.x',
  'domain verification endpoint',
  'does not deploy',
  'Client release remains withheld',
]);
requireTokens(files.receiptDocs, sources.receiptDocs, [
  'Provider access',
  'Provider-only settings reconciliation',
  'Application authorities',
  'canonical provider inspection receipt',
  'VERCEL_PROVISION_APPLICATION_AUTHORITIES_INCOMPLETE',
]);

if (errors.length > 0) {
  process.stderr.write(`${JSON.stringify({
    check: "vector-studio-vercel-project-provisioning",
    ok: false,
    contractVersion: "1.2",
    errors,
  }, null, 2)}\n`);
  process.exit(1);
}

process.stdout.write(`${JSON.stringify({
  check: "vector-studio-vercel-project-provisioning",
  ok: true,
  contractVersion: "1.1",
  project: "evavo-vector-studio",
  productionDomain: "vector.evavo.com.au",
  modes: ["plan", "settings", "apply"],
  providerOnlyInspectionSupported: true,
  providerOnlySettingsApplySupported: true,
  applicationAuthoritiesSeparatedFromProviderAccess: true,
  canonicalProviderReceiptEnforced: true,
  deploymentPerformedByProvisioner: false,
  clientReleaseEligible: false,
  checkedFiles: [...checkedFiles].sort(),
}, null, 2)}\n`);
