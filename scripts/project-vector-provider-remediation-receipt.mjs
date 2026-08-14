import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { link, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const CONTRACT_VERSION = "1.0";
const CHECK = "vector-studio-provider-remediation-projection";
const REPOSITORY = "EVAVO-STUDIO/evavo-vector-studio";
const CONTRACT_PATH = "ops/provider/vector-studio-provider-remediation-v1.json";
const WORKFLOW_PATH = ".github/workflows/vector-vercel-provisioning-preflight.yml";
const PACKAGE_PATH = "package.json";
const DOCUMENTATION_PATH = "docs/VERCEL-REMEDIATION-RECEIPTS.md";
const MAX_INPUT_BYTES = 256 * 1024;
const MAX_OUTPUT_BYTES = 256 * 1024;
const SHA_PATTERN = /^[a-f0-9]{40}$/;
const PROHIBITED_TOKENS = Object.freeze([
  "VERCEL_TOKEN",
  "EVAVO_CLIENT_APP_LAUNCH_SECRET",
  "EVAVO_VECTOR_PRIVATE_SIGNING_SECRET",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
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
  const result = { receipt: null, commit: null, out: null, selfTest: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--self-test") {
      result.selfTest = true;
      continue;
    }
    if (!["--receipt", "--commit", "--out"].includes(argument)) {
      fail("VECTOR_REMEDIATION_PROJECTION_ARGUMENT_INVALID", `Unknown argument: ${argument}`);
    }
    const value = argv[index + 1];
    if (!value) {
      fail("VECTOR_REMEDIATION_PROJECTION_ARGUMENT_INVALID", `${argument} requires a value.`);
    }
    index += 1;
    if (argument === "--receipt") result.receipt = value;
    if (argument === "--commit") result.commit = value;
    if (argument === "--out") result.out = value;
  }
  if (!result.selfTest) {
    if (!result.receipt) {
      fail("VECTOR_REMEDIATION_PROJECTION_RECEIPT_REQUIRED", "Pass --receipt with a bounded provisioning receipt.");
    }
    if (!result.commit || !SHA_PATTERN.test(result.commit)) {
      fail("VECTOR_REMEDIATION_PROJECTION_COMMIT_INVALID", "Pass a lowercase 40-character current main commit with --commit.");
    }
  }
  return result;
}

async function readBoundedText(target, label) {
  const absolute = path.resolve(target);
  const info = await stat(absolute);
  if (!info.isFile()) fail("VECTOR_REMEDIATION_PROJECTION_INPUT_INVALID", `${label} must be a regular file.`);
  if (info.size > MAX_INPUT_BYTES) {
    fail("VECTOR_REMEDIATION_PROJECTION_INPUT_TOO_LARGE", `${label} exceeded the bounded input limit.`, {
      maximumBytes: MAX_INPUT_BYTES,
      actualBytes: info.size,
    });
  }
  return readFile(absolute, "utf8");
}

async function readBoundedJson(target, label) {
  const source = await readBoundedText(target, label);
  try {
    return JSON.parse(source.replace(/^\uFEFF/, ""));
  } catch {
    fail("VECTOR_REMEDIATION_PROJECTION_JSON_INVALID", `${label} is not valid JSON.`);
  }
}

function requireBoolean(value, label) {
  if (typeof value !== "boolean") {
    fail("VECTOR_REMEDIATION_PROJECTION_RECEIPT_INVALID", `${label} must be boolean.`);
  }
  return value;
}

function validateContract(contract) {
  if (
    contract?.contractVersion !== CONTRACT_VERSION ||
    contract?.provider !== "vercel" ||
    contract?.project?.repository !== REPOSITORY ||
    contract?.sourcePolicy?.branch !== "main" ||
    contract?.sourcePolicy?.exactCurrentMainRequired !== true ||
    contract?.sourcePolicy?.sourceProofRequired !== true ||
    contract?.release?.clientReleaseEligible !== false ||
    contract?.release?.automaticPromotionAllowed !== false ||
    contract?.secretValuesIncluded !== false
  ) {
    fail("VECTOR_REMEDIATION_PROJECTION_CONTRACT_INVALID", "The canonical provider remediation contract drifted.");
  }
  if (!Array.isArray(contract.actions) || contract.actions.length !== 12) {
    fail("VECTOR_REMEDIATION_PROJECTION_CONTRACT_INVALID", "The canonical remediation action set must contain twelve steps.");
  }
  for (let index = 0; index < contract.actions.length; index += 1) {
    const action = contract.actions[index];
    if (
      action?.sequence !== index + 1 ||
      typeof action.code !== "string" ||
      typeof action.scope !== "string" ||
      typeof action.target !== "string" ||
      typeof action.mutationRequired !== "boolean" ||
      typeof action.authority !== "string" ||
      typeof action.completionEvidence !== "string" ||
      "observed" in action ||
      "complete" in action ||
      "performed" in action
    ) {
      fail("VECTOR_REMEDIATION_PROJECTION_CONTRACT_INVALID", `Canonical remediation action ${index + 1} drifted.`);
    }
  }
  const domainIndex = contract.actions.findIndex((action) => action.code === "ATTACH_CANONICAL_DOMAIN");
  const deploymentIndex = contract.actions.findIndex((action) => action.code === "DEPLOY_EXACT_SOURCE");
  if (domainIndex < 0 || deploymentIndex !== domainIndex + 1) {
    fail("VECTOR_REMEDIATION_PROJECTION_CONTRACT_INVALID", "Canonical domain verification must immediately precede exact deployment.");
  }
  return contract;
}

function validateReceipt(receipt, commit) {
  if (
    !receipt ||
    typeof receipt !== "object" ||
    Array.isArray(receipt) ||
    !["vector-studio-vercel-provisioning", "vector-studio-vercel-provisioning-plan"].includes(receipt.check) ||
    receipt.version !== "1.0" ||
    receipt.repository !== REPOSITORY ||
    receipt.commit !== commit ||
    receipt.mode !== "plan"
  ) {
    fail("VECTOR_REMEDIATION_PROJECTION_RECEIPT_INVALID", "The provisioning receipt identity does not match the requested source commit.");
  }
  if (receipt.deploymentPerformed !== false && receipt.deploymentPerformed !== undefined) {
    fail("VECTOR_REMEDIATION_PROJECTION_RECEIPT_INVALID", "A provisioning receipt cannot prove production deployment.");
  }
  if (receipt.mutationAttempted !== false && receipt.mutationAttempted !== undefined) {
    fail("VECTOR_REMEDIATION_PROJECTION_RECEIPT_INVALID", "A plan receipt cannot record a mutation attempt.");
  }
  if (receipt.mutationPerformed !== false) {
    fail("VECTOR_REMEDIATION_PROJECTION_RECEIPT_INVALID", "A plan receipt must record no provider mutation.");
  }
  if (receipt.sensitiveValuesRecorded !== false) {
    fail("VECTOR_REMEDIATION_PROJECTION_RECEIPT_INVALID", "A plan receipt must record no sensitive values.");
  }
  if (!receipt.plan || typeof receipt.plan !== "object" || Array.isArray(receipt.plan)) {
    fail("VECTOR_REMEDIATION_PROJECTION_RECEIPT_INVALID", "The provisioning receipt has no bounded plan projection.");
  }
  requireBoolean(receipt.plan.inspectionAvailable, "plan.inspectionAvailable");
  if (typeof receipt.completedAt !== "string" || Number.isNaN(Date.parse(receipt.completedAt))) {
    fail("VECTOR_REMEDIATION_PROJECTION_RECEIPT_INVALID", "The provisioning receipt completedAt timestamp is invalid.");
  }
  return receipt;
}

function settingObservation(inspectionAvailable, settings, field) {
  if (!inspectionAvailable || !settings || typeof settings !== "object") return "unobserved";
  return settings[field] === true ? "matched" : "mismatch-or-unset";
}

function projectReceipt(contract, receipt, commit) {
  const inspectionAvailable = receipt.plan.inspectionAvailable === true;
  const project = inspectionAvailable && receipt.plan.project && typeof receipt.plan.project === "object"
    ? receipt.plan.project
    : null;
  const settings = project?.settings && typeof project.settings === "object" ? project.settings : null;
  const applicationAuthoritiesReady =
    receipt.credentialReadiness?.applicationAuthorities?.ready === true;
  const identityReady =
    inspectionAvailable &&
    project?.exists === true &&
    project?.identity?.passed === true &&
    project?.gitLink?.acceptable === true;
  const domainReady = inspectionAvailable && receipt.plan.domain?.verified === true;

  const facts = new Map([
    ["CONFIRM_SOURCE_CONTROL_BOUNDARY", {
      complete: identityReady,
      observed: inspectionAvailable ? (project?.sourceControlMode ?? "unobserved") : "inspection-unavailable",
      evidenceSource: "provider-inspection-receipt",
    }],
    ["SET_ROOT_DIRECTORY", {
      complete: settings?.rootDirectoryMatched === true,
      observed: settingObservation(inspectionAvailable, settings, "rootDirectoryMatched"),
      evidenceSource: "provider-inspection-receipt",
    }],
    ["SET_FRAMEWORK", {
      complete: settings?.frameworkMatched === true,
      observed: settingObservation(inspectionAvailable, settings, "frameworkMatched"),
      evidenceSource: "provider-inspection-receipt",
    }],
    ["SET_NODE_VERSION", {
      complete: settings?.nodeVersionMatched === true,
      observed: settingObservation(inspectionAvailable, settings, "nodeVersionMatched"),
      evidenceSource: "provider-inspection-receipt",
    }],
    ["SET_INSTALL_COMMAND", {
      complete: settings?.installCommandMatched === true,
      observed: settingObservation(inspectionAvailable, settings, "installCommandMatched"),
      evidenceSource: "provider-inspection-receipt",
    }],
    ["SET_BUILD_COMMAND", {
      complete: settings?.buildCommandMatched === true,
      observed: settingObservation(inspectionAvailable, settings, "buildCommandMatched"),
      evidenceSource: "provider-inspection-receipt",
    }],
    ["CONFIGURE_RUNTIME_AUTHORITIES", {
      complete: applicationAuthoritiesReady,
      observed: applicationAuthoritiesReady ? "ready-and-separated" : "incomplete-or-unproven",
      evidenceSource: "credential-readiness-summary",
    }],
    ["ATTACH_CANONICAL_DOMAIN", {
      complete: domainReady,
      observed: !inspectionAvailable
        ? "unobserved"
        : domainReady
          ? "verified"
          : receipt.plan.domain?.exists === true
            ? "attached-unverified"
            : "absent",
      evidenceSource: "provider-inspection-receipt",
    }],
    ["DEPLOY_EXACT_SOURCE", {
      complete: false,
      observed: "unproven-separate-transaction",
      evidenceSource: "production-deployment-receipt-required",
    }],
    ["VERIFY_LIVE_RUNTIME", {
      complete: false,
      observed: "unproven-separate-transaction",
      evidenceSource: "bounded-live-runtime-receipt-required",
    }],
    ["RUN_SIGNED_LAUNCH_PROOFS", {
      complete: false,
      observed: "unproven-separate-transaction",
      evidenceSource: "signed-launch-receipts-required",
    }],
    ["PROMOTE_FROM_CENTRAL_HUB", {
      complete: false,
      observed: "withheld",
      evidenceSource: "reviewed-release-policy-commit-required",
    }],
  ]);

  const actions = Object.freeze(contract.actions.map((action) => {
    const fact = facts.get(action.code);
    if (!fact) {
      fail("VECTOR_REMEDIATION_PROJECTION_ACTION_UNKNOWN", `No projection rule exists for ${action.code}.`);
    }
    return Object.freeze({
      sequence: action.sequence,
      code: action.code,
      scope: action.scope,
      target: action.target,
      mutationRequired: action.mutationRequired,
      authority: action.authority,
      completionEvidence: action.completionEvidence,
      observed: fact.observed,
      complete: fact.complete,
      evidenceSource: fact.evidenceSource,
    });
  }));

  const byCode = Object.fromEntries(actions.map((action) => [action.code, action]));
  const projectSettingsReady = [
    "SET_ROOT_DIRECTORY",
    "SET_FRAMEWORK",
    "SET_NODE_VERSION",
    "SET_INSTALL_COMMAND",
    "SET_BUILD_COMMAND",
  ].every((code) => byCode[code].complete);
  const projectConfigured =
    byCode.CONFIRM_SOURCE_CONTROL_BOUNDARY.complete &&
    projectSettingsReady &&
    byCode.CONFIGURE_RUNTIME_AUTHORITIES.complete;
  let minimumObserved = "source-ready";
  if (byCode.CONFIRM_SOURCE_CONTROL_BOUNDARY.complete) minimumObserved = "project-created";
  if (projectConfigured) minimumObserved = "project-configured";
  if (projectConfigured && byCode.ATTACH_CANONICAL_DOMAIN.complete) {
    minimumObserved = "domain-verified";
  }

  const output = {
    version: CONTRACT_VERSION,
    check: CHECK,
    repository: REPOSITORY,
    commit,
    projectedAt: new Date(receipt.completedAt).toISOString(),
    source: {
      contract: CONTRACT_PATH,
      contractVersion: contract.contractVersion,
      providerReceiptCheck: receipt.check,
      providerReceiptMode: receipt.mode,
    },
    project: {
      id: contract.project.id,
      name: contract.project.name,
      teamId: contract.project.teamId,
      canonicalDomain: contract.project.canonicalDomain,
    },
    currentState: minimumObserved,
    targetState: contract.stateModel.at(-1),
    actions,
    readiness: {
      inspectionAvailable,
      projectIdentityReady: identityReady,
      sourceControlBoundaryProven: byCode.CONFIRM_SOURCE_CONTROL_BOUNDARY.complete,
      projectSettingsReady,
      runtimeAuthoritiesProven: byCode.CONFIGURE_RUNTIME_AUTHORITIES.complete,
      canonicalDomainReady: byCode.ATTACH_CANONICAL_DOMAIN.complete,
      readyForExactProductionDeployment:
        projectConfigured && byCode.ATTACH_CANONICAL_DOMAIN.complete,
      exactProductionDeploymentReady: false,
      liveRuntimeProofReady: false,
      signedLaunchProofReady: false,
      centralPromotionReady: false,
    },
    nextActionCodes: actions.filter((action) => !action.complete).map((action) => action.code),
    apply: {
      mode: "projection",
      requested: false,
      authorized: false,
      performed: false,
    },
    release: {
      productionApproval: false,
      clientReleaseEligible: false,
      automaticPromotionAllowed: false,
    },
    evidenceScope: "derived-secret-free-provider-remediation-projection",
    providerMutationPerformed: false,
    sensitiveValuesRecorded: false,
  };
  const withoutDigest = JSON.stringify(output);
  output.projectionDigest = createHash("sha256").update(withoutDigest).digest("hex");
  return Object.freeze(output);
}

function assertSecretFree(serialized) {
  for (const token of PROHIBITED_TOKENS) {
    if (serialized.includes(token)) {
      fail("VECTOR_REMEDIATION_PROJECTION_SECRET_NAME_LEAK", `The remediation projection contains prohibited authority token ${token}.`);
    }
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
      fail("VECTOR_REMEDIATION_PROJECTION_OUTPUT_EXISTS", `The remediation projection already exists: ${absolute}`);
    }
    throw error;
  } finally {
    await rm(temporary, { force: true });
  }
  return absolute;
}

async function writeProjection(options, projection) {
  const serialized = `${JSON.stringify(projection, null, 2)}\n`;
  if (Buffer.byteLength(serialized, "utf8") > MAX_OUTPUT_BYTES) {
    fail("VECTOR_REMEDIATION_PROJECTION_OUTPUT_TOO_LARGE", "The remediation projection exceeded its bounded output limit.");
  }
  assertSecretFree(serialized);
  const target =
    options.out ??
    path.join("artifacts", "vercel-provisioning", `${options.commit}.remediation.json`);
  return atomicNewFile(target, serialized);
}

function canonicalReceipt(commit, overrides = {}) {
  const settings = {
    rootDirectoryMatched: false,
    frameworkMatched: false,
    nodeVersionMatched: false,
    installCommandMatched: false,
    buildCommandMatched: false,
    ...(overrides.settings ?? {}),
  };
  return {
    version: "1.0",
    check: "vector-studio-vercel-provisioning",
    repository: REPOSITORY,
    commit,
    mode: "plan",
    completedAt: "2026-08-15T00:00:00.000Z",
    credentialReadiness: {
      providerAccess: { passed: true },
      applicationAuthorities: { ready: overrides.authoritiesReady === true },
    },
    plan: {
      inspectionAvailable: true,
      project: {
        exists: true,
        identity: { passed: true },
        sourceControlMode: "api-managed",
        gitLink: { acceptable: true },
        settings,
      },
      domain: {
        exists: overrides.domainExists === true,
        verified: overrides.domainVerified === true,
      },
    },
    blockers: [],
    deploymentPerformed: false,
    mutationPerformed: false,
    sensitiveValuesRecorded: false,
  };
}

async function validateIntegration() {
  const packageSource = await readBoundedText(PACKAGE_PATH, "Root package manifest");
  const packageJson = JSON.parse(packageSource);
  const expectedCommand =
    "node scripts/project-vector-provider-remediation-receipt.mjs --self-test";
  if (packageJson?.scripts?.["vercel-remediation-projection:check"] !== expectedCommand) {
    fail(
      "VECTOR_REMEDIATION_PROJECTION_INTEGRATION_INVALID",
      "The root package manifest does not expose the projection self-test.",
    );
  }
  if (
    !String(packageJson?.scripts?.["vercel-provision-plan:check"] ?? "").includes(
      "pnpm vercel-remediation-projection:check",
    ) ||
    !String(packageJson?.scripts?.check ?? "").includes("pnpm vercel-provision-plan:check")
  ) {
    fail(
      "VECTOR_REMEDIATION_PROJECTION_INTEGRATION_INVALID",
      "The provisioning-plan and full repository checks do not retain the projection self-test.",
    );
  }

  const workflowSource = await readBoundedText(WORKFLOW_PATH, "Provider preflight workflow");
  for (const token of [
    "node scripts/project-vector-provider-remediation-receipt.mjs --self-test",
    "Project canonical remediation state",
    "--receipt .ci/vector-vercel-provisioning-preflight.json",
    "--out .ci/vector-provider-remediation-projection.json",
    ".ci/vector-provider-remediation-projection.json",
    "PROJECTION_OUTCOME",
    "steps.projection.outcome",
  ]) {
    if (!workflowSource.includes(token)) {
      fail(
        "VECTOR_REMEDIATION_PROJECTION_INTEGRATION_INVALID",
        `Provider preflight workflow is missing ${JSON.stringify(token)}.`,
      );
    }
  }
  for (const token of [
    "contents: write",
    "actions: write",
    "git push",
    "vercel deploy",
    "vercel --prod",
  ]) {
    if (workflowSource.includes(token)) {
      fail(
        "VECTOR_REMEDIATION_PROJECTION_INTEGRATION_INVALID",
        `Provider preflight workflow contains prohibited authority ${JSON.stringify(token)}.`,
      );
    }
  }

  const documentationSource = await readBoundedText(
    DOCUMENTATION_PATH,
    "Provider remediation receipt documentation",
  );
  for (const token of [
    "# Vector Studio provider remediation receipts",
    "derived secret-free projection",
    "source-ready",
    "project-created",
    "project-configured",
    "domain-verified",
    "production deployment remains a separate transaction",
    "client release remains withheld",
  ]) {
    if (!documentationSource.includes(token)) {
      fail(
        "VECTOR_REMEDIATION_PROJECTION_INTEGRATION_INVALID",
        `Provider remediation receipt documentation is missing ${JSON.stringify(token)}.`,
      );
    }
  }
  for (const token of PROHIBITED_TOKENS) {
    if (documentationSource.includes(token)) {
      fail(
        "VECTOR_REMEDIATION_PROJECTION_SECRET_NAME_LEAK",
        `Provider remediation receipt documentation contains prohibited authority token ${token}.`,
      );
    }
  }

  const ownSource = await readBoundedText(
    "scripts/project-vector-provider-remediation-receipt.mjs",
    "Provider remediation projection source",
  );
  const prohibitedSourceTokens = [
    "fe" + "tch(",
    'method: "' + "POST" + '"',
    'method: "' + "PATCH" + '"',
    'method: "' + "DELETE" + '"',
  ];
  for (const token of prohibitedSourceTokens) {
    if (ownSource.includes(token)) {
      fail(
        "VECTOR_REMEDIATION_PROJECTION_INTEGRATION_INVALID",
        `Projection source contains prohibited network or mutation token ${JSON.stringify(token)}.`,
      );
    }
  }
}

async function runSelfTest() {
  await validateIntegration();
  const contract = validateContract(
    await readBoundedJson(CONTRACT_PATH, "Canonical remediation contract"),
  );
  const commit = "a".repeat(40);

  const created = projectReceipt(contract, validateReceipt(canonicalReceipt(commit), commit), commit);
  assert.equal(created.currentState, "project-created");
  assert.equal(created.actions[0].complete, true);
  assert.equal(created.actions.slice(1).every((action) => action.complete === false), true);
  assert.equal(created.readiness.readyForExactProductionDeployment, false);
  assert.equal(created.release.clientReleaseEligible, false);

  const ready = projectReceipt(
    contract,
    validateReceipt(
      canonicalReceipt(commit, {
        settings: {
          rootDirectoryMatched: true,
          frameworkMatched: true,
          nodeVersionMatched: true,
          installCommandMatched: true,
          buildCommandMatched: true,
        },
        authoritiesReady: true,
        domainExists: true,
        domainVerified: true,
      }),
      commit,
    ),
    commit,
  );
  assert.equal(ready.currentState, "domain-verified");
  assert.equal(ready.actions.slice(0, 8).every((action) => action.complete === true), true);
  assert.equal(ready.actions.slice(8).every((action) => action.complete === false), true);
  assert.equal(ready.readiness.readyForExactProductionDeployment, true);
  assert.equal(ready.readiness.exactProductionDeploymentReady, false);

  const diagnosticReceipt = {
    version: "1.0",
    check: "vector-studio-vercel-provisioning-plan",
    repository: REPOSITORY,
    commit,
    mode: "plan",
    completedAt: "2026-08-15T00:00:00.000Z",
    credentialReadiness: {
      providerAccess: { passed: false },
      applicationAuthorities: { ready: false },
    },
    plan: {
      inspectionAvailable: false,
      action: "inspection-unavailable",
      project: null,
      environment: null,
      domain: null,
    },
    blockers: [],
    diagnosticReceipt: true,
    mutationAttempted: false,
    mutationPerformed: false,
    sensitiveValuesRecorded: false,
  };
  const unavailable = projectReceipt(contract, validateReceipt(diagnosticReceipt, commit), commit);
  assert.equal(unavailable.currentState, "source-ready");
  assert.equal(unavailable.actions.every((action) => action.complete === false), true);
  assert.equal(unavailable.readiness.inspectionAvailable, false);

  assert.throws(
    () => validateReceipt({ ...canonicalReceipt(commit), deploymentPerformed: true }, commit),
    /cannot prove production deployment/,
  );
  assert.throws(
    () => validateReceipt({ ...canonicalReceipt(commit), mutationPerformed: true }, commit),
    /no provider mutation/,
  );
  assert.throws(
    () => validateReceipt(canonicalReceipt("b".repeat(40)), commit),
    /does not match the requested source commit/,
  );
  assertSecretFree(JSON.stringify(ready));

  const directory = await mkdtemp(path.join(os.tmpdir(), "vector-remediation-projection-"));
  try {
    const output = path.join(directory, "projection.json");
    await writeProjection({ commit, out: output }, ready);
    const written = JSON.parse(await readFile(output, "utf8"));
    assert.equal(written.projectionDigest, ready.projectionDigest);
    assert.equal(written.currentState, "domain-verified");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }

  process.stdout.write(`${JSON.stringify({
    ok: true,
    check: `${CHECK}-self-test`,
    contractVersion: CONTRACT_VERSION,
    actionCount: contract.actions.length,
    projectedStates: [created.currentState, ready.currentState, unavailable.currentState],
    domainBeforeDeployment: contract.actions[7].code === "ATTACH_CANONICAL_DOMAIN" && contract.actions[8].code === "DEPLOY_EXACT_SOURCE",
    laterReleaseProofsRemainSeparate: ready.actions.slice(8).every((action) => action.complete === false),
    providerMutationPerformed: false,
    integrationChecked: true,
    sensitiveValuesRecorded: false,
  }, null, 2)}\n`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.selfTest) {
    await runSelfTest();
    return;
  }
  const contract = validateContract(
    await readBoundedJson(CONTRACT_PATH, "Canonical remediation contract"),
  );
  const receipt = validateReceipt(
    await readBoundedJson(options.receipt, "Provisioning receipt"),
    options.commit,
  );
  const projection = projectReceipt(contract, receipt, options.commit);
  const output = await writeProjection(options, projection);
  process.stdout.write(`${JSON.stringify({
    ok: true,
    check: CHECK,
    output,
    commit: projection.commit,
    currentState: projection.currentState,
    completedActionCount: projection.actions.filter((action) => action.complete).length,
    nextActionCodes: projection.nextActionCodes,
    readyForExactProductionDeployment: projection.readiness.readyForExactProductionDeployment,
    exactProductionDeploymentReady: projection.readiness.exactProductionDeploymentReady,
    clientReleaseEligible: projection.release.clientReleaseEligible,
    automaticPromotionAllowed: projection.release.automaticPromotionAllowed,
    providerMutationPerformed: false,
    sensitiveValuesRecorded: false,
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    error:
      error instanceof Error && "code" in error && typeof error.code === "string"
        ? error.code
        : "VECTOR_REMEDIATION_PROJECTION_FAILED",
    message: error instanceof Error ? error.message : String(error),
    details: error instanceof Error && "details" in error ? error.details : undefined,
    providerMutationPerformed: false,
    sensitiveValuesRecorded: false,
  }, null, 2)}\n`);
  process.exit(1);
});
