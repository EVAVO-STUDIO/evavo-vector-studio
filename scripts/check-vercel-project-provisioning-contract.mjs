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

async function requireAbsent(relativePath) {
  checkedFiles.add(relativePath);
  try {
    await fs.stat(path.join(root, relativePath));
    errors.push(`Retired Vercel workflow must remain absent: ${relativePath}.`);
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) {
      errors.push(`Unable to verify retired path ${relativePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
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

const files = Object.freeze({
  package: "package.json",
  provisioner: "scripts/provision-vector-studio-vercel.mjs",
  planWrapper: "scripts/plan-vector-studio-vercel-provisioning.mjs",
  providerEnforcer: "scripts/enforce-vercel-provider-inspection-receipt.mjs",
  localOrchestrator: "scripts/run-vector-vercel-provisioning-local.mjs",
  settingsOrchestrator: "scripts/run-vector-vercel-settings-source.mjs",
  exactMain: "scripts/check-exact-current-main.mjs",
  docs: "docs/VERCEL-DEPLOYMENT.md",
  receiptDocs: "docs/VERCEL-PROVISIONING-PLAN-RECEIPTS.md",
});
const sources = Object.fromEntries(
  await Promise.all(Object.entries(files).map(async ([key, relativePath]) => [key, await read(relativePath)])),
);
const packageJson = await readJson(files.package);

await requireAbsent(".github/workflows/vector-vercel-project-provisioning.yml");
await requireAbsent(".github/workflows/vector-vercel-provisioning-preflight.yml");

if (packageJson?.scripts?.["vercel-provision:check"] !== "node scripts/check-vercel-project-provisioning-contract.mjs") {
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
  'readyToReconcileSettings',
  'readyToApply: blockers.length === 0',
  'sourceControlMode: gitLink.mode',
  'link.type === "github"',
  'target: Object.freeze(["production"])',
  'createHash("sha256").update(value)',
  'providerOnlyInspectionSupported: true',
  'providerOnlySettingsApplySupported: true',
  'applicationAuthoritiesRequiredForApply: true',
  'deploymentPerformed: false',
  'sensitiveValuesRecorded: false',
]);
forbidTokens(files.provisioner, sources.provisioner, [
  "console.log(process.env",
  "JSON.stringify(process.env",
  "deploymentPerformed: true",
  'target: Object.freeze(["preview"])',
  "VERCEL_TOKEN: process.env.VERCEL_TOKEN",
]);

requireTokens(files.planWrapper, sources.planWrapper, [
  'const CHILD_SCRIPT = "scripts/provision-vector-studio-vercel.mjs"',
  'function credentialReadiness(environment = process.env)',
  'inspectionAvailable: false',
  'providerOnlyInspectionSupported: true',
  'diagnosticReceiptOnProviderFailure: true',
  'canonicalReceiptProduced: true',
  'spawnSync(',
  '"--mode"',
  '"plan"',
  'mutationAttempted: false',
]);
forbidTokens(files.planWrapper, sources.planWrapper, [
  'method: "POST"',
  'method: "PATCH"',
  'fetch(',
  'mutationAttempted: true',
  'mutationPerformed: true',
]);

requireTokens(files.providerEnforcer, sources.providerEnforcer, [
  'const ENFORCER_CHECK = "vector-studio-vercel-provider-inspection-receipt"',
  'const PROJECT_ID = "prj_Nb5IcrF5Fd0xhwDoUfZPJYmwSo6L"',
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

requireTokens(files.exactMain, sources.exactMain, [
  'const REPOSITORY = "EVAVO-STUDIO/evavo-vector-studio"',
  'const EXPECTED_BRANCH = "main"',
  'git", ["ls-remote", "--heads", "origin", "refs/heads/main"]',
  'VECTOR_MAIN_REMOTE_MISMATCH',
  'VECTOR_MAIN_REPOSITORY_DIRTY',
  'mutationAttempted: false',
  'mutationPerformed: false',
  'repositoryPublicationAuthority: false',
]);
forbidTokens(files.exactMain, sources.exactMain, ["git fetch", "git reset", "git checkout", "git switch", "git push"]);

requireTokens(files.settingsOrchestrator, sources.settingsOrchestrator, [
  'const SETTINGS_CONFIRMATION = "reconcile-evavo-vector-studio-project-settings"',
  'VECTOR_VERCEL_OPERATION_CONFIRM: SETTINGS_CONFIRMATION',
  '"scripts/check-vector-vercel-provider-access.mjs"',
  '"scripts/create-source-proof.mjs"',
  '"scripts/run-vector-vercel-settings-reconciliation.mjs"',
  'githubActionsAuthority: false',
  'productionDeploymentAuthority: false',
]);

requireTokens(files.localOrchestrator, sources.localOrchestrator, [
  'const APPLY_CONFIRMATION = "provision-evavo-vector-studio"',
  '["plan", "settings", "apply"]',
  '"scripts/run-vector-vercel-settings-source.mjs"',
  '"scripts/check-exact-current-main.mjs"',
  '"scripts/check-vector-vercel-provider-access.mjs"',
  '"scripts/plan-vector-studio-vercel-provisioning.mjs"',
  '"scripts/enforce-vercel-provider-inspection-receipt.mjs"',
  '"scripts/create-source-proof.mjs"',
  '"scripts/provision-vector-studio-vercel.mjs"',
  'VECTOR_VERCEL_OPERATION_CONFIRM: APPLY_CONFIRMATION',
  'providerFreeExecution: true',
  'deploymentPerformed: false',
  'repositoryPublicationAuthority: false',
  'githubActionsAuthority: false',
  'sensitiveValuesRecorded: false',
]);
forbidTokens(files.localOrchestrator, sources.localOrchestrator, [
  'actions/',
  'contents: write',
  'git push',
  'vercel --prod',
  'vercel deploy',
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
    contractVersion: "2.0",
    errors,
  }, null, 2)}\n`);
  process.exit(1);
}

process.stdout.write(`${JSON.stringify({
  check: "vector-studio-vercel-project-provisioning",
  ok: true,
  contractVersion: "2.0",
  project: "evavo-vector-studio",
  productionDomain: "vector.evavo.com.au",
  modes: ["plan", "settings", "apply"],
  providerFreeExecution: true,
  retiredProvisioningWorkflowsRequiredAbsent: true,
  exactCurrentMainRequired: true,
  providerOnlyInspectionSupported: true,
  providerOnlySettingsApplySupported: true,
  applicationAuthoritiesSeparatedFromProviderAccess: true,
  canonicalProviderReceiptEnforced: true,
  deploymentPerformedByProvisioner: false,
  clientReleaseEligible: false,
  checkedFiles: [...checkedFiles].sort(),
}, null, 2)}\n`);
