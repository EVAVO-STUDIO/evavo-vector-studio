import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { link, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const CONTRACT_VERSION = "1.0";
const TEAM_ID = "team_ckKLAnG3MGJK0mMpIVpjbogl";
const TEAM_SLUG = "evavos-projects";
const PROJECT_NAME = "evavo-vector-studio";
const REPOSITORY = "EVAVO-STUDIO/evavo-vector-studio";
const REPOSITORY_ORG = "EVAVO-STUDIO";
const REPOSITORY_NAME = "evavo-vector-studio";
const ROOT_DIRECTORY = "apps/web";
const FRAMEWORK = "nextjs";
const INSTALL_COMMAND = "cd ../.. && pnpm install --frozen-lockfile";
const BUILD_COMMAND = "cd ../.. && pnpm exec turbo run build --filter=@evavo/vector-web";
const PRODUCTION_ORIGIN = "https://vector.evavo.com.au";
const PRODUCTION_DOMAIN = "vector.evavo.com.au";
const APPLY_CONFIRMATION = "provision-evavo-vector-studio";
const MAX_RESPONSE_BYTES = 1_000_000;
const MAX_RECEIPT_BYTES = 256 * 1024;
const REQUEST_TIMEOUT_MS = 30_000;
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

const ENVIRONMENT_SPECS = Object.freeze([
  Object.freeze({
    key: "VECTOR_PUBLIC_ORIGIN",
    valueFrom: "constant",
    value: PRODUCTION_ORIGIN,
    type: "plain",
    comment: "Canonical private Vector Studio production origin.",
  }),
  Object.freeze({
    key: "VECTOR_HUB_REPLAY_MODE",
    valueFrom: "constant",
    value: "upstash",
    type: "plain",
    comment: "Require durable atomic signed-launch replay protection.",
  }),
  Object.freeze({
    key: "EVAVO_CLIENT_APP_LAUNCH_SECRET",
    valueFrom: "environment",
    type: "encrypted",
    comment: "Dedicated EVAVO hub-to-Vector Studio handoff authority.",
  }),
  Object.freeze({
    key: "EVAVO_VECTOR_PRIVATE_SIGNING_SECRET",
    valueFrom: "environment",
    type: "encrypted",
    comment: "Dedicated Vector Studio private workspace-session authority.",
  }),
  Object.freeze({
    key: "UPSTASH_REDIS_REST_URL",
    valueFrom: "environment",
    type: "encrypted",
    comment: "Durable replay-store HTTPS endpoint.",
  }),
  Object.freeze({
    key: "UPSTASH_REDIS_REST_TOKEN",
    valueFrom: "environment",
    type: "encrypted",
    comment: "Server-only durable replay-store token.",
  }),
  Object.freeze({
    key: "VECTOR_API_TOKEN",
    valueFrom: "environment",
    type: "encrypted",
    comment: "Server-only machine API authority.",
  }),
  Object.freeze({
    key: "VECTOR_WORKER_API_TOKEN",
    valueFrom: "environment",
    type: "encrypted",
    comment: "Separate server-only worker-control authority.",
  }),
]);

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
      if (!value) fail("VERCEL_PROVISION_ARGUMENT_INVALID", `${argument} requires a value.`);
      index += 1;
      if (argument === "--mode") result.mode = value;
      if (argument === "--commit") result.commit = value;
      if (argument === "--out") result.out = value;
      continue;
    }
    fail("VERCEL_PROVISION_ARGUMENT_INVALID", `Unknown argument: ${argument}`);
  }
  if (!["plan", "apply"].includes(result.mode)) {
    fail("VERCEL_PROVISION_MODE_INVALID", "The provisioning mode must be plan or apply.");
  }
  if (!result.selfTest && (!result.commit || !SHA_PATTERN.test(result.commit))) {
    fail("VERCEL_PROVISION_COMMIT_INVALID", "Pass a lowercase 40-character Git commit with --commit.");
  }
  return result;
}

function credentialState(environment = process.env) {
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

  const seen = new Map();
  for (const key of AUTHORITY_KEYS) {
    const value = values[key];
    if (!value) continue;
    const digest = createHash("sha256").update(value).digest("hex");
    const existing = seen.get(digest);
    if (existing) invalid.push(`${key}:duplicates-${existing}`);
    else seen.set(digest, key);
  }

  return Object.freeze({
    missing: Object.freeze(missing),
    invalid: Object.freeze(invalid),
    values: Object.freeze(values),
    passed: missing.length === 0 && invalid.length === 0,
    authoritySeparationPassed: !invalid.some((item) => item.includes(":duplicates-")),
  });
}

function safeProject(project) {
  if (!project || typeof project !== "object") return null;
  return Object.freeze({
    id: typeof project.id === "string" ? project.id : null,
    name: typeof project.name === "string" ? project.name : null,
    framework: typeof project.framework === "string" ? project.framework : null,
    rootDirectory: typeof project.rootDirectory === "string" ? project.rootDirectory : null,
    installCommand: typeof project.installCommand === "string" ? project.installCommand : null,
    buildCommand: typeof project.buildCommand === "string" ? project.buildCommand : null,
    link: project.link && typeof project.link === "object"
      ? Object.freeze({
          type: typeof project.link.type === "string" ? project.link.type : null,
          org: typeof project.link.org === "string" ? project.link.org : null,
          repo: typeof project.link.repo === "string" ? project.link.repo : null,
        })
      : null,
  });
}

function projectSettings(project) {
  const safe = safeProject(project);
  return Object.freeze({
    frameworkMatched: safe?.framework === FRAMEWORK,
    rootDirectoryMatched: safe?.rootDirectory === ROOT_DIRECTORY,
    installCommandMatched: safe?.installCommand === INSTALL_COMMAND,
    buildCommandMatched: safe?.buildCommand === BUILD_COMMAND,
  });
}

function gitLinkState(project) {
  const link = safeProject(project)?.link;
  if (!link) return Object.freeze({ present: false, matched: false });
  const typeMatched = link.type === "github";
  const orgMatched = !link.org || link.org.toLowerCase() === REPOSITORY_ORG.toLowerCase();
  const repoMatched =
    !link.repo ||
    link.repo.toLowerCase() === REPOSITORY_NAME.toLowerCase() ||
    link.repo.toLowerCase() === REPOSITORY.toLowerCase();
  return Object.freeze({
    present: true,
    matched: typeMatched && orgMatched && repoMatched,
  });
}

function buildEnvironmentPayload(values) {
  return ENVIRONMENT_SPECS.map((spec) => Object.freeze({
    key: spec.key,
    value: spec.valueFrom === "constant" ? spec.value : values[spec.key],
    type: spec.type,
    target: Object.freeze(["production"]),
    comment: spec.comment,
  }));
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
          "VERCEL_PROVISION_RESPONSE_TOO_LARGE",
          "A Vercel API response exceeded the bounded provisioning limit.",
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

function safeApiError(value) {
  if (!value || typeof value !== "object") return null;
  const code =
    typeof value.error?.code === "string"
      ? value.error.code.slice(0, 120)
      : typeof value.code === "string"
        ? value.code.slice(0, 120)
        : null;
  return code;
}

function apiClient(token, fetchImpl = fetch) {
  async function request(pathname, options = {}) {
    const url = new URL(pathname, "https://api.vercel.com");
    if (url.origin !== "https://api.vercel.com") {
      fail("VERCEL_PROVISION_API_URL_INVALID", "Provisioning attempted to leave the Vercel API origin.");
    }
    const response = await fetchImpl(url, {
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
    const text = await readBoundedText(response);
    let value = null;
    if (text) {
      try {
        value = JSON.parse(text);
      } catch {
        fail(
          "VERCEL_PROVISION_API_JSON_INVALID",
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
        "VERCEL_PROVISION_API_FAILED",
        "A Vercel provisioning request failed.",
        {
          method: options.method ?? "GET",
          path: url.pathname,
          status: response.status,
          code: options.sensitiveResponse ? null : safeApiError(value),
        },
      );
    }
    return Object.freeze({ status: response.status, value });
  }
  return Object.freeze({ request });
}

async function inspectProject(client) {
  const projectResponse = await client.request(
    `/v9/projects/${encodeURIComponent(PROJECT_NAME)}?teamId=${encodeURIComponent(TEAM_ID)}`,
    { allow404: true },
  );
  const project = projectResponse.value;
  if (!project) {
    return Object.freeze({
      project: null,
      domain: null,
    });
  }
  const projectId = typeof project.id === "string" ? project.id : PROJECT_NAME;
  const domainResponse = await client.request(
    `/v9/projects/${encodeURIComponent(projectId)}/domains/${encodeURIComponent(PRODUCTION_DOMAIN)}?teamId=${encodeURIComponent(TEAM_ID)}`,
    { allow404: true },
  );
  return Object.freeze({
    project,
    domain: domainResponse.value,
  });
}

function planFromInspection(inspection) {
  const exists = Boolean(inspection.project);
  const settings = projectSettings(inspection.project);
  const gitLink = gitLinkState(inspection.project);
  const domainVerified = inspection.domain?.verified === true;
  return Object.freeze({
    project: Object.freeze({
      exists,
      id: safeProject(inspection.project)?.id ?? null,
      action: exists ? "reconcile-settings" : "create",
      settings,
      gitLink,
    }),
    environment: Object.freeze({
      action: "upsert-production",
      keys: Object.freeze(ENVIRONMENT_SPECS.map((spec) => spec.key)),
    }),
    domain: Object.freeze({
      exists: Boolean(inspection.domain),
      verified: domainVerified,
      action: inspection.domain ? (domainVerified ? "reuse-verified" : "await-verification") : "add",
    }),
    deployment: Object.freeze({
      action: "not-performed-by-provisioner",
      reason: "Exact deployment and live proof remain a separate governed transaction.",
    }),
  });
}

async function createProject(client) {
  const response = await client.request(
    `/v10/projects?teamId=${encodeURIComponent(TEAM_ID)}`,
    {
      method: "POST",
      body: {
        name: PROJECT_NAME,
        framework: FRAMEWORK,
        rootDirectory: ROOT_DIRECTORY,
        installCommand: INSTALL_COMMAND,
        buildCommand: BUILD_COMMAND,
        gitRepository: {
          type: "github",
          repo: REPOSITORY,
        },
        previewDeploymentsDisabled: true,
        enablePreviewFeedback: false,
        enableProductionFeedback: false,
      },
    },
  );
  if (!response.value || typeof response.value.id !== "string") {
    fail("VERCEL_PROVISION_PROJECT_RESPONSE_INVALID", "Vercel did not return a project identifier.");
  }
  return response.value;
}

async function reconcileProject(client, project) {
  const link = gitLinkState(project);
  if (!link.present || !link.matched) {
    fail(
      "VERCEL_PROVISION_PROJECT_GIT_CONFLICT",
      "An existing project with the expected name is not linked to the governed GitHub repository.",
    );
  }
  const settings = projectSettings(project);
  if (Object.values(settings).every(Boolean)) return project;
  const projectId = safeProject(project)?.id;
  if (!projectId) fail("VERCEL_PROVISION_PROJECT_ID_MISSING", "The existing Vercel project has no identifier.");
  const response = await client.request(
    `/v9/projects/${encodeURIComponent(projectId)}?teamId=${encodeURIComponent(TEAM_ID)}`,
    {
      method: "PATCH",
      body: {
        framework: FRAMEWORK,
        rootDirectory: ROOT_DIRECTORY,
        installCommand: INSTALL_COMMAND,
        buildCommand: BUILD_COMMAND,
        previewDeploymentsDisabled: true,
        enablePreviewFeedback: false,
        enableProductionFeedback: false,
      },
    },
  );
  return response.value ?? project;
}

async function upsertEnvironment(client, projectId, values) {
  const payload = buildEnvironmentPayload(values);
  const response = await client.request(
    `/v10/projects/${encodeURIComponent(projectId)}/env?upsert=true&teamId=${encodeURIComponent(TEAM_ID)}`,
    {
      method: "POST",
      body: payload,
      sensitiveResponse: true,
    },
  );
  const failed = Array.isArray(response.value?.failed) ? response.value.failed : [];
  if (failed.length > 0) {
    fail(
      "VERCEL_PROVISION_ENVIRONMENT_FAILED",
      "One or more production environment variables were rejected.",
      {
        failedCount: failed.length,
        codes: failed
          .map((item) => safeApiError(item))
          .filter(Boolean)
          .slice(0, 20),
      },
    );
  }
  return Object.freeze({
    upsertedKeys: Object.freeze(ENVIRONMENT_SPECS.map((spec) => spec.key)),
  });
}

async function ensureDomain(client, projectId) {
  let response = await client.request(
    `/v9/projects/${encodeURIComponent(projectId)}/domains/${encodeURIComponent(PRODUCTION_DOMAIN)}?teamId=${encodeURIComponent(TEAM_ID)}`,
    { allow404: true },
  );
  let created = false;
  if (!response.value) {
    await client.request(
      `/v10/projects/${encodeURIComponent(projectId)}/domains?teamId=${encodeURIComponent(TEAM_ID)}`,
      {
        method: "POST",
        body: {
          name: PRODUCTION_DOMAIN,
          gitBranch: null,
        },
      },
    );
    created = true;
    response = await client.request(
      `/v9/projects/${encodeURIComponent(projectId)}/domains/${encodeURIComponent(PRODUCTION_DOMAIN)}?teamId=${encodeURIComponent(TEAM_ID)}`,
    );
  }
  return Object.freeze({
    created,
    name: typeof response.value?.name === "string" ? response.value.name : PRODUCTION_DOMAIN,
    verified: response.value?.verified === true,
    verificationRequired: response.value?.verified !== true,
    verificationRecordCount: Array.isArray(response.value?.verification)
      ? response.value.verification.length
      : 0,
  });
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
      fail("VERCEL_PROVISION_OUTPUT_EXISTS", `The provisioning receipt already exists: ${absolute}`);
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
    fail("VERCEL_PROVISION_RECEIPT_TOO_LARGE", "The bounded provisioning receipt exceeded its limit.");
  }
  for (const key of REQUIRED_SECRETS) {
    const value = String(process.env[key] ?? "").trim();
    if (value && serialized.includes(value)) {
      fail("VERCEL_PROVISION_SECRET_LEAK", `Sensitive ${key} material entered the provisioning receipt.`);
    }
  }
  const target =
    options.out ??
    path.join("artifacts", "vercel-provisioning", `${options.commit}.${options.mode}.json`);
  const output = await atomicNewFile(target, serialized);
  return output;
}

async function runSelfTest() {
  const valid = {
    VERCEL_TOKEN: "v".repeat(40),
    EVAVO_CLIENT_APP_LAUNCH_SECRET: "a".repeat(40),
    EVAVO_VECTOR_PRIVATE_SIGNING_SECRET: "b".repeat(40),
    UPSTASH_REDIS_REST_URL: "https://example.upstash.io",
    UPSTASH_REDIS_REST_TOKEN: "c".repeat(40),
    VECTOR_API_TOKEN: "d".repeat(40),
    VECTOR_WORKER_API_TOKEN: "e".repeat(40),
  };
  const state = credentialState(valid);
  assert.equal(state.passed, true);
  const duplicate = credentialState({
    ...valid,
    VECTOR_WORKER_API_TOKEN: valid.VECTOR_API_TOKEN,
  });
  assert.equal(duplicate.passed, false);
  assert.equal(duplicate.authoritySeparationPassed, false);
  const plan = planFromInspection({ project: null, domain: null });
  assert.equal(plan.project.action, "create");
  assert.equal(plan.environment.keys.includes("VECTOR_HUB_REPLAY_MODE"), true);
  const payload = buildEnvironmentPayload(valid);
  assert.equal(payload.length, ENVIRONMENT_SPECS.length);
  assert.equal(payload.every((item) => item.target[0] === "production"), true);
  assert.equal(JSON.stringify(plan).includes(valid.VERCEL_TOKEN), false);
  process.stdout.write(`${JSON.stringify({
    ok: true,
    check: "vector-studio-vercel-provisioner-self-test",
    contractVersion: CONTRACT_VERSION,
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

  const credentials = credentialState();
  if (!credentials.passed) {
    fail(
      "VERCEL_PROVISION_CREDENTIALS_INVALID",
      "Provisioning credentials are missing, malformed, or not separated.",
      {
        missing: credentials.missing,
        invalid: credentials.invalid,
        authoritySeparationPassed: credentials.authoritySeparationPassed,
      },
    );
  }

  if (
    options.mode === "apply" &&
    String(process.env.VECTOR_VERCEL_APPLY_CONFIRM ?? "").trim() !== APPLY_CONFIRMATION
  ) {
    fail(
      "VERCEL_PROVISION_CONFIRMATION_REQUIRED",
      `Apply mode requires VECTOR_VERCEL_APPLY_CONFIRM=${APPLY_CONFIRMATION}.`,
    );
  }

  const startedAtMs = Date.now();
  const client = apiClient(credentials.values.VERCEL_TOKEN);
  let inspection = await inspectProject(client);
  const plan = planFromInspection(inspection);
  let result = Object.freeze({
    projectCreated: false,
    projectReconciled: false,
    environmentUpserted: false,
    domain: plan.domain,
  });

  if (options.mode === "apply") {
    let project = inspection.project;
    let projectCreated = false;
    if (!project) {
      project = await createProject(client);
      projectCreated = true;
    } else {
      project = await reconcileProject(client, project);
    }
    const projectId = safeProject(project)?.id;
    if (!projectId) fail("VERCEL_PROVISION_PROJECT_ID_MISSING", "The Vercel project has no identifier.");
    await upsertEnvironment(client, projectId, credentials.values);
    const domain = await ensureDomain(client, projectId);
    inspection = await inspectProject(client);
    const finalSettings = projectSettings(inspection.project);
    const finalLink = gitLinkState(inspection.project);
    const reconciled =
      Object.values(finalSettings).every(Boolean) &&
      finalLink.present &&
      finalLink.matched;
    if (!reconciled) {
      fail(
        "VERCEL_PROVISION_PROJECT_RECONCILIATION_FAILED",
        "The project did not retain the governed repository and build settings.",
      );
    }
    result = Object.freeze({
      projectCreated,
      projectReconciled: true,
      environmentUpserted: true,
      domain,
    });
  }

  const completedAtMs = Date.now();
  const receipt = Object.freeze({
    version: CONTRACT_VERSION,
    check: "vector-studio-vercel-provisioning",
    repository: REPOSITORY,
    commit: options.commit,
    mode: options.mode,
    team: Object.freeze({ id: TEAM_ID, slug: TEAM_SLUG }),
    expectedProject: PROJECT_NAME,
    expectedDomain: PRODUCTION_DOMAIN,
    startedAt: new Date(startedAtMs).toISOString(),
    completedAt: new Date(completedAtMs).toISOString(),
    durationMs: completedAtMs - startedAtMs,
    passed:
      options.mode === "plan"
        ? true
        : result.projectReconciled &&
          result.environmentUpserted &&
          result.domain.verified === true,
    plan,
    result,
    deploymentPerformed: false,
    mutationPerformed: options.mode === "apply",
    sensitiveValuesRecorded: false,
  });
  const output = await writeReceipt(options, receipt);
  process.stdout.write(`${JSON.stringify({
    ok: receipt.passed,
    mode: options.mode,
    output,
    projectCreated: result.projectCreated,
    projectReconciled: result.projectReconciled,
    environmentUpserted: result.environmentUpserted,
    domainVerified: result.domain.verified === true,
    deploymentPerformed: false,
    mutationPerformed: receipt.mutationPerformed,
    sensitiveValuesRecorded: false,
  }, null, 2)}\n`);
  if (!receipt.passed) process.exit(1);
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    error: error instanceof Error && "code" in error ? error.code : "VERCEL_PROVISION_FAILED",
    message: error instanceof Error ? error.message : String(error),
    details: error instanceof Error && "details" in error ? error.details : undefined,
    deploymentPerformed: false,
    sensitiveValuesRecorded: false,
  }, null, 2)}\n`);
  process.exit(1);
});
