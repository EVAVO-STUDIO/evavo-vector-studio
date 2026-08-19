import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const workflowPath = new URL(
  "../.github/workflows/vector-vercel-settings-source-trigger.yml",
  import.meta.url,
);
const workflow = await readFile(workflowPath, "utf8");

const required = [
  "name: Vector Studio Vercel settings source trigger",
  "push:",
  "branches: [main]",
  "'.github/vector-vercel-settings.trigger'",
  "environment: vector-studio-production",
  "runs-on: ubuntu-latest",
  "contents: read",
  "statuses: write",
  "VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}",
  "VECTOR_VERCEL_OPERATION_CONFIRM: reconcile-evavo-vector-studio-project-settings",
  "node scripts/provision-vector-studio-vercel.mjs --self-test",
  "node scripts/create-source-proof.mjs --commit \"$GITHUB_SHA\"",
  "--mode settings",
  "--commit \"$GITHUB_SHA\"",
  "deploy/vector-studio-vercel-project-settings-source-trigger",
];

for (const marker of required) {
  assert.ok(workflow.includes(marker), `settings source trigger missing marker: ${marker}`);
}

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
]) {
  assert.ok(!workflow.includes(forbidden), `settings source trigger contains forbidden authority: ${forbidden}`);
}

assert.match(workflow, /test "\$GITHUB_REF" = "refs\/heads\/main"/u);
assert.match(workflow, /test "\$GITHUB_SHA" = "\$CURRENT_MAIN_SHA"/u);
assert.match(workflow, /test "\$\(git rev-parse HEAD\)" = "\$GITHUB_SHA"/u);
assert.match(workflow, /git diff --exit-code/u);
assert.match(workflow, /git status --porcelain=v1 --untracked-files=all/u);

process.stdout.write(
  `${JSON.stringify({
    ok: true,
    kind: "vector-vercel-settings-source-trigger-contract",
    providerMutationScope: "pinned-project-settings-only",
    productionDeploymentAuthority: false,
    applicationSecretAuthority: false,
    publicationAuthority: false,
  })}\n`,
);
