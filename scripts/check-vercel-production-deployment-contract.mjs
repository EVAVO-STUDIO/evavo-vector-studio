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
    if (!source.includes(token)) errors.push(`${relativePath} is missing exact-deployment token: ${token}`);
  }
}

function forbidTokens(relativePath, source, tokens) {
  for (const token of tokens) {
    if (source.includes(token)) errors.push(`${relativePath} contains prohibited exact-deployment token: ${token}`);
  }
}

const files = {
  package: "package.json",
  deployer: "scripts/deploy-vector-studio-vercel.mjs",
  workflow: ".github/workflows/vector-vercel-production-deployment.yml",
  provisioningWorkflow: ".github/workflows/vector-vercel-project-provisioning.yml",
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
  packageJson?.scripts?.["vercel-deploy:check"] !==
  "node scripts/check-vercel-production-deployment-contract.mjs"
) {
  errors.push("package.json must expose vercel-deploy:check.");
}
if (!String(packageJson?.scripts?.check ?? "").includes("pnpm vercel-deploy:check")) {
  errors.push("package.json check must include vercel-deploy:check.");
}

requireTokens(files.deployer, sources.deployer, [
  'const CONTRACT_VERSION = "1.0"',
  'const TEAM_ID = "team_ckKLAnG3MGJK0mMpIVpjbogl"',
  'const PROJECT_NAME = "evavo-vector-studio"',
  'const REPOSITORY = "EVAVO-STUDIO/evavo-vector-studio"',
  'const PRODUCTION_DOMAIN = "vector.evavo.com.au"',
  'const APPLY_CONFIRMATION = "deploy-evavo-vector-studio"',
  'const DEPLOYMENT_TIMEOUT_MS = 20 * 60 * 1000',
  'const TERMINAL_FAILURE_STATES = new Set(["ERROR", "CANCELED", "BLOCKED"])',
  '"--self-test"',
  '"--mode"',
  '"plan"',
  '"apply"',
  'String(process.env.VECTOR_VERCEL_DEPLOY_CONFIRM ?? "").trim()',
  '/v9/projects/${encodeURIComponent(PROJECT_NAME)}',
  '/v7/deployments?projectId=${encodeURIComponent(projectId)}',
  '/v13/deployments?forceNew=1&skipAutoDetectionConfirmation=1',
  '/v13/deployments/${encodeURIComponent(deploymentId)}?withGitRepoInfo=true',
  '/v2/deployments/${encodeURIComponent(deploymentId)}/aliases',
  'type: "github-limited"',
  'org: REPOSITORY_ORG',
  'repo: REPOSITORY_NAME',
  'ref: "main"',
  'sha: commit',
  'target: "production"',
  'githubCommitSha: commit',
  'monorepoManager: "turbo"',
  'nodeVersion: "22.x"',
  'deployment.readyState === "READY"',
  'deployment.commit === options.commit',
  'aliases.includes(PRODUCTION_DOMAIN)',
  '"VERCEL_DEPLOY_COMMIT_MISMATCH"',
  '"VERCEL_DEPLOY_COMMIT_UNPROVEN"',
  '"VERCEL_DEPLOY_ALIAS_TIMEOUT"',
  '"VERCEL_DEPLOY_SECRET_LEAK"',
  'writeFile(temporary, source, { encoding: "utf8", flag: "wx" })',
  'sensitiveValuesRecorded: false',
]);

forbidTokens(files.deployer, sources.deployer, [
  'type: "vercel"',
  'withLatestCommit: true',
  'target: "preview"',
  'ref: "develop"',
  'method: "DELETE"',
  'console.log(process.env',
  'JSON.stringify(process.env',
  'authorization: token',
]);

requireTokens(files.workflow, sources.workflow, [
  "Vector Studio exact production deployment",
  "workflow_dispatch:",
  "mode:",
  "- plan",
  "- apply",
  'description: "Apply only: deploy-evavo-vector-studio"',
  "persist-credentials: false",
  'test "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)"',
  "environment: vector-studio-production",
  "Verify provisioned project, production environment and domain without mutation",
  "node scripts/provision-vector-studio-vercel.mjs",
  "Create exact source proof before deployment",
  "node scripts/create-source-proof.mjs",
  "Create or reuse exact production deployment and prove readiness",
  "node scripts/deploy-vector-studio-vercel.mjs",
  "--mode plan",
  "--mode apply",
  'VECTOR_VERCEL_DEPLOY_CONFIRM: ${{ inputs.confirmation }}',
  'VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}',
  'EVAVO_CLIENT_APP_LAUNCH_SECRET: ${{ secrets.EVAVO_CLIENT_APP_LAUNCH_SECRET }}',
  'EVAVO_VECTOR_PRIVATE_SIGNING_SECRET: ${{ secrets.EVAVO_VECTOR_PRIVATE_SIGNING_SECRET }}',
  'UPSTASH_REDIS_REST_URL: ${{ secrets.UPSTASH_REDIS_REST_URL }}',
  'UPSTASH_REDIS_REST_TOKEN: ${{ secrets.UPSTASH_REDIS_REST_TOKEN }}',
  'VECTOR_API_TOKEN: ${{ secrets.VECTOR_API_TOKEN }}',
  'VECTOR_WORKER_API_TOKEN: ${{ secrets.VECTOR_WORKER_API_TOKEN }}',
  "node scripts/verify-live-private-response.mjs",
  "node scripts/verify-live-deployment.mjs",
  'VECTOR_DEPLOYMENT_SOURCE_PROOF: .ci/vector-source-proof.json',
  'context: "deploy/vector-studio-production-plan"',
  'context: "deploy/vector-studio-production-exact"',
  "include-hidden-files: true",
]);

forbidTokens(files.workflow, sources.workflow, [
  "\n  push:",
  "\n  pull_request:",
  "contents: write",
  "branches:",
  "vercel --prod",
  "vercel deploy",
  "withLatestCommit",
  "echo $VERCEL_TOKEN",
  "printenv",
  "--require-launch",
]);

requireTokens(files.provisioningWorkflow, sources.provisioningWorkflow, [
  "Vector Studio Vercel project provisioning",
  "environment: vector-studio-production",
  'description: "Apply only: provision-evavo-vector-studio"',
]);

requireTokens(files.deploymentWorkflow, sources.deploymentWorkflow, [
  '"scripts/check-vercel-production-deployment-contract.mjs"',
  '"scripts/deploy-vector-studio-vercel.mjs"',
  '".github/workflows/vector-vercel-production-deployment.yml"',
  "node scripts/check-vercel-production-deployment-contract.mjs",
  "node scripts/deploy-vector-studio-vercel.mjs --self-test",
]);

requireTokens(files.docs, sources.docs, [
  "vector-vercel-production-deployment.yml",
  "deploy-evavo-vector-studio",
  "exact current `main` commit",
  "READY",
  "production alias",
  "live private-response",
  "does not perform signed owner or client launch proof",
  "Client release remains withheld",
]);

if (errors.length > 0) {
  process.stderr.write(`${JSON.stringify({
    check: "vector-studio-vercel-production-deployment",
    ok: false,
    contractVersion: "1.0",
    errors,
  }, null, 2)}\n`);
  process.exit(1);
}

process.stdout.write(`${JSON.stringify({
  check: "vector-studio-vercel-production-deployment",
  ok: true,
  contractVersion: "1.0",
  project: "evavo-vector-studio",
  productionDomain: "vector.evavo.com.au",
  exactCommitRequired: true,
  productionAliasRequired: true,
  livePublicProofRequired: true,
  signedLaunchProofPerformed: false,
  clientReleaseEligible: false,
  checkedFiles: [...checkedFiles].sort(),
}, null, 2)}\n`);
