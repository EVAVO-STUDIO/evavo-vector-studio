#!/usr/bin/env node

import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const CONTRACT_VERSION = "1.0";
const PROVIDER_KEY = "VERCEL_TOKEN";
const MAX_RECEIPT_BYTES = 16 * 1024;

function evaluateProviderAccess(environment = process.env) {
  const value = String(environment[PROVIDER_KEY] ?? "").trim();
  const errors = [];
  if (!value) errors.push("missing");
  if (value && value.length < 20) errors.push("below-minimum-length");
  if (value && /\s/u.test(value)) errors.push("contains-whitespace");
  return Object.freeze({
    configured: value.length > 0,
    valid: errors.length === 0,
    errors: Object.freeze(errors),
  });
}

function parseArgs(argv) {
  const options = { out: null, selfTest: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--self-test") {
      options.selfTest = true;
      continue;
    }
    if (argument === "--out") {
      const value = argv[index + 1];
      if (!value) throw new Error("VECTOR_VERCEL_PROVIDER_ACCESS_OUTPUT_REQUIRED");
      options.out = value;
      index += 1;
      continue;
    }
    throw new Error(`VECTOR_VERCEL_PROVIDER_ACCESS_ARGUMENT_INVALID:${argument}`);
  }
  return options;
}

function receiptFor(evaluation) {
  return Object.freeze({
    version: CONTRACT_VERSION,
    check: "vector-studio-vercel-provider-access",
    provider: "vercel",
    key: PROVIDER_KEY,
    configured: evaluation.configured,
    valid: evaluation.valid,
    errors: evaluation.errors,
    networkRequestPerformed: false,
    providerMutationPerformed: false,
    rawCredentialRecorded: false,
    sensitiveValuesRecorded: false,
  });
}

function writeReceipt(target, receipt) {
  const absolute = path.resolve(target);
  mkdirSync(path.dirname(absolute), { recursive: true });
  const serialized = `${JSON.stringify(receipt, null, 2)}\n`;
  if (Buffer.byteLength(serialized, "utf8") > MAX_RECEIPT_BYTES) {
    throw new Error("VECTOR_VERCEL_PROVIDER_ACCESS_RECEIPT_TOO_LARGE");
  }
  writeFileSync(absolute, serialized, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  return absolute;
}

function runSelfTest() {
  const absent = evaluateProviderAccess({});
  assert.equal(absent.configured, false);
  assert.equal(absent.valid, false);
  assert.deepEqual(absent.errors, ["missing"]);

  const short = evaluateProviderAccess({ VERCEL_TOKEN: "short" });
  assert.equal(short.configured, true);
  assert.equal(short.valid, false);
  assert.deepEqual(short.errors, ["below-minimum-length"]);

  const whitespace = evaluateProviderAccess({
    VERCEL_TOKEN: `${"v".repeat(24)} bad`,
  });
  assert.equal(whitespace.valid, false);
  assert.deepEqual(whitespace.errors, ["contains-whitespace"]);

  const valid = evaluateProviderAccess({ VERCEL_TOKEN: "v".repeat(40) });
  assert.equal(valid.configured, true);
  assert.equal(valid.valid, true);
  assert.deepEqual(valid.errors, []);

  const serialized = JSON.stringify(receiptFor(valid));
  assert.equal(serialized.includes("v".repeat(20)), false);

  process.stdout.write(`${JSON.stringify({
    ok: true,
    check: "vector-studio-vercel-provider-access-self-test",
    contractVersion: CONTRACT_VERSION,
    networkRequestPerformed: false,
    providerMutationPerformed: false,
    rawCredentialRecorded: false,
    sensitiveValuesRecorded: false,
  }, null, 2)}\n`);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.selfTest) {
    runSelfTest();
    return;
  }
  if (!options.out) throw new Error("VECTOR_VERCEL_PROVIDER_ACCESS_OUTPUT_REQUIRED");
  const evaluation = evaluateProviderAccess();
  const receipt = receiptFor(evaluation);
  const output = writeReceipt(options.out, receipt);
  process.stdout.write(`${JSON.stringify({
    ok: evaluation.valid,
    output,
    providerAccessConfigured: evaluation.configured,
    providerAccessValid: evaluation.valid,
    errorCodes: evaluation.errors,
    networkRequestPerformed: false,
    providerMutationPerformed: false,
    sensitiveValuesRecorded: false,
  }, null, 2)}\n`);
  if (!evaluation.valid) process.exit(1);
}

try {
  main();
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    error: error instanceof Error ? error.message : "VECTOR_VERCEL_PROVIDER_ACCESS_FAILED",
    networkRequestPerformed: false,
    providerMutationPerformed: false,
    sensitiveValuesRecorded: false,
  })}\n`);
  process.exit(1);
}
