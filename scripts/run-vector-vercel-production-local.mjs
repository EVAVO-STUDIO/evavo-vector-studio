import { readFileSync, rmSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const CONTRACT_VERSION = "1.0";
const REPOSITORY = "EVAVO-STUDIO/evavo-vector-studio";
const DEPLOY_CONFIRMATION = "deploy-evavo-vector-studio";
const SOURCE_PROOF_ENV = "VECTOR_DEPLOYMENT_SOURCE_PROOF";
const LAUNCH_TOKEN_ENV = "VECTOR_DEPLOYMENT_PROOF_LAUNCH_TOKEN";
const SHA_PATTERN = /^[a-f0-9]{40}$/u;
const MAX_CHILD_OUTPUT_BYTES = 4 * 1024 * 1024;

function fail(code, message, details = undefined) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  throw error;
}

function parseArgs(argv) {
  const options = { mode: "plan", commit: null, evidenceRoot: null };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!["--mode", "--commit", "--evidence-root"].includes(argument)) {
      fail("VECTOR_PRODUCTION_LOCAL_ARGUMENT_INVALID", `Unknown argument: ${argument}`);
    }
    const value = argv[index + 1];
    if (!value) fail("VECTOR_PRODUCTION_LOCAL_ARGUMENT_INVALID", `${argument} requires a value.`);
    index += 1;
    if (argument === "--mode") options.mode = value;
    if (argument === "--commit") options.commit = value.trim().toLowerCase();
    if (argument === "--evidence-root") options.evidenceRoot = value;
  }
  if (!["plan", "apply"].includes(options.mode)) fail("VECTOR_PRODUCTION_LOCAL_MODE_INVALID", "--mode must be plan or apply.");
  if (!options.commit || !SHA_PATTERN.test(options.commit)) fail("VECTOR_PRODUCTION_LOCAL_COMMIT_INVALID", "Pass the exact lowercase 40-character commit with --commit.");
  if (!options.evidenceRoot) fail("VECTOR_PRODUCTION_LOCAL_EVIDENCE_REQUIRED", "Pass --evidence-root for create-only release evidence.");
  return options;
}

function externalEvidenceRoot(value) {
  const repositoryRoot = path.resolve(process.cwd());
  const evidenceRoot = path.resolve(value);
  const relative = path.relative(repositoryRoot, evidenceRoot);
  if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))) {
    fail("VECTOR_PRODUCTION_LOCAL_EVIDENCE_INSIDE_REPOSITORY", "Production evidence must be written outside the repository.");
  }
  mkdirSync(evidenceRoot, { recursive: true, mode: 0o700 });
  return evidenceRoot;
}

function runNode(args, label, env = process.env) {
  const started = Date.now();
  const result = spawnSync(process.execPath, args, {
    cwd: process.cwd(),
    env,
    encoding: "utf8",
    maxBuffer: MAX_CHILD_OUTPUT_BYTES,
    windowsHide: true,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error || result.status !== 0) {
    fail("VECTOR_PRODUCTION_LOCAL_STEP_FAILED", `${label} failed.`, { status: result.status, durationMs: Date.now() - started });
  }
  return Object.freeze({ label, status: "passed", durationMs: Date.now() - started });
}

function tokenValue(tokenPath) {
  const token = readFileSync(tokenPath, "utf8").trim();
  if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u.test(token)) fail("VECTOR_PRODUCTION_LOCAL_TOKEN_INVALID", "Generated live launch token did not match the bounded token shape.");
  return token;
}

function destroyToken(tokenPath) {
  try { rmSync(tokenPath, { force: true }); } catch { /* best-effort after proof */ }
}

function runLaunchProof(profile, options, evidenceRoot, sourceProof, steps) {
  const tokenPath = path.join(evidenceRoot, `${profile}-launch.token`);
  const tokenReceipt = path.join(evidenceRoot, `${profile}-launch-token.json`);
  const liveReceipt = path.join(evidenceRoot, `${profile}-launch-live-proof.json`);
  try {
    steps.push(runNode([
      "scripts/create-vector-live-launch-token.mjs",
      "--profile", profile,
      "--commit", options.commit,
      "--token-out", tokenPath,
      "--receipt-out", tokenReceipt,
    ], `${profile} one-time launch token`));
    const token = tokenValue(tokenPath);
    steps.push(runNode([
      "scripts/verify-live-deployment.mjs",
      "--commit", options.commit,
      "--source-proof", sourceProof,
      "--require-launch",
      "--out", liveReceipt,
    ], `${profile} live launch and replay proof`, { ...process.env, [LAUNCH_TOKEN_ENV]: token }));
  } finally {
    destroyToken(tokenPath);
  }
  return Object.freeze({ tokenReceipt, liveReceipt, tokenRetained: false });
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const evidenceRoot = externalEvidenceRoot(options.evidenceRoot);
  const steps = [];
  const evidence = {
    exactMainBefore: path.join(evidenceRoot, "exact-main-before.json"),
    providerAccess: path.join(evidenceRoot, "provider-access.json"),
    sourceProof: path.join(evidenceRoot, "source-proof.json"),
    exactMainAfterSource: path.join(evidenceRoot, "exact-main-after-source.json"),
    providerPlanRoot: path.join(evidenceRoot, "provider-plan"),
    deployment: path.join(evidenceRoot, `deployment-${options.mode}.json`),
    exactMainAfterDeployment: path.join(evidenceRoot, "exact-main-after-deployment.json"),
  };

  steps.push(runNode(["scripts/check-exact-current-main.mjs", "--commit", options.commit, "--out", evidence.exactMainBefore], "exact current main before source proof"));
  steps.push(runNode(["scripts/check-vector-vercel-provider-access.mjs", "--out", evidence.providerAccess], "Vercel provider access admission"));
  steps.push(runNode(["scripts/create-source-proof.mjs", "--commit", options.commit, "--out", evidence.sourceProof], "complete source proof"));
  steps.push(runNode(["scripts/check-exact-current-main.mjs", "--commit", options.commit, "--out", evidence.exactMainAfterSource], "exact current main after source proof"));
  steps.push(runNode(["scripts/run-vector-vercel-provisioning-local.mjs", "--mode", "plan", "--commit", options.commit, "--evidence-root", evidence.providerPlanRoot], "read-only provider provisioning plan"));

  const deploymentEnvironment = options.mode === "apply" ? { ...process.env, VECTOR_VERCEL_DEPLOY_CONFIRM: DEPLOY_CONFIRMATION } : process.env;
  steps.push(runNode(["scripts/deploy-vector-studio-vercel.mjs", "--mode", options.mode, "--commit", options.commit, "--out", evidence.deployment], `Vercel production deployment ${options.mode}`, deploymentEnvironment));
  steps.push(runNode(["scripts/check-exact-current-main.mjs", "--commit", options.commit, "--out", evidence.exactMainAfterDeployment], "exact current main after deployment provider step"));

  let live = null;
  if (options.mode === "apply") {
    evidence.privateResponse = path.join(evidenceRoot, "live-private-response.json");
    evidence.liveDeployment = path.join(evidenceRoot, "live-deployment.json");
    evidence.capabilities = path.join(evidenceRoot, "live-capabilities-current.json");
    evidence.exactMainAfterLive = path.join(evidenceRoot, "exact-main-after-live.json");
    const liveEnvironment = { ...process.env, [SOURCE_PROOF_ENV]: evidence.sourceProof };
    steps.push(runNode(["scripts/verify-live-private-response.mjs", "--commit", options.commit, "--out", evidence.privateResponse], "live private-response proof", liveEnvironment));
    steps.push(runNode(["scripts/verify-live-deployment.mjs", "--commit", options.commit, "--source-proof", evidence.sourceProof, "--out", evidence.liveDeployment], "live deployment proof", liveEnvironment));
    steps.push(runNode(["scripts/verify-live-capability-discovery-current.mjs", "--commit", options.commit, "--source-proof", evidence.sourceProof, "--out", evidence.capabilities], "current live capability discovery proof", liveEnvironment));
    const owner = runLaunchProof("owner", options, evidenceRoot, evidence.sourceProof, steps);
    const client = runLaunchProof("client", options, evidenceRoot, evidence.sourceProof, steps);
    steps.push(runNode(["scripts/check-exact-current-main.mjs", "--commit", options.commit, "--out", evidence.exactMainAfterLive], "exact current main after live proofs"));
    live = Object.freeze({ owner, client });
  }

  process.stdout.write(`${JSON.stringify({
    ok: true,
    check: "vector-vercel-production-local",
    contractVersion: CONTRACT_VERSION,
    repository: REPOSITORY,
    mode: options.mode,
    commit: options.commit,
    evidenceRoot,
    evidence,
    live,
    providerFreeExecution: true,
    exactCurrentMainRequiredBeforeAndAfterProviderEffects: true,
    sourceProofRequired: true,
    explicitDeploymentConfirmationBoundLocally: options.mode === "apply",
    livePrivateResponseProofRequiredOnApply: options.mode === "apply",
    liveCapabilityProofRequiredOnApply: options.mode === "apply",
    ownerAndClientOneTimeLaunchProofRequiredOnApply: options.mode === "apply",
    launchTokenBodiesRetained: false,
    automaticClientPromotion: false,
    repositoryPublicationAuthority: false,
    githubActionsAuthority: false,
    sensitiveValuesRecorded: false,
    steps,
  }, null, 2)}\n`);
}

try { main(); } catch (error) {
  process.stderr.write(`${JSON.stringify({ ok: false, error: error instanceof Error && "code" in error ? error.code : "VECTOR_PRODUCTION_LOCAL_FAILED", message: error instanceof Error ? error.message : String(error), details: error instanceof Error && "details" in error ? error.details : undefined, repositoryPublicationAuthority: false, launchTokenBodiesRetained: false, sensitiveValuesRecorded: false }, null, 2)}\n`);
  process.exit(1);
}
