import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const errors = [];
const checkedFiles = new Set();
const REQUIRED_SECRETS = Object.freeze([
  "VERCEL_TOKEN",
  "EVAVO_CLIENT_APP_LAUNCH_SECRET",
  "EVAVO_VECTOR_PRIVATE_SIGNING_SECRET",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "VECTOR_API_TOKEN",
  "VECTOR_WORKER_API_TOKEN",
]);

async function read(relativePath) {
  checkedFiles.add(relativePath);
  try {
    return (await readFile(path.join(root, relativePath), "utf8")).replace(/^\uFEFF/, "");
  } catch (error) {
    errors.push(`Missing or unreadable provisioning-plan file: ${relativePath} (${error instanceof Error ? error.message : String(error)})`);
    return "";
  }
}

function requireTokens(relativePath, source, tokens) {
  for (const token of tokens) {
    if (!source.includes(token)) {
      errors.push(`${relativePath} is missing provisioning-plan token: ${token}`);
    }
  }
}

function forbidTokens(relativePath, source, tokens) {
  for (const token of tokens) {
    if (source.includes(token)) {
      errors.push(`${relativePath} contains prohibited provisioning-plan material: ${token}`);
    }
  }
}

const files = {
  package: "package.json",
  wrapper: "scripts/plan-vector-studio-vercel-provisioning.mjs",
  provisioner: "scripts/provision-vector-studio-vercel.mjs",
  provisioningWorkflow: ".github/workflows/vector-vercel-project-provisioning.yml",
  exactWorkflow: ".github/workflows/vector-vercel-production-deployment.yml",
  deploymentWorkflow: ".github/workflows/vercel-deployment-contract.yml",
  docs: "docs/VERCEL-PROVISIONING-PLAN-RECEIPTS.md",
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
  packageJson?.scripts?.["vercel-provision-plan:check"] !==
  "node scripts/check-vercel-provisioning-plan-receipt-contract.mjs"
) {
  errors.push("package.json must expose vercel-provision-plan:check.");
}
if (!String(packageJson?.scripts?.check ?? "").includes("pnpm vercel-provision-plan:check")) {
  errors.push("package.json check must include vercel-provision-plan:check before dependency-backed gates.");
}

requireTokens(files.wrapper, sources.wrapper, [
  'const CONTRACT_VERSION = "1.0"',
  'const CHILD_SCRIPT = "scripts/provision-vector-studio-vercel.mjs"',
  'const REQUIRED_SECRETS = Object.freeze([',
  'const AUTHORITY_KEYS = Object.freeze([',
  "function credentialReadiness(environment = process.env)",
  'createHash("sha256").update(value)',
  "spawnSync(",
  "process.execPath",
  "CHILD_SCRIPT",
  '"--mode"',
  '"plan"',
  "async function writeDiagnosticReceipt(options, result, readiness, startedAtMs)",
  'check: "vector-studio-vercel-provisioning-plan"',
  "readyToApply: false",
  "inspectionAvailable: false",
  'action: "inspection-unavailable"',
  'code: "VERCEL_PROVISION_CREDENTIALS_INVALID"',
  "credentialReadiness: Object.freeze({",
  "canonicalReceiptProduced: false",
  "diagnosticReceipt: true",
  "mutationAttempted: false",
  "mutationPerformed: false",
  "assertSecretFree(serialized, readiness)",
  'writeFile(temporary, source, { encoding: "utf8", flag: "wx", mode: 0o600 })',
  "diagnosticReceiptWritten: true",
  'check: "vector-studio-vercel-provision-plan-self-test"',
  "diagnosticReceiptOnFailure: true",
]);
forbidTokens(files.wrapper, sources.wrapper, [
  '"apply"',
  "VECTOR_VERCEL_APPLY_CONFIRM",
  'method: "POST"',
  'method: "PATCH"',
  "fetch(",
  "console.log(process.env",
  "JSON.stringify(process.env",
  "mutationAttempted: true",
  "mutationPerformed: true",
  "authorization: `Bearer",
]);

requireTokens(files.provisioner, sources.provisioner, [
  '"--mode"',
  '"plan"',
  '"apply"',
  'const APPLY_CONFIRMATION = "provision-evavo-vector-studio"',
  "deploymentPerformed: false",
  "sensitiveValuesRecorded: false",
]);

requireTokens(files.provisioningWorkflow, sources.provisioningWorkflow, [
  "Verify provisioner and plan-wrapper self-tests",
  "node scripts/plan-vector-studio-vercel-provisioning.mjs --self-test",
  "Create bounded no-mutation plan",
  "node scripts/plan-vector-studio-vercel-provisioning.mjs",
  "--out .ci/vector-vercel-provision-plan.json",
  "Preserve bounded plan",
  "if: always()",
  "if-no-files-found: error",
  'context: "deploy/vector-studio-vercel-provision-plan"',
  "Apply idempotent Vercel project transaction",
  "node scripts/provision-vector-studio-vercel.mjs",
  "--mode apply",
  'VECTOR_VERCEL_APPLY_CONFIRM: ${{ inputs.confirmation }}',
]);

requireTokens(files.exactWorkflow, sources.exactWorkflow, [
  "node scripts/plan-vector-studio-vercel-provisioning.mjs --self-test",
  "Verify provisioned project, production environment and domain without mutation",
  "node scripts/plan-vector-studio-vercel-provisioning.mjs",
  "--out .ci/vector-vercel-provision-before-deploy.json",
  ".ci/vector-vercel-provision-before-deploy.json",
]);

for (const [relativePath, source] of [
  [files.provisioningWorkflow, sources.provisioningWorkflow],
  [files.exactWorkflow, sources.exactWorkflow],
]) {
  forbidTokens(relativePath, source, [
    "contents: write",
    "vercel deploy",
    "vercel --prod",
    "git push",
    "echo $VERCEL_TOKEN",
    "printenv",
  ]);
}

requireTokens(files.deploymentWorkflow, sources.deploymentWorkflow, [
  '"scripts/check-vercel-provisioning-plan-receipt-contract.mjs"',
  '"scripts/plan-vector-studio-vercel-provisioning.mjs"',
  '"docs/VERCEL-PROVISIONING-PLAN-RECEIPTS.md"',
  "Verify diagnostic provisioning-plan receipt contract",
  "node scripts/check-vercel-provisioning-plan-receipt-contract.mjs",
  "node scripts/plan-vector-studio-vercel-provisioning.mjs --self-test",
]);

requireTokens(files.docs, sources.docs, [
  "diagnostic provisioning plan receipts",
  "Canonical plan wrapper",
  "new-file-only",
  "readyToApply",
  "inspection-unavailable",
  "credentialReadiness.missing",
  "mutationAttempted",
  "mutationPerformed",
  "if-no-files-found: error",
  "pnpm vercel-plan:check",
]);

async function executableReceiptTest() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "vector-provision-plan-contract-"));
  const output = path.join(directory, "plan.json");
  const environment = { ...process.env };
  for (const key of REQUIRED_SECRETS) delete environment[key];
  delete environment.VECTOR_VERCEL_APPLY_CONFIRM;
  try {
    const result = spawnSync(
      process.execPath,
      [
        "scripts/plan-vector-studio-vercel-provisioning.mjs",
        "--commit",
        "b".repeat(40),
        "--out",
        output,
      ],
      {
        cwd: root,
        env: environment,
        encoding: "utf8",
        shell: false,
        timeout: 30_000,
        maxBuffer: 256 * 1024,
      },
    );
    assert.equal(result.status, 1);
    assert.equal(result.error, undefined);
    const receipt = JSON.parse(await readFile(output, "utf8"));
    assert.equal(receipt.version, "1.0");
    assert.equal(receipt.check, "vector-studio-vercel-provisioning-plan");
    assert.equal(receipt.mode, "plan");
    assert.equal(receipt.passed, false);
    assert.equal(receipt.readyToApply, false);
    assert.equal(receipt.diagnosticReceipt, true);
    assert.equal(receipt.plan.inspectionAvailable, false);
    assert.equal(receipt.plan.action, "inspection-unavailable");
    assert.deepEqual(receipt.credentialReadiness.missing, REQUIRED_SECRETS);
    assert.deepEqual(receipt.credentialReadiness.invalid, []);
    assert.equal(receipt.credentialReadiness.authoritySeparationPassed, true);
    assert.equal(receipt.blockers[0].code, "VERCEL_PROVISION_CREDENTIALS_INVALID");
    assert.equal(receipt.child.mode, "plan");
    assert.equal(receipt.child.canonicalReceiptProduced, false);
    assert.equal(receipt.mutationAttempted, false);
    assert.equal(receipt.mutationPerformed, false);
    assert.equal(receipt.sensitiveValuesRecorded, false);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /"diagnosticReceiptWritten": true/);
    assert.doesNotMatch(result.stderr, /authorization|bearer|secret value/i);
    return Object.freeze({
      status: result.status,
      blockerCode: receipt.blockers[0].code,
      missingCredentialCount: receipt.credentialReadiness.missing.length,
      diagnosticReceipt: true,
      mutationAttempted: false,
      mutationPerformed: false,
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

let executable = null;
try {
  executable = await executableReceiptTest();
} catch (error) {
  errors.push(
    `Executable diagnostic provisioning-plan test failed (${error instanceof Error ? error.message : String(error)}).`,
  );
}

if (errors.length > 0) {
  process.stderr.write(`${JSON.stringify({
    check: "vector-studio-vercel-provisioning-plan-receipt",
    ok: false,
    contractVersion: "1.0",
    errors,
  }, null, 2)}\n`);
  process.exit(1);
}

process.stdout.write(`${JSON.stringify({
  check: "vector-studio-vercel-provisioning-plan-receipt",
  ok: true,
  contractVersion: "1.0",
  noMutationPlan: true,
  canonicalWrapper: true,
  diagnosticReceiptOnFailure: true,
  newFileOnly: true,
  secretFree: true,
  nonZeroWhenBlocked: true,
  exactCurrentMainInputRequired: true,
  executable,
  checkedFiles: [...checkedFiles].sort(),
}, null, 2)}\n`);
