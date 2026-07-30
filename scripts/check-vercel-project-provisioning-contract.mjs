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
  'const PROJECT_NAME = "evavo-vector-studio"',
  'const REPOSITORY = "EVAVO-STUDIO/evavo-vector-studio"',
  'const ROOT_DIRECTORY = "apps/web"',
  'const PRODUCTION_DOMAIN = "vector.evavo.com.au"',
  'const APPLY_CONFIRMATION = "provision-evavo-vector-studio"',
  '"--self-test"',
  '"--mode"',
  '"plan"',
  '"apply"',
  'String(process.env.VECTOR_VERCEL_APPLY_CONFIRM ?? "").trim()',
  '/v9/projects/${encodeURIComponent(PROJECT_NAME)}',
  '/v10/projects?teamId=${encodeURIComponent(TEAM_ID)}',
  '/v9/projects/${encodeURIComponent(projectId)}?teamId=${encodeURIComponent(TEAM_ID)}',
  '/v10/projects/${encodeURIComponent(projectId)}/env?upsert=true',
  '/v10/projects/${encodeURIComponent(projectId)}/domains',
  'gitRepository: {',
  'type: "github"',
  'repo: REPOSITORY',
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
  'test "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)"',
  "environment: vector-studio-production",
  "Create exact source proof before mutation",
  "node scripts/create-source-proof.mjs",
  "Apply idempotent Vercel project transaction",
  "node scripts/provision-vector-studio-vercel.mjs",
  "--mode plan",
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
  "vercel --prod",
  "vercel deploy",
  "curl -H",
  "echo $VERCEL_TOKEN",
  "printenv",
]);

requireTokens(files.deploymentWorkflow, sources.deploymentWorkflow, [
  '"scripts/check-vercel-project-provisioning-contract.mjs"',
  '"scripts/provision-vector-studio-vercel.mjs"',
  '".github/workflows/vector-vercel-project-provisioning.yml"',
  "node scripts/check-vercel-project-provisioning-contract.mjs",
  "node scripts/provision-vector-studio-vercel.mjs --self-test",
]);

requireTokens(files.docs, sources.docs, [
  "vector-vercel-project-provisioning.yml",
  "plan",
  "apply",
  "provision-evavo-vector-studio",
  "exact current `main` commit",
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
  deploymentPerformedByProvisioner: false,
  clientReleaseEligible: false,
  checkedFiles: [...checkedFiles].sort(),
}, null, 2)}\n`);
