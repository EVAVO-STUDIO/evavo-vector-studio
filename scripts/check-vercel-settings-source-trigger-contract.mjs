import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";

const orchestratorPath = new URL("./run-vector-vercel-settings-source.mjs", import.meta.url);
const wrapperPath = new URL("./run-vector-vercel-settings-reconciliation.mjs", import.meta.url);
const providerAccessPath = new URL("./check-vector-vercel-provider-access.mjs", import.meta.url);
const sourceProofPath = new URL("./create-source-proof.mjs", import.meta.url);
const retiredWorkflowPath = new URL("../.github/workflows/vector-vercel-settings-source-trigger.yml", import.meta.url);

const [orchestrator, wrapper, providerAccess, sourceProof] = await Promise.all([
  readFile(orchestratorPath, "utf8"),
  readFile(wrapperPath, "utf8"),
  readFile(providerAccessPath, "utf8"),
  readFile(sourceProofPath, "utf8"),
]);

try {
  await stat(retiredWorkflowPath);
  assert.fail("retired settings source workflow must remain absent");
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

for (const marker of [
  'const REPOSITORY = "EVAVO-STUDIO/evavo-vector-studio"',
  'const SETTINGS_CONFIRMATION = "reconcile-evavo-vector-studio-project-settings"',
  'const SHA_PATTERN = /^[a-f0-9]{40}$/u',
  'commandOutput("git", ["branch", "--show-current"])',
  'commandOutput("git", ["rev-parse", "HEAD"])',
  'commandOutput("git", ["status", "--porcelain=v1", "--untracked-files=all"])',
  'commandOutput("git", ["ls-remote", "--refs", "origin", "refs/heads/main"])',
  '["scripts/check-vector-vercel-provider-access.mjs", "--out", providerReceipt]',
  '["scripts/create-source-proof.mjs", "--commit", options.commit, "--out", sourceProof]',
  '["scripts/run-vector-vercel-settings-reconciliation.mjs", "--commit", options.commit, "--out", settingsReceipt]',
  'VECTOR_VERCEL_OPERATION_CONFIRM: SETTINGS_CONFIRMATION',
  'explicitSettingsConfirmationBoundLocally: true',
  'applicationSecretAuthority: false',
  'productionDeploymentAuthority: false',
  'repositoryPublicationAuthority: false',
  'githubActionsAuthority: false',
  'sensitiveValuesRecorded: false',
  '"--self-test"',
]) {
  assert.ok(orchestrator.includes(marker), `settings source orchestrator missing marker: ${marker}`);
}

assert.ok(
  orchestrator.indexOf('"scripts/check-vector-vercel-provider-access.mjs"') <
    orchestrator.indexOf('"scripts/create-source-proof.mjs"'),
  "provider access must be checked before source proof",
);
assert.ok(
  orchestrator.indexOf('"scripts/create-source-proof.mjs"') <
    orchestrator.indexOf('"scripts/run-vector-vercel-settings-reconciliation.mjs"'),
  "source proof must complete before provider settings mutation",
);
assert.ok(
  (orchestrator.match(/assertExactMain\(options\.commit\)/gu) ?? []).length >= 3,
  "settings source orchestrator must prove exact current main before source proof, after source proof, and after settings",
);

for (const forbidden of [
  "EVAVO_CLIENT_APP_LAUNCH_SECRET",
  "EVAVO_VECTOR_PRIVATE_SIGNING_SECRET",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "VECTOR_API_TOKEN",
  "VECTOR_WORKER_API_TOKEN",
  "deploy-vector-studio-vercel.mjs",
  "--mode apply",
  "contents: write",
  "actions: write",
]) {
  assert.ok(!orchestrator.includes(forbidden), `settings source orchestrator contains forbidden authority: ${forbidden}`);
}

for (const marker of [
  'const PROVIDER_KEY = "VERCEL_TOKEN"',
  "below-minimum-length",
  "contains-whitespace",
  "networkRequestPerformed: false",
  "providerMutationPerformed: false",
  "rawCredentialRecorded: false",
  "sensitiveValuesRecorded: false",
  'flag: "wx"',
]) {
  assert.ok(providerAccess.includes(marker), `provider-access gate missing marker: ${marker}`);
}
for (const forbidden of ["console.log(process.env", "JSON.stringify(process.env", "rawCredentialRecorded: true", "fetch(", "spawnSync("]) {
  assert.ok(!providerAccess.includes(forbidden), `provider-access gate contains forbidden behavior: ${forbidden}`);
}

for (const marker of [
  'const CHILD_SCRIPT = "scripts/provision-vector-studio-vercel.mjs"',
  "MAX_CHILD_OUTPUT_BYTES",
  "MAX_RECEIPT_BYTES",
  "spawnSync(",
  "shell: false",
  '"--mode",\n      "settings"',
  "sanitiseProvisionerFailure",
  "rawProviderResponseRecorded: false",
  "rawStderrRecorded: false",
  "sensitiveValuesRecorded: false",
  "diagnosticReceiptOnFailure: true",
]) {
  assert.ok(wrapper.includes(marker), `settings reconciliation wrapper missing marker: ${marker}`);
}
for (const forbidden of ["console.log(process.env", "JSON.stringify(process.env", "rawStderrRecorded: true", "rawProviderResponseRecorded: true", "shell: true", "execSync(", "fetch("]) {
  assert.ok(!wrapper.includes(forbidden), `settings reconciliation wrapper contains forbidden behavior: ${forbidden}`);
}

for (const marker of [
  'REPOSITORY = "EVAVO-STUDIO/evavo-vector-studio"',
  'runChecked("pnpm", ["install", "--frozen-lockfile"]',
  'runChecked("pnpm", ["check"]',
  'runChecked("pnpm", ["--filter", "@evavo/vector-web", "build"]',
  "assertCleanRepository()",
  "sensitiveValuesRecorded: false",
]) {
  assert.ok(sourceProof.includes(marker), `source proof missing settings-lane prerequisite: ${marker}`);
}

process.stdout.write(`${JSON.stringify({
  ok: true,
  kind: "vector-vercel-settings-source-contract",
  contractVersion: "2.1",
  providerFreeExecution: true,
  retiredWorkflowAbsent: true,
  exactCurrentMainRechecks: 3,
  explicitSettingsConfirmationBoundLocally: true,
  providerMutationScope: "pinned-project-settings-only",
  applicationSecretAuthority: false,
  productionDeploymentAuthority: false,
  publicationAuthority: false,
  sensitiveValuesRecorded: false,
})}\n`);
