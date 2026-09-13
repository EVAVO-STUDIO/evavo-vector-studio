import { execFileSync, spawnSync } from "node:child_process";

const CONTRACT_VERSION = "1.0";
const REPOSITORY = "EVAVO-STUDIO/evavo-vector-studio";
const EXPECTED_BRANCH = "main";
const EXPECTED_PNPM = "10.14.0";

function fail(code, message, details = undefined) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  throw error;
}

function commandOutput(command, args) {
  try {
    return execFileSync(command, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
    }).trim();
  } catch (error) {
    fail("VECTOR_READINESS_COMMAND_FAILED", `Unable to execute ${command} ${args.join(" ")}.`, {
      status: error && typeof error === "object" && "status" in error ? error.status : null,
    });
  }
}

function assertRepositoryBoundary() {
  const branch = commandOutput("git", ["branch", "--show-current"]);
  if (branch !== EXPECTED_BRANCH) {
    fail("VECTOR_READINESS_BRANCH_INVALID", `Readiness requires ${EXPECTED_BRANCH}; observed ${branch || "detached"}.`);
  }
  const status = commandOutput("git", ["status", "--porcelain=v1", "--untracked-files=all"]);
  if (status) {
    fail("VECTOR_READINESS_REPOSITORY_DIRTY", "Readiness requires a clean tracked and untracked repository boundary.");
  }
  const pnpm = commandOutput("pnpm", ["--version"]);
  if (pnpm !== EXPECTED_PNPM) {
    fail("VECTOR_READINESS_PNPM_INVALID", `Readiness requires pnpm ${EXPECTED_PNPM}; observed ${pnpm}.`);
  }
  return Object.freeze({ branch, pnpm });
}

function run(command, args, label) {
  const started = Date.now();
  process.stderr.write(`\n[${label}] ${command} ${args.join(" ")}\n`);
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.error || result.status !== 0) {
    fail("VECTOR_READINESS_STEP_FAILED", `${label} failed.`, {
      status: result.status,
      durationMs: Date.now() - started,
    });
  }
  return Object.freeze({ label, durationMs: Date.now() - started });
}

async function main() {
  const before = assertRepositoryBoundary();
  const steps = [
    run("node", ["scripts/check-repository-hygiene.mjs"], "repository hygiene"),
    run("node", ["scripts/check-test-build-isolation.mjs"], "test/build isolation"),
    run("node", ["scripts/check-lockfile-integrity.mjs"], "lockfile integrity"),
    run("node", ["scripts/check-readiness-contract.mjs"], "runtime readiness contract"),
    run("pnpm", ["install", "--frozen-lockfile"], "frozen dependency install"),
    run("pnpm", ["build:packages"], "package build"),
    run("pnpm", ["--filter", "@evavo/vector-web", "typecheck"], "Vector web typecheck"),
    run("pnpm", ["--filter", "@evavo/vector-web", "build"], "Vector web build"),
  ];
  const after = assertRepositoryBoundary();
  process.stdout.write(`${JSON.stringify({
    ok: true,
    contractVersion: CONTRACT_VERSION,
    check: "vector-studio-local-readiness",
    repository: REPOSITORY,
    branch: after.branch,
    pnpmVersion: after.pnpm,
    providerFreeExecution: true,
    githubActionsAuthority: false,
    repositoryMutationAllowed: false,
    deploymentPerformed: false,
    sensitiveValuesRecorded: false,
    steps,
    before,
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    error: error instanceof Error && "code" in error ? error.code : "VECTOR_READINESS_FAILED",
    message: error instanceof Error ? error.message : String(error),
    details: error instanceof Error && "details" in error ? error.details : undefined,
    sensitiveValuesRecorded: false,
  }, null, 2)}\n`);
  process.exit(1);
});
