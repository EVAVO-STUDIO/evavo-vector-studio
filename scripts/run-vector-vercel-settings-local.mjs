import { spawnSync } from "node:child_process";
import { link, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const CONTRACT_VERSION = "1.0";
const REPOSITORY = "EVAVO-STUDIO/evavo-vector-studio";
const CONFIRMATION = "reconcile-evavo-vector-studio-project-settings";
const SHA_PATTERN = /^[a-f0-9]{40}$/u;
const MAX_CHILD_OUTPUT_BYTES = 2 * 1024 * 1024;
const MAX_RECEIPT_BYTES = 64 * 1024;

function fail(code, message, details = undefined) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  throw error;
}

function parseArgs(argv) {
  const options = { commit: null, outDir: null };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!["--commit", "--out-dir"].includes(argument)) {
      fail("VECTOR_VERCEL_SETTINGS_LOCAL_ARGUMENT_INVALID", `Unknown argument: ${argument}`);
    }
    const value = argv[index + 1];
    if (!value) fail("VECTOR_VERCEL_SETTINGS_LOCAL_ARGUMENT_INVALID", `${argument} requires a value.`);
    index += 1;
    if (argument === "--commit") options.commit = value.trim().toLowerCase();
    if (argument === "--out-dir") options.outDir = value;
  }
  if (!options.commit || !SHA_PATTERN.test(options.commit)) {
    fail("VECTOR_VERCEL_SETTINGS_LOCAL_COMMIT_INVALID", "Pass the exact lowercase 40-character commit with --commit.");
  }
  if (!options.outDir) fail("VECTOR_VERCEL_SETTINGS_LOCAL_OUTPUT_REQUIRED", "Pass --out-dir for create-only local evidence.");
  return options;
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
  });
  if (result.error || result.status !== 0) {
    fail("VECTOR_VERCEL_SETTINGS_LOCAL_STEP_FAILED", `${label} failed.`, {
      status: result.status,
      durationMs: Date.now() - started,
    });
  }
  return Object.freeze({ label, durationMs: Date.now() - started });
}

async function atomicNewFile(target, source) {
  const absolute = path.resolve(target);
  await mkdir(path.dirname(absolute), { recursive: true });
  const temporary = `${absolute}.tmp-${process.pid}-${Date.now()}`;
  try {
    await writeFile(temporary, source, { encoding: "utf8", flag: "wx", mode: 0o600 });
    await link(temporary, absolute);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "EEXIST") {
      fail("VECTOR_VERCEL_SETTINGS_LOCAL_OUTPUT_EXISTS", `Refusing to overwrite existing evidence: ${absolute}`);
    }
    throw error;
  } finally {
    await rm(temporary, { force: true });
  }
  return absolute;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const outDir = path.resolve(options.outDir);
  await mkdir(outDir, { recursive: true });
  const evidence = Object.freeze({
    providerAccess: path.join(outDir, "provider-access.json"),
    exactMainBefore: path.join(outDir, "exact-main-before.json"),
    sourceProof: path.join(outDir, "source-proof.json"),
    exactMainAfter: path.join(outDir, "exact-main-after.json"),
    settings: path.join(outDir, "settings.json"),
    summary: path.join(outDir, "summary.json"),
  });
  const startedAtMs = Date.now();
  const steps = [];

  steps.push(runNode(["scripts/check-vector-vercel-provider-access.mjs", "--out", evidence.providerAccess], "provider credential admission"));
  steps.push(runNode(["scripts/check-exact-current-main.mjs", "--commit", options.commit, "--out", evidence.exactMainBefore], "exact current main before source proof"));
  steps.push(runNode(["scripts/create-source-proof.mjs", "--commit", options.commit, "--out", evidence.sourceProof], "complete source proof"));
  steps.push(runNode(["scripts/check-exact-current-main.mjs", "--commit", options.commit, "--out", evidence.exactMainAfter], "exact current main after source proof"));

  const settingsEnvironment = {
    ...process.env,
    VECTOR_VERCEL_OPERATION_CONFIRM: CONFIRMATION,
  };
  steps.push(runNode([
    "scripts/run-vector-vercel-settings-reconciliation.mjs",
    "--commit", options.commit,
    "--out", evidence.settings,
  ], "provider-only settings reconciliation", settingsEnvironment));

  const completedAtMs = Date.now();
  const receipt = Object.freeze({
    contractVersion: CONTRACT_VERSION,
    check: "vector-studio-vercel-settings-local",
    repository: REPOSITORY,
    commit: options.commit,
    startedAt: new Date(startedAtMs).toISOString(),
    completedAt: new Date(completedAtMs).toISOString(),
    durationMs: completedAtMs - startedAtMs,
    passed: true,
    providerFreeExecution: true,
    exactCurrentMainBeforeSourceProof: true,
    exactCurrentMainAfterSourceProof: true,
    sourceProofRequired: true,
    providerMutationScope: "pinned-project-settings-only",
    productionDeploymentPerformed: false,
    applicationSecretAuthority: false,
    repositoryPublicationAuthority: false,
    githubActionsAuthority: false,
    sensitiveValuesRecorded: false,
    evidence,
    steps,
  });
  const serialized = `${JSON.stringify(receipt, null, 2)}\n`;
  if (Buffer.byteLength(serialized, "utf8") > MAX_RECEIPT_BYTES) {
    fail("VECTOR_VERCEL_SETTINGS_LOCAL_RECEIPT_TOO_LARGE", "Settings orchestration receipt exceeded its bounded size.");
  }
  await atomicNewFile(evidence.summary, serialized);
  process.stdout.write(`${JSON.stringify({ ok: true, output: evidence.summary, commit: options.commit, sensitiveValuesRecorded: false }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    error: error instanceof Error && "code" in error ? error.code : "VECTOR_VERCEL_SETTINGS_LOCAL_FAILED",
    message: error instanceof Error ? error.message : String(error),
    details: error instanceof Error && "details" in error ? error.details : undefined,
    sensitiveValuesRecorded: false,
  }, null, 2)}\n`);
  process.exit(1);
});
