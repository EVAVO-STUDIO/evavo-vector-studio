#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";

const CONTRACT_VERSION = "1.0";
const REPOSITORY = "EVAVO-STUDIO/evavo-vector-studio";
const SHA_PATTERN = /^[a-f0-9]{40}$/u;
const MAX_CHILD_OUTPUT_BYTES = 1_000_000;

function fail(code, message, details = undefined) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  throw error;
}

function parseArgs(argv) {
  const options = { commit: null, evidenceRoot: null, selfTest: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--self-test") {
      options.selfTest = true;
      continue;
    }
    if (argument === "--commit" || argument === "--evidence-root") {
      const value = argv[index + 1];
      if (!value) fail("VECTOR_VERCEL_SETTINGS_SOURCE_ARGUMENT_INVALID", `${argument} requires a value.`);
      index += 1;
      if (argument === "--commit") options.commit = value;
      else options.evidenceRoot = value;
      continue;
    }
    fail("VECTOR_VERCEL_SETTINGS_SOURCE_ARGUMENT_INVALID", `Unknown argument: ${argument}`);
  }
  if (!options.selfTest) {
    if (!options.commit || !SHA_PATTERN.test(options.commit)) {
      fail("VECTOR_VERCEL_SETTINGS_SOURCE_COMMIT_INVALID", "Pass the exact lowercase 40-character commit with --commit.");
    }
    if (!options.evidenceRoot) {
      fail("VECTOR_VERCEL_SETTINGS_SOURCE_EVIDENCE_REQUIRED", "Pass --evidence-root for create-only bounded receipts.");
    }
  }
  return options;
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
    fail("VECTOR_VERCEL_SETTINGS_SOURCE_COMMAND_FAILED", `Unable to execute ${command} ${args.join(" ")}.`, {
      status: error && typeof error === "object" && "status" in error ? error.status : null,
    });
  }
}

function assertExactMain(commit) {
  const branch = commandOutput("git", ["branch", "--show-current"]);
  if (branch !== "main") fail("VECTOR_VERCEL_SETTINGS_SOURCE_BRANCH_INVALID", `Expected main; observed ${branch || "detached"}.`);
  const head = commandOutput("git", ["rev-parse", "HEAD"]).toLowerCase();
  if (head !== commit) fail("VECTOR_VERCEL_SETTINGS_SOURCE_HEAD_MISMATCH", "Checked-out HEAD does not match requested commit.", { expected: commit, actual: head });
  const status = commandOutput("git", ["status", "--porcelain=v1", "--untracked-files=all"]);
  if (status) fail("VECTOR_VERCEL_SETTINGS_SOURCE_DIRTY", "Settings reconciliation requires a clean repository boundary.");
  const remoteLine = commandOutput("git", ["ls-remote", "--refs", "origin", "refs/heads/main"]);
  const remote = remoteLine.split(/\s+/u)[0]?.toLowerCase() ?? "";
  if (remote !== commit) fail("VECTOR_VERCEL_SETTINGS_SOURCE_REMOTE_MISMATCH", "origin/main no longer matches requested commit.", { expected: commit, actual: remote || null });
  return Object.freeze({ branch, head, remoteMain: remote });
}

function runNode(args, label) {
  const result = spawnSync(process.execPath, args, {
    cwd: process.cwd(),
    env: process.env,
    encoding: "utf8",
    maxBuffer: MAX_CHILD_OUTPUT_BYTES,
    windowsHide: true,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error || result.status !== 0) {
    fail("VECTOR_VERCEL_SETTINGS_SOURCE_STEP_FAILED", `${label} failed.`, {
      status: result.status,
    });
  }
  return Object.freeze({ label, status: "passed" });
}

function runSelfTest() {
  assert.match("a".repeat(40), SHA_PATTERN);
  assert.doesNotMatch("A".repeat(40), SHA_PATTERN);
  assert.equal(REPOSITORY, "EVAVO-STUDIO/evavo-vector-studio");
  process.stdout.write(`${JSON.stringify({
    ok: true,
    check: "vector-vercel-settings-source-self-test",
    contractVersion: CONTRACT_VERSION,
    order: ["exact-main", "provider-access", "source-proof", "settings-reconciliation"],
    applicationSecretAuthority: false,
    productionDeploymentAuthority: false,
    repositoryPublicationAuthority: false,
    sensitiveValuesRecorded: false,
  }, null, 2)}\n`);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.selfTest) {
    runSelfTest();
    return;
  }

  const exactMainBefore = assertExactMain(options.commit);
  const evidenceRoot = path.resolve(options.evidenceRoot);
  mkdirSync(evidenceRoot, { recursive: true, mode: 0o700 });
  const providerReceipt = path.join(evidenceRoot, "vector-vercel-provider-access.json");
  const sourceProof = path.join(evidenceRoot, "vector-source-proof.json");
  const settingsReceipt = path.join(evidenceRoot, "vector-vercel-provision-settings.json");

  const steps = [
    runNode(["scripts/check-vector-vercel-provider-access.mjs", "--out", providerReceipt], "provider access admission"),
    runNode(["scripts/create-source-proof.mjs", "--commit", options.commit, "--out", sourceProof], "exact source proof"),
  ];
  const exactMainAfterSource = assertExactMain(options.commit);
  steps.push(runNode(["scripts/run-vector-vercel-settings-reconciliation.mjs", "--commit", options.commit, "--out", settingsReceipt], "settings-only reconciliation"));
  const exactMainAfterSettings = assertExactMain(options.commit);

  process.stdout.write(`${JSON.stringify({
    ok: true,
    check: "vector-vercel-settings-source",
    contractVersion: CONTRACT_VERSION,
    repository: REPOSITORY,
    commit: options.commit,
    order: ["exact-main", "provider-access", "source-proof", "settings-reconciliation"],
    evidence: {
      providerReceipt,
      sourceProof,
      settingsReceipt,
    },
    exactMainBefore,
    exactMainAfterSource,
    exactMainAfterSettings,
    applicationSecretAuthority: false,
    productionDeploymentAuthority: false,
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
    error: error instanceof Error && "code" in error ? error.code : "VECTOR_VERCEL_SETTINGS_SOURCE_FAILED",
    message: error instanceof Error ? error.message : String(error),
    details: error instanceof Error && "details" in error ? error.details : undefined,
    applicationSecretAuthority: false,
    productionDeploymentAuthority: false,
    repositoryPublicationAuthority: false,
    sensitiveValuesRecorded: false,
  }, null, 2)}\n`);
  process.exit(1);
}
