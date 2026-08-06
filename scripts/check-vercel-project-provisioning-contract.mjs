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

const files = {
  package: "package.json",
  provisioner: "scripts/provision-vector-studio-vercel.mjs",
  planWrapper: "scripts/plan-vector-studio-vercel-provisioning.mjs",
  workflow: ".github/workflows/vector-vercel-project-provisioning.yml",
  deploymentWorkflow: ".github/workflows/vercel-deployment-contract.yml",
  docs: "docs/VERCEL-DEPLOYMENT.md",
};

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
  'const APPLY_CONFIRMATION = "provision-evavo-vector-studio"',
  '"--self-test"',
  '"--mode"',
  '"plan"',
  '"apply"',
  'String(process.env.VECTOR_VERCEL_APPLY_CONFIRM ?? "").trim()',
  '/v9/projects/${encodeURIComponent(PROJECT_ID)}',
  'function projectIdentity(project)',
  'action: exists ? "reconcile-settings" : "restore-required"',
  '"VERCEL_PROVISION_PROJECT_IDENTITY_CONFLICT"',
  '"VERCEL_PROVISION_PROJECT_MISSING"',
  '/v9/projects/${encodeURIComponent(projectId)}?teamId=${encodeURIComponent(TEAM_ID)}',
  '/v10/projects/${encodeURIComponent(projectId)}/env?upsert=true',
  '/v10/projects/${encodeURIComponent(projectId)}/domains',
  '/verify?teamId=${encodeURIComponent(TEAM_ID)}',
  'nodeVersion: NODE_VERSION',
  'sourceControlMode: gitLink.mode',
  'link.type === "github"',
  'acceptable: true',
  'link.present && !link.matched',
  'allowFailure: true',
  'verificationAttempted',
  'previewDeploymentsDisabled: true',
  'enablePreviewFeedback: false',
  'enableProductionFeedback: false',
  'target: Object.freeze(["production"])',
  '"VECTOR_PUBLIC_ORIGIN"',
  '"VECTOR_HUB_REPLAY_MODE"',
  '"EVAVO_CLIENT_APP_LAUNCH_SECRET"',
  '"EVAVO_VECTOR_PRIVATE_SIGNING_SECRET"',
  '"UPSTASH_REDIS_REST_URL"',
  '"UPSTASH_REDIS_REST_TOKEN"',
  '"VECTOR_API_TOKEN"',
  '"VECTOR_WORKER_API_TOKEN"',
  'createHash("sha256").update(value)',
  '"VERCEL_PROVISION_PROJECT_GIT_CONFLICT"',
  '"VERCEL_PROVISION_SECRET_LEAK"',
  'writeFile(temporary, source, { encoding: "utf8", flag: "wx" })',
  "deploymentPerformed: false",
  "sensitiveValuesRecorded: false",
]);

forbidTokens(files.provisioner, sources.provisioner, [
  "console.log(process.env",
  "JSON.stringify(process.env",
  "deploymentPerformed: true",
  'target: Object.freeze(["preview"])',
  '"type": "plain",\n    comment: "Dedicated',
  "VERCEL_TOKEN: process.env.VERCEL_TOKEN",
  '/v10/projects?teamId=${encodeURIComponent(TEAM_ID)}',
  "gitRepository: {",
]);

requireTokens(files.planWrapper, sources.planWrapper, [
  'const CONTRACT_VERSION = "1.0"',
  'const CHILD_SCRIPT = "scripts/provision-vector-studio-vercel.mjs"',
  'const REQUIRED_SECRETS = Object.freeze([',
  'const AUTHORITY_KEYS = Object.freeze([',
  "function credentialReadiness(environment = process.env)",
  'createHash("sha256").update(value)',
  "spawnSync(",
  "CHILD_SCRIPT",
  '"--mode"',
  '"plan"',
  "async function writeDiagnosticReceipt(options, result, readiness, startedAtMs)",
  'check: "vector-studio-vercel-provisioning-plan"',
  "readyToApply: false",
  "inspectionAvailable: false",
  'action: "inspection-unavailable"',
  'code: "VERCEL_PROVISION_CREDENTIALS_INVALID"',
  "canonicalReceiptProduced: false",
  "diagnosticReceipt: true",
  "mutationAttempted: false",
  "mutationPerformed: false",
  "assertSecretFree(serialized, readiness)",
  'writeFile(temporary, source, { encoding: "utf8", flag: "wx", mode: 0o600 })',
  "diagnosticReceiptWritten: true",
  'check: "vector-studio-vercel-provision-plan-self-test"',
  "diagnosticReceiptOnFailure: true",
]);
forbidTokens(files.planWrapper, sources.planWrapper, [
  '"apply"',
  "VECTOR_VERCEL_APPLY_CONFIRM",
  'method: "POST"',
  'method: "PATCH"',
  "fetch(",
  "console.log(process.env",
  "JSON.stringify(process.env",
  "mutationAttempted: true",
  "mutationPerformed: true",
]);

requireTokens(files.workflow, sources.workflow, [
  "Vector Studio Vercel project provisioning",
  "workflow_dispatch:",
  "mode:",
  "options:",
  "- plan",
  "- apply",
  "commit:",
  'description: "Apply only: provision-evavo-vector-studio"',
  "persist-credentials: false",
  "node-version-file: .nvmrc",
  "corepack prepare pnpm@10.14.0 --activate",
  "node scripts/check-lockfile-integrity.mjs",
  "Resolve exact current main",
  "CURRENT_MAIN_SHA",
  'test "$(git rev-parse HEAD)" = "$CURRENT_MAIN_SHA"',
  "environment: vector-studio-production",
  "Verify provisioner and plan-wrapper self-tests",
  "node scripts/plan-vector-studio-vercel-provisioning.mjs --self-test",
  "Create bounded no-mutation plan",
  "node scripts/plan-vector-studio-vercel-provisioning.mjs",
  "if-no-files-found: error",
  "Create exact source proof before mutation",
  "node scripts/create-source-proof.mjs",
  "Apply idempotent Vercel project transaction",
  "node scripts/provision-vector-studio-vercel.mjs",
  "--mode apply",
  'VECTOR_VERCEL_APPLY_CONFIRM: ${{ inputs.confirmation }}',
  'VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}',
  'EVAVO_CLIENT_APP_LAUNCH_SECRET: ${{ secrets.EVAVO_CLIENT_APP_LAUNCH_SECRET }}',
  'EVAVO_VECTOR_PRIVATE_SIGNING_SECRET: ${{ secrets.EVAVO_VECTOR_PRIVATE_SIGNING_SECRET }}',
  'UPSTASH_REDIS_REST_URL: ${{ secrets.UPSTASH_REDIS_REST_URL }}',
  'UPSTASH_REDIS_REST_TOKEN: ${{ secrets.UPSTASH_REDIS_REST_TOKEN }}',
  'VECTOR_API_TOKEN: ${{ secrets.VECTOR_API_TOKEN }}',
  'VECTOR_WORKER_API_TOKEN: ${{ secrets.VECTOR_WORKER_API_TOKEN }}',
  'context: "deploy/vector-studio-vercel-provision-plan"',
  'context: "deploy/vector-studio-vercel-provision-apply"',
  "include-hidden-files: true",
]);

forbidTokens(files.workflow, sources.workflow, [
  "\n  push:",
  "\n  pull_request:",
  "contents: write",
  "branches:",
  "git fetch --no-tags origin main",
  "vercel --prod",
  "vercel deploy",
  "curl -H",
  "echo $VERCEL_TOKEN",
  "printenv",
]);

requireTokens(files.deploymentWorkflow, sources.deploymentWorkflow, [
  '"scripts/check-vercel-project-provisioning-contract.mjs"',
  '"scripts/provision-vector-studio-vercel.mjs"',
  '"scripts/plan-vector-studio-vercel-provisioning.mjs"',
  '".github/workflows/vector-vercel-project-provisioning.yml"',
  "node scripts/check-vercel-project-provisioning-contract.mjs",
  "node scripts/provision-vector-studio-vercel.mjs --self-test",
  "node scripts/plan-vector-studio-vercel-provisioning.mjs --self-test",
]);

requireTokens(files.docs, sources.docs, [
  "vector-vercel-project-provisioning.yml",
  "plan",
  "apply",
  "provision-evavo-vector-studio",
  "exact current `main` commit",
  "API-managed",
  "Node.js 22.x",
  "domain verification endpoint",
  "does not deploy",
  "Client release remains withheld",
]);

if (errors.length > 0) {
  process.stderr.write(`${JSON.stringify({
    check: "vector-studio-vercel-project-provisioning",
    ok: false,
    contractVersion: "1.0",
    errors,
  }, null, 2)}\n`);
  process.exit(1);
}

process.stdout.write(`${JSON.stringify({
  check: "vector-studio-vercel-project-provisioning",
  ok: true,
  contractVersion: "1.0",
  project: "evavo-vector-studio",
  productionDomain: "vector.evavo.com.au",
  modes: ["plan", "apply"],
  diagnosticPlanWrapper: true,
  deploymentPerformedByProvisioner: false,
  clientReleaseEligible: false,
  checkedFiles: [...checkedFiles].sort(),
}, null, 2)}\n`);
