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

const packageSource = read("package.json");
const productionWorkflow = read(
  ".github/workflows/vector-vercel-production-deployment.yml",
);
const exportWorkflow = read(".github/workflows/export-exact-source.yml");
const deployer = read("scripts/deploy-vector-studio-vercel.mjs");
const provisioner = read("scripts/provision-vector-studio-vercel.mjs");
const appVercelSource = read("apps/web/vercel.json");

const forbiddenBootstrapPaths = Object.freeze([
  "bootstrap-exact-source.sh",
  "scripts/bootstrap-exact-source.sh",
  "apps/web/bootstrap-exact-source.sh",
]);
for (const relativePath of forbiddenBootstrapPaths) {
  if (fs.existsSync(path.join(root, relativePath))) {
    errors.push(`Retired manual Vercel bootstrap path returned: ${relativePath}`);
  }
}

for (const [label, source] of [
  ["root package", packageSource],
  ["exact production workflow", productionWorkflow],
  ["exact source export workflow", exportWorkflow],
  ["Vercel deployer", deployer],
  ["Vercel provisioner", provisioner],
  ["web Vercel config", appVercelSource],
]) {
  if (source.includes("bootstrap-exact-source.sh")) {
    errors.push(`${label} references the retired manual bootstrap deployment path.`);
  }
}

for (const token of [
  "workflow_dispatch:",
  "node scripts/deploy-vector-studio-vercel.mjs",
  "Create or reuse exact production deployment and prove readiness",
]) {
  if (!productionWorkflow.includes(token)) {
    errors.push(`Exact production workflow is missing governed deployer token: ${token}`);
  }
}

for (const token of [
  "git archive --format=zip",
  "COMMIT_SHA",
  "SHA256SUMS",
]) {
  if (!exportWorkflow.includes(token)) {
    errors.push(`Exact source export is missing tracked-source token: ${token}`);
  }
}

for (const token of [
  'const PROJECT_ID = "prj_Nb5IcrF5Fd0xhwDoUfZPJYmwSo6L"',
  "/v13/deployments?forceNew=1&skipAutoDetectionConfirmation=1",
  'target: "production"',
  'ref: "main"',
  "githubCommitSha: commit",
]) {
  if (!deployer.includes(token)) {
    errors.push(`Direct Vercel deployer is missing exact-source token: ${token}`);
  }
}

if (!provisioner.includes('deploymentPerformed: false')) {
  errors.push("Project provisioner must remain separate from production deployment authority.");
}

let appVercel = null;
try {
  appVercel = JSON.parse(appVercelSource || "{}");
} catch {
  errors.push("apps/web/vercel.json must remain valid JSON.");
}
if (appVercel?.git?.deploymentEnabled !== false) {
  errors.push("Vector Studio Git deployment creation must remain closed at rest.");
}

let packageJson = null;
try {
  packageJson = JSON.parse(packageSource || "{}");
} catch {
  errors.push("package.json must remain valid JSON.");
}
if (
  packageJson?.scripts?.["vercel-bootstrap-retirement:check"] !==
  "node scripts/check-vercel-bootstrap-retirement.mjs"
) {
  errors.push("package.json must expose vercel-bootstrap-retirement:check.");
}
if (
  !String(packageJson?.scripts?.check ?? "").includes(
    "pnpm vercel-bootstrap-retirement:check",
  )
) {
  errors.push("The aggregate check must execute vercel-bootstrap-retirement:check.");
}

if (errors.length > 0) {
  process.stderr.write(
    `${JSON.stringify(
      {
        check: "vector-studio-vercel-bootstrap-retirement",
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
      check: "vector-studio-vercel-bootstrap-retirement",
      ok: true,
      contractVersion: "1.0",
      historicalBootstrapDeploymentSupported: false,
      exactSourceArchiveIsDeploymentAuthority: false,
      exactCommitApiDeploymentRequired: true,
      gitDeploymentCreationEnabled: false,
      providerMutationPerformed: false,
      networkRequestPerformed: false,
    },
    null,
    2,
  )}\n`,
);
