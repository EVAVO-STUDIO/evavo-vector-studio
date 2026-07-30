import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { link, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const CANONICAL_ORIGIN = "https://vector.evavo.com.au";
const REPOSITORY = "EVAVO-STUDIO/evavo-vector-studio";
const CONTRACT_VERSION = "1.0";
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_PROOF_BYTES = 256 * 1024;
const SHA_PATTERN = /^[a-f0-9]{40}$/;

const EXPECTED_COMMON_HEADERS = Object.freeze({
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-resource-policy": "same-origin",
  "origin-agent-cluster": "?1",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()",
  "referrer-policy": "no-referrer",
  "strict-transport-security": "max-age=63072000; includeSubDomains",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "x-vector-private-response-contract": CONTRACT_VERSION,
});

const EXPECTED_ROBOT_TOKENS = Object.freeze([
  "noindex",
  "nofollow",
  "noarchive",
  "nosnippet",
  "noimageindex",
]);

const REQUIRED_VARY_TOKENS = Object.freeze(["authorization", "cookie", "origin"]);
const REQUIRED_CACHE_DIRECTIVES = Object.freeze(["no-store", "max-age=0"]);

const PROBES = Object.freeze([
  Object.freeze({
    id: "access-page",
    path: "/access",
    api: false,
    statuses: Object.freeze([200]),
  }),
  Object.freeze({
    id: "private-root-redirect",
    path: "/",
    api: false,
    statuses: Object.freeze([302, 303, 307, 308]),
    location: "/access",
  }),
  Object.freeze({
    id: "private-motion-redirect",
    path: "/motion",
    api: false,
    statuses: Object.freeze([302, 303, 307, 308]),
    location: "/access",
  }),
  Object.freeze({
    id: "health-api",
    path: "/api/health",
    api: true,
    statuses: Object.freeze([200]),
  }),
  Object.freeze({
    id: "trace-capability-api",
    path: "/api/v1/trace",
    api: true,
    statuses: Object.freeze([200]),
  }),
  Object.freeze({
    id: "worker-control-api",
    path: "/api/v1/worker",
    api: true,
    statuses: Object.freeze([200, 401, 403, 503]),
  }),
]);

function fail(code, message, details = undefined) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  throw error;
}

function parseArgs(argv) {
  const result = {
    origin: CANONICAL_ORIGIN,
    commit: null,
    out: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!["--origin", "--commit", "--out"].includes(argument)) {
      fail("PRIVATE_RESPONSE_PROOF_ARGUMENT_INVALID", `Unknown argument: ${argument}`);
    }
    const value = argv[index + 1];
    if (!value) fail("PRIVATE_RESPONSE_PROOF_ARGUMENT_INVALID", `${argument} requires a value.`);
    index += 1;
    if (argument === "--origin") result.origin = value;
    if (argument === "--commit") result.commit = value;
    if (argument === "--out") result.out = value;
  }
  return result;
}

function canonicalOrigin(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    fail("PRIVATE_RESPONSE_PROOF_ORIGIN_INVALID", "The live proof origin is not a valid URL.");
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== "vector.evavo.com.au" ||
    url.port ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    fail(
      "PRIVATE_RESPONSE_PROOF_ORIGIN_INVALID",
      `The live private-response verifier accepts only ${CANONICAL_ORIGIN}.`,
    );
  }
  return CANONICAL_ORIGIN;
}

function resolveCommit(argument) {
  const candidate = argument?.trim() || process.env.VECTOR_DEPLOYMENT_PROOF_COMMIT?.trim();
  if (candidate) {
    if (!SHA_PATTERN.test(candidate)) {
      fail(
        "PRIVATE_RESPONSE_PROOF_COMMIT_INVALID",
        "The live private-response proof commit must be a lowercase 40-character Git SHA.",
      );
    }
    return candidate;
  }
  try {
    const head = execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim().toLowerCase();
    if (!SHA_PATTERN.test(head)) throw new Error("invalid Git output");
    return head;
  } catch {
    fail(
      "PRIVATE_RESPONSE_PROOF_COMMIT_REQUIRED",
      "Pass --commit or set VECTOR_DEPLOYMENT_PROOF_COMMIT when Git metadata is unavailable.",
    );
  }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function boundedHeader(value, maximum = 1024) {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maximum || /[\u0000-\u001f\u007f]/.test(trimmed)) return null;
  return trimmed;
}

function splitHeaderTokens(value) {
  return new Set(
    String(value ?? "")
      .split(",")
      .map((token) => token.trim().toLowerCase())
      .filter(Boolean),
  );
}

function sameOriginLocation(origin, value) {
  if (!value) return null;
  try {
    const url = new URL(value, origin);
    if (url.origin !== origin || url.username || url.password || url.hash) return null;
    return `${url.pathname}${url.search}`;
  } catch {
    return null;
  }
}

function setCookieNames(response) {
  const values = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : response.headers.get("set-cookie")
      ? [response.headers.get("set-cookie")]
      : [];
  return [...new Set(values
    .map((value) => value?.split("=", 1)[0]?.trim())
    .filter((value) => value && /^[A-Za-z0-9_-]{1,80}$/.test(value)))]
    .sort();
}

async function request(origin, probe) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const started = Date.now();
  try {
    const response = await fetch(new URL(probe.path, origin), {
      method: "GET",
      headers: {
        accept: probe.api ? "application/json" : "text/html",
        "accept-encoding": "identity",
      },
      cache: "no-store",
      redirect: "manual",
      signal: controller.signal,
    });
    if (response.body) await response.body.cancel();
    return Object.freeze({ response, durationMs: Date.now() - started });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      fail("PRIVATE_RESPONSE_PROOF_REQUEST_TIMEOUT", `The live request timed out: ${probe.path}`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function inspectProbe(origin, probe, result) {
  const failures = [];
  const observed = {};

  if (!probe.statuses.includes(result.response.status)) {
    failures.push(`unexpected HTTP status ${result.response.status}`);
  }

  for (const [name, expected] of Object.entries(EXPECTED_COMMON_HEADERS)) {
    const actual = boundedHeader(result.response.headers.get(name));
    observed[name] = actual;
    if (actual !== expected) failures.push(`${name} did not match the private-response contract`);
  }

  const robotTokens = splitHeaderTokens(result.response.headers.get("x-robots-tag"));
  observed["x-robots-tag"] = boundedHeader(result.response.headers.get("x-robots-tag"));
  for (const token of EXPECTED_ROBOT_TOKENS) {
    if (!robotTokens.has(token)) failures.push(`x-robots-tag is missing ${token}`);
  }

  const varyTokens = splitHeaderTokens(result.response.headers.get("vary"));
  observed.vary = boundedHeader(result.response.headers.get("vary"));
  for (const token of REQUIRED_VARY_TOKENS) {
    if (!varyTokens.has(token)) failures.push(`vary is missing ${token}`);
  }

  observed["cache-control"] = boundedHeader(result.response.headers.get("cache-control"));
  if (probe.api) {
    const cacheTokens = splitHeaderTokens(result.response.headers.get("cache-control"));
    for (const directive of REQUIRED_CACHE_DIRECTIVES) {
      if (!cacheTokens.has(directive)) failures.push(`cache-control is missing ${directive}`);
    }
  }

  const location = sameOriginLocation(origin, result.response.headers.get("location"));
  if (probe.location && location !== probe.location) {
    failures.push(`redirect location was ${location ?? "invalid"}, expected ${probe.location}`);
  }

  const cookieNames = setCookieNames(result.response);
  if (cookieNames.includes("__Host-evavo-vector-session")) {
    failures.push("an unauthenticated proof request unexpectedly received a workspace session cookie");
  }

  return Object.freeze({
    id: probe.id,
    path: probe.path,
    api: probe.api,
    status: failures.length === 0 ? "passed" : "failed",
    httpStatus: result.response.status,
    durationMs: result.durationMs,
    location,
    setCookieNames: cookieNames,
    headers: Object.freeze(observed),
    failures: Object.freeze(failures),
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
      fail("PRIVATE_RESPONSE_PROOF_OUTPUT_EXISTS", `The proof output already exists: ${absolute}`);
    }
    throw error;
  } finally {
    await rm(temporary, { force: true });
  }
  return absolute;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const origin = canonicalOrigin(options.origin);
  const commit = resolveCommit(options.commit);
  const startedAt = new Date().toISOString();
  const checks = [];

  for (const probe of PROBES) {
    checks.push(inspectProbe(origin, probe, await request(origin, probe)));
  }

  const passed = checks.every((check) => check.status === "passed");
  const proof = Object.freeze({
    version: "1.0",
    proof: "evavo-vector-live-private-response",
    repository: REPOSITORY,
    commit,
    origin,
    contractVersion: CONTRACT_VERSION,
    startedAt,
    completedAt: new Date().toISOString(),
    passed,
    checks: Object.freeze(checks),
    sensitiveValuesRecorded: false,
  });
  const serialized = `${JSON.stringify(proof, null, 2)}\n`;
  if (Buffer.byteLength(serialized, "utf8") > MAX_PROOF_BYTES) {
    fail("PRIVATE_RESPONSE_PROOF_OUTPUT_TOO_LARGE", "The bounded live private-response proof exceeded its maximum size.");
  }

  const output = options.out ?? path.join("artifacts", "deployment-proof", `${commit}.private-response.json`);
  const written = await atomicNewFile(output, serialized);
  process.stdout.write(`${JSON.stringify({
    ok: passed,
    output: written,
    commit,
    origin,
    contractVersion: CONTRACT_VERSION,
    checksPassed: checks.filter((check) => check.status === "passed").length,
    checksTotal: checks.length,
    proofSha256: sha256(serialized),
    sensitiveValuesRecorded: false,
  }, null, 2)}\n`);
  if (!passed) process.exit(1);
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    error: error instanceof Error && "code" in error ? error.code : "PRIVATE_RESPONSE_PROOF_FAILED",
    message: error instanceof Error ? error.message : String(error),
    details: error instanceof Error && "details" in error ? error.details : undefined,
    sensitiveValuesRecorded: false,
  }, null, 2)}\n`);
  process.exit(1);
});
