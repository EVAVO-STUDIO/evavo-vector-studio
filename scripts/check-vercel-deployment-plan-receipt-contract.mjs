import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const errors = [];
const checkedFiles = new Set();

async function read(relativePath) {
  checkedFiles.add(relativePath);
  try {
    return (await readFile(path.join(root, relativePath), "utf8")).replace(/^\uFEFF/, "");
  } catch (error) {
    errors.push(`Missing or unreadable diagnostic-plan file: ${relativePath} (${error instanceof Error ? error.message : String(error)})`);
    return "";
  }
}

function requireTokens(relativePath, source, tokens) {
  for (const token of tokens) {
    if (!source.includes(token)) {
      errors.push(`${relativePath} is missing diagnostic-plan token: ${token}`);
    }
  }
}

function forbidTokens(relativePath, source, tokens) {
  for (const token of tokens) {
    if (source.includes(token)) {
      errors.push(`${relativePath} contains prohibited diagnostic-plan material: ${token}`);
    }
  }
}

const files = {
  package: "package.json",
  deployer: "scripts/deploy-vector-studio-vercel.mjs",
  workflow: ".github/workflows/vector-vercel-production-deployment.yml",
  deploymentWorkflow: ".github/workflows/vercel-deployment-contract.yml",
  docs: "docs/VERCEL-DEPLOYMENT-PLAN-RECEIPTS.md",
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
  packageJson?.scripts?.["vercel-plan:check"] !==
  "node scripts/check-vercel-deployment-plan-receipt-contract.mjs"
) {
  errors.push("package.json must expose vercel-plan:check.");
}
if (!String(packageJson?.scripts?.check ?? "").includes("pnpm vercel-plan:check")) {
  errors.push("package.json check must include vercel-plan:check before dependency-backed gates.");
}

requireTokens(files.deployer, sources.deployer, [
  "const MAX_FAILURE_DETAILS_BYTES = 8 * 1024",
  "let activeOptions = null",
  "let activeStartedAtMs = null",
  "let activePlan = null",
  "let activeMutationAttempted = false",
  "let activeMutationPerformed = false",
  "function serialisableDetails(value)",
  "function safeFailure(error)",
  "function unavailablePlan()",
  "inspectionAvailable: false",
  'action: "inspection-unavailable"',
  "inspectionAvailable: true",
  "function deploymentBoundaryBlockers(plan)",
  'code: "VERCEL_DEPLOY_PROJECT_MISSING"',
  'code: "VERCEL_DEPLOY_PROJECT_NOT_READY"',
  'code: "VERCEL_DEPLOY_DOMAIN_NOT_VERIFIED"',
  "async function writeFailureReceipt(options, error)",
  'mode: options.mode',
  'options.mode === "apply"',
  "blockers: Object.freeze(blockers)",
  "diagnosticReceipt: true",
  "mutationAttempted: activeMutationAttempted",
  "mutationPerformed: activeMutationPerformed",
  'diagnosticPlanReceipts: true',
  'diagnosticApplyReceipts: true',
  'quotaFailuresClassified: true',
  'deploymentRootDirectoryExplicit: true',
  '"VERCEL_DEPLOY_API_QUOTA_EXHAUSTED"',
  'resource !== "api-deployments-free-per-day"',
  'resetAt: reset === null ? null : new Date(reset).toISOString()',
  "activeMutationAttempted = true",
  "activeMutationPerformed = true",
  "readyToApply: true",
  "blockers: Object.freeze([])",
  'activeOptions && !activeOptions.selfTest',
  "diagnosticReceiptWritten: Boolean(diagnosticOutput)",
  "diagnosticOutput",
  "diagnosticReceiptError",
  'writeFile(temporary, source, { encoding: "utf8", flag: "wx" })',
  'serialized.includes(token)',
]);
forbidTokens(files.deployer, sources.deployer, [
  'mutationPerformed: options.mode === "apply"',
  'mutationAttempted: options.mode === "apply"',
  "writeFile(absolute, source, { encoding: \"utf8\" })",
  "appendFile(",
  "console.log(process.env",
  "JSON.stringify(process.env",
]);

const mutationAttemptIndex = sources.deployer.indexOf("activeMutationAttempted = true");
const createDeploymentIndex = sources.deployer.indexOf(
  "deployment = await createDeployment",
  mutationAttemptIndex,
);
const mutationPerformedIndex = sources.deployer.indexOf(
  "activeMutationPerformed = true",
  createDeploymentIndex,
);
if (
  mutationAttemptIndex < 0 ||
  createDeploymentIndex <= mutationAttemptIndex ||
  mutationPerformedIndex <= createDeploymentIndex
) {
  errors.push(
    "scripts/deploy-vector-studio-vercel.mjs must record mutation attempted before the production POST and mutation performed only after a valid deployment response.",
  );
}

requireTokens(files.workflow, sources.workflow, [
  "Create bounded no-mutation deployment plan",
  "continue-on-error: true",
  "Preserve bounded deployment plan",
  "if: always()",
  "if-no-files-found: error",
  "Publish deployment plan status",
  'DEPLOYMENT_OUTCOME: ${{ steps.deployment.outcome }}',
  'context: "deploy/vector-studio-production-plan"',
  "Enforce deployment plan result",
  'run: test "$DEPLOYMENT_OUTCOME" = "success"',
]);
forbidTokens(files.workflow, sources.workflow, [
  "contents: write",
  "vercel deploy",
  "vercel --prod",
  "git push",
]);

requireTokens(files.deploymentWorkflow, sources.deploymentWorkflow, [
  '"scripts/check-vercel-deployment-plan-receipt-contract.mjs"',
  '"docs/VERCEL-DEPLOYMENT-PLAN-RECEIPTS.md"',
  "Verify diagnostic deployment-plan receipt contract",
  "node scripts/check-vercel-deployment-plan-receipt-contract.mjs",
]);

requireTokens(files.docs, sources.docs, [
  "Diagnostic plan receipts",
  "new-file-only",
  "readyToApply",
  "blockerCodes",
  "inspection-unavailable",
  "mutationAttempted",
  "mutationPerformed",
  "exits non-zero",
  "receipt is still uploaded",
  "pnpm vercel-plan:check",
]);

async function executablePlanReceiptTest() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "vector-deploy-plan-contract-"));
  const output = path.join(directory, "plan.json");
  const environment = { ...process.env };
  delete environment.VERCEL_TOKEN;
  delete environment.VECTOR_VERCEL_DEPLOY_CONFIRM;
  try {
    const result = spawnSync(
      process.execPath,
      [
        "scripts/deploy-vector-studio-vercel.mjs",
        "--mode",
        "plan",
        "--commit",
        "a".repeat(40),
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
    assert.equal(receipt.check, "vector-studio-vercel-deployment");
    assert.equal(receipt.mode, "plan");
    assert.equal(receipt.passed, false);
    assert.equal(receipt.readyToApply, false);
    assert.equal(receipt.diagnosticReceipt, true);
    assert.equal(receipt.plan.inspectionAvailable, false);
    assert.equal(receipt.plan.action, "inspection-unavailable");
    assert.equal(receipt.blockers[0].code, "VERCEL_DEPLOY_CREDENTIALS_INVALID");
    assert.deepEqual(receipt.blockers[0].details.invalid, ["VERCEL_TOKEN:missing"]);
    assert.equal(receipt.mutationAttempted, false);
    assert.equal(receipt.mutationPerformed, false);
    assert.equal(receipt.sensitiveValuesRecorded, false);
    assert.equal(receipt.result.deploymentCreated, false);
    assert.equal(receipt.result.deployment, null);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /"diagnosticReceiptWritten": true/);
    assert.doesNotMatch(result.stderr, /authorization|bearer|secret value/i);
    return Object.freeze({
      status: result.status,
      blockerCode: receipt.blockers[0].code,
      diagnosticReceipt: true,
      mutationAttempted: false,
      mutationPerformed: false,
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function executableApplyFailureReceiptTest() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "vector-deploy-apply-contract-"));
  const output = path.join(directory, "apply.json");
  const environment = { ...process.env };
  delete environment.VERCEL_TOKEN;
  delete environment.VECTOR_VERCEL_DEPLOY_CONFIRM;
  try {
    const result = spawnSync(
      process.execPath,
      [
        "scripts/deploy-vector-studio-vercel.mjs",
        "--mode",
        "apply",
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
    assert.equal(receipt.mode, "apply");
    assert.equal(receipt.passed, false);
    assert.equal(receipt.readyToApply, false);
    assert.equal(receipt.diagnosticReceipt, true);
    assert.equal(receipt.blockers[0].code, "VERCEL_DEPLOY_CREDENTIALS_INVALID");
    assert.equal(receipt.mutationAttempted, false);
    assert.equal(receipt.mutationPerformed, false);
    assert.equal(receipt.result.deploymentCreated, false);
    assert.equal(receipt.result.deployment, null);
    assert.match(result.stderr, /"diagnosticReceiptWritten": true/);
    return Object.freeze({
      status: result.status,
      blockerCode: receipt.blockers[0].code,
      diagnosticReceipt: true,
      mode: receipt.mode,
      mutationAttempted: false,
      mutationPerformed: false,
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function executableDeployerSelfTest() {
  const result = spawnSync(
    process.execPath,
    ["scripts/deploy-vector-studio-vercel.mjs", "--self-test"],
    {
      cwd: root,
      env: { ...process.env },
      encoding: "utf8",
      shell: false,
      timeout: 30_000,
      maxBuffer: 256 * 1024,
    },
  );
  assert.equal(result.status, 0);
  assert.equal(result.error, undefined);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.ok, true);
  assert.equal(receipt.diagnosticPlanReceipts, true);
  assert.equal(receipt.diagnosticApplyReceipts, true);
  assert.equal(receipt.quotaFailuresClassified, true);
  assert.equal(receipt.deploymentRootDirectoryExplicit, true);
  assert.equal(receipt.sensitiveValuesRecorded, false);
  return Object.freeze(receipt);
}

let executable = null;
let executableApply = null;
let deployerSelfTest = null;
try {
  executable = await executablePlanReceiptTest();
} catch (error) {
  errors.push(
    `Executable diagnostic plan receipt test failed (${error instanceof Error ? error.message : String(error)}).`,
  );
}
try {
  executableApply = await executableApplyFailureReceiptTest();
} catch (error) {
  errors.push(
    `Executable diagnostic apply receipt test failed (${error instanceof Error ? error.message : String(error)}).`,
  );
}
try {
  deployerSelfTest = executableDeployerSelfTest();
} catch (error) {
  errors.push(
    `Executable deployer self-test failed (${error instanceof Error ? error.message : String(error)}).`,
  );
}

if (errors.length > 0) {
  process.stderr.write(`${JSON.stringify({
    check: "vector-studio-vercel-deployment-plan-receipt",
    ok: false,
    contractVersion: "1.0",
    errors,
  }, null, 2)}\n`);
  process.exit(1);
}

process.stdout.write(`${JSON.stringify({
  check: "vector-studio-vercel-deployment-plan-receipt",
  ok: true,
  contractVersion: "1.0",
  noMutationPlan: true,
  diagnosticReceiptOnFailure: true,
  diagnosticApplyReceiptOnFailure: true,
  quotaFailuresClassified: true,
  deploymentRootDirectoryExplicit: true,
  newFileOnly: true,
  secretFree: true,
  nonZeroWhenBlocked: true,
  mutationAttemptTruthRetained: true,
  executable,
  executableApply,
  deployerSelfTest,
  checkedFiles: [...checkedFiles].sort(),
}, null, 2)}\n`);
