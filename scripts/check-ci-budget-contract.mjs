import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const errors = [];
const checkedFiles = new Set();

async function read(relativePath) {
  checkedFiles.add(relativePath);
  try {
    return (await fs.readFile(path.join(root, relativePath), "utf8")).replace(/^\uFEFF/, "");
  } catch (error) {
    errors.push(
      `Missing or unreadable CI-budget file: ${relativePath} (${
        error instanceof Error ? error.message : String(error)
      })`,
    );
    return "";
  }
}

async function requireAbsent(relativePath) {
  checkedFiles.add(relativePath);
  try {
    await fs.access(path.join(root, relativePath));
    errors.push(`Retired CI authority must remain absent: ${relativePath}.`);
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) {
      errors.push(
        `Could not verify absence of ${relativePath} (${
          error instanceof Error ? error.message : String(error)
        }).`,
      );
    }
  }
}

function requireTokens(relativePath, source, tokens) {
  for (const token of tokens) {
    if (!source.includes(token)) {
      errors.push(`${relativePath} is missing CI-budget token: ${token}`);
    }
  }
}

function forbidTokens(relativePath, source, tokens) {
  for (const token of tokens) {
    if (source.includes(token)) {
      errors.push(`${relativePath} contains prohibited CI-budget token: ${token}`);
    }
  }
}

function triggerBlock(relativePath, source) {
  const match = source.replace(/\r\n/g, "\n").match(/^on:\n([\s\S]*?)\npermissions:/m);
  if (!match) {
    errors.push(`${relativePath} does not expose a bounded workflow trigger block.`);
    return "";
  }
  return `on:\n${match[1].trimEnd()}\n`;
}

function requireManualOnly(relativePath, source) {
  const actual = triggerBlock(relativePath, source);
  const expected = "on:\n  workflow_dispatch:\n";
  if (actual !== expected) {
    errors.push(`${relativePath} must be operator-dispatched only; received ${JSON.stringify(actual)}.`);
  }
}

function requireDispatchOnly(relativePath, source) {
  const block = triggerBlock(relativePath, source);
  requireTokens(relativePath, block, ["workflow_dispatch:"]);
  forbidTokens(relativePath, block, ["\n  push:", "\n  pull_request:", "\n  merge_group:", "\n  schedule:"]);
}

const files = Object.freeze({
  quality: ".github/workflows/quality.yml",
  governance: ".github/workflows/governance-contract.yml",
  capabilities: ".github/workflows/capabilities-api-contract.yml",
  print: ".github/workflows/print-preflight-contract.yml",
  readiness: ".github/workflows/readiness-contract.yml",
  hub: ".github/workflows/hub-contract.yml",
  httpWorker: ".github/workflows/http-worker-contract.yml",
  sourceProof: ".github/workflows/source-release-proof.yml",
  publicProof: ".github/workflows/public-deployment-proof.yml",
  providerPreflight: ".github/workflows/vector-vercel-provisioning-preflight.yml",
  providerProvision: ".github/workflows/vector-vercel-project-provisioning.yml",
  providerDeploy: ".github/workflows/vector-vercel-production-deployment.yml",
  hygiene: "scripts/check-repository-hygiene.mjs",
  documentation: "docs/CI-BUDGET.md",
});

const sources = Object.fromEntries(
  await Promise.all(
    Object.entries(files).map(async ([key, relativePath]) => [key, await read(relativePath)]),
  ),
);

for (const [key, relativePath] of Object.entries({
  capabilities: files.capabilities,
  print: files.print,
  readiness: files.readiness,
  hub: files.hub,
  httpWorker: files.httpWorker,
  sourceProof: files.sourceProof,
})) {
  requireManualOnly(relativePath, sources[key]);
}

for (const [key, relativePath] of Object.entries({
  publicProof: files.publicProof,
  providerPreflight: files.providerPreflight,
  providerProvision: files.providerProvision,
  providerDeploy: files.providerDeploy,
})) {
  requireDispatchOnly(relativePath, sources[key]);
}

const qualityTriggers = triggerBlock(files.quality, sources.quality);
requireTokens(files.quality, qualityTriggers, [
  "push:",
  "branches: [main]",
  "pull_request:",
  "merge_group:",
  "workflow_dispatch:",
]);
forbidTokens(files.quality, qualityTriggers, ["paths:", "paths-ignore:", "schedule:"]);
requireTokens(files.quality, sources.quality, [
  "pnpm install --frozen-lockfile",
  "pnpm lint",
  "pnpm typecheck",
  "pnpm test",
  "pnpm build",
  '["contracts", ".ci/contracts.log", process.env.CONTRACTS_OUTCOME]',
  "context: `vector/${name}`",
]);
forbidTokens(files.quality, sources.quality, [
  "contents: write",
  "git push",
  "vercel deploy",
  "vercel --prod",
]);

const governanceTriggers = triggerBlock(files.governance, sources.governance);
requireTokens(files.governance, governanceTriggers, [
  "push:",
  "branches: [main]",
  "paths:",
  "pull_request:",
  "workflow_dispatch:",
  '".github/workflows/governance-contract.yml"',
  '"scripts/check-ci-budget-contract.mjs"',
  '"scripts/check-repository-hygiene.mjs"',
  '"scripts/check-test-build-isolation.mjs"',
  '"scripts/check-readiness-contract.mjs"',
  '"docs/CI-BUDGET.md"',
]);
forbidTokens(files.governance, governanceTriggers, ["schedule:", "paths-ignore:"]);
requireTokens(files.governance, sources.governance, [
  "Vector Studio source governance",
  "node scripts/check-ci-budget-contract.mjs",
  "node scripts/check-repository-hygiene.mjs",
  "node scripts/check-test-build-isolation.mjs",
  "node scripts/check-readiness-contract.mjs",
  "governance/vector-ci-budget",
  "api/vector-repository-hygiene",
  "api/vector-test-build-isolation",
  "api/vector-readiness-contract",
  "Verify clean tracked and untracked boundary",
]);
forbidTokens(files.governance, sources.governance, [
  "pnpm install",
  "npm install",
  "yarn install",
  "pnpm build",
  "pnpm test",
  "pnpm typecheck",
  "turbo run",
  "contents: write",
  "actions: write",
  "git push",
  "vercel deploy",
  "vercel --prod",
  "secrets.",
]);

requireTokens(files.hygiene, sources.hygiene, [
  "retiredPublicationAuthoritiesAbsent: true",
  '".github/workflows/one-time-finalise-vercel-contract.yml"',
]);

requireTokens(files.documentation, sources.documentation, [
  "# CI and provider budget",
  "one full automatic quality gate",
  "one dependency-free automatic governance gate",
  "Operator-dispatched deep proofs",
  "repair-pnpm-lockfile-once.yml",
  "vector-vercel-preflight.trigger",
  "no provider mutation",
  "Client release remains withheld",
]);

for (const retiredPath of [
  ".github/workflows/repair-pnpm-lockfile-once.yml",
  ".github/vector-vercel-preflight.trigger",
]) {
  await requireAbsent(retiredPath);
}

if (errors.length > 0) {
  process.stderr.write(
    `${JSON.stringify(
      {
        check: "evavo-vector-studio-ci-budget",
        ok: false,
        contractVersion: "1.0",
        errors,
      },
      null,
      2,
    )}\n`,
  );
  process.exit(1);
}

process.stdout.write(
  `${JSON.stringify(
    {
      check: "evavo-vector-studio-ci-budget",
      ok: true,
      contractVersion: "1.0",
      automaticFullQualityGates: 1,
      automaticDependencyFreeGovernanceGates: 1,
      focusedDeepProofsManualOnly: true,
      retiredWriteEnabledRepairAbsent: true,
      retiredProviderTriggerAbsent: true,
      providerMutationManualOnly: true,
      clientReleaseEligible: false,
      mutationPerformed: false,
      sensitiveValuesRecorded: false,
      checkedFiles: [...checkedFiles].sort(),
    },
    null,
    2,
  )}\n`,
);
