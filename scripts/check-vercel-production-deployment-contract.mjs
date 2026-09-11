import "./check-vercel-bootstrap-retirement.mjs";
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
async function requireAbsent(relativePath) {
  checkedFiles.add(relativePath);
  try {
    await fs.stat(path.join(root, relativePath));
    errors.push(`Retired production workflow must remain absent: ${relativePath}.`);
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) {
      errors.push(`Unable to verify retired path ${relativePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
function requireTokens(relativePath, source, tokens) {
  for (const token of tokens) if (!source.includes(token)) errors.push(`${relativePath} is missing exact-deployment token: ${token}`);
}
function forbidTokens(relativePath, source, tokens) {
  for (const token of tokens) if (source.includes(token)) errors.push(`${relativePath} contains prohibited exact-deployment token: ${token}`);
}

const files = Object.freeze({
  package: "package.json",
  deployer: "scripts/deploy-vector-studio-vercel.mjs",
  orchestrator: "scripts/run-vector-vercel-production-local.mjs",
  exactMain: "scripts/check-exact-current-main.mjs",
  sourceProof: "scripts/create-source-proof.mjs",
  privateProof: "scripts/verify-live-private-response.mjs",
  liveProof: "scripts/verify-live-deployment.mjs",
  launchToken: "scripts/create-vector-live-launch-token.mjs",
  liveCapabilities: "scripts/verify-live-capability-discovery.mjs",
});
const sources = Object.fromEntries(await Promise.all(Object.entries(files).map(async ([key, relativePath]) => [key, await read(relativePath)])));
const packageJson = await readJson(files.package);

await requireAbsent(".github/workflows/vector-vercel-production-deployment.yml");
await requireAbsent(".github/workflows/vector-vercel-project-provisioning.yml");
await requireAbsent(".github/workflows/vector-vercel-provisioning-preflight.yml");

if (packageJson?.scripts?.["vercel-deploy:check"] !== "node scripts/check-vercel-production-deployment-contract.mjs") errors.push("package.json must expose vercel-deploy:check.");
if (!String(packageJson?.scripts?.check ?? "").includes("pnpm vercel-deploy:check")) errors.push("package.json check must include vercel-deploy:check.");

requireTokens(files.deployer, sources.deployer, [
  'const CONTRACT_VERSION = "1.0"',
  'const PROJECT_ID = "prj_Nb5IcrF5Fd0xhwDoUfZPJYmwSo6L"',
  'const REPOSITORY = "EVAVO-STUDIO/evavo-vector-studio"',
  'const GITHUB_REPOSITORY_VISIBILITY = "public"',
  'const PRODUCTION_DOMAIN = "vector.evavo.com.au"',
  'const APPLY_CONFIRMATION = "deploy-evavo-vector-studio"',
  'const DEPLOYMENT_TIMEOUT_MS = 20 * 60 * 1000',
  '"plan"',
  '"apply"',
  'String(process.env.VECTOR_VERCEL_DEPLOY_CONFIRM ?? "").trim()',
  'type: "github-limited"',
  'ref: "main"',
  'sha: commit',
  'target: "production"',
  '"VERCEL_DEPLOY_API_QUOTA_EXHAUSTED"',
  'deployment.readyState === "READY"',
  'deployment.commit === options.commit',
  'aliases.includes(PRODUCTION_DOMAIN)',
  '"VERCEL_DEPLOY_COMMIT_UNPROVEN"',
  '"VERCEL_DEPLOY_SECRET_LEAK"',
  'sensitiveValuesRecorded: false',
]);
forbidTokens(files.deployer, sources.deployer, ['target: "preview"', 'ref: "develop"', 'method: "DELETE"', 'console.log(process.env', 'JSON.stringify(process.env']);

requireTokens(files.exactMain, sources.exactMain, [
  'git", ["ls-remote", "--heads", "origin", "refs/heads/main"]',
  'VECTOR_MAIN_REMOTE_MISMATCH',
  'VECTOR_MAIN_REPOSITORY_DIRTY',
  'mutationAttempted: false',
  'repositoryPublicationAuthority: false',
]);
forbidTokens(files.exactMain, sources.exactMain, ["git fetch", "git reset", "git checkout", "git switch", "git push"]);
requireTokens(files.sourceProof, sources.sourceProof, [
  'runChecked("pnpm", ["install", "--frozen-lockfile"]',
  'runChecked("pnpm", ["check"]',
  'runChecked("pnpm", ["--filter", "@evavo/vector-web", "build"]',
  'assertCleanRepository()',
  'sensitiveValuesRecorded: false',
]);
requireTokens(files.privateProof, sources.privateProof, ['CANONICAL_ORIGIN = "https://vector.evavo.com.au"', 'redirect: "manual"', 'cache: "no-store"', 'x-vector-private-response-contract']);
requireTokens(files.liveProof, sources.liveProof, [
  'CANONICAL_ORIGIN = "https://vector.evavo.com.au"',
  'LAUNCH_TOKEN_ENV = "VECTOR_DEPLOYMENT_PROOF_LAUNCH_TOKEN"',
  'SOURCE_PROOF_ENV = "VECTOR_DEPLOYMENT_SOURCE_PROOF"',
  '--require-launch',
  'replayLocation === "/access?reason=used"',
  'sensitiveValuesRecorded: false',
]);
requireTokens(files.launchToken, sources.launchToken, [
  'const PROFILE_NAMES = Object.freeze(["owner", "client"])',
  '"EVAVO_CLIENT_APP_LAUNCH_SECRET"',
  '"EVAVO_VECTOR_PRIVATE_SIGNING_SECRET"',
  'randomBytes(24).toString("base64url")',
  'tokenBodyRecorded: false',
  'sensitiveValuesRecorded: false',
  'mode = 0o600',
]);
forbidTokens(files.launchToken, sources.launchToken, ['process.stdout.write(token)', 'console.log(token)', 'tokenBodyRecorded: true', 'mode = 0o644']);
requireTokens(files.liveCapabilities, sources.liveCapabilities, [
  'const PRODUCTION_ORIGIN = "https://vector.evavo.com.au"',
  'const SOURCE_PROOF_ENV = "VECTOR_DEPLOYMENT_SOURCE_PROOF"',
  'document.deploymentBoundaries?.managedRemoteExecution === false',
  'document.deploymentBoundaries?.distributedAutoscaling === false',
  'document.approval?.state === "human-review-required"',
  'responseBodyRecorded: false',
  'sensitiveValuesRecorded: false',
]);

requireTokens(files.orchestrator, sources.orchestrator, [
  'const DEPLOY_CONFIRMATION = "deploy-evavo-vector-studio"',
  '"scripts/check-exact-current-main.mjs"',
  '"scripts/check-vector-vercel-provider-access.mjs"',
  '"scripts/create-source-proof.mjs"',
  '"scripts/run-vector-vercel-provisioning-local.mjs"',
  '"scripts/deploy-vector-studio-vercel.mjs"',
  'VECTOR_VERCEL_DEPLOY_CONFIRM: DEPLOY_CONFIRMATION',
  '"scripts/verify-live-private-response.mjs"',
  '"scripts/verify-live-deployment.mjs"',
  '"scripts/verify-live-capability-discovery.mjs"',
  'runLaunchProof("owner"',
  'runLaunchProof("client"',
  'destroyToken(tokenPath)',
  'launchTokenBodiesRetained: false',
  'automaticClientPromotion: false',
  'repositoryPublicationAuthority: false',
  'githubActionsAuthority: false',
  'sensitiveValuesRecorded: false',
]);
forbidTokens(files.orchestrator, sources.orchestrator, ['actions/', 'contents: write', 'git push', 'vercel --prod', 'vercel deploy']);

if (errors.length > 0) {
  process.stderr.write(`${JSON.stringify({ check: "vector-studio-vercel-production-deployment", ok: false, contractVersion: "2.0", errors }, null, 2)}\n`);
  process.exit(1);
}
process.stdout.write(`${JSON.stringify({
  check: "vector-studio-vercel-production-deployment",
  ok: true,
  contractVersion: "2.0",
  providerFreeExecution: true,
  retiredProductionWorkflowRequiredAbsent: true,
  exactCurrentMainRequiredBeforeAndAfterProviderEffects: true,
  sourceProofRequired: true,
  livePrivateResponseRequired: true,
  liveCapabilityDiscoveryRequired: true,
  ownerAndClientReplayProofRequired: true,
  tokenBodiesRetained: false,
  automaticClientPromotion: false,
  repositoryPublicationAuthority: "development.repository.publish",
  checkedFiles: [...checkedFiles].sort(),
}, null, 2)}\n`);
