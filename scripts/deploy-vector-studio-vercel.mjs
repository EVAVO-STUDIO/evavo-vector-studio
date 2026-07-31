import assert from "node:assert/strict";
import { link, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const CONTRACT_VERSION = "1.0";
const TEAM_ID = "team_ckKLAnG3MGJK0mMpIVpjbogl";
const PROJECT_NAME = "evavo-vector-studio";
const REPOSITORY = "EVAVO-STUDIO/evavo-vector-studio";
const REPOSITORY_ORG = "EVAVO-STUDIO";
const REPOSITORY_NAME = "evavo-vector-studio";
const GITHUB_REPOSITORY_VISIBILITY = "private";
const PRODUCTION_DOMAIN = "vector.evavo.com.au";
const ROOT_DIRECTORY = "apps/web";
const FRAMEWORK = "nextjs";
const INSTALL_COMMAND = "cd ../.. && pnpm install --frozen-lockfile";
const BUILD_COMMAND = "cd ../.. && pnpm exec turbo run build --filter=@evavo/vector-web";
const APPLY_CONFIRMATION = "deploy-evavo-vector-studio";
const REQUEST_TIMEOUT_MS = 30_000;
const DEPLOYMENT_TIMEOUT_MS = 20 * 60 * 1000;
const ALIAS_TIMEOUT_MS = 2 * 60 * 1000;
const POLL_INTERVAL_MS = 5_000;
const MAX_RESPONSE_BYTES = 1_000_000;
const MAX_RECEIPT_BYTES = 256 * 1024;
const MAX_FAILURE_DETAILS_BYTES = 8 * 1024;
const SHA_PATTERN = /^[a-f0-9]{40}$/;
const TERMINAL_FAILURE_STATES = new Set(["ERROR", "CANCELED", "BLOCKED"]);

let activeOptions = null;
let activeStartedAtMs = null;
let activePlan = null;
let activeMutationAttempted = false;
let activeMutationPerformed = false;

function fail(code, message, details = undefined) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  throw error;
}

function parseArgs(argv) {
  const result = {
    mode: "plan",
    commit: null,
    out: null,
    selfTest: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--self-test") {
      result.selfTest = true;
      continue;
    }
    if (["--mode", "--commit", "--out"].includes(argument)) {
      const value = argv[index + 1];
      if (!value) fail("VERCEL_DEPLOY_ARGUMENT_INVALID", `${argument} requires a value.`);
      index += 1;
      if (argument === "--mode") result.mode = value;
      if (argument === "--commit") result.commit = value;
      if (argument === "--out") result.out = value;
      continue;
    }
    fail("VERCEL_DEPLOY_ARGUMENT_INVALID", `Unknown argument: ${argument}`);
  }
  if (!["plan", "apply"].includes(result.mode)) {
    fail("VERCEL_DEPLOY_MODE_INVALID", "The deployment mode must be plan or apply.");
  }
  if (!result.selfTest && (!result.commit || !SHA_PATTERN.test(result.commit))) {
    fail("VERCEL_DEPLOY_COMMIT_INVALID", "Pass a lowercase 40-character Git commit with --commit.");
  }
  return result;
}

function credentialState(environment = process.env) {
  const token = String(environment.VERCEL_TOKEN ?? "").trim();
  const invalid = [];
  if (!token) invalid.push("VERCEL_TOKEN:missing");
  if (token && token.length < 20) invalid.push("VERCEL_TOKEN:below-minimum-length");
  if (token && /\s/.test(token)) invalid.push("VERCEL_TOKEN:contains-whitespace");
  return Object.freeze({
    token,
    invalid: Object.freeze(invalid),
    passed: invalid.length === 0,
  });
}

function serialisableDetails(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  try {
    const serialized = JSON.stringify(value);
    if (Buffer.byteLength(serialized, "utf8") > MAX_FAILURE_DETAILS_BYTES) return null;
    return Object.freeze(JSON.parse(serialized));
  } catch {
    return null;
  }
}

function safeFailure(error) {
  return Object.freeze({
    code:
      error instanceof Error && "code" in error && typeof error.code === "string"
        ? error.code.slice(0, 160)
        : "VERCEL_DEPLOY_FAILED",
    message:
      error instanceof Error
        ? error.message.slice(0, 2_000)
        : String(error).slice(0, 2_000),
    details:
      error instanceof Error && "details" in error
        ? serialisableDetails(error.details)
        : null,
  });
}

async function readBoundedText(response) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        fail(
          "VERCEL_DEPLOY_RESPONSE_TOO_LARGE",
          "A Vercel deployment API response exceeded its bounded limit.",
          { maximum: MAX_RESPONSE_BYTES },
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8");
}

function safeApiCode(value) {
  if (!value || typeof value !== "object") return null;
  const code =
    typeof value.error?.code === "string"
      ? value.error.code
      : typeof value.code === "string"
        ? value.code
        : null;
  return code ? code.slice(0, 120) : null;
}

function apiClient(token, fetchImpl = fetch) {
  async function request(pathname, options = {}) {
    const url = new URL(pathname, "https://api.vercel.com");
    if (url.origin !== "https://api.vercel.com") {
      fail("VERCEL_DEPLOY_API_URL_INVALID", "Deployment attempted to leave the Vercel API origin.");
    }
    let response;
    try {
      response = await fetchImpl(url, {
        method: options.method ?? "GET",
        headers: {
          authorization: `Bearer ${token}`,
          accept: "application/json",
          "accept-encoding": "identity",
          ...(options.body ? { "content-type": "application/json" } : {}),
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
        redirect: "error",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      fail(
        "VERCEL_DEPLOY_API_NETWORK_FAILED",
        "The Vercel deployment API request failed before a response.",
        {
          method: options.method ?? "GET",
          path: url.pathname,
          cause: error instanceof Error ? error.name : "NETWORK_FAILED",
        },
      );
    }

    const text = await readBoundedText(response);
    let value = null;
    if (text) {
      try {
        value = JSON.parse(text);
      } catch {
        fail(
          "VERCEL_DEPLOY_API_JSON_INVALID",
          "Vercel returned invalid bounded JSON.",
          { method: options.method ?? "GET", path: url.pathname, status: response.status },
        );
      }
    }

    if (response.status === 404 && options.allow404) {
      return Object.freeze({ status: response.status, value: null });
    }
    if (!response.ok) {
      fail(
        "VERCEL_DEPLOY_API_FAILED",
        "A Vercel deployment request failed.",
        {
          method: options.method ?? "GET",
          path: url.pathname,
          status: response.status,
          code: safeApiCode(value),
        },
      );
    }
    return Object.freeze({ status: response.status, value });
  }
  return Object.freeze({ request });
}

function safeProject(project) {
  if (!project || typeof project !== "object") return null;
  const link = project.link && typeof project.link === "object" ? project.link : null;
  return Object.freeze({
    id: typeof project.id === "string" ? project.id : null,
    name: typeof project.name === "string" ? project.name : null,
    framework: typeof project.framework === "string" ? project.framework : null,
    rootDirectory: typeof project.rootDirectory === "string" ? project.rootDirectory : null,
    installCommand: typeof project.installCommand === "string" ? project.installCommand : null,
    buildCommand: typeof project.buildCommand === "string" ? project.buildCommand : null,
    link: link
      ? Object.freeze({
          type: typeof link.type === "string" ? link.type : null,
          org: typeof link.org === "string" ? link.org : null,
          repo: typeof link.repo === "string" ? link.repo : null,
          repoId:
            typeof link.repoId === "number" || typeof link.repoId === "string"
              ? String(link.repoId)
              : null,
        })
      : null,
  });
}

function projectReady(project) {
  const safe = safeProject(project);
  if (!safe?.id || safe.name !== PROJECT_NAME) return false;
  if (
    safe.framework !== FRAMEWORK ||
    safe.rootDirectory !== ROOT_DIRECTORY ||
    safe.installCommand !== INSTALL_COMMAND ||
    safe.buildCommand !== BUILD_COMMAND
  ) {
    return false;
  }
  if (!safe.link || safe.link.type !== "github") return false;
  if (safe.link.org && safe.link.org.toLowerCase() !== REPOSITORY_ORG.toLowerCase()) return false;
  if (
    safe.link.repo &&
    safe.link.repo.toLowerCase() !== REPOSITORY_NAME.toLowerCase() &&
    safe.link.repo.toLowerCase() !== REPOSITORY.toLowerCase()
  ) {
    return false;
  }
  return true;
}

function deploymentList(value) {
  if (Array.isArray(value?.deployments)) return value.deployments;
  if (Array.isArray(value?.data?.deployments)) return value.data.deployments;
  if (Array.isArray(value?.data)) return value.data;
  return [];
}

function aliasNames(value) {
  const candidates = Array.isArray(value?.aliases)
    ? value.aliases
    : Array.isArray(value?.alias)
      ? value.alias
      : [];
  return [...new Set(
    candidates
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item.alias === "string") return item.alias;
        if (item && typeof item.name === "string") return item.name;
        return null;
      })
      .filter(Boolean),
  )].sort();
}

function deploymentCommit(value) {
  const candidates = [
    value?.gitSource?.sha,
    value?.gitMetadata?.commitSha,
    value?.meta?.githubCommitSha,
    value?.meta?.gitCommitSha,
  ];
  return candidates.find((candidate) => typeof candidate === "string" && SHA_PATTERN.test(candidate)) ?? null;
}

function safeDeployment(value) {
  if (!value || typeof value !== "object") return null;
  const url =
    typeof value.url === "string"
      ? value.url
      : typeof value.inspectorUrl === "string"
        ? value.inspectorUrl
        : null;
  return Object.freeze({
    id: typeof value.id === "string" ? value.id : null,
    name: typeof value.name === "string" ? value.name : null,
    url,
    readyState:
      typeof value.readyState === "string"
        ? value.readyState
        : typeof value.state === "string"
          ? value.state
          : null,
    target: typeof value.target === "string" ? value.target : null,
    createdAt: Number.isSafeInteger(value.createdAt) ? value.createdAt : null,
    commit: deploymentCommit(value),
    aliases: Object.freeze(aliasNames(value)),
  });
}

async function inspect(client, commit) {
  const projectResponse = await client.request(
    `/v9/projects/${encodeURIComponent(PROJECT_NAME)}?teamId=${encodeURIComponent(TEAM_ID)}`,
    { allow404: true },
  );
  const project = projectResponse.value;
  if (!project) {
    return Object.freeze({
      project: null,
      domain: null,
      deployments: Object.freeze([]),
    });
  }

  const projectId = safeProject(project)?.id ?? PROJECT_NAME;
  const domainResponse = await client.request(
    `/v9/projects/${encodeURIComponent(projectId)}/domains/${encodeURIComponent(PRODUCTION_DOMAIN)}?teamId=${encodeURIComponent(TEAM_ID)}`,
    { allow404: true },
  );
  const deploymentsResponse = await client.request(
    `/v7/deployments?projectId=${encodeURIComponent(projectId)}&sha=${encodeURIComponent(commit)}&target=production&limit=20&teamId=${encodeURIComponent(TEAM_ID)}`,
  );

  return Object.freeze({
    project,
    domain: domainResponse.value,
    deployments: Object.freeze(deploymentList(deploymentsResponse.value).map(safeDeployment).filter(Boolean)),
  });
}

function unavailablePlan() {
  return Object.freeze({
    inspectionAvailable: false,
    project: Object.freeze({ exists: null, id: null, ready: false }),
    domain: Object.freeze({ exists: null, verified: false }),
    exactCommitDeployment: null,
    action: "inspection-unavailable",
  });
}

function planFromInspection(inspection, commit) {
  const exactReady = inspection.deployments.find(
    (deployment) =>
      deployment.commit === commit &&
      deployment.readyState === "READY" &&
      deployment.target === "production",
  ) ?? null;
  return Object.freeze({
    inspectionAvailable: true,
    project: Object.freeze({
      exists: Boolean(inspection.project),
      id: safeProject(inspection.project)?.id ?? null,
      ready: projectReady(inspection.project),
    }),
    domain: Object.freeze({
      exists: Boolean(inspection.domain),
      verified: inspection.domain?.verified === true,
    }),
    exactCommitDeployment: exactReady,
    action: exactReady ? "reuse-ready-exact-commit" : "create-production-deployment",
  });
}

function deploymentBoundaryBlockers(plan) {
  if (!plan || plan.inspectionAvailable !== true) return Object.freeze([]);
  const blockers = [];
  if (!plan.project.exists) {
    blockers.push(Object.freeze({
      code: "VERCEL_DEPLOY_PROJECT_MISSING",
      message: "The Vector Studio Vercel project must be provisioned before deployment.",
      details: null,
    }));
  } else {
    if (!plan.project.ready) {
      blockers.push(Object.freeze({
        code: "VERCEL_DEPLOY_PROJECT_NOT_READY",
        message: "The Vercel project does not match the governed GitHub and monorepo build contract.",
        details: null,
      }));
    }
    if (!plan.domain.exists || !plan.domain.verified) {
      blockers.push(Object.freeze({
        code: "VERCEL_DEPLOY_DOMAIN_NOT_VERIFIED",
        message: "The production domain must be assigned and verified before deployment.",
        details: null,
      }));
    }
  }
  return Object.freeze(blockers);
}

function requireDeploymentBoundary(plan) {
  const blockers = deploymentBoundaryBlockers(plan);
  if (blockers.length < 1) return;
  const primary = blockers[0];
  fail(primary.code, primary.message, {
    blockerCodes: blockers.map((item) => item.code),
  });
}

async function createDeployment(client, projectId, commit) {
  const response = await client.request(
    `/v13/deployments?forceNew=1&skipAutoDetectionConfirmation=1&teamId=${encodeURIComponent(TEAM_ID)}`,
    {
      method: "POST",
      body: {
        name: PROJECT_NAME,
        project: projectId,
        target: "production",
        gitSource: {
          type: "github-limited",
          org: REPOSITORY_ORG,
          repo: REPOSITORY_NAME,
          ref: "main",
          sha: commit,
        },
        gitMetadata: {
          remoteUrl: `https://github.com/${REPOSITORY}`,
          commitMessage: "Governed Vector Studio production deployment",
          commitRef: "main",
          commitSha: commit,
          dirty: false,
          ci: true,
          ciType: "github-actions",
          ciGitRepoVisibility: GITHUB_REPOSITORY_VISIBILITY,
        },
        meta: {
          githubCommitSha: commit,
          githubCommitRef: "main",
          githubCommitRepo: REPOSITORY_NAME,
          githubCommitOrg: REPOSITORY_ORG,
          vectorDeploymentContract: CONTRACT_VERSION,
        },
        monorepoManager: "turbo",
        projectSettings: {
          framework: FRAMEWORK,
          installCommand: INSTALL_COMMAND,
          buildCommand: BUILD_COMMAND,
          nodeVersion: "22.x",
        },
      },
    },
  );
  const deployment = safeDeployment(response.value);
  if (!deployment?.id) {
    fail("VERCEL_DEPLOY_CREATE_RESPONSE_INVALID", "Vercel did not return a deployment identifier.");
  }
  return deployment;
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function getDeployment(client, deploymentId) {
  const response = await client.request(
    `/v13/deployments/${encodeURIComponent(deploymentId)}?withGitRepoInfo=true&teamId=${encodeURIComponent(TEAM_ID)}`,
  );
  const deployment = safeDeployment(response.value);
  if (!deployment?.id) {
    fail("VERCEL_DEPLOY_STATUS_RESPONSE_INVALID", "Vercel did not return deployment status evidence.");
  }
  return deployment;
}

async function waitForReady(client, initial, commit) {
  const started = Date.now();
  let deployment = initial;
  while (true) {
    if (deployment.commit && deployment.commit !== commit) {
      fail(
        "VERCEL_DEPLOY_COMMIT_MISMATCH",
        "Vercel associated the deployment with a different Git commit.",
        { expected: commit, actual: deployment.commit },
      );
    }
    if (deployment.readyState === "READY") return deployment;
    if (TERMINAL_FAILURE_STATES.has(deployment.readyState)) {
      fail(
        "VERCEL_DEPLOY_TERMINAL_FAILURE",
        "The production deployment reached a terminal failure state.",
        { deploymentId: deployment.id, readyState: deployment.readyState },
      );
    }
    if (Date.now() - started > DEPLOYMENT_TIMEOUT_MS) {
      fail(
        "VERCEL_DEPLOY_TIMEOUT",
        "The production deployment did not reach READY within the bounded wait.",
        { deploymentId: deployment.id, maximumMs: DEPLOYMENT_TIMEOUT_MS },
      );
    }
    await sleep(POLL_INTERVAL_MS);
    deployment = await getDeployment(client, deployment.id);
  }
}

async function getDeploymentAliases(client, deploymentId) {
  const response = await client.request(
    `/v2/deployments/${encodeURIComponent(deploymentId)}/aliases?teamId=${encodeURIComponent(TEAM_ID)}`,
  );
  return Object.freeze(aliasNames(response.value));
}

async function waitForProductionAlias(client, deployment) {
  const started = Date.now();
  let aliases = deployment.aliases;
  while (true) {
    if (aliases.includes(PRODUCTION_DOMAIN)) return aliases;
    if (Date.now() - started > ALIAS_TIMEOUT_MS) {
      fail(
        "VERCEL_DEPLOY_ALIAS_TIMEOUT",
        "The READY deployment did not receive the governed production domain.",
        {
          deploymentId: deployment.id,
          expectedDomain: PRODUCTION_DOMAIN,
          aliases,
        },
      );
    }
    await sleep(POLL_INTERVAL_MS);
    aliases = await getDeploymentAliases(client, deployment.id);
  }
}

async function atomicNewFile(target, source) {
  const absolute = path.resolve(target);
  await mkdir(path.dirname(absolute), { recursive: true });
  const temporary = `${absolute}.tmp-${process.pid}-${Date.now()}`;
  try {
    await writeFile(temporary, source, { encoding: "utf8", flag: "wx" });
    await link(temporary, absolute);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "EEXIST") {
      fail("VERCEL_DEPLOY_OUTPUT_EXISTS", `The deployment receipt already exists: ${absolute}`);
    }
    throw error;
  } finally {
    await rm(temporary, { force: true });
  }
  return absolute;
}

async function writeReceipt(options, receipt) {
  const serialized = `${JSON.stringify(receipt, null, 2)}\n`;
  if (Buffer.byteLength(serialized, "utf8") > MAX_RECEIPT_BYTES) {
    fail("VERCEL_DEPLOY_RECEIPT_TOO_LARGE", "The bounded deployment receipt exceeded its limit.");
  }
  const token = String(process.env.VERCEL_TOKEN ?? "").trim();
  if (token && serialized.includes(token)) {
    fail("VERCEL_DEPLOY_SECRET_LEAK", "VERCEL_TOKEN entered the deployment receipt.");
  }
  const target =
    options.out ??
    path.join("artifacts", "vercel-deployment", `${options.commit}.${options.mode}.json`);
  return atomicNewFile(target, serialized);
}

async function writePlanFailureReceipt(options, error) {
  const failure = safeFailure(error);
  const boundary = deploymentBoundaryBlockers(activePlan);
  const blockers = [
    failure,
    ...boundary.filter((item) => item.code !== failure.code),
  ];
  const completedAtMs = Date.now();
  const receipt = Object.freeze({
    version: CONTRACT_VERSION,
    check: "vector-studio-vercel-deployment",
    repository: REPOSITORY,
    commit: options.commit,
    mode: "plan",
    projectId: activePlan?.project?.id ?? null,
    productionDomain: PRODUCTION_DOMAIN,
    startedAt: new Date(activeStartedAtMs ?? completedAtMs).toISOString(),
    completedAt: new Date(completedAtMs).toISOString(),
    durationMs: Math.max(0, completedAtMs - (activeStartedAtMs ?? completedAtMs)),
    passed: false,
    readyToApply: false,
    plan: activePlan ?? unavailablePlan(),
    blockers: Object.freeze(blockers),
    result: Object.freeze({
      deploymentCreated: false,
      deployment: null,
      aliases: Object.freeze([]),
      exactCommitProven: false,
      productionAliasProven: false,
    }),
    diagnosticReceipt: true,
    mutationAttempted: false,
    mutationPerformed: false,
    sensitiveValuesRecorded: false,
  });
  return writeReceipt(options, receipt);
}

async function runSelfTest() {
  assert.equal(credentialState({ VERCEL_TOKEN: "v".repeat(40) }).passed, true);
  assert.equal(credentialState({ VERCEL_TOKEN: "short" }).passed, false);
  assert.equal(GITHUB_REPOSITORY_VISIBILITY, "private");
  const deployment = safeDeployment({
    id: "dpl_test",
    url: "example.vercel.app",
    readyState: "READY",
    target: "production",
    gitSource: { sha: "a".repeat(40) },
    alias: [PRODUCTION_DOMAIN],
  });
  assert.equal(deployment.commit, "a".repeat(40));
  assert.equal(deployment.aliases.includes(PRODUCTION_DOMAIN), true);
  const list = deploymentList({ deployments: [{ id: "dpl_test" }] });
  assert.equal(list.length, 1);
  const plan = planFromInspection(
    {
      project: {
        id: "prj_test",
        name: PROJECT_NAME,
        framework: FRAMEWORK,
        rootDirectory: ROOT_DIRECTORY,
        installCommand: INSTALL_COMMAND,
        buildCommand: BUILD_COMMAND,
        link: { type: "github", org: REPOSITORY_ORG, repo: REPOSITORY_NAME },
      },
      domain: { verified: true },
      deployments: [deployment],
    },
    "a".repeat(40),
  );
  assert.equal(plan.action, "reuse-ready-exact-commit");
  assert.equal(deploymentBoundaryBlockers(plan).length, 0);

  const missingProject = planFromInspection(
    { project: null, domain: null, deployments: [] },
    "b".repeat(40),
  );
  const missingBlockers = deploymentBoundaryBlockers(missingProject);
  assert.equal(missingBlockers.length, 1);
  assert.equal(missingBlockers[0].code, "VERCEL_DEPLOY_PROJECT_MISSING");
  assert.equal(unavailablePlan().inspectionAvailable, false);

  process.stdout.write(`${JSON.stringify({
    ok: true,
    check: "vector-studio-vercel-deployer-self-test",
    contractVersion: CONTRACT_VERSION,
    githubRepositoryVisibility: GITHUB_REPOSITORY_VISIBILITY,
    diagnosticPlanReceipts: true,
    mutationAttempted: false,
    mutationPerformed: false,
    sensitiveValuesRecorded: false,
  }, null, 2)}\n`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  activeOptions = options;
  activeStartedAtMs = Date.now();
  activePlan = unavailablePlan();
  activeMutationAttempted = false;
  activeMutationPerformed = false;

  if (options.selfTest) {
    await runSelfTest();
    return;
  }

  const credentials = credentialState();
  if (!credentials.passed) {
    fail(
      "VERCEL_DEPLOY_CREDENTIALS_INVALID",
      "VERCEL_TOKEN is missing or malformed.",
      { invalid: credentials.invalid },
    );
  }
  if (
    options.mode === "apply" &&
    String(process.env.VECTOR_VERCEL_DEPLOY_CONFIRM ?? "").trim() !== APPLY_CONFIRMATION
  ) {
    fail(
      "VERCEL_DEPLOY_CONFIRMATION_REQUIRED",
      `Apply mode requires VECTOR_VERCEL_DEPLOY_CONFIRM=${APPLY_CONFIRMATION}.`,
    );
  }

  const client = apiClient(credentials.token);
  const inspection = await inspect(client, options.commit);
  const plan = planFromInspection(inspection, options.commit);
  activePlan = plan;
  requireDeploymentBoundary(plan);

  let created = false;
  let deployment = plan.exactCommitDeployment;
  let aliases = deployment?.aliases ?? Object.freeze([]);

  if (options.mode === "apply") {
    if (!deployment) {
      activeMutationAttempted = true;
      deployment = await createDeployment(client, plan.project.id, options.commit);
      activeMutationPerformed = true;
      created = true;
    }
    deployment = await waitForReady(client, deployment, options.commit);
    if (!deployment.commit) {
      const refreshed = await getDeployment(client, deployment.id);
      deployment = refreshed;
    }
    if (deployment.commit !== options.commit) {
      fail(
        "VERCEL_DEPLOY_COMMIT_UNPROVEN",
        "The READY deployment did not expose the exact requested Git commit.",
        { deploymentId: deployment.id, expected: options.commit, actual: deployment.commit },
      );
    }
    aliases = await waitForProductionAlias(client, deployment);
  }

  const completedAtMs = Date.now();
  const passed =
    options.mode === "plan"
      ? true
      : Boolean(
          deployment &&
          deployment.readyState === "READY" &&
          deployment.commit === options.commit &&
          aliases.includes(PRODUCTION_DOMAIN),
        );

  const receipt = Object.freeze({
    version: CONTRACT_VERSION,
    check: "vector-studio-vercel-deployment",
    repository: REPOSITORY,
    commit: options.commit,
    mode: options.mode,
    projectId: plan.project.id,
    productionDomain: PRODUCTION_DOMAIN,
    startedAt: new Date(activeStartedAtMs).toISOString(),
    completedAt: new Date(completedAtMs).toISOString(),
    durationMs: completedAtMs - activeStartedAtMs,
    passed,
    readyToApply: true,
    plan,
    blockers: Object.freeze([]),
    result: Object.freeze({
      deploymentCreated: created,
      deployment,
      aliases,
      exactCommitProven: deployment?.commit === options.commit,
      productionAliasProven: aliases.includes(PRODUCTION_DOMAIN),
    }),
    diagnosticReceipt: false,
    mutationAttempted: activeMutationAttempted,
    mutationPerformed: activeMutationPerformed,
    sensitiveValuesRecorded: false,
  });
  const output = await writeReceipt(options, receipt);
  process.stdout.write(`${JSON.stringify({
    ok: passed,
    mode: options.mode,
    output,
    readyToApply: true,
    blockerCodes: [],
    deploymentCreated: created,
    deploymentId: deployment?.id ?? null,
    readyState: deployment?.readyState ?? null,
    exactCommitProven: deployment?.commit === options.commit,
    productionAliasProven: aliases.includes(PRODUCTION_DOMAIN),
    diagnosticReceipt: false,
    mutationAttempted: activeMutationAttempted,
    mutationPerformed: activeMutationPerformed,
    sensitiveValuesRecorded: false,
  }, null, 2)}\n`);
  if (!passed) process.exit(1);
}

main().catch(async (error) => {
  const failure = safeFailure(error);
  let diagnosticOutput = null;
  let diagnosticReceiptError = null;
  if (activeOptions?.mode === "plan" && !activeOptions.selfTest) {
    try {
      diagnosticOutput = await writePlanFailureReceipt(activeOptions, error);
    } catch (receiptError) {
      diagnosticReceiptError = safeFailure(receiptError);
    }
  }
  process.stderr.write(`${JSON.stringify({
    ok: false,
    error: failure.code,
    message: failure.message,
    details: failure.details,
    blockerCodes: [
      failure.code,
      ...deploymentBoundaryBlockers(activePlan)
        .map((item) => item.code)
        .filter((code) => code !== failure.code),
    ],
    diagnosticReceiptWritten: Boolean(diagnosticOutput),
    diagnosticOutput,
    diagnosticReceiptError,
    mutationAttempted: activeMutationAttempted,
    mutationPerformed: activeMutationPerformed,
    sensitiveValuesRecorded: false,
  }, null, 2)}\n`);
  process.exit(1);
});
