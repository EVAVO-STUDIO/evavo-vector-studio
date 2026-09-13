import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

const CONTRACT_VERSION = "1.0";
const RECEIPT_CHECK = "vector-studio-vercel-provisioning";
const ENFORCER_CHECK = "vector-studio-vercel-provider-inspection-receipt";
const REPOSITORY = "EVAVO-STUDIO/evavo-vector-studio";
const PROJECT_ID = "prj_Nb5IcrF5Fd0xhwDoUfZPJYmwSo6L";
const PROJECT_NAME = "evavo-vector-studio";
const PRODUCTION_DOMAIN = "vector.evavo.com.au";
const MAX_RECEIPT_BYTES = 256 * 1024;
const SHA_PATTERN = /^[a-f0-9]{40}$/;

function fail(code, message, details = undefined) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  throw error;
}

function parseArgs(argv) {
  const result = { receipt: null, commit: null, selfTest: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--self-test") {
      result.selfTest = true;
      continue;
    }
    if (!["--receipt", "--commit"].includes(argument)) {
      fail("VERCEL_PROVIDER_RECEIPT_ARGUMENT_INVALID", `Unknown argument: ${argument}`);
    }
    const value = argv[index + 1];
    if (!value) fail("VERCEL_PROVIDER_RECEIPT_ARGUMENT_INVALID", `${argument} requires a value.`);
    index += 1;
    if (argument === "--receipt") result.receipt = value;
    if (argument === "--commit") result.commit = value;
  }
  if (!result.selfTest) {
    if (!result.receipt) {
      fail("VERCEL_PROVIDER_RECEIPT_PATH_REQUIRED", "Pass the bounded plan receipt with --receipt.");
    }
    if (!result.commit || !SHA_PATTERN.test(result.commit)) {
      fail(
        "VERCEL_PROVIDER_RECEIPT_COMMIT_INVALID",
        "Pass the exact lowercase 40-character current main commit with --commit.",
      );
    }
  }
  return result;
}

function exactStringArray(value, expected) {
  return (
    Array.isArray(value) &&
    value.length === expected.length &&
    value.every((item, index) => item === expected[index])
  );
}

function requireBoolean(value, label) {
  if (typeof value !== "boolean") {
    fail("VERCEL_PROVIDER_RECEIPT_SHAPE_INVALID", `${label} must be a boolean.`);
  }
  return value;
}

function validateReceipt(receipt, expectedCommit) {
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) {
    fail("VERCEL_PROVIDER_RECEIPT_SHAPE_INVALID", "The provider receipt must be a JSON object.");
  }
  const exact = [
    ["version", receipt.version, CONTRACT_VERSION],
    ["check", receipt.check, RECEIPT_CHECK],
    ["repository", receipt.repository, REPOSITORY],
    ["commit", receipt.commit, expectedCommit],
    ["mode", receipt.mode, "plan"],
    ["expectedProjectId", receipt.expectedProjectId, PROJECT_ID],
    ["expectedProject", receipt.expectedProject, PROJECT_NAME],
    ["expectedDomain", receipt.expectedDomain, PRODUCTION_DOMAIN],
  ];
  for (const [label, actual, expected] of exact) {
    if (actual !== expected) {
      fail(
        "VERCEL_PROVIDER_RECEIPT_IDENTITY_MISMATCH",
        `${label} must equal ${JSON.stringify(expected)}.`,
      );
    }
  }

  if (receipt.passed !== true) {
    fail("VERCEL_PROVIDER_RECEIPT_PLAN_FAILED", "The canonical provider plan did not pass.");
  }
  const providerAccess = receipt.credentialReadiness?.providerAccess;
  if (!providerAccess || providerAccess.passed !== true) {
    fail("VERCEL_PROVIDER_RECEIPT_ACCESS_UNPROVEN", "Vercel provider access was not proven.");
  }
  if (!exactStringArray(providerAccess.requiredKeys, ["VERCEL_TOKEN"])) {
    fail(
      "VERCEL_PROVIDER_RECEIPT_ACCESS_SHAPE_INVALID",
      "The provider access boundary must require only VERCEL_TOKEN.",
    );
  }
  if (!exactStringArray(providerAccess.missing, []) || !exactStringArray(providerAccess.invalid, [])) {
    fail(
      "VERCEL_PROVIDER_RECEIPT_ACCESS_INVALID",
      "The provider access receipt contains missing or invalid provider credentials.",
    );
  }

  const applicationAuthorities = receipt.credentialReadiness?.applicationAuthorities;
  if (!applicationAuthorities || typeof applicationAuthorities !== "object") {
    fail(
      "VERCEL_PROVIDER_RECEIPT_APPLICATION_AUTHORITY_SHAPE_INVALID",
      "The receipt must retain bounded application-authority readiness.",
    );
  }
  const applicationAuthoritiesReady = requireBoolean(
    applicationAuthorities.ready,
    "credentialReadiness.applicationAuthorities.ready",
  );
  requireBoolean(
    applicationAuthorities.authoritySeparationPassed,
    "credentialReadiness.applicationAuthorities.authoritySeparationPassed",
  );
  if (!Array.isArray(applicationAuthorities.missing) || !Array.isArray(applicationAuthorities.invalid)) {
    fail(
      "VERCEL_PROVIDER_RECEIPT_APPLICATION_AUTHORITY_SHAPE_INVALID",
      "Application-authority gaps must be bounded arrays.",
    );
  }

  const plan = receipt.plan;
  if (!plan || plan.inspectionAvailable !== true || plan.action !== "inspection-complete") {
    fail(
      "VERCEL_PROVIDER_RECEIPT_INSPECTION_UNAVAILABLE",
      "The canonical plan must contain a completed read-only provider inspection.",
    );
  }
  const project = plan.project;
  if (
    !project ||
    project.exists !== true ||
    project.id !== PROJECT_ID ||
    project.expectedId !== PROJECT_ID ||
    project.identity?.passed !== true
  ) {
    fail(
      "VERCEL_PROVIDER_RECEIPT_PROJECT_IDENTITY_UNPROVEN",
      "The exact pinned Vector Studio Vercel project identity was not proven.",
    );
  }
  if (project.gitLink?.acceptable !== true) {
    fail(
      "VERCEL_PROVIDER_RECEIPT_SOURCE_CONTROL_CONFLICT",
      "The provider inspection found a conflicting source-control boundary.",
    );
  }
  if (!["api-managed", "git-linked"].includes(project.sourceControlMode)) {
    fail(
      "VERCEL_PROVIDER_RECEIPT_SOURCE_CONTROL_MODE_INVALID",
      "The provider inspection reported an unsupported source-control mode.",
    );
  }
  const settings = project.settings;
  if (!settings || typeof settings !== "object") {
    fail(
      "VERCEL_PROVIDER_RECEIPT_SETTINGS_SHAPE_INVALID",
      "The provider inspection must retain project-settings evidence.",
    );
  }
  const settingsValues = [
    settings.frameworkMatched,
    settings.nodeVersionMatched,
    settings.rootDirectoryMatched,
    settings.installCommandMatched,
    settings.buildCommandMatched,
  ];
  if (!settingsValues.every((value) => typeof value === "boolean")) {
    fail(
      "VERCEL_PROVIDER_RECEIPT_SETTINGS_SHAPE_INVALID",
      "Every project-settings evidence field must be a boolean.",
    );
  }
  const projectSettingsMatched = settingsValues.every(Boolean);
  const domainVerified = requireBoolean(plan.domain?.verified, "plan.domain.verified");
  const readyToApply = requireBoolean(receipt.readyToApply, "readyToApply");
  if (plan.readyToApply !== readyToApply) {
    fail(
      "VERCEL_PROVIDER_RECEIPT_READINESS_CONTRADICTION",
      "Top-level and plan apply readiness must agree.",
    );
  }
  if (applicationAuthoritiesReady !== (plan.environment?.applicationAuthoritiesReady === true)) {
    fail(
      "VERCEL_PROVIDER_RECEIPT_READINESS_CONTRADICTION",
      "Application-authority readiness must agree with the environment plan.",
    );
  }
  if (!Array.isArray(receipt.blockers) || !Array.isArray(plan.blockers)) {
    fail("VERCEL_PROVIDER_RECEIPT_BLOCKERS_INVALID", "Plan blockers must be bounded arrays.");
  }
  if (JSON.stringify(receipt.blockers) !== JSON.stringify(plan.blockers)) {
    fail(
      "VERCEL_PROVIDER_RECEIPT_BLOCKERS_CONTRADICTORY",
      "Top-level and plan blockers must agree.",
    );
  }
  if (!applicationAuthoritiesReady && !receipt.blockers.some((item) =>
    item?.code === "VERCEL_PROVISION_APPLICATION_AUTHORITIES_INCOMPLETE"
  )) {
    fail(
      "VERCEL_PROVIDER_RECEIPT_APPLICATION_BLOCKER_MISSING",
      "Incomplete application authorities must retain an explicit blocker.",
    );
  }
  if (readyToApply && (!applicationAuthoritiesReady || receipt.blockers.length !== 0)) {
    fail(
      "VERCEL_PROVIDER_RECEIPT_READINESS_CONTRADICTION",
      "Apply readiness cannot coexist with application-authority gaps or blockers.",
    );
  }

  if (receipt.deploymentPerformed !== false) {
    fail("VERCEL_PROVIDER_RECEIPT_DEPLOYMENT_PROHIBITED", "Provider inspection must not deploy.");
  }
  if (receipt.mutationPerformed !== false) {
    fail("VERCEL_PROVIDER_RECEIPT_MUTATION_PROHIBITED", "Provider inspection must not mutate Vercel.");
  }
  if (receipt.sensitiveValuesRecorded !== false) {
    fail(
      "VERCEL_PROVIDER_RECEIPT_SENSITIVE_VALUES_PROHIBITED",
      "Provider inspection must not record sensitive values.",
    );
  }
  if (plan.deployment?.action !== "not-performed-by-provisioner") {
    fail(
      "VERCEL_PROVIDER_RECEIPT_DEPLOYMENT_BOUNDARY_INVALID",
      "The provider plan must retain the separate deployment boundary.",
    );
  }

  return Object.freeze({
    commit: expectedCommit,
    inspectionAvailable: true,
    projectIdentityPassed: true,
    projectSettingsMatched,
    sourceControlMode: project.sourceControlMode,
    domainVerified,
    applicationAuthoritiesReady,
    readyToApply,
    blockerCodes: Object.freeze(receipt.blockers.map((item) => item?.code).filter(Boolean)),
    mutationPerformed: false,
    sensitiveValuesRecorded: false,
  });
}

async function loadReceipt(relativePath) {
  const absolute = path.resolve(relativePath);
  const relative = path.relative(process.cwd(), absolute);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    fail(
      "VERCEL_PROVIDER_RECEIPT_PATH_OUTSIDE_REPOSITORY",
      "The provider receipt must be inside the current repository.",
    );
  }
  const details = await stat(absolute);
  if (!details.isFile() || details.size <= 0 || details.size > MAX_RECEIPT_BYTES) {
    fail(
      "VERCEL_PROVIDER_RECEIPT_FILE_INVALID",
      "The provider receipt must be a non-empty bounded regular file.",
      { bytes: details.size, maximum: MAX_RECEIPT_BYTES },
    );
  }
  const source = await readFile(absolute, "utf8");
  try {
    return JSON.parse(source);
  } catch {
    fail("VERCEL_PROVIDER_RECEIPT_JSON_INVALID", "The provider receipt is not valid JSON.");
  }
}

function sampleReceipt() {
  const commit = "a".repeat(40);
  const applicationRequired = [
    "EVAVO_CLIENT_APP_LAUNCH_SECRET",
    "EVAVO_VECTOR_PRIVATE_SIGNING_SECRET",
    "UPSTASH_REDIS_REST_URL",
    "UPSTASH_REDIS_REST_TOKEN",
    "VECTOR_API_TOKEN",
    "VECTOR_WORKER_API_TOKEN",
  ];
  const blocker = {
    code: "VERCEL_PROVISION_APPLICATION_AUTHORITIES_INCOMPLETE",
    message: "Application runtime authorities are missing, malformed or not separated.",
  };
  return {
    commit,
    receipt: {
      version: CONTRACT_VERSION,
      check: RECEIPT_CHECK,
      repository: REPOSITORY,
      commit,
      mode: "plan",
      expectedProjectId: PROJECT_ID,
      expectedProject: PROJECT_NAME,
      expectedDomain: PRODUCTION_DOMAIN,
      passed: true,
      readyToApply: false,
      credentialReadiness: {
        providerAccess: {
          requiredKeys: ["VERCEL_TOKEN"],
          missing: [],
          invalid: [],
          passed: true,
        },
        applicationAuthorities: {
          requiredKeys: applicationRequired,
          missing: applicationRequired,
          invalid: [],
          authoritySeparationPassed: true,
          ready: false,
        },
      },
      plan: {
        inspectionAvailable: true,
        action: "inspection-complete",
        project: {
          exists: true,
          id: PROJECT_ID,
          expectedId: PROJECT_ID,
          identity: { idMatched: true, nameMatched: true, passed: true },
          action: "reconcile-settings",
          settings: {
            frameworkMatched: false,
            nodeVersionMatched: false,
            rootDirectoryMatched: false,
            installCommandMatched: false,
            buildCommandMatched: false,
          },
          sourceControlMode: "api-managed",
          gitLink: { present: false, matched: false, acceptable: true, mode: "api-managed" },
        },
        environment: {
          action: "blocked-incomplete-authorities",
          keys: [],
          applicationAuthoritiesReady: false,
        },
        domain: { exists: false, verified: false, action: "add" },
        deployment: { action: "not-performed-by-provisioner" },
        blockers: [blocker],
        readyToApply: false,
      },
      blockers: [blocker],
      deploymentPerformed: false,
      mutationPerformed: false,
      sensitiveValuesRecorded: false,
    },
  };
}

async function runSelfTest() {
  const { receipt, commit } = sampleReceipt();
  const result = validateReceipt(receipt, commit);
  assert.equal(result.inspectionAvailable, true);
  assert.equal(result.projectIdentityPassed, true);
  assert.equal(result.projectSettingsMatched, false);
  assert.equal(result.applicationAuthoritiesReady, false);
  assert.equal(result.readyToApply, false);
  assert.deepEqual(result.blockerCodes, [
    "VERCEL_PROVISION_APPLICATION_AUTHORITIES_INCOMPLETE",
  ]);
  assert.throws(
    () => validateReceipt({ ...receipt, mutationPerformed: true }, commit),
    /must not mutate Vercel/,
  );
  assert.throws(
    () => validateReceipt({ ...receipt, commit: "b".repeat(40) }, commit),
    /commit must equal/,
  );
  process.stdout.write(`${JSON.stringify({
    ok: true,
    check: `${ENFORCER_CHECK}-self-test`,
    contractVersion: CONTRACT_VERSION,
    providerOnlyCanonicalReceiptAccepted: true,
    applicationAuthorityGapsRetained: true,
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
  const receipt = await loadReceipt(options.receipt);
  const result = validateReceipt(receipt, options.commit);
  process.stdout.write(`${JSON.stringify({
    ok: true,
    check: ENFORCER_CHECK,
    contractVersion: CONTRACT_VERSION,
    ...result,
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    check: ENFORCER_CHECK,
    error:
      error instanceof Error && "code" in error && typeof error.code === "string"
        ? error.code
        : "VERCEL_PROVIDER_RECEIPT_FAILED",
    message: error instanceof Error ? error.message : String(error),
    details: error instanceof Error && "details" in error ? error.details : undefined,
    mutationPerformed: false,
    sensitiveValuesRecorded: false,
  }, null, 2)}\n`);
  process.exit(1);
});
