#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CONTRACT_VERSION = "1.0";
const REPOSITORY = "EVAVO-STUDIO/evavo-vector-studio";
const CHILD_SCRIPT = "scripts/provision-vector-studio-vercel.mjs";
const MAX_CHILD_OUTPUT_BYTES = 1_000_000;
const MAX_RECEIPT_BYTES = 64 * 1024;
const SHA_PATTERN = /^[a-f0-9]{40}$/u;
const SAFE_ERROR_PATTERN = /^[A-Z0-9_:-]{1,120}$/u;
const SAFE_ENV_KEY_PATTERN = /^[A-Z][A-Z0-9_]{0,79}$/u;
const SAFE_METHODS = new Set(["GET", "POST", "PATCH", "PUT", "DELETE"]);

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function parseArgs(argv) {
  const options = { commit: null, out: null, selfTest: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--self-test") {
      options.selfTest = true;
      continue;
    }
    if (argument === "--commit" || argument === "--out") {
      const value = argv[index + 1];
      if (!value) fail("VECTOR_VERCEL_SETTINGS_WRAPPER_ARGUMENT_INVALID", `${argument} requires a value.`);
      index += 1;
      if (argument === "--commit") options.commit = value;
      else options.out = value;
      continue;
    }
    fail("VECTOR_VERCEL_SETTINGS_WRAPPER_ARGUMENT_INVALID", `Unknown argument: ${argument}`);
  }
  if (!options.selfTest) {
    if (!options.commit || !SHA_PATTERN.test(options.commit)) {
      fail("VECTOR_VERCEL_SETTINGS_WRAPPER_COMMIT_INVALID", "Pass the exact lowercase 40-character commit with --commit.");
    }
    if (!options.out) {
      fail("VECTOR_VERCEL_SETTINGS_WRAPPER_OUTPUT_REQUIRED", "Pass the bounded receipt path with --out.");
    }
  }
  return options;
}

function safeString(value, pattern) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return pattern.test(trimmed) ? trimmed : null;
}

function safeInteger(value) {
  return Number.isInteger(value) && value >= 100 && value <= 599 ? value : null;
}

function safeKeyList(value) {
  if (!Array.isArray(value)) return Object.freeze([]);
  return Object.freeze(
    value
      .map((item) => safeString(item, SAFE_ENV_KEY_PATTERN))
      .filter(Boolean)
      .slice(0, 32),
  );
}

function structuredErrorFromText(text) {
  if (typeof text !== "string" || text.length === 0) return null;
  if (Buffer.byteLength(text, "utf8") > MAX_CHILD_OUTPUT_BYTES) return null;
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    const first = trimmed.indexOf("{");
    const last = trimmed.lastIndexOf("}");
    if (first < 0 || last <= first) return null;
    try {
      const parsed = JSON.parse(trimmed.slice(first, last + 1));
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
}

export function sanitiseProvisionerFailure(stderr) {
  const parsed = structuredErrorFromText(stderr);
  const errorCode =
    safeString(parsed?.error, SAFE_ERROR_PATTERN) ?? "VERCEL_PROVISION_FAILED";
  const details = parsed?.details && typeof parsed.details === "object" && !Array.isArray(parsed.details)
    ? parsed.details
    : {};
  const methodCandidate =
    typeof details.method === "string" ? details.method.trim().toUpperCase() : "";
  const method = SAFE_METHODS.has(methodCandidate) ? methodCandidate : null;
  const rawPath = typeof details.path === "string" ? details.path.trim() : "";
  const providerPath = rawPath.startsWith("/") && rawPath.length <= 512
    ? rawPath.split("?", 1)[0].slice(0, 240)
    : null;
  const providerCode = safeString(details.code, SAFE_ERROR_PATTERN);
  const providerStatus = safeInteger(details.status);
  const missing = safeKeyList(details.missing);
  const invalid = safeKeyList(details.invalid);

  return Object.freeze({
    errorCode,
    provider: Object.freeze({
      method,
      path: providerPath,
      status: providerStatus,
      code: providerCode,
    }),
    missing,
    invalid,
    deploymentPerformed: false,
    mutationAttempted: parsed?.mutationAttempted === true,
    mutationPerformed: parsed?.mutationPerformed === true,
    rawProviderResponseRecorded: false,
    rawStderrRecorded: false,
    sensitiveValuesRecorded: false,
  });
}

function writeFailureReceipt(options, failure) {
  const target = path.resolve(options.out);
  mkdirSync(path.dirname(target), { recursive: true });
  if (existsSync(target)) {
    fail("VECTOR_VERCEL_SETTINGS_WRAPPER_OUTPUT_EXISTS", `Refusing to overwrite an existing receipt: ${target}`);
  }
  const receipt = Object.freeze({
    version: CONTRACT_VERSION,
    check: "vector-studio-vercel-settings-reconciliation",
    repository: REPOSITORY,
    commit: options.commit,
    mode: "settings",
    passed: false,
    error: failure.errorCode,
    provider: failure.provider,
    missing: failure.missing,
    invalid: failure.invalid,
    deploymentPerformed: false,
    mutationAttempted: failure.mutationAttempted,
    mutationPerformed: failure.mutationPerformed,
    rawProviderResponseRecorded: false,
    rawStderrRecorded: false,
    sensitiveValuesRecorded: false,
  });
  const serialized = `${JSON.stringify(receipt, null, 2)}\n`;
  if (Buffer.byteLength(serialized, "utf8") > MAX_RECEIPT_BYTES) {
    fail("VECTOR_VERCEL_SETTINGS_WRAPPER_RECEIPT_TOO_LARGE", "The bounded diagnostic receipt exceeded its size limit.");
  }
  writeFileSync(target, serialized, { encoding: "utf8", flag: "wx", mode: 0o600 });
  return target;
}

function runSelfTest() {
  const secret = "do-not-record-this-provider-token";
  const failure = sanitiseProvisionerFailure(JSON.stringify({
    ok: false,
    error: "VERCEL_PROVISION_API_FAILED",
    message: `provider message containing ${secret}`,
    details: {
      method: "PATCH",
      path: "/v9/projects/prj_example?teamId=team_example",
      status: 403,
      code: "forbidden",
      ignored: secret,
    },
    mutationAttempted: true,
    mutationPerformed: false,
    sensitiveValuesRecorded: false,
  }));
  assert.equal(failure.errorCode, "VERCEL_PROVISION_API_FAILED");
  assert.equal(failure.provider.method, "PATCH");
  assert.equal(failure.provider.path, "/v9/projects/prj_example");
  assert.equal(failure.provider.status, 403);
  assert.equal(failure.provider.code, null, "lowercase provider codes fail closed rather than entering receipts");
  assert.equal(failure.mutationAttempted, true);
  assert.equal(failure.mutationPerformed, false);
  assert.equal(JSON.stringify(failure).includes(secret), false);

  const credentialFailure = sanitiseProvisionerFailure(JSON.stringify({
    error: "VERCEL_PROVISION_PROVIDER_ACCESS_INVALID",
    details: {
      missing: ["VERCEL_TOKEN"],
      invalid: ["VERCEL_TOKEN:below-minimum-length", secret],
    },
  }));
  assert.deepEqual(credentialFailure.missing, ["VERCEL_TOKEN"]);
  assert.deepEqual(credentialFailure.invalid, []);
  assert.equal(JSON.stringify(credentialFailure).includes(secret), false);

  const malformed = sanitiseProvisionerFailure(`warning ${secret}`);
  assert.equal(malformed.errorCode, "VERCEL_PROVISION_FAILED");
  assert.equal(JSON.stringify(malformed).includes(secret), false);

  process.stdout.write(`${JSON.stringify({
    ok: true,
    check: "vector-studio-vercel-settings-reconciliation-wrapper-self-test",
    contractVersion: CONTRACT_VERSION,
    boundedChildOutput: true,
    diagnosticReceiptOnFailure: true,
    rawProviderResponseRecorded: false,
    rawStderrRecorded: false,
    sensitiveValuesRecorded: false,
    providerMutationPerformed: false,
  }, null, 2)}\n`);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.selfTest) {
    runSelfTest();
    return;
  }

  const child = spawnSync(
    process.execPath,
    [
      CHILD_SCRIPT,
      "--mode",
      "settings",
      "--commit",
      options.commit,
      "--out",
      options.out,
    ],
    {
      cwd: process.cwd(),
      env: process.env,
      encoding: "utf8",
      maxBuffer: MAX_CHILD_OUTPUT_BYTES,
      windowsHide: true,
      shell: false,
    },
  );

  if (child.error) {
    const failure = sanitiseProvisionerFailure("");
    const output = writeFailureReceipt(options, failure);
    process.stderr.write(`${JSON.stringify({
      ok: false,
      error: "VECTOR_VERCEL_SETTINGS_WRAPPER_CHILD_FAILED",
      output,
      deploymentPerformed: false,
      mutationAttempted: false,
      mutationPerformed: false,
      sensitiveValuesRecorded: false,
    })}\n`);
    process.exit(1);
  }

  if (child.status === 0) {
    if (!existsSync(path.resolve(options.out))) {
      fail("VECTOR_VERCEL_SETTINGS_WRAPPER_SUCCESS_RECEIPT_MISSING", "The successful provisioner did not produce its bounded receipt.");
    }
    process.stdout.write(`${JSON.stringify({
      ok: true,
      check: "vector-studio-vercel-settings-reconciliation-wrapper",
      output: path.resolve(options.out),
      deploymentPerformed: false,
      sensitiveValuesRecorded: false,
    })}\n`);
    return;
  }

  const failure = sanitiseProvisionerFailure(child.stderr ?? "");
  const output = existsSync(path.resolve(options.out))
    ? path.resolve(options.out)
    : writeFailureReceipt(options, failure);
  process.stderr.write(`${JSON.stringify({
    ok: false,
    error: failure.errorCode,
    providerStatus: failure.provider.status,
    providerCode: failure.provider.code,
    output,
    deploymentPerformed: false,
    mutationAttempted: failure.mutationAttempted,
    mutationPerformed: failure.mutationPerformed,
    rawStderrRecorded: false,
    sensitiveValuesRecorded: false,
  })}\n`);
  process.exit(typeof child.status === "number" && child.status > 0 ? child.status : 1);
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      ok: false,
      error: error instanceof Error && "code" in error ? error.code : "VECTOR_VERCEL_SETTINGS_WRAPPER_FAILED",
      deploymentPerformed: false,
      mutationAttempted: false,
      mutationPerformed: false,
      sensitiveValuesRecorded: false,
    })}\n`);
    process.exit(1);
  }
}
