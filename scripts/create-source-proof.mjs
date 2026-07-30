import { execFileSync, spawnSync } from "node:child_process";
import { link, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const REPOSITORY = "EVAVO-STUDIO/evavo-vector-studio";
const MAX_PROOF_BYTES = 256 * 1024;
const SHA_PATTERN = /^[a-f0-9]{40}$/;

function fail(code, message, details = undefined) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  throw error;
}

function parseArgs(argv) {
  const result = { commit: null, out: null };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--commit" || argument === "--out") {
      const value = argv[index + 1];
      if (!value) fail("SOURCE_PROOF_ARGUMENT_INVALID", `${argument} requires a value.`);
      index += 1;
      if (argument === "--commit") result.commit = value;
      if (argument === "--out") result.out = value;
      continue;
    }
    fail("SOURCE_PROOF_ARGUMENT_INVALID", `Unknown argument: ${argument}`);
  }
  return result;
}

function commandOutput(command, args) {
  try {
    return execFileSync(command, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (error) {
    fail(
      "SOURCE_PROOF_COMMAND_FAILED",
      `Unable to execute ${command} ${args.join(" ")}.`,
      { status: error && typeof error === "object" && "status" in error ? error.status : null },
    );
  }
}

function currentCommit(expected) {
  const head = commandOutput("git", ["rev-parse", "HEAD"]).toLowerCase();
  if (!SHA_PATTERN.test(head)) fail("SOURCE_PROOF_COMMIT_INVALID", "Git did not return a canonical commit SHA.");
  if (expected) {
    const normalized = expected.trim().toLowerCase();
    if (!SHA_PATTERN.test(normalized) || normalized !== head) {
      fail("SOURCE_PROOF_COMMIT_MISMATCH", "The requested source-proof commit does not match checked-out HEAD.", {
        expected: normalized,
        actual: head,
      });
    }
  }
  return head;
}

function assertCleanRepository() {
  const tracked = commandOutput("git", ["status", "--porcelain=v1", "--untracked-files=all"]);
  if (tracked) {
    fail(
      "SOURCE_PROOF_REPOSITORY_DIRTY",
      "Source proof generation requires a clean checkout with no tracked or untracked changes.",
      { changedEntryCount: tracked.split(/\r?\n/).filter(Boolean).length },
    );
  }
}

function runChecked(command, args, label) {
  const started = Date.now();
  process.stderr.write(`\n[${label}] ${command} ${args.join(" ")}\n`);
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  const durationMs = Date.now() - started;
  if (result.error || result.status !== 0) {
    fail("SOURCE_PROOF_VERIFICATION_FAILED", `${label} failed.`, {
      command: `${command} ${args.join(" ")}`,
      status: result.status,
      durationMs,
    });
  }
  return Object.freeze({
    command: `${command} ${args.join(" ")}`,
    status: "passed",
    durationMs,
  });
}

async function atomicNewFile(target, source) {
  const absolute = path.resolve(target);
  await mkdir(path.dirname(absolute), { recursive: true });
  const temporary = `${absolute}.tmp-${process.pid}-${Date.now()}`;
  try {
    await writeFile(temporary, source, { encoding: "utf8", flag: "wx" });
    await link(temporary, absolute);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "EEXIST") {
      fail("SOURCE_PROOF_OUTPUT_EXISTS", `The source proof output already exists: ${absolute}`);
    }
    throw error;
  } finally {
    await rm(temporary, { force: true });
  }
  return absolute;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  assertCleanRepository();
  const commit = currentCommit(options.commit);
  const nodeVersion = process.version;
  if (!/^v(?:2[2-9]|[3-9][0-9])\.[0-9]+\.[0-9]+$/.test(nodeVersion)) {
    fail("SOURCE_PROOF_NODE_VERSION_INVALID", "Source proof requires Node.js 22 or newer.", { nodeVersion });
  }
  const pnpmVersion = commandOutput("pnpm", ["--version"]);
  if (pnpmVersion !== "10.14.0") {
    fail("SOURCE_PROOF_PNPM_VERSION_INVALID", "Source proof requires pnpm 10.14.0.", { pnpmVersion });
  }

  const startedAtMs = Date.now();
  const commands = [
    runChecked("pnpm", ["install", "--frozen-lockfile"], "frozen install"),
    runChecked("pnpm", ["check"], "complete repository check"),
    runChecked("pnpm", ["--filter", "@evavo/vector-web", "build"], "private web production build"),
  ];
  assertCleanRepository();
  const completedAtMs = Date.now();
  const proof = Object.freeze({
    version: "1.0",
    repository: REPOSITORY,
    commit,
    nodeVersion,
    pnpmVersion,
    startedAt: new Date(startedAtMs).toISOString(),
    completedAt: new Date(completedAtMs).toISOString(),
    durationMs: completedAtMs - startedAtMs,
    frozenInstall: true,
    fullCheck: true,
    productionBuild: true,
    commands: Object.freeze(commands),
    sensitiveValuesRecorded: false,
  });
  const serialized = `${JSON.stringify(proof, null, 2)}\n`;
  if (Buffer.byteLength(serialized, "utf8") > MAX_PROOF_BYTES) {
    fail("SOURCE_PROOF_OUTPUT_TOO_LARGE", "The bounded source proof exceeded its maximum size.");
  }
  const output = options.out ?? path.join("artifacts", "source-proof", `${commit}.json`);
  const written = await atomicNewFile(output, serialized);
  process.stdout.write(`${JSON.stringify({
    ok: true,
    output: written,
    commit,
    frozenInstall: true,
    fullCheck: true,
    productionBuild: true,
    sensitiveValuesRecorded: false,
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    error: error instanceof Error && "code" in error ? error.code : "SOURCE_PROOF_FAILED",
    message: error instanceof Error ? error.message : String(error),
    details: error instanceof Error && "details" in error ? error.details : undefined,
    sensitiveValuesRecorded: false,
  }, null, 2)}\n`);
  process.exit(1);
});
