import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const workflowPath = new URL(
  "../.github/workflows/vector-vercel-settings-source-trigger.yml",
  import.meta.url,
);
const wrapperPath = new URL(
  "./run-vector-vercel-settings-reconciliation.mjs",
  import.meta.url,
);
const providerAccessPath = new URL(
  "./check-vector-vercel-provider-access.mjs",
  import.meta.url,
);
const workflow = await readFile(workflowPath, "utf8");
const wrapper = await readFile(wrapperPath, "utf8");
const providerAccess = await readFile(providerAccessPath, "utf8");

const required = [
  "name: Vector Studio Vercel settings source trigger",
  "push:",
  "branches: [main]",
  "'.github/vector-vercel-settings.trigger'",
  "'scripts/check-vector-vercel-provider-access.mjs'",
  "'scripts/run-vector-vercel-settings-reconciliation.mjs'",
  "environment: vector-studio-production",
  "runs-on: ubuntu-latest",
  "contents: read",
  "statuses: write",
  "VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}",
  "VECTOR_VERCEL_OPERATION_CONFIRM: reconcile-evavo-vector-studio-project-settings",
  "node scripts/provision-vector-studio-vercel.mjs --self-test",
  "node scripts/check-vector-vercel-provider-access.mjs --self-test",
  "node scripts/run-vector-vercel-settings-reconciliation.mjs --self-test",
  "id: provider_access",
  "--out .ci/vector-vercel-provider-access.json",
  "id: source_proof",
  "if: ${{ steps.provider_access.outcome == 'success' }}",
  "node scripts/create-source-proof.mjs --commit \"$GITHUB_SHA\"",
  "steps.provider_access.outcome == 'success' && steps.source_proof.outcome == 'success'",
  "node scripts/run-vector-vercel-settings-reconciliation.mjs \\",
  "--commit \"$GITHUB_SHA\"",
  "--out .ci/vector-vercel-provision-settings.json",
  ".ci/vector-vercel-provider-access.json",
  "provider access blocked: VERCEL_TOKEN",
  "if-no-files-found: error",
  "deploy/vector-studio-vercel-project-settings-source-trigger",
];

for (const marker of required) {
  assert.ok(workflow.includes(marker), `settings source trigger missing marker: ${marker}`);
}

assert.ok(
  workflow.indexOf("id: provider_access") < workflow.indexOf("id: source_proof"),
  "provider access must be checked before the expensive source proof",
);
assert.ok(
  workflow.indexOf("id: source_proof") < workflow.indexOf("id: settings"),
  "source proof must complete before provider settings mutation",
);

for (const forbidden of [
  "EVAVO_CLIENT_APP_LAUNCH_SECRET",
  "EVAVO_VECTOR_PRIVATE_SIGNING_SECRET",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "VECTOR_API_TOKEN",
  "VECTOR_WORKER_API_TOKEN",
  "--mode apply",
  "deploy-vector-studio-vercel.mjs",
  "production-deployed",
  "contents: write",
  "actions: write",
  "printenv",
  "echo $VERCEL_TOKEN",
]) {
  assert.ok(!workflow.includes(forbidden), `settings source trigger contains forbidden authority: ${forbidden}`);
}

assert.match(workflow, /test "\$GITHUB_REF" = "refs\/heads\/main"/u);
assert.match(workflow, /test "\$GITHUB_SHA" = "\$CURRENT_MAIN_SHA"/u);
assert.match(workflow, /test "\$\(git rev-parse HEAD\)" = "\$GITHUB_SHA"/u);
assert.match(workflow, /git diff --exit-code/u);
assert.match(workflow, /git status --porcelain=v1 --untracked-files=all/u);

for (const marker of [
  'const PROVIDER_KEY = "VERCEL_TOKEN"',
  "below-minimum-length",
  "contains-whitespace",
  "networkRequestPerformed: false",
  "providerMutationPerformed: false",
  "rawCredentialRecorded: false",
  "sensitiveValuesRecorded: false",
  'flag: "wx"',
  "--self-test",
]) {
  assert.ok(providerAccess.includes(marker), `provider-access gate missing marker: ${marker}`);
}
for (const forbidden of [
  "console.log(process.env",
  "JSON.stringify(process.env",
  "rawCredentialRecorded: true",
  "sensitiveValuesRecorded: true",
  "fetch(",
  "spawnSync(",
]) {
  assert.ok(!providerAccess.includes(forbidden), `provider-access gate contains forbidden behavior: ${forbidden}`);
}

for (const marker of [
  'const CHILD_SCRIPT = "scripts/provision-vector-studio-vercel.mjs"',
  "MAX_CHILD_OUTPUT_BYTES",
  "MAX_RECEIPT_BYTES",
  "spawnSync(",
  "maxBuffer: MAX_CHILD_OUTPUT_BYTES",
  "shell: false",
  '"--mode",\n      "settings"',
  "sanitiseProvisionerFailure",
  "rawProviderResponseRecorded: false",
  "rawStderrRecorded: false",
  "sensitiveValuesRecorded: false",
  "diagnosticReceiptOnFailure: true",
  "providerMutationPerformed: false",
]) {
  assert.ok(wrapper.includes(marker), `settings reconciliation wrapper missing marker: ${marker}`);
}
for (const forbidden of [
  "console.log(process.env",
  "JSON.stringify(process.env",
  "rawStderrRecorded: true",
  "rawProviderResponseRecorded: true",
  "sensitiveValuesRecorded: true",
  "shell: true",
  "execSync(",
  "fetch(",
]) {
  assert.ok(!wrapper.includes(forbidden), `settings reconciliation wrapper contains forbidden behavior: ${forbidden}`);
}

process.stdout.write(
  `${JSON.stringify({
    ok: true,
    kind: "vector-vercel-settings-source-trigger-contract",
    contractVersion: "1.2",
    providerMutationScope: "pinned-project-settings-only",
    providerAccessCheckedBeforeSourceProof: true,
    expensiveSourceProofSkippedWhenProviderAccessMissing: true,
    boundedFailureReceiptRequired: true,
    rawProviderResponseRecorded: false,
    rawStderrRecorded: false,
    productionDeploymentAuthority: false,
    applicationSecretAuthority: false,
    publicationAuthority: false,
  })}\n`,
);
