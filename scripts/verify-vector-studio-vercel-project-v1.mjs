import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const MANIFEST_PATH = "ops/provider/vector-studio-vercel-project-v1.json";
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RESPONSE_BYTES = 1_000_000;
const MAX_RECEIPT_BYTES = 128 * 1024;
const MAX_DEPLOYMENTS = 20;
const SHA_PATTERN = /^[a-f0-9]{40}$/;

function fail(code, message, details = undefined) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  throw error;
}

function loadManifest() {
  const value = JSON.parse(readFileSync(path.resolve(MANIFEST_PATH), "utf8"));
  assert.equal(value.contractVersion, "1.0");
  assert.equal(value.provider, "vercel");
  assert.equal(value.clientReleaseEligible, false);
  assert.equal(value.secretValuesIncluded, false);
  assert.match(value.project.id, /^prj_[A-Za-z0-9]+$/);
  assert.equal(value.project.name, "evavo-vector-studio");
  assert.equal(value.project.repository, "EVAVO-STUDIO/evavo-vector-studio");
  assert.equal(value.project.rootDirectory, "apps/web");
  assert.equal(value.project.framework, "nextjs");
  assert.equal(value.project.nodeVersion, "22.x");
  assert.equal(value.production.domain, "vector.evavo.com.au");
  assert.equal(new Set(value.requiredEnvironmentKeys).size, value.requiredEnvironmentKeys.length);
  return Object.freeze(value);
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
      if (!value) fail("VERCEL_PROJECT_STATE_ARGUMENT_INVALID", `${argument} requires a value.`);
      index += 1;
      if (argument === "--commit") options.commit = value;
      else options.out = value;
      continue;
    }
    fail("VERCEL_PROJECT_STATE_ARGUMENT_INVALID", `Unknown argument: ${argument}`);
  }
  if (!options.selfTest && (!options.commit || !SHA_PATTERN.test(options.commit))) {
    fail(
      "VERCEL_PROJECT_STATE_COMMIT_INVALID",
      "Pass the exact lowercase 40-character main SHA with --commit.",
    );
  }
  return Object.freeze(options);
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
          "VERCEL_PROJECT_STATE_RESPONSE_TOO_LARGE",
          "A Vercel response exceeded the bounded inspection limit.",
        );
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function requestJson(token, pathname, fetchImpl = fetch) {
  const url = new URL(pathname, "https://api.vercel.com");
  if (url.origin !== "https://api.vercel.com") {
    fail(
      "VERCEL_PROJECT_STATE_ORIGIN_INVALID",
      "Provider inspection attempted to leave the Vercel API origin.",
    );
  }
  const response = await fetchImpl(url, {
    method: "GET",
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/json",
      "accept-encoding": "identity",
    },
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await readBoundedText(response);
  let value = null;
  if (text) {
    try {
      value = JSON.parse(text);
    } catch {
      fail("VERCEL_PROJECT_STATE_JSON_INVALID", "Vercel returned invalid bounded JSON.", {
        path: url.pathname,
        status: response.status,
      });
    }
  }
  if (!response.ok) {
    const code =
      typeof value?.error?.code === "string" ? value.error.code.slice(0, 120) : null;
    fail("VERCEL_PROJECT_STATE_REQUEST_FAILED", "A read-only Vercel request failed.", {
      path: url.pathname,
      status: response.status,
      code,
    });
  }
  return value;
}

function safeProject(project) {
  return Object.freeze({
    id: typeof project?.id === "string" ? project.id : null,
    name: typeof project?.name === "string" ? project.name : null,
    framework: typeof project?.framework === "string" ? project.framework : null,
    rootDirectory: typeof project?.rootDirectory === "string" ? project.rootDirectory : null,
    nodeVersion: typeof project?.nodeVersion === "string" ? project.nodeVersion : null,
    installCommand:
      typeof project?.installCommand === "string" ? project.installCommand : null,
    buildCommand: typeof project?.buildCommand === "string" ? project.buildCommand : null,
    gitLink:
      project?.link && typeof project.link === "object"
        ? Object.freeze({
            type: typeof project.link.type === "string" ? project.link.type : null,
            org: typeof project.link.org === "string" ? project.link.org : null,
            repo: typeof project.link.repo === "string" ? project.link.repo : null,
          })
        : null,
  });
}

function sourceControlState(project, repository) {
  const link = safeProject(project).gitLink;
  if (!link) {
    return Object.freeze({
      present: false,
      acceptable: true,
      exactMatch: false,
      mode: "api-managed",
    });
  }
  const [expectedOrg, expectedRepo] = repository.split("/");
  const typeMatched = link.type === "github";
  const orgMatched =
    typeof link.org === "string" &&
    link.org.toLowerCase() === expectedOrg.toLowerCase();
  const repoMatched =
    typeof link.repo === "string" &&
    (link.repo.toLowerCase() === expectedRepo.toLowerCase() ||
      link.repo.toLowerCase() === repository.toLowerCase());
  const exactMatch = typeMatched && orgMatched && repoMatched;
  return Object.freeze({
    present: true,
    acceptable: exactMatch,
    exactMatch,
    mode: exactMatch ? "github-linked" : "conflicting",
  });
}

function domainsFrom(value) {
  const domains = Array.isArray(value?.domains) ? value.domains : [];
  return domains
    .filter((entry) => entry && typeof entry === "object")
    .map((entry) =>
      Object.freeze({
        name: typeof entry.name === "string" ? entry.name : null,
        verified: entry.verified === true,
      }),
    );
}

function environmentKeysFrom(value) {
  const envs = Array.isArray(value?.envs) ? value.envs : [];
  return Object.freeze(
    [...new Set(envs.map((entry) => entry?.key).filter((key) => typeof key === "string"))].sort(),
  );
}

function deploymentList(value) {
  if (Array.isArray(value?.deployments)) return value.deployments;
  if (Array.isArray(value?.data?.deployments)) return value.data.deployments;
  if (Array.isArray(value?.data)) return value.data;
  return [];
}

function deploymentCommit(value) {
  const candidates = [
    value?.gitSource?.sha,
    value?.gitMetadata?.commitSha,
    value?.meta?.githubCommitSha,
    value?.meta?.gitCommitSha,
  ];
  return (
    candidates.find(
      (candidate) => typeof candidate === "string" && SHA_PATTERN.test(candidate),
    ) ?? null
  );
}

function safeDeployment(value) {
  if (!value || typeof value !== "object") return null;
  return Object.freeze({
    id: typeof value.id === "string" ? value.id : null,
    name: typeof value.name === "string" ? value.name : null,
    url: typeof value.url === "string" ? value.url : null,
    readyState:
      typeof value.readyState === "string"
        ? value.readyState
        : typeof value.state === "string"
          ? value.state
          : null,
    target: typeof value.target === "string" ? value.target : null,
    createdAt: Number.isSafeInteger(value.createdAt) ? value.createdAt : null,
    commit: deploymentCommit(value),
  });
}

function deploymentsFrom(value) {
  return Object.freeze(
    deploymentList(value)
      .slice(0, MAX_DEPLOYMENTS)
      .map(safeDeployment)
      .filter(Boolean),
  );
}

function currentProviderState({
  projectIdentityPassed,
  projectConfigured,
  domainVerified,
  productionDeployed,
}) {
  if (productionDeployed) return "production-deployed";
  if (domainVerified) return "domain-verified";
  if (projectConfigured) return "project-configured";
  if (projectIdentityPassed) return "project-created";
  return "source-ready";
}

function evaluate({ manifest, project, domains, environmentKeys, deployments, commit }) {
  const safe = safeProject(project);
  const sourceControl = sourceControlState(project, manifest.project.repository);
  const domain = domains.find((entry) => entry.name === manifest.production.domain) ?? null;
  const missingEnvironmentKeys = manifest.requiredEnvironmentKeys.filter(
    (key) => !environmentKeys.includes(key),
  );
  const settings = Object.freeze({
    framework: safe.framework === manifest.project.framework,
    rootDirectory: safe.rootDirectory === manifest.project.rootDirectory,
    nodeVersion: safe.nodeVersion === manifest.project.nodeVersion,
    installCommand: safe.installCommand === manifest.project.installCommand,
    buildCommand: safe.buildCommand === manifest.project.buildCommand,
  });
  const projectIdentityPassed =
    safe.id === manifest.project.id && safe.name === manifest.project.name;
  const settingsPassed = Object.values(settings).every(Boolean);
  const projectConfigured =
    projectIdentityPassed && settingsPassed && sourceControl.acceptable;
  const domainVerified = domain?.verified === true;
  const environmentPassed = missingEnvironmentKeys.length === 0;
  const exactCommitProductionDeployment =
    deployments.find(
      (deployment) =>
        deployment.commit === commit &&
        deployment.readyState === "READY" &&
        deployment.target === "production",
    ) ?? null;
  const productionDeployed = Boolean(exactCommitProductionDeployment);
  const releaseReady =
    projectConfigured && domainVerified && environmentPassed && productionDeployed;
  const providerState = currentProviderState({
    projectIdentityPassed,
    projectConfigured,
    domainVerified: projectConfigured && domainVerified,
    productionDeployed: releaseReady,
  });

  return Object.freeze({
    contractVersion: manifest.contractVersion,
    inspectedCommit: commit,
    provider: manifest.provider,
    providerState,
    team: manifest.team,
    project: safe,
    expected: Object.freeze({
      projectId: manifest.project.id,
      projectName: manifest.project.name,
      repository: manifest.project.repository,
      rootDirectory: manifest.project.rootDirectory,
      framework: manifest.project.framework,
      nodeVersion: manifest.project.nodeVersion,
      productionOrigin: manifest.production.origin,
    }),
    checks: Object.freeze({
      projectIdentity: projectIdentityPassed,
      sourceControl,
      sourceControlAcceptable: sourceControl.acceptable,
      settings,
      settingsPassed,
      projectConfigured,
      productionDomainPresent: Boolean(domain),
      productionDomainVerified: domainVerified,
      requiredEnvironmentKeysPresent: environmentPassed,
      exactCommitProductionDeploymentReady: productionDeployed,
    }),
    environment: Object.freeze({
      requiredKeyCount: manifest.requiredEnvironmentKeys.length,
      presentRequiredKeyCount:
        manifest.requiredEnvironmentKeys.length - missingEnvironmentKeys.length,
      missingKeys: Object.freeze(missingEnvironmentKeys),
      valuesRecorded: false,
    }),
    deployment: Object.freeze({
      inspectedCandidateCount: deployments.length,
      exactCommitProduction: exactCommitProductionDeployment,
      rawResponsesRecorded: false,
    }),
    releaseReady,
    clientReleaseEligible: false,
    mutationAttempted: false,
    mutationPerformed: false,
    sensitiveValuesRecorded: false,
  });
}

async function writeReceipt(out, receipt) {
  if (!out) return;
  const absolute = path.resolve(out);
  const body = `${JSON.stringify(receipt, null, 2)}\n`;
  if (Buffer.byteLength(body) > MAX_RECEIPT_BYTES) {
    fail(
      "VERCEL_PROJECT_STATE_RECEIPT_TOO_LARGE",
      "The provider-state receipt exceeded its bounded limit.",
    );
  }
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, body, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
}

function completeProject(manifest) {
  return {
    id: manifest.project.id,
    name: manifest.project.name,
    framework: manifest.project.framework,
    rootDirectory: manifest.project.rootDirectory,
    nodeVersion: manifest.project.nodeVersion,
    installCommand: manifest.project.installCommand,
    buildCommand: manifest.project.buildCommand,
    link: { type: "github", org: "EVAVO-STUDIO", repo: "evavo-vector-studio" },
  };
}

function readyDeployment(commit) {
  return {
    id: "dpl_ready",
    name: "evavo-vector-studio",
    url: "evavo-vector-studio.example.vercel.app",
    readyState: "READY",
    target: "production",
    createdAt: 1,
    gitSource: { sha: commit },
  };
}

async function selfTest() {
  const manifest = loadManifest();
  const commit = "a".repeat(40);
  const receipt = evaluate({
    manifest,
    commit,
    project: completeProject(manifest),
    domains: [{ name: manifest.production.domain, verified: true }],
    environmentKeys: [...manifest.requiredEnvironmentKeys],
    deployments: deploymentsFrom({ deployments: [readyDeployment(commit)] }),
  });
  assert.equal(receipt.releaseReady, true);
  assert.equal(receipt.providerState, "production-deployed");
  assert.equal(receipt.checks.sourceControlAcceptable, true);
  assert.equal(receipt.checks.exactCommitProductionDeploymentReady, true);
  assert.equal(receipt.clientReleaseEligible, false);
  assert.equal(receipt.mutationPerformed, false);
  assert.equal(receipt.sensitiveValuesRecorded, false);

  const apiManaged = evaluate({
    manifest,
    commit,
    project: { ...completeProject(manifest), link: null },
    domains: [{ name: manifest.production.domain, verified: true }],
    environmentKeys: [...manifest.requiredEnvironmentKeys],
    deployments: deploymentsFrom({ deployments: [readyDeployment(commit)] }),
  });
  assert.equal(apiManaged.releaseReady, true);
  assert.equal(apiManaged.checks.sourceControl.mode, "api-managed");

  const conflicting = evaluate({
    manifest,
    commit,
    project: {
      ...completeProject(manifest),
      link: { type: "github", org: "EVAVO-STUDIO", repo: "wrong-repository" },
    },
    domains: [{ name: manifest.production.domain, verified: true }],
    environmentKeys: [...manifest.requiredEnvironmentKeys],
    deployments: deploymentsFrom({ deployments: [readyDeployment(commit)] }),
  });
  assert.equal(conflicting.releaseReady, false);
  assert.equal(conflicting.checks.sourceControl.mode, "conflicting");

  const noDeployment = evaluate({
    manifest,
    commit,
    project: completeProject(manifest),
    domains: [{ name: manifest.production.domain, verified: true }],
    environmentKeys: [...manifest.requiredEnvironmentKeys],
    deployments: Object.freeze([]),
  });
  assert.equal(noDeployment.releaseReady, false);
  assert.equal(noDeployment.providerState, "domain-verified");
  assert.equal(noDeployment.checks.exactCommitProductionDeploymentReady, false);

  const incomplete = evaluate({
    manifest,
    commit: "b".repeat(40),
    project: { id: manifest.project.id, name: manifest.project.name },
    domains: [],
    environmentKeys: [],
    deployments: Object.freeze([]),
  });
  assert.equal(incomplete.releaseReady, false);
  assert.equal(
    incomplete.environment.missingKeys.length,
    manifest.requiredEnvironmentKeys.length,
  );
  console.log("Vector Studio Vercel project verifier v1 self-test passed.");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.selfTest) {
    await selfTest();
    return;
  }
  const manifest = loadManifest();
  const token = String(process.env.VERCEL_TOKEN ?? "").trim();
  if (token.length < 20 || /\s/.test(token)) {
    fail("VERCEL_PROJECT_STATE_TOKEN_INVALID", "VERCEL_TOKEN is missing or malformed.");
  }
  const project = await requestJson(
    token,
    `/v9/projects/${encodeURIComponent(manifest.project.name)}?teamId=${encodeURIComponent(manifest.team.id)}`,
  );
  const [domainsValue, environmentValue, deploymentsValue] = await Promise.all([
    requestJson(
      token,
      `/v9/projects/${encodeURIComponent(manifest.project.id)}/domains?teamId=${encodeURIComponent(manifest.team.id)}`,
    ),
    requestJson(
      token,
      `/v9/projects/${encodeURIComponent(manifest.project.id)}/env?teamId=${encodeURIComponent(manifest.team.id)}`,
    ),
    requestJson(
      token,
      `/v7/deployments?projectId=${encodeURIComponent(manifest.project.id)}&sha=${encodeURIComponent(options.commit)}&target=production&limit=${MAX_DEPLOYMENTS}&teamId=${encodeURIComponent(manifest.team.id)}`,
    ),
  ]);
  const receipt = evaluate({
    manifest,
    project,
    domains: domainsFrom(domainsValue),
    environmentKeys: environmentKeysFrom(environmentValue),
    deployments: deploymentsFrom(deploymentsValue),
    commit: options.commit,
  });
  await writeReceipt(options.out, receipt);
  console.log(
    JSON.stringify({
      contractVersion: receipt.contractVersion,
      providerState: receipt.providerState,
      projectId: receipt.project.id,
      projectIdentityPassed: receipt.checks.projectIdentity,
      sourceControlAcceptable: receipt.checks.sourceControlAcceptable,
      settingsPassed: receipt.checks.settingsPassed,
      productionDomainVerified: receipt.checks.productionDomainVerified,
      requiredEnvironmentKeysPresent: receipt.checks.requiredEnvironmentKeysPresent,
      exactCommitProductionDeploymentReady:
        receipt.checks.exactCommitProductionDeploymentReady,
      releaseReady: receipt.releaseReady,
      clientReleaseEligible: false,
      receiptSha256: createHash("sha256")
        .update(JSON.stringify(receipt))
        .digest("hex"),
      mutationPerformed: false,
      sensitiveValuesRecorded: false,
    }),
  );
  if (!receipt.releaseReady) process.exitCode = 2;
}

main().catch((error) => {
  const code =
    typeof error?.code === "string" ? error.code : "VERCEL_PROJECT_STATE_UNEXPECTED";
  const details =
    error?.details && typeof error.details === "object" ? error.details : undefined;
  console.error(
    JSON.stringify({
      code,
      message: error instanceof Error ? error.message : String(error),
      details,
    }),
  );
  process.exitCode = 1;
});
