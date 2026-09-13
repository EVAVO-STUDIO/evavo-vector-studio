import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const errors = [];

function read(relativePath) {
  const absolute = path.join(root, relativePath);
  if (!fs.existsSync(absolute)) {
    errors.push(`Missing required deployment source: ${relativePath}`);
    return "";
  }
  return fs.readFileSync(absolute, "utf8").replace(/^\uFEFF/u, "");
}

function requireAbsent(relativePath) {
  if (fs.existsSync(path.join(root, relativePath))) errors.push(`Retired deployment path returned: ${relativePath}`);
}

function deploymentPolicyClosedAtRest(value) {
  if (value === false) return Object.freeze({ closed: true, mode: "boolean-disabled" });
  if (!value || typeof value !== "object" || Array.isArray(value)) return Object.freeze({ closed: false, mode: "invalid" });
  const entries = Object.entries(value);
  const allBranchesDisabled = entries.length > 0 && entries.every(([, enabled]) => enabled === false);
  const canonicalBranchDisabled = value.main === false;
  const wildcardDisabled = value["*"] === false || value["**/*"] === false;
  return Object.freeze({ closed: allBranchesDisabled && canonicalBranchDisabled && wildcardDisabled, mode: "branch-map" });
}

assert.equal(deploymentPolicyClosedAtRest(false).closed, true);
assert.equal(deploymentPolicyClosedAtRest({ "*": false, main: false }).closed, true);
assert.equal(deploymentPolicyClosedAtRest({ "*": false, main: true }).closed, false);
assert.equal(deploymentPolicyClosedAtRest({ main: false }).closed, false);

const packageSource = read("package.json");
const deployer = read("scripts/deploy-vector-studio-vercel.mjs");
const provisioner = read("scripts/provision-vector-studio-vercel.mjs");
const appVercelSource = read("apps/web/vercel.json");

for (const relativePath of [
  "bootstrap-exact-source.sh",
  "scripts/bootstrap-exact-source.sh",
  "apps/web/bootstrap-exact-source.sh",
  ".github/workflows/export-exact-source.yml",
]) requireAbsent(relativePath);

for (const [label, source] of [["root package", packageSource], ["Vercel deployer", deployer], ["Vercel provisioner", provisioner], ["web Vercel config", appVercelSource]]) {
  if (source.includes("bootstrap-exact-source.sh")) errors.push(`${label} references retired manual bootstrap deployment.`);
  if (source.includes(".github/workflows/export-exact-source.yml")) errors.push(`${label} references retired exact-source workflow.`);
}

for (const token of [
  'const PROJECT_ID = "prj_Nb5IcrF5Fd0xhwDoUfZPJYmwSo6L"',
  '/v13/deployments?forceNew=1&skipAutoDetectionConfirmation=1',
  'target: "production"',
  'ref: "main"',
  "githubCommitSha: commit",
  'const APPLY_CONFIRMATION = "deploy-evavo-vector-studio"',
  '"plan"',
  '"apply"',
  "sensitiveValuesRecorded: false",
]) {
  if (!deployer.includes(token)) errors.push(`Direct Vercel deployer is missing exact-source token: ${token}`);
}

if (!provisioner.includes("deploymentPerformed: false")) errors.push("Project provisioner must remain separate from production deployment authority.");

let appVercel = null;
try { appVercel = JSON.parse(appVercelSource || "{}"); } catch { errors.push("apps/web/vercel.json must remain valid JSON."); }
const deploymentPolicy = deploymentPolicyClosedAtRest(appVercel?.git?.deploymentEnabled);
if (!deploymentPolicy.closed) errors.push("Vector Studio Git deployment creation must remain closed at rest for main and wildcard refs.");

let packageJson = null;
try { packageJson = JSON.parse(packageSource || "{}"); } catch { errors.push("package.json must remain valid JSON."); }
if (packageJson?.scripts?.["vercel-bootstrap-retirement:check"] !== "node scripts/check-vercel-bootstrap-retirement.mjs") errors.push("package.json must expose vercel-bootstrap-retirement:check.");
if (!String(packageJson?.scripts?.check ?? "").includes("pnpm vercel-bootstrap-retirement:check")) errors.push("Aggregate check must execute vercel-bootstrap-retirement:check.");

if (errors.length > 0) {
  process.stderr.write(`${JSON.stringify({ check: "vector-studio-vercel-bootstrap-retirement", ok: false, contractVersion: "2.0", errors }, null, 2)}\n`);
  process.exit(1);
}
process.stdout.write(`${JSON.stringify({
  check: "vector-studio-vercel-bootstrap-retirement",
  ok: true,
  contractVersion: "2.0",
  historicalBootstrapDeploymentSupported: false,
  exactSourceArchiveIsDeploymentAuthority: false,
  retiredExactSourceWorkflowAbsent: true,
  exactCommitApiDeploymentRequired: true,
  gitDeploymentCreationEnabled: false,
  gitDeploymentPolicyMode: deploymentPolicy.mode,
  canonicalMainDeploymentDisabled: true,
  wildcardDeploymentDisabled: true,
  providerMutationPerformed: false,
  networkRequestPerformed: false,
}, null, 2)}\n`);
