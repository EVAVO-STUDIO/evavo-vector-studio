import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const files = Object.freeze({
  manifest: "ops/provider/vector-studio-vercel-project-v1.json",
  verifier: "scripts/verify-vector-studio-vercel-project-v1.mjs",
  documentation: "docs/VERCEL-PROJECT-STATE-V1.md",
  workflow: ".github/workflows/vector-studio-vercel-project-v1.yml",
});

function read(relativePath) {
  const absolute = path.join(root, relativePath);
  assert.ok(fs.existsSync(absolute), `Missing Vercel project-state file: ${relativePath}`);
  return fs.readFileSync(absolute, "utf8").replace(/^\uFEFF/, "");
}

function requireTokens(label, source, tokens) {
  for (const token of tokens) {
    assert.ok(source.includes(token), `${label} is missing: ${token}`);
  }
}

function forbidTokens(label, source, tokens) {
  for (const token of tokens) {
    assert.ok(!source.includes(token), `${label} contains prohibited token: ${token}`);
  }
}

const manifestSource = read(files.manifest);
const verifier = read(files.verifier);
const documentation = read(files.documentation);
const workflow = read(files.workflow);
const manifest = JSON.parse(manifestSource);

assert.equal(manifest.contractVersion, "1.0");
assert.equal(manifest.provider, "vercel");
assert.equal(manifest.team.id, "team_ckKLAnG3MGJK0mMpIVpjbogl");
assert.equal(manifest.project.id, "prj_Nb5IcrF5Fd0xhwDoUfZPJYmwSo6L");
assert.equal(manifest.project.name, "evavo-vector-studio");
assert.equal(manifest.project.repository, "EVAVO-STUDIO/evavo-vector-studio");
assert.equal(manifest.project.rootDirectory, "apps/web");
assert.equal(manifest.project.framework, "nextjs");
assert.equal(manifest.project.nodeVersion, "22.x");
assert.equal(manifest.production.domain, "vector.evavo.com.au");
assert.equal(manifest.currentMinimumState, "project-created");
assert.equal(manifest.clientReleaseEligible, false);
assert.equal(manifest.secretValuesIncluded, false);
assert.equal(new Set(manifest.requiredEnvironmentKeys).size, 8);

requireTokens("Vercel project verifier", verifier, [
  'const MANIFEST_PATH = "ops/provider/vector-studio-vercel-project-v1.json"',
  'method: "GET"',
  'redirect: "error"',
  'cache: "no-store"',
  'flag: "wx"',
  'mode: 0o600',
  'clientReleaseEligible: false',
  'mutationAttempted: false',
  'mutationPerformed: false',
  'sensitiveValuesRecorded: false',
  'valuesRecorded: false',
  'process.env.VERCEL_TOKEN',
  '--self-test',
]);
forbidTokens("Vercel project verifier", verifier, [
  'method: "POST"',
  'method: "PUT"',
  'method: "PATCH"',
  'method: "DELETE"',
  "console.log(token)",
  "console.error(token)",
  "writeFileSync",
]);

requireTokens("Vercel project documentation", documentation, [
  "prj_Nb5IcrF5Fd0xhwDoUfZPJYmwSo6L",
  "evavo-vector-studio",
  "apps/web",
  "vector.evavo.com.au",
  "source-ready",
  "project-created",
  "release-withheld",
  "No secret values",
  "verify-vector-studio-vercel-project-v1.mjs",
]);

requireTokens("Vercel project workflow", workflow, [
  "Vector Studio Vercel project v1",
  "contents: read",
  "statuses: write",
  "node scripts/check-vector-studio-vercel-project-v1.mjs",
  "node scripts/verify-vector-studio-vercel-project-v1.mjs --self-test",
  "provider/vector-project-v1",
  "Confirm exact current main",
  "Confirm validated head remains current main",
]);
forbidTokens("Vercel project workflow", workflow, [
  "contents: write",
  "VERCEL_TOKEN:",
  "git push",
  "vercel deploy",
  "vercel --prod",
]);

console.log("Vector Studio Vercel project v1 source contract passed.");
