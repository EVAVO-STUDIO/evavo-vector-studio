#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const CONTRACT_VERSION = "1.0";
const REPOSITORY = "EVAVO-STUDIO/evavo-vector-studio";
const SHA_PATTERN = /^[a-f0-9]{40}$/u;
const MAX_CHILD_OUTPUT_BYTES = 2_000_000;
const MAX_FINAL_RECEIPT_BYTES = 128 * 1024;
const PROVISION_CONFIRMATION = "provision-evavo-vector-studio";
const DEPLOY_CONFIRMATION = "deploy-evavo-vector-studio";

function fail(code, message, details = undefined) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  throw error;
}

function parseArgs(argv) {
  const result = { mode: "plan", commit: null, evidenceRoot: null, selfTest: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--self-test") {
      result.selfTest = true;
      continue;
    }
    if (["--mode", "--commit", "--evidence-root"].includes(argument)) {
      const value = argv[index + 1];
      if (!value) fail("VECTOR_PRODUCTION_ARGUMENT_INVALID", `${argument} requires a value.`);
      index += 1;
      if (argument === "--mode") result.mode = value;
      if (argument === "--commit") result.commit = value;
      if (argument === "--evidence-root") result.evidenceRoot = value;
      continue;
    }
    fail("VECTOR_PRODUCTION_ARGUMENT_INVALID", `Unknown argument: ${argument}`);
  }
  if (!["plan", "apply"].includes(result.mode)) fail("VECTOR_PRODUCTION_MODE_INVALID", "Mode must be plan or apply.");
  if (result.selfTest) return result;
  if (!result.commit || !SHA_PATTERN.test(result.commit)) fail("VECTOR_PRODUCTION_COMMIT_INVALID", "Pass the exact lowercase 40-character main commit with --commit.");
  if (!result.evidenceRoot) fail("VECTOR_PRODUCTION_EVIDENCE_REQUIRED", "Pass an external create-only --evidence-root.");
  return result;
}

function commandOutput(command, args) {
  try {
    return execFileSync(command, args, {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
      maxBuffer: MAX_CHILD_OUTPUT_BYTES,
    }).trim();
  } catch (error) {
    fail("VECTOR_PRODUCTION_COMMAND_FAILED", `Unable to execute ${command} ${args.join(" ")}.`, {
      status: error && typeof error === "object" && "status" in error ? error.status : null,
    });
  }
}

function assertExternalCreateOnlyRoot(value) {
  const repository = path.resolve(".");
  const target = path.resolve(value);
  const relative = path.relative(repository, target);
  if (!relative || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    fail("VECTOR_PRODUCTION_EVIDENCE_INSIDE_REPOSITORY", "Production evidence must be outside the repository source tree.");
  }
  try {
    statSync(target);
    fail("VECTOR_PRODUCTION_EVIDENCE_EXISTS", `Refusing to reuse an existing evidence root: ${target}`);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code !== "ENOENT") throw error;
  }
  mkdirSync(target, { recursive: false, mode: 0o700 });
  return target;
}

function assertExactMain(commit) {
  const branch = commandOutput("git", ["branch", "--show-current"]);
  if (branch !== "main") fail("VECTOR_PRODUCTION_BRANCH_INVALID", `Expected main; observed ${branch || "detached"}.`);
  const head = commandOutput("git", ["rev-parse", "HEAD"]).toLowerCase();
  if (head !== commit) fail("VECTOR_PRODUCTION_HEAD_MISMATCH", "Checked-out HEAD does not match requested commit.", { expected: commit, actual: head });
  const status = commandOutput("git", ["status", "--porcelain=v1", "--untracked-files=all"]);
  if (status) fail("VECTOR_PRODUCTION_REPOSITORY_DIRTY", "Production release requires a clean tracked and untracked repository boundary.");
  const remoteLine = commandOutput("git", ["ls-remote", "--refs", "origin", "refs/heads/main"]);
  const remoteMain = remoteLine.split(/\s+/u)[0]?.toLowerCase() ?? "";
  if (remoteMain !== commit) fail("VECTOR_PRODUCTION_REMOTE_MAIN_MISMATCH", "origin/main no longer matches the requested commit.", { expected: commit, actual: remoteMain || null });
  return Object.freeze({ branch, head, remoteMain });
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
    fail("VECTOR_PRODUCTION_STEP_FAILED", `${label} failed.`, {
      status: result.status,
      durationMs: Date.now() - started,
    });
  }
  return Object.freeze({ label, durationMs: Date.now() - started });
}

function readToken(file) {
  const value = readFileSync(file, "utf8").trim();
  if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u.test(value)) fail("VECTOR_PRODUCTION_LAUNCH_TOKEN_INVALID", "Generated launch token failed the expected bounded shape.");
  return value;
}

function runLaunchProof(profile, options, files, steps) {
  const tokenFile = path.join(options.evidenceRoot, `${profile}.launch-token.secret`);
  const tokenReceipt = path.join(options.evidenceRoot, `${profile}.launch-token.receipt.json`);
  const proofFile = path.join(options.evidenceRoot, `${profile}.launch-proof.json`);
  runNode([
    "scripts/create-vector-live-launch-token.mjs",
    "--profile", profile,
    "--commit", options.commit,
    "--token-out", tokenFile,
    "--receipt-out", tokenReceipt,
  ], `${profile} one-time launch token`);
  let token = null;
  try {
    token = readToken(tokenFile);
    const proofEnv = { ...process.env, VECTOR_DEPLOYMENT_PROOF_LAUNCH_TOKEN: token, VECTOR_DEPLOYMENT_SOURCE_PROOF: files.sourceProof };
    steps.push(runNode([
      "scripts/verify-live-deployment.mjs",
      "--commit", options.commit,
      "--source-proof", files.sourceProof,
      "--require-launch",
      "--out", proofFile,
    ], `${profile} one-time launch and replay proof`, proofEnv));
  } finally {
    token = null;
    rmSync(tokenFile, { force: true });
  }
  files[`${profile}LaunchReceipt`] = tokenReceipt;
  files[`${profile}LaunchProof`] = proofFile;
}

function writeFinalReceipt(options, files, steps, exactMainStates) {
  const target = path.join(options.evidenceRoot, "vector-production-lane.json");
  const receipt = {
    contractVersion: CONTRACT_VERSION,
    check: "vector-studio-provider-free-production-lane",
    repository: REPOSITORY,
    mode: options.mode,
    commit: options.commit,
    passed: true,
    providerFreeExecution: true,
    githubActionsAuthority: false,
    repositoryPublicationAuthority: "development.repository.publish",
    provider: "vercel",
    providerMutationPerformed: options.mode === "apply",
    deploymentPerformed: options.mode === "apply",
    ownerLaunchProved: options.mode === "apply",
    clientLaunchProved: options.mode === "apply",
    rawLaunchTokenRecorded: false,
    sensitiveValuesRecorded: false,
    files,
    exactMainStates,
    steps,
  };
  const serialized = `${JSON.stringify(receipt, null, 2)}\n`;
  if (Buffer.byteLength(serialized, "utf8") > MAX_FINAL_RECEIPT_BYTES) fail("VECTOR_PRODUCTION_FINAL_RECEIPT_TOO_LARGE", "Final production receipt exceeded its bounded size.");
  for (const key of ["VERCEL_TOKEN", "EVAVO_CLIENT_APP_LAUNCH_SECRET", "EVAVO_VECTOR_PRIVATE_SIGNING_SECRET", "UPSTASH_REDIS_REST_TOKEN", "VECTOR_API_TOKEN", "VECTOR_WORKER_API_TOKEN"]) {
    const value = String(process.env[key] ?? "");
    if (value && serialized.includes(value)) fail("VECTOR_PRODUCTION_SECRET_LEAK", `Sensitive ${key} material entered the final receipt.`);
  }
  writeFileSync(target, serialized, { encoding: "utf8", flag: "wx", mode: 0o600 });
  return target;
}

function runSelfTest() {
  if (!SHA_PATTERN.test("a".repeat(40)) || SHA_PATTERN.test("A".repeat(40))) throw new Error("self-test SHA grammar failed");
  process.stdout.write(`${JSON.stringify({
    ok: true,
    check: "vector-studio-provider-free-production-lane-self-test",
    contractVersion: CONTRACT_VERSION,
    modes: ["plan", "apply"],
    exactMainRecheckedBeforeAndAfterProviderEffects: true,
    applicationAuthoritiesUsedOnlyByApplyChildren: true,
    ownerAndClientLaunchProofsSeparated: true,
    rawLaunchTokenRecorded: false,
    repositoryPublicationAuthority: "development.repository.publish",
    sensitiveValuesRecorded: false,
  }, null, 2)}\n`);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.selfTest) {
    runSelfTest();
    return;
  }
  options.evidenceRoot = assertExternalCreateOnlyRoot(options.evidenceRoot);
  const steps = [];
  const exactMainStates = [];
  const files = {
    sourceProof: path.join(options.evidenceRoot, "source-proof.json"),
    providerPlan: path.join(options.evidenceRoot, "provider-plan.json"),
    deploymentPlan: path.join(options.evidenceRoot, "deployment-plan.json"),
  };

  exactMainStates.push(assertExactMain(options.commit));
  steps.push(runNode(["scripts/create-source-proof.mjs", "--commit", options.commit, "--out", files.sourceProof], "exact source proof"));
  exactMainStates.push(assertExactMain(options.commit));
  steps.push(runNode(["scripts/plan-vector-studio-vercel-provisioning.mjs", "--commit", options.commit, "--out", files.providerPlan], "bounded provider inspection plan"));
  steps.push(runNode(["scripts/enforce-vercel-provider-inspection-receipt.mjs", "--receipt", files.providerPlan, "--commit", options.commit], "provider inspection receipt enforcement"));
  steps.push(runNode(["scripts/deploy-vector-studio-vercel.mjs", "--mode", "plan", "--commit", options.commit, "--out", files.deploymentPlan], "exact production deployment plan"));
  exactMainStates.push(assertExactMain(options.commit));

  if (options.mode === "apply") {
    files.provisionApply = path.join(options.evidenceRoot, "provision-apply.json");
    files.deploymentApply = path.join(options.evidenceRoot, "deployment-apply.json");
    files.privateResponse = path.join(options.evidenceRoot, "private-response-proof.json");
    files.publicDeployment = path.join(options.evidenceRoot, "public-deployment-proof.json");
    files.capabilities = path.join(options.evidenceRoot, "capability-discovery-proof.json");

    const provisionEnv = { ...process.env, VECTOR_VERCEL_OPERATION_CONFIRM: PROVISION_CONFIRMATION };
    steps.push(runNode(["scripts/provision-vector-studio-vercel.mjs", "--mode", "apply", "--commit", options.commit, "--out", files.provisionApply], "Vercel production project/environment/domain reconciliation", provisionEnv));
    exactMainStates.push(assertExactMain(options.commit));

    const deployEnv = { ...process.env, VECTOR_VERCEL_DEPLOY_CONFIRM: DEPLOY_CONFIRMATION };
    steps.push(runNode(["scripts/deploy-vector-studio-vercel.mjs", "--mode", "apply", "--commit", options.commit, "--out", files.deploymentApply], "exact Vercel production deployment", deployEnv));
    exactMainStates.push(assertExactMain(options.commit));

    steps.push(runNode(["scripts/verify-live-private-response.mjs", "--commit", options.commit, "--out", files.privateResponse], "live private-response proof"));
    const sourceProofEnv = { ...process.env, VECTOR_DEPLOYMENT_SOURCE_PROOF: files.sourceProof };
    steps.push(runNode(["scripts/verify-live-deployment.mjs", "--commit", options.commit, "--source-proof", files.sourceProof, "--out", files.publicDeployment], "live public deployment proof", sourceProofEnv));
    steps.push(runNode(["scripts/verify-live-capability-discovery.mjs", "--commit", options.commit, "--out", files.capabilities], "live capability discovery proof", sourceProofEnv));

    runLaunchProof("owner", options, files, steps);
    runLaunchProof("client", options, files, steps);
    exactMainStates.push(assertExactMain(options.commit));
  }

  const finalReceipt = writeFinalReceipt(options, files, steps, exactMainStates);
  process.stdout.write(`${JSON.stringify({
    ok: true,
    check: "vector-studio-provider-free-production-lane",
    mode: options.mode,
    commit: options.commit,
    finalReceipt,
    deploymentPerformed: options.mode === "apply",
    ownerLaunchProved: options.mode === "apply",
    clientLaunchProved: options.mode === "apply",
    rawLaunchTokenRecorded: false,
    repositoryPublicationAuthority: "development.repository.publish",
    sensitiveValuesRecorded: false,
  }, null, 2)}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    error: error instanceof Error && "code" in error ? error.code : "VECTOR_PRODUCTION_FAILED",
    message: error instanceof Error ? error.message : String(error),
    details: error instanceof Error && "details" in error ? error.details : undefined,
    rawLaunchTokenRecorded: false,
    repositoryPublicationAuthority: "development.repository.publish",
    sensitiveValuesRecorded: false,
  }, null, 2)}\n`);
  process.exit(1);
}
