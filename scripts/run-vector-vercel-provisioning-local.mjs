import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";

const CONTRACT_VERSION = "1.0";
const REPOSITORY = "EVAVO-STUDIO/evavo-vector-studio";
const APPLY_CONFIRMATION = "provision-evavo-vector-studio";
const SHA_PATTERN = /^[a-f0-9]{40}$/u;
const MAX_CHILD_OUTPUT_BYTES = 2 * 1024 * 1024;

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
      fail("VECTOR_VERCEL_PROVISION_LOCAL_ARGUMENT_INVALID", `Unknown argument: ${argument}`);
    }
    const value = argv[index + 1];
    if (!value) fail("VECTOR_VERCEL_PROVISION_LOCAL_ARGUMENT_INVALID", `${argument} requires a value.`);
    index += 1;
    if (argument === "--mode") options.mode = value;
    if (argument === "--commit") options.commit = value.trim().toLowerCase();
    if (argument === "--evidence-root") options.evidenceRoot = value;
  }
  if (!["plan", "settings", "apply"].includes(options.mode)) {
    fail("VECTOR_VERCEL_PROVISION_LOCAL_MODE_INVALID", "--mode must be plan, settings or apply.");
  }
  if (!options.commit || !SHA_PATTERN.test(options.commit)) {
    fail("VECTOR_VERCEL_PROVISION_LOCAL_COMMIT_INVALID", "Pass the exact lowercase 40-character commit with --commit.");
  }
  if (!options.evidenceRoot) {
    fail("VECTOR_VERCEL_PROVISION_LOCAL_EVIDENCE_REQUIRED", "Pass --evidence-root for create-only receipts.");
  }
  return options;
}

function runNode(args, label, env = process.env) {
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
    fail("VECTOR_VERCEL_PROVISION_LOCAL_STEP_FAILED", `${label} failed.`, { status: result.status });
  }
  return Object.freeze({ label, status: "passed" });
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const evidenceRoot = path.resolve(options.evidenceRoot);
  mkdirSync(evidenceRoot, { recursive: true, mode: 0o700 });
  const steps = [];

  if (options.mode === "settings") {
    steps.push(runNode([
      "scripts/run-vector-vercel-settings-source.mjs",
      "--commit", options.commit,
      "--evidence-root", path.join(evidenceRoot, "settings-source"),
    ], "settings-source orchestration"));
  } else {
    steps.push(runNode([
      "scripts/check-exact-current-main.mjs",
      "--commit", options.commit,
      "--out", path.join(evidenceRoot, "exact-main-before.json"),
    ], "exact current main before provisioning"));
    steps.push(runNode([
      "scripts/check-vector-vercel-provider-access.mjs",
      "--out", path.join(evidenceRoot, "provider-access.json"),
    ], "provider access admission"));

    if (options.mode === "plan") {
      const planReceipt = path.join(evidenceRoot, "provision-plan.json");
      steps.push(runNode([
        "scripts/plan-vector-studio-vercel-provisioning.mjs",
        "--commit", options.commit,
        "--out", planReceipt,
      ], "read-only provider plan"));
      steps.push(runNode([
        "scripts/enforce-vercel-provider-inspection-receipt.mjs",
        "--receipt", planReceipt,
        "--commit", options.commit,
      ], "provider plan receipt enforcement"));
      steps.push(runNode([
        "scripts/check-exact-current-main.mjs",
        "--commit", options.commit,
        "--out", path.join(evidenceRoot, "exact-main-after.json"),
      ], "exact current main after provider plan"));
    }

    if (options.mode === "apply") {
      steps.push(runNode([
        "scripts/create-source-proof.mjs",
        "--commit", options.commit,
        "--out", path.join(evidenceRoot, "source-proof.json"),
      ], "complete source proof"));
      steps.push(runNode([
        "scripts/check-exact-current-main.mjs",
        "--commit", options.commit,
        "--out", path.join(evidenceRoot, "exact-main-before-apply.json"),
      ], "exact current main before provider mutation"));
      const applyEnvironment = {
        ...process.env,
        VECTOR_VERCEL_OPERATION_CONFIRM: APPLY_CONFIRMATION,
      };
      steps.push(runNode([
        "scripts/provision-vector-studio-vercel.mjs",
        "--mode", "apply",
        "--commit", options.commit,
        "--out", path.join(evidenceRoot, "provision-apply.json"),
      ], "full provider provisioning apply", applyEnvironment));
      steps.push(runNode([
        "scripts/check-exact-current-main.mjs",
        "--commit", options.commit,
        "--out", path.join(evidenceRoot, "exact-main-after-apply.json"),
      ], "exact current main after provider mutation"));
    }
  }

  process.stdout.write(`${JSON.stringify({
    ok: true,
    check: "vector-vercel-provisioning-local",
    contractVersion: CONTRACT_VERSION,
    repository: REPOSITORY,
    mode: options.mode,
    commit: options.commit,
    evidenceRoot,
    providerFreeExecution: true,
    explicitApplyConfirmationBoundLocally: options.mode === "apply",
    deploymentPerformed: false,
    repositoryPublicationAuthority: false,
    githubActionsAuthority: false,
    sensitiveValuesRecorded: false,
    steps,
  }, null, 2)}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    error: error instanceof Error && "code" in error ? error.code : "VECTOR_VERCEL_PROVISION_LOCAL_FAILED",
    message: error instanceof Error ? error.message : String(error),
    details: error instanceof Error && "details" in error ? error.details : undefined,
    deploymentPerformed: false,
    repositoryPublicationAuthority: false,
    sensitiveValuesRecorded: false,
  }, null, 2)}\n`);
  process.exit(1);
}
