import { execFileSync } from "node:child_process";
import { link, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const CONTRACT_VERSION = "1.0";
const REPOSITORY = "EVAVO-STUDIO/evavo-vector-studio";
const EXPECTED_BRANCH = "main";
const SHA_PATTERN = /^[a-f0-9]{40}$/;
const MAX_RECEIPT_BYTES = 64 * 1024;

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
    if (!["--commit", "--out"].includes(argument)) {
      fail("VECTOR_MAIN_ARGUMENT_INVALID", `Unknown argument: ${argument}`);
    }
    const value = argv[index + 1];
    if (!value) fail("VECTOR_MAIN_ARGUMENT_INVALID", `${argument} requires a value.`);
    index += 1;
    if (argument === "--commit") result.commit = value.trim().toLowerCase();
    if (argument === "--out") result.out = value;
  }
  if (result.commit && !SHA_PATTERN.test(result.commit)) {
    fail("VECTOR_MAIN_COMMIT_INVALID", "--commit must be a lowercase 40-character Git SHA.");
  }
  return result;
}

function command(commandName, args) {
  try {
    return execFileSync(commandName, args, {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
    }).trim();
  } catch (error) {
    fail("VECTOR_MAIN_GIT_FAILED", `Unable to execute ${commandName} ${args.join(" ")}.`, {
      status: error && typeof error === "object" && "status" in error ? error.status : null,
    });
  }
}

function normaliseOrigin(value) {
  const trimmed = value.trim().replace(/\.git$/u, "");
  const match = trimmed.match(/github\.com[/:]([^/]+)\/([^/]+)$/iu);
  return match ? `${match[1]}/${match[2]}` : trimmed;
}

function remoteMainSha() {
  const output = command("git", ["ls-remote", "--heads", "origin", "refs/heads/main"]);
  const first = output.split(/\s+/u)[0]?.toLowerCase() ?? "";
  if (!SHA_PATTERN.test(first)) {
    fail("VECTOR_MAIN_REMOTE_INVALID", "origin did not return a canonical refs/heads/main SHA.");
  }
  return first;
}

async function atomicNewFile(target, source) {
  const absolute = path.resolve(target);
  await mkdir(path.dirname(absolute), { recursive: true });
  const temporary = `${absolute}.tmp-${process.pid}-${Date.now()}`;
  try {
    await writeFile(temporary, source, { encoding: "utf8", flag: "wx", mode: 0o600 });
    await link(temporary, absolute);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "EEXIST") {
      fail("VECTOR_MAIN_OUTPUT_EXISTS", `Exact-main receipt already exists: ${absolute}`);
    }
    throw error;
  } finally {
    await rm(temporary, { force: true });
  }
  return absolute;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const branch = command("git", ["branch", "--show-current"]);
  if (branch !== EXPECTED_BRANCH) {
    fail("VECTOR_MAIN_BRANCH_INVALID", `Expected branch ${EXPECTED_BRANCH}; observed ${branch || "detached"}.`);
  }
  const head = command("git", ["rev-parse", "HEAD"]).toLowerCase();
  if (!SHA_PATTERN.test(head)) fail("VECTOR_MAIN_HEAD_INVALID", "HEAD is not a canonical Git SHA.");
  if (options.commit && options.commit !== head) {
    fail("VECTOR_MAIN_HEAD_MISMATCH", "Requested commit does not match local HEAD.", { expected: options.commit, actual: head });
  }
  const origin = command("git", ["remote", "get-url", "origin"]);
  if (normaliseOrigin(origin).toLowerCase() !== REPOSITORY.toLowerCase()) {
    fail("VECTOR_MAIN_ORIGIN_INVALID", `Expected origin ${REPOSITORY}; observed ${origin}.`);
  }
  const status = command("git", ["status", "--porcelain=v1", "--untracked-files=all"]);
  if (status) {
    fail("VECTOR_MAIN_REPOSITORY_DIRTY", "Exact-current-main admission requires a clean tracked and untracked repository.", {
      changedEntryCount: status.split(/\r?\n/u).filter(Boolean).length,
    });
  }
  const remote = remoteMainSha();
  if (remote !== head) {
    fail("VECTOR_MAIN_REMOTE_MISMATCH", "Local HEAD is not exact current origin/main.", { localHead: head, remoteMain: remote });
  }

  const receipt = Object.freeze({
    contractVersion: CONTRACT_VERSION,
    check: "vector-exact-current-main",
    repository: REPOSITORY,
    branch,
    commit: head,
    remoteMain: remote,
    clean: true,
    networkOperation: "git-ls-remote-read-only",
    mutationAttempted: false,
    mutationPerformed: false,
    repositoryPublicationAuthority: false,
    sensitiveValuesRecorded: false,
  });
  const serialized = `${JSON.stringify(receipt, null, 2)}\n`;
  if (Buffer.byteLength(serialized, "utf8") > MAX_RECEIPT_BYTES) {
    fail("VECTOR_MAIN_RECEIPT_TOO_LARGE", "Exact-main receipt exceeded its bounded size.");
  }
  const output = options.out ? await atomicNewFile(options.out, serialized) : null;
  process.stdout.write(`${JSON.stringify({ ...receipt, output }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    error: error instanceof Error && "code" in error ? error.code : "VECTOR_MAIN_FAILED",
    message: error instanceof Error ? error.message : String(error),
    details: error instanceof Error && "details" in error ? error.details : undefined,
    sensitiveValuesRecorded: false,
  }, null, 2)}\n`);
  process.exit(1);
});
