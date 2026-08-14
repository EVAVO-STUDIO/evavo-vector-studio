import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const errors = [];
const checkedFiles = new Set();
const COMMIT = "a".repeat(40);
const PROJECT_ID = "prj_Nb5IcrF5Fd0xhwDoUfZPJYmwSo6L";
const PROVIDER_ACCESS_KEYS = Object.freeze(["VERCEL_TOKEN"]);
const APPLICATION_ENVIRONMENT_KEYS = Object.freeze([
  "EVAVO_CLIENT_APP_LAUNCH_SECRET",
  "EVAVO_VECTOR_PRIVATE_SIGNING_SECRET",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "VECTOR_API_TOKEN",
  "VECTOR_WORKER_API_TOKEN",
]);
const ALL_SECRET_KEYS = Object.freeze([
  ...PROVIDER_ACCESS_KEYS,
  ...APPLICATION_ENVIRONMENT_KEYS,
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
      errors.push(`${relativePath} contains prohibited provisioning-plan token: ${token}`);
    }
  }
}

const files = Object.freeze({
  wrapper: "scripts/plan-vector-studio-vercel-provisioning.mjs",
  provisioner: "scripts/provision-vector-studio-vercel.mjs",
  enforcer: "scripts/enforce-vercel-provider-inspection-receipt.mjs",
  projector: "scripts/project-vector-provider-remediation-receipt.mjs",
  checker: "scripts/check-vercel-provisioning-plan-receipt-contract.mjs",
  workflow: ".github/workflows/vector-vercel-provisioning-preflight.yml",
  docs: "docs/VERCEL-PROVISIONING-PLAN-RECEIPTS.md",
});
const sources = Object.fromEntries(
  await Promise.all(Object.entries(files).map(async ([key, relativePath]) => [key, await read(relativePath)])),
);

requireTokens(files.wrapper, sources.wrapper, [
  'const PROVIDER_ACCESS_KEYS = Object.freeze([',
  'const APPLICATION_ENVIRONMENT_KEYS = Object.freeze([',
  'const ALL_SECRET_KEYS = Object.freeze([',
  "function credentialReadiness(environment = process.env)",
  "providerAccess:",
  "applicationAuthorities:",
  "providerOnlyInspectionSupported: true",
  "diagnosticReceiptOnProviderFailure: true",
  'code: "VERCEL_PROVISION_PROVIDER_ACCESS_INVALID"',
  "inspectionAvailable: false",
  'action: "inspection-unavailable"',
  "spawnSync(",
  '"--mode"',
  '"plan"',
  "canonicalReceiptProduced: true",
  "mutationAttempted: false",
  "mutationPerformed: false",
  "sensitiveValuesRecorded: false",
]);
forbidTokens(files.wrapper, sources.wrapper, [
  "VECTOR_VERCEL_APPLY_CONFIRM",
  'method: "POST"',
  'method: "PATCH"',
  "fetch(",
  "mutationAttempted: true",
  "mutationPerformed: true",
]);

requireTokens(files.provisioner, sources.provisioner, [
  'const PROVIDER_ACCESS_KEYS = Object.freeze([',
  'const APPLICATION_ENVIRONMENT_KEYS = Object.freeze([',
  '"VERCEL_PROVISION_PROVIDER_ACCESS_INVALID"',
  '"VERCEL_PROVISION_APPLICATION_AUTHORITIES_INCOMPLETE"',
  "planFromInspection(inspection, credentials)",
  "inspectionAvailable: true",
  'action: "inspection-complete"',
  "readyToApply: blockers.length === 0",
  'options.mode === "apply" && !credentials.applicationAuthorities.ready',
  'options.mode === "plan"',
]);
requireTokens(files.enforcer, sources.enforcer, [
  'const ENFORCER_CHECK = "vector-studio-vercel-provider-inspection-receipt"',
  '"--receipt"',
  '"--commit"',
  "plan.inspectionAvailable !== true",
  "project.identity?.passed !== true",
  "project.gitLink?.acceptable !== true",
  "receipt.mutationPerformed !== false",
  "receipt.sensitiveValuesRecorded !== false",
  "providerOnlyCanonicalReceiptAccepted: true",
]);
forbidTokens(files.enforcer, sources.enforcer, [
  "fetch(",
  'method: "POST"',
  'method: "PATCH"',
  'method: "DELETE"',
  "process.env.VERCEL_TOKEN",
]);
requireTokens(files.workflow, sources.workflow, [
  "Create bounded no-mutation provider plan",
  "node scripts/plan-vector-studio-vercel-provisioning.mjs",
  "Enforce bounded provider inspection receipt",
  "node scripts/enforce-vercel-provider-inspection-receipt.mjs",
  'context: "deploy/vector-studio-vercel-preflight"',
  "read-only Vector provider inspection passed",
]);
requireTokens(files.docs, sources.docs, [
  "Provider access",
  "Application authorities",
  "VERCEL_TOKEN",
  "inspectionAvailable: true",
  "readyToApply: false",
  "VERCEL_PROVISION_APPLICATION_AUTHORITIES_INCOMPLETE",
  "canonical provider inspection receipt",
  "does not mutate Vercel",
]);

async function createMockFetchModule(directory) {
  const target = path.join(directory, "mock-vercel-fetch.mjs");
  const source = `
const projectId = ${JSON.stringify(PROJECT_ID)};
const project = {
  id: projectId,
  name: "evavo-vector-studio",
  framework: null,
  nodeVersion: "24.x",
  rootDirectory: null,
  installCommand: null,
  buildCommand: null,
};
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(String(input));
  if ((init.method ?? "GET") !== "GET") {
    return new Response(JSON.stringify({ error: { code: "MUTATION_PROHIBITED" } }), {
      status: 405,
      headers: { "content-type": "application/json" },
    });
  }
  if (url.pathname === "/v9/projects/" + encodeURIComponent(projectId)) {
    return new Response(JSON.stringify(project), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  if (url.pathname === "/v9/projects/" + encodeURIComponent(projectId) + "/domains/vector.evavo.com.au") {
    return new Response("", { status: 404 });
  }
  return new Response(JSON.stringify({ error: { code: "NOT_FOUND" } }), {
    status: 404,
    headers: { "content-type": "application/json" },
  });
};
`;
  await writeFile(target, source, "utf8");
  return target;
}

function sanitizedEnvironment(extra = {}) {
  const environment = { ...process.env };
  for (const key of ALL_SECRET_KEYS) delete environment[key];
  return { ...environment, ...extra };
}

async function executableDiagnosticTest() {
  await mkdir(path.join(root, ".ci"), { recursive: true });
  const directory = await mkdtemp(path.join(root, ".ci", "provider-plan-diagnostic-"));
  try {
    const output = path.join(directory, "receipt.json");
    const result = spawnSync(
      process.execPath,
      [
        files.wrapper,
        "--commit",
        COMMIT,
        "--out",
        output,
      ],
      {
        cwd: root,
        env: sanitizedEnvironment(),
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
    assert.deepEqual(receipt.credentialReadiness.providerAccess.missing, ["VERCEL_TOKEN"]);
    assert.deepEqual(receipt.credentialReadiness.providerAccess.invalid, []);
    assert.equal(receipt.credentialReadiness.providerAccess.passed, false);
    assert.deepEqual(
      receipt.credentialReadiness.applicationAuthorities.missing,
      APPLICATION_ENVIRONMENT_KEYS,
    );
    assert.equal(receipt.blockers[0].code, "VERCEL_PROVISION_PROVIDER_ACCESS_INVALID");
    assert.equal(receipt.child.canonicalReceiptProduced, false);
    assert.equal(receipt.mutationAttempted, false);
    assert.equal(receipt.mutationPerformed, false);
    assert.equal(receipt.sensitiveValuesRecorded, false);
    assert.match(result.stderr, /"diagnosticReceiptWritten": true/);
    return Object.freeze({
      status: result.status,
      blockerCode: receipt.blockers[0].code,
      inspectionAvailable: false,
      mutationPerformed: false,
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function executableProjectionTest() {
  const result = spawnSync(
    process.execPath,
    [files.projector, "--self-test"],
    {
      cwd: root,
      env: sanitizedEnvironment(),
      encoding: "utf8",
      shell: false,
      timeout: 30_000,
      maxBuffer: 256 * 1024,
    },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.error, undefined);
  const summary = JSON.parse(result.stdout);
  assert.equal(
    summary.check,
    "vector-studio-provider-remediation-projection-self-test",
  );
  assert.equal(summary.actionCount, 12);
  assert.equal(summary.domainBeforeDeployment, true);
  assert.equal(summary.laterReleaseProofsRemainSeparate, true);
  assert.equal(summary.providerMutationPerformed, false);
  assert.equal(summary.sensitiveValuesRecorded, false);
  return Object.freeze({
    status: result.status,
    actionCount: summary.actionCount,
    domainBeforeDeployment: summary.domainBeforeDeployment,
    laterReleaseProofsRemainSeparate:
      summary.laterReleaseProofsRemainSeparate,
    mutationPerformed: false,
  });
}

async function executableProviderOnlyTest() {
  await mkdir(path.join(root, ".ci"), { recursive: true });
  const directory = await mkdtemp(path.join(root, ".ci", "provider-plan-canonical-"));
  try {
    const output = path.join(directory, "receipt.json");
    const mockModule = await createMockFetchModule(directory);
    const environment = sanitizedEnvironment({
      VERCEL_TOKEN: "v".repeat(40),
      NODE_OPTIONS: `--import=${pathToFileURL(mockModule).href}`,
    });
    const result = spawnSync(
      process.execPath,
      [
        files.wrapper,
        "--commit",
        COMMIT,
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
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.error, undefined);
    const receipt = JSON.parse(await readFile(output, "utf8"));
    assert.equal(receipt.check, "vector-studio-vercel-provisioning");
    assert.equal(receipt.passed, true);
    assert.equal(receipt.plan.inspectionAvailable, true);
    assert.equal(receipt.plan.action, "inspection-complete");
    assert.equal(receipt.plan.project.id, PROJECT_ID);
    assert.equal(receipt.plan.project.identity.passed, true);
    assert.equal(receipt.plan.project.gitLink.acceptable, true);
    assert.equal(receipt.plan.project.settings.nodeVersionMatched, false);
    assert.equal(receipt.plan.domain.verified, false);
    assert.equal(receipt.credentialReadiness.providerAccess.passed, true);
    assert.deepEqual(receipt.credentialReadiness.providerAccess.missing, []);
    assert.equal(receipt.credentialReadiness.applicationAuthorities.ready, false);
    assert.deepEqual(
      receipt.credentialReadiness.applicationAuthorities.missing,
      APPLICATION_ENVIRONMENT_KEYS,
    );
    assert.equal(receipt.readyToApply, false);
    assert.equal(
      receipt.blockers[0].code,
      "VERCEL_PROVISION_APPLICATION_AUTHORITIES_INCOMPLETE",
    );
    assert.equal(receipt.deploymentPerformed, false);
    assert.equal(receipt.mutationPerformed, false);
    assert.equal(receipt.sensitiveValuesRecorded, false);

    const enforcement = spawnSync(
      process.execPath,
      [
        files.enforcer,
        "--receipt",
        output,
        "--commit",
        COMMIT,
      ],
      {
        cwd: root,
        env: sanitizedEnvironment(),
        encoding: "utf8",
        shell: false,
        timeout: 30_000,
        maxBuffer: 256 * 1024,
      },
    );
    assert.equal(enforcement.status, 0, enforcement.stderr);
    const summary = JSON.parse(enforcement.stdout);
    assert.equal(summary.inspectionAvailable, true);
    assert.equal(summary.projectIdentityPassed, true);
    assert.equal(summary.projectSettingsMatched, false);
    assert.equal(summary.domainVerified, false);
    assert.equal(summary.applicationAuthoritiesReady, false);
    assert.equal(summary.readyToApply, false);
    assert.deepEqual(summary.blockerCodes, [
      "VERCEL_PROVISION_APPLICATION_AUTHORITIES_INCOMPLETE",
    ]);
    return Object.freeze({
      status: result.status,
      inspectionAvailable: true,
      projectIdentityPassed: true,
      applicationAuthoritiesReady: false,
      readyToApply: false,
      enforcementPassed: true,
      mutationPerformed: false,
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

let diagnostic = null;
let providerOnly = null;
let projection = null;
try {
  diagnostic = await executableDiagnosticTest();
} catch (error) {
  errors.push(
    `Executable diagnostic provisioning-plan test failed (${error instanceof Error ? error.message : String(error)}).`,
  );
}
try {
  providerOnly = await executableProviderOnlyTest();
} catch (error) {
  errors.push(
    `Executable provider-only provisioning-plan test failed (${error instanceof Error ? error.message : String(error)}).`,
  );
}
try {
  projection = await executableProjectionTest();
} catch (error) {
  errors.push(
    `Executable remediation-projection test failed (${error instanceof Error ? error.message : String(error)}).`,
  );
}

if (errors.length > 0) {
  process.stderr.write(`${JSON.stringify({
    check: "vector-studio-vercel-provisioning-plan-receipt",
    ok: false,
    contractVersion: "1.1",
    errors,
  }, null, 2)}\n`);
  process.exit(1);
}

process.stdout.write(`${JSON.stringify({
  check: "vector-studio-vercel-provisioning-plan-receipt",
  ok: true,
  contractVersion: "1.1",
  providerOnlyInspectionSupported: true,
  applicationAuthoritiesSeparatedFromProviderAccess: true,
  canonicalProviderReceiptEnforced: true,
  diagnosticReceiptOnProviderFailure: true,
  newFileOnly: true,
  secretFree: true,
  exactCurrentMainInputRequired: true,
  executable: { diagnostic, providerOnly, projection },
  checkedFiles: [...checkedFiles].sort(),
}, null, 2)}\n`);
