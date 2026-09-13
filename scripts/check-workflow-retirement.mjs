import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const planPath = path.join(root, ".evavo", "workflow-retirement-plan.json");
const workflowDir = path.join(root, ".github", "workflows");

function fail(message) {
  process.stderr.write(`${JSON.stringify({
    check: "evavo-vector-studio-workflow-retirement",
    ok: false,
    error: message,
  }, null, 2)}\n`);
  process.exit(1);
}

let plan;
try {
  plan = JSON.parse(await fs.readFile(planPath, "utf8"));
} catch (error) {
  fail(`Unable to load workflow retirement plan: ${error instanceof Error ? error.message : String(error)}`);
}

if (plan.repository !== "EVAVO-STUDIO/evavo-vector-studio") fail("Retirement plan repository identity is invalid.");
if (plan.canonicalBranch !== "main") fail("Retirement plan must bind canonical branch main.");
if (plan.githubActionsRoutineAuthority !== false) fail("GitHub Actions cannot retain routine authority.");
if (plan.githubWorkflowPublicationAuthority !== false) fail("GitHub workflows cannot retain publication authority.");
if (plan.newWorkflowFilesAllowed !== false) fail("New workflow files must remain forbidden.");

let active = [];
try {
  const entries = await fs.readdir(workflowDir, { withFileTypes: true });
  active = entries
    .filter((entry) => entry.isFile() && /\.ya?ml$/u.test(entry.name))
    .map((entry) => entry.name)
    .sort();
} catch (error) {
  if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) {
    fail(`Unable to inspect workflow directory: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const allowed = new Set(Array.isArray(plan.allowedMigrationDebt) ? plan.allowedMigrationDebt : []);
const unexpected = active.filter((name) => !allowed.has(name));
if (unexpected.length > 0) fail(`Unexpected workflow files appeared during migration: ${unexpected.join(", ")}`);

if (plan.state === "retired") {
  if (active.length !== 0) fail(`Retired workflow plan requires zero active workflows; found ${active.join(", ")}`);
  if (allowed.size !== 0) fail("Retired workflow plan must have an empty allowedMigrationDebt list.");
} else if (plan.state !== "migration-pending") {
  fail(`Unsupported retirement plan state: ${String(plan.state)}`);
}

process.stdout.write(`${JSON.stringify({
  check: "evavo-vector-studio-workflow-retirement",
  ok: true,
  state: plan.state,
  activeWorkflowCount: active.length,
  activeWorkflows: active,
  allowedMigrationDebtCount: allowed.size,
  newWorkflowFilesAllowed: false,
  githubActionsRoutineAuthority: false,
  githubWorkflowPublicationAuthority: false,
}, null, 2)}\n`);
