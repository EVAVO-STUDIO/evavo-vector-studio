import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { link, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

const CONTRACT_VERSION = "1.0";
const REPOSITORY = "EVAVO-STUDIO/evavo-vector-studio";
const PROJECT_NAME = "evavo-vector-studio";
const PRODUCTION_DOMAIN = "vector.evavo.com.au";
const CHILD_SCRIPT = "scripts/provision-vector-studio-vercel.mjs";
const MAX_RECEIPT_BYTES = 256 * 1024;
const MAX_CHILD_OUTPUT_BYTES = 256 * 1024;
const CHILD_TIMEOUT_MS = 2 * 60 * 1000;
const SHA_PATTERN = /^[a-f0-9]{40}$/;

const REQUIRED_SECRETS = Object.freeze([
  "VERCEL_TOKEN",
  "EVAVO_CLIENT_APP_LAUNCH_SECRET",
  "EVAVO_VECTOR_PRIVATE_SIGNING_SECRET",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "VECTOR_API_TOKEN",
  "VECTOR_WORKER_API_TOKEN",
]);
const AUTHORITY_KEYS = Object.freeze([
  "EVAVO_CLIENT_APP_LAUNCH_SECRET",
  "EVAVO_VECTOR_PRIVATE_SIGNING_SECRET",
  "VECTOR_API_TOKEN",
  "VECTOR_WORKER_API_TOKEN",
]);

function fail(code, message, details = undefined) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  throw error;
}

function parseArgs(argv) {
  const result = { commit: null, out: null, selfTest: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--self-test") {
      result.selfTest = true;
      continue;
    }
    if (!["--commit", "--out"].includes(argument)) {
      fail("VERCEL_PROVISION_PLAN_ARGUMENT_INVALID", `Unknown argument: ${argument}`);
    }
    const value = argv[index + 1];
    if (!value) fail("VERCEL_PROVISION_PLAN_ARGUMENT_INVALID", `${argument} requires a value.`);
    index += 1;
    if (argument === "--commit") result.commit = value;
    if (argument === "--out") result.out = value;
  }
  if (!result.selfTest && (!result.commit || !SHA_PATTERN.test(result.commit))) {
    fail(
      "VERCEL_PROVISION_PLAN_COMMIT_INVALID",
      "Pass the exact lowercase 40-character current main commit with --commit.",
    );
  }
  return result;
}

function credentialReadiness(environment = process.env) {
  const missing = [];
  const invalid = [];
  const values = {};
  for (const key of REQUIRED_SECRETS) {
    const value = String(environment[key] ?? "").trim();
    values[key] = value;
    if (!value) {
      missing.push(key);
      continue;
    }
    if (key === "UPSTASH_REDIS_REST_URL") {
      try {
        const url = new URL(value);
        if (
          url.protocol !== "https:" ||
          url.username ||
          url.password ||
          url.search ||
          url.hash
        ) {
          invalid.push(`${key}:invalid-https-url`);
        }
      } catch {
        invalid.push(`${key}:invalid-https-url`);
      }
      continue;
    }
    const minimum = key === "VERCEL_TOKEN" ? 20 : 32;
    if (value.length < minimum) invalid.push(`${key}:below-minimum-length`);
    if (/\s/.test(value)) invalid.push(`${key}:contains-whitespace`);
  }

  const seenAuthorities = new Map();
  for (const key of AUTHORITY_KEYS) {
    const value = values[key];
    if (!value) continue;
    const digest = createHash("sha256").update(value).digest("hex");
    const prior = seenAuthorities.get(digest);
    if (prior) invalid.push(`${key}:duplicates-${prior}`);
    else seenAuthorities.set(digest, key);
  }

  return Object.freeze({
    missing: Object.freeze(missing),
    invalid: Object.freeze(invalid),
    values: Object.freeze(values),
    passed: missing.length === 0 && invalid.length === 0,
    authoritySeparationPassed: !invalid.some((item) => item.includes(":duplicates-")),
  });
}

async function regularFileExists(filePath) {
  try {
    return (await stat(filePath)).isFile();
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
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
      fail(
        "VERCEL_PROVISION_PLAN_OUTPUT_EXISTS",
        `The provisioning plan receipt already exists: ${absolute}`,
      );
    }
    throw error;
  } finally {
    await rm(temporary, { force: true });
  }
  return absolute;
}

function childFailure(result, readiness) {
  if (!readiness.passed) {
    return Object.freeze({
      code: "VERCEL_PROVISION_CREDENTIALS_INVALID",
      message: "Required provisioning credentials are missing, malformed or not separated.",
      details: Object.freeze({
        missing: readiness.missing,
        invalid: readiness.invalid,
        authoritySeparationPassed: readiness.authoritySeparationPassed,
      }),
    });
  }
  if (result.error) {
    return Object.freeze({
      code: "VERCEL_PROVISION_PLAN_CHILD_PROCESS_FAILED",
      message: "The bounded provisioning plan process could not complete.",
      details: Object.freeze({
        errorCode:
          typeof result.error.code === "string" ? result.error.code.slice(0, 80) : null,
      }),
    });
  }
  return Object.freeze({
    code: "VERCEL_PROVISION_PLAN_FAILED",
    message: "The governed provisioning plan failed before producing its canonical receipt.",
    details: Object.freeze({ childStatus: result.status }),
  });
}

function assertSecretFree(serialized, readiness) {
  for (const key of REQUIRED_SECRETS) {
    const value = readiness.values[key];
    if (value && serialized.includes(value)) {
      fail(
        "VERCEL_PROVISION_PLAN_SECRET_LEAK",
        `The value for ${key} entered the provisioning plan receipt.`,
      );
    }
  }
}

async function writeDiagnosticReceipt(options, result, readiness, startedAtMs) {
  const failure = childFailure(result, readiness);
  const completedAtMs = Date.now();
  const receipt = Object.freeze({
    version: CONTRACT_VERSION,
    check: "vector-studio-vercel-provisioning-plan",
    repository: REPOSITORY,
    commit: options.commit,
    mode: "plan",
    projectName: PROJECT_NAME,
    productionDomain: PRODUCTION_DOMAIN,
    startedAt: new Date(startedAtMs).toISOString(),
    completedAt: new Date(completedAtMs).toISOString(),
    durationMs: Math.max(0, completedAtMs - startedAtMs),
    passed: false,
    readyToApply: false,
    credentialReadiness: Object.freeze({
      requiredKeys: REQUIRED_SECRETS,
      missing: readiness.missing,
      invalid: readiness.invalid,
      authoritySeparationPassed: readiness.authoritySeparationPassed,
    }),
    plan: Object.freeze({
      inspectionAvailable: false,
      action: "inspection-unavailable",
      project: null,
      environment: null,
      domain: null,
    }),
    blockers: Object.freeze([failure]),
    child: Object.freeze({
      script: CHILD_SCRIPT,
      mode: "plan",
      status: result.status,
      signal: result.signal ?? null,
      errorCode:
        result.error && typeof result.error.code === "string"
          ? result.error.code.slice(0, 80)
          : null,
      stdoutBytes: Buffer.byteLength(result.stdout ?? "", "utf8"),
      stderrBytes: Buffer.byteLength(result.stderr ?? "", "utf8"),
      canonicalReceiptProduced: false,
    }),
    diagnosticReceipt: true,
    mutationAttempted: false,
    mutationPerformed: false,
    sensitiveValuesRecorded: false,
  });
  const serialized = `${JSON.stringify(receipt, null, 2)}\n`;
  if (Buffer.byteLength(serialized, "utf8") > MAX_RECEIPT_BYTES) {
    fail(
      "VERCEL_PROVISION_PLAN_RECEIPT_TOO_LARGE",
      "The diagnostic provisioning plan receipt exceeded its bounded limit.",
    );
  }
  assertSecretFree(serialized, readiness);
  const target =
    options.out ??
    path.join("artifacts", "vercel-provisioning", `${options.commit}.plan.json`);
  return Object.freeze({
    receipt,
    output: await atomicNewFile(target, serialized),
  });
}

function safeChildSuccessOutput(result, readiness) {
  const source = String(result.stdout ?? "");
  if (Buffer.byteLength(source, "utf8") > MAX_CHILD_OUTPUT_BYTES) return null;
  for (const key of REQUIRED_SECRETS) {
    const value = readiness.values[key];
    if (value && source.includes(value)) return null;
  }
  return source;
}

async function runPlan(options, environment = process.env) {
  const startedAtMs = Date.now();
  const readiness = credentialReadiness(environment);
  const output = path.resolve(
    options.out ??
      path.join("artifacts", "vercel-provisioning", `${options.commit}.plan.json`),
  );
  const result = spawnSync(
    process.execPath,
    [
      CHILD_SCRIPT,
      "--mode",
      "plan",
      "--commit",
      options.commit,
      "--out",
      output,
    ],
    {
      cwd: process.cwd(),
      env: environment,
      encoding: "utf8",
      shell: false,
      timeout: CHILD_TIMEOUT_MS,
      maxBuffer: MAX_CHILD_OUTPUT_BYTES,
    },
  );
  const receiptProduced = await regularFileExists(output);

  if (result.status === 0 && receiptProduced) {
    const childOutput = safeChildSuccessOutput(result, readiness);
    process.stdout.write(
      childOutput ??
        `${JSON.stringify({
          ok: true,
          mode: "plan",
          output,
          childStatus: 0,
          canonicalReceiptProduced: true,
          mutationAttempted: false,
          mutationPerformed: false,
          sensitiveValuesRecorded: false,
        }, null, 2)}\n`,
    );
    return 0;
  }

  if (receiptProduced) {
    process.stderr.write(`${JSON.stringify({
      ok: false,
      error: "VERCEL_PROVISION_PLAN_FAILED_WITH_RECEIPT",
      message: "The governed provisioning plan failed and preserved its canonical receipt.",
      output,
      childStatus: result.status,
      canonicalReceiptProduced: true,
      diagnosticReceiptWritten: false,
      mutationAttempted: false,
      mutationPerformed: false,
      sensitiveValuesRecorded: false,
    }, null, 2)}\n`);
    return 1;
  }

  const diagnostic = await writeDiagnosticReceipt(options, result, readiness, startedAtMs);
  process.stderr.write(`${JSON.stringify({
    ok: false,
    error: diagnostic.receipt.blockers[0].code,
    message: diagnostic.receipt.blockers[0].message,
    blockerCodes: diagnostic.receipt.blockers.map((item) => item.code),
    output: diagnostic.output,
    childStatus: result.status,
    canonicalReceiptProduced: false,
    diagnosticReceiptWritten: true,
    mutationAttempted: false,
    mutationPerformed: false,
    sensitiveValuesRecorded: false,
  }, null, 2)}\n`);
  return 1;
}

async function runSelfTest() {
  const missing = credentialReadiness({});
  assert.equal(missing.passed, false);
  assert.deepEqual(missing.missing, REQUIRED_SECRETS);
  assert.equal(missing.authoritySeparationPassed, true);

  const separated = Object.fromEntries(
    REQUIRED_SECRETS.map((key, index) => [
      key,
      key === "UPSTASH_REDIS_REST_URL"
        ? "https://example.upstash.io"
        : `${String(index + 1).padStart(2, "0")}-${"x".repeat(40)}`,
    ]),
  );
  const valid = credentialReadiness(separated);
  assert.equal(valid.passed, true);

  const duplicated = {
    ...separated,
    VECTOR_WORKER_API_TOKEN: separated.VECTOR_API_TOKEN,
  };
  const duplicateState = credentialReadiness(duplicated);
  assert.equal(duplicateState.passed, false);
  assert.equal(duplicateState.authoritySeparationPassed, false);

  process.stdout.write(`${JSON.stringify({
    ok: true,
    check: "vector-studio-vercel-provision-plan-self-test",
    contractVersion: CONTRACT_VERSION,
    requiredCredentialCount: REQUIRED_SECRETS.length,
    diagnosticReceiptOnFailure: true,
    mutationAttempted: false,
    mutationPerformed: false,
    sensitiveValuesRecorded: false,
  }, null, 2)}\n`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.selfTest) {
    await runSelfTest();
    return;
  }
  process.exitCode = await runPlan(options);
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    error:
      error instanceof Error && "code" in error && typeof error.code === "string"
        ? error.code
        : "VERCEL_PROVISION_PLAN_WRAPPER_FAILED",
    message: error instanceof Error ? error.message : String(error),
    mutationAttempted: false,
    mutationPerformed: false,
    sensitiveValuesRecorded: false,
  }, null, 2)}\n`);
  process.exit(1);
});
