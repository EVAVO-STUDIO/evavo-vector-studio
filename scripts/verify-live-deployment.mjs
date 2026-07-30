import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { link, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const CANONICAL_ORIGIN = "https://vector.evavo.com.au";
const REPOSITORY = "EVAVO-STUDIO/evavo-vector-studio";
const MAX_RESPONSE_BYTES = 4_500_000;
const MAX_PROOF_BYTES = 512 * 1024;
const REQUEST_TIMEOUT_MS = 30_000;
const LAUNCH_TOKEN_ENV = "VECTOR_DEPLOYMENT_PROOF_LAUNCH_TOKEN";
const SOURCE_PROOF_ENV = "VECTOR_DEPLOYMENT_SOURCE_PROOF";
const SHA_PATTERN = /^[a-f0-9]{40}$/;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

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
    requireLaunch: false,
    sourceProof: process.env[SOURCE_PROOF_ENV]?.trim() || null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--require-launch") {
      result.requireLaunch = true;
      continue;
    }
    if (["--origin", "--commit", "--out", "--source-proof"].includes(argument)) {
      const value = argv[index + 1];
      if (!value) fail("DEPLOYMENT_PROOF_ARGUMENT_INVALID", `${argument} requires a value.`);
      index += 1;
      if (argument === "--origin") result.origin = value;
      if (argument === "--commit") result.commit = value;
      if (argument === "--out") result.out = value;
      if (argument === "--source-proof") result.sourceProof = value;
      continue;
    }
    fail("DEPLOYMENT_PROOF_ARGUMENT_INVALID", `Unknown argument: ${argument}`);
  }
  return result;
}

function canonicalOrigin(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    fail("DEPLOYMENT_PROOF_ORIGIN_INVALID", "The deployment proof origin is not a valid URL.");
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
      "DEPLOYMENT_PROOF_ORIGIN_INVALID",
      `The live verifier accepts only ${CANONICAL_ORIGIN}.`,
    );
  }
  return CANONICAL_ORIGIN;
}

function resolveCommit(argument) {
  const candidate = argument?.trim() || process.env.VECTOR_DEPLOYMENT_PROOF_COMMIT?.trim();
  if (candidate) {
    if (!SHA_PATTERN.test(candidate)) {
      fail("DEPLOYMENT_PROOF_COMMIT_INVALID", "The deployment proof commit must be a lowercase 40-character Git SHA.");
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
      "DEPLOYMENT_PROOF_COMMIT_REQUIRED",
      "Pass --commit or set VECTOR_DEPLOYMENT_PROOF_COMMIT when Git metadata is unavailable.",
    );
  }
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function boundedHeader(value, maximum = 320) {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maximum || /[\u0000-\u001f\u007f]/.test(trimmed)) return null;
  return trimmed;
}

function sameOriginLocation(origin, rawLocation) {
  if (!rawLocation) return null;
  try {
    const url = new URL(rawLocation, origin);
    if (url.origin !== origin || url.username || url.password || url.hash) return null;
    return `${url.pathname}${url.search}`;
  } catch {
    return null;
  }
}

function setCookieHeaders(response) {
  if (typeof response.headers.getSetCookie === "function") {
    return response.headers.getSetCookie();
  }
  const combined = response.headers.get("set-cookie");
  return combined ? [combined] : [];
}

function cookieNames(values) {
  const names = new Set();
  for (const value of values) {
    const name = value.split("=", 1)[0]?.trim();
    if (name && /^[A-Za-z0-9_-]{1,80}$/.test(name)) names.add(name);
  }
  return [...names].sort();
}

function workspaceCookie(values) {
  for (const value of values) {
    const first = value.split(";", 1)[0]?.trim();
    if (first?.startsWith("__Host-evavo-vector-session=")) return first;
  }
  return null;
}

async function readBoundedBody(response, maximum = MAX_RESPONSE_BYTES) {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maximum) {
        await reader.cancel();
        fail(
          "DEPLOYMENT_PROOF_RESPONSE_TOO_LARGE",
          "A live proof response exceeded its bounded evidence limit.",
          { maximum, total },
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function decodeJson(bytes, checkId) {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    fail("DEPLOYMENT_PROOF_JSON_INVALID", `${checkId} did not return bounded valid UTF-8 JSON.`);
  }
}

async function request(origin, pathname, options = {}) {
  const started = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(new URL(pathname, origin), {
      method: options.method ?? "GET",
      headers: {
        accept: options.accept ?? "*/*",
        "accept-encoding": "identity",
        ...(options.cookie ? { cookie: options.cookie } : {}),
      },
      cache: "no-store",
      redirect: "manual",
      signal: controller.signal,
    });
    const bytes = await readBoundedBody(response, options.maximumBytes);
    const cookies = setCookieHeaders(response);
    return Object.freeze({
      response,
      bytes,
      cookies,
      durationMs: Date.now() - started,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      fail("DEPLOYMENT_PROOF_REQUEST_TIMEOUT", `The live request timed out: ${pathname}`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function checkRecord({
  id,
  category,
  requiredForRelease,
  status,
  method = "GET",
  pathname,
  result = null,
  origin,
  evidence = {},
}) {
  const contentType = result ? boundedHeader(result.response.headers.get("content-type"), 160) : null;
  return Object.freeze({
    id,
    category,
    requiredForRelease,
    status,
    method,
    path: pathname,
    httpStatus: result?.response.status ?? null,
    durationMs: result?.durationMs ?? 0,
    responseBytes: result?.bytes.byteLength ?? 0,
    responseSha256: result ? sha256(result.bytes) : null,
    contentType,
    cacheControl: result ? boundedHeader(result.response.headers.get("cache-control")) : null,
    referrerPolicy: result ? boundedHeader(result.response.headers.get("referrer-policy"), 160) : null,
    location: result ? sameOriginLocation(origin, result.response.headers.get("location")) : null,
    setCookieNames: result ? cookieNames(result.cookies) : [],
    evidence: Object.freeze(evidence),
  });
}

function passed(record) {
  return record.status === "passed";
}

async function loadSourceProof(file, commit) {
  if (!file) return Object.freeze({ passed: false, reason: "source proof was not supplied" });
  const absolute = path.resolve(file);
  let source;
  try {
    source = await readFile(absolute, "utf8");
  } catch {
    fail("DEPLOYMENT_SOURCE_PROOF_UNREADABLE", "The source proof file could not be read.");
  }
  if (Buffer.byteLength(source, "utf8") > MAX_PROOF_BYTES) {
    fail("DEPLOYMENT_SOURCE_PROOF_TOO_LARGE", "The source proof file exceeds the bounded evidence limit.");
  }
  let value;
  try {
    value = JSON.parse(source);
  } catch {
    fail("DEPLOYMENT_SOURCE_PROOF_INVALID", "The source proof file is not valid JSON.");
  }
  const valid =
    value &&
    value.version === "1.0" &&
    value.repository === REPOSITORY &&
    value.commit === commit &&
    value.frozenInstall === true &&
    value.fullCheck === true &&
    value.productionBuild === true &&
    value.sensitiveValuesRecorded === false;
  return Object.freeze({
    passed: valid,
    reason: valid ? "exact source proof accepted" : "source proof did not match the exact commit and required checks",
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
      fail("DEPLOYMENT_PROOF_OUTPUT_EXISTS", `The proof output already exists: ${absolute}`);
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
  const startedAtMs = Date.now();
  const checks = [];
  const sourceProof = await loadSourceProof(options.sourceProof, commit);

  const health = await request(origin, "/api/health", { accept: "application/json", maximumBytes: 256 * 1024 });
  const healthJson = decodeJson(health.bytes, "health");
  const healthPassed =
    health.response.status === 200 &&
    healthJson?.service === "evavo-vector-studio" &&
    healthJson?.privateApplication === true &&
    healthJson?.deployment?.profile?.hostingProfile === "vercel" &&
    healthJson?.deployment?.profile?.provider === "vercel-functions" &&
    healthJson?.deployment?.profile?.providerDirectPrivateStorageConfigured === false;
  checks.push(checkRecord({
    id: "health",
    category: "public-runtime",
    requiredForRelease: true,
    status: healthPassed ? "passed" : "failed",
    pathname: "/api/health",
    result: health,
    origin,
    evidence: {
      serviceMatched: healthJson?.service === "evavo-vector-studio",
      privateApplication: healthJson?.privateApplication === true,
      hostingProfile: typeof healthJson?.deployment?.profile?.hostingProfile === "string" ? healthJson.deployment.profile.hostingProfile : null,
      provider: typeof healthJson?.deployment?.profile?.provider === "string" ? healthJson.deployment.profile.provider : null,
      providerDirectPrivateStorageConfigured: healthJson?.deployment?.profile?.providerDirectPrivateStorageConfigured === true,
    },
  }));

  const access = await request(origin, "/access", { accept: "text/html", maximumBytes: 1024 * 1024 });
  const accessText = new TextDecoder().decode(access.bytes);
  const accessPassed =
    access.response.status === 200 &&
    (access.response.headers.get("content-type") ?? "").toLowerCase().includes("text/html") &&
    accessText.includes("Return to EVAVO hub") &&
    /noindex/i.test(accessText);
  checks.push(checkRecord({
    id: "access-page",
    category: "public-runtime",
    requiredForRelease: true,
    status: accessPassed ? "passed" : "failed",
    pathname: "/access",
    result: access,
    origin,
    evidence: {
      returnLinkPresent: accessText.includes("Return to EVAVO hub"),
      noindexPresent: /noindex/i.test(accessText),
    },
  }));

  const unauthenticatedRoot = await request(origin, "/", { accept: "text/html", maximumBytes: 256 * 1024 });
  const rootLocation = sameOriginLocation(origin, unauthenticatedRoot.response.headers.get("location"));
  checks.push(checkRecord({
    id: "private-root-redirect",
    category: "public-runtime",
    requiredForRelease: true,
    status: [302, 303, 307, 308].includes(unauthenticatedRoot.response.status) && rootLocation === "/access" ? "passed" : "failed",
    pathname: "/",
    result: unauthenticatedRoot,
    origin,
    evidence: { redirectedToAccess: rootLocation === "/access" },
  }));

  for (const [id, pathname] of [
    ["trace-capabilities", "/api/v1/trace"],
    ["motion-capabilities", "/api/v1/motion/svg"],
    ["lottie-capabilities", "/api/v1/motion/lottie"],
    ["dotlottie-capabilities", "/api/v1/motion/dotlottie"],
  ]) {
    const result = await request(origin, pathname, { accept: "application/json", maximumBytes: 512 * 1024 });
    const value = decodeJson(result.bytes, id);
    const profile = value?.hosting;
    const capabilityPassed =
      result.response.status === 200 &&
      profile?.hostingProfile === "vercel" &&
      profile?.provider === "vercel-functions" &&
      Number.isSafeInteger(profile?.maxRequestBytes) &&
      profile.maxRequestBytes <= 4_000_000 &&
      Number.isSafeInteger(profile?.maxResponseBytes) &&
      profile.maxResponseBytes <= 4_000_000 &&
      profile?.providerDirectPrivateStorageConfigured === false;
    checks.push(checkRecord({
      id,
      category: "capability",
      requiredForRelease: true,
      status: capabilityPassed ? "passed" : "failed",
      pathname,
      result,
      origin,
      evidence: {
        hostingProfile: typeof profile?.hostingProfile === "string" ? profile.hostingProfile : null,
        provider: typeof profile?.provider === "string" ? profile.provider : null,
        maxRequestBytes: Number.isSafeInteger(profile?.maxRequestBytes) ? profile.maxRequestBytes : null,
        maxFileBytes: Number.isSafeInteger(profile?.maxFileBytes) ? profile.maxFileBytes : null,
        maxResponseBytes: Number.isSafeInteger(profile?.maxResponseBytes) ? profile.maxResponseBytes : null,
      },
    }));
  }

  const token = process.env[LAUNCH_TOKEN_ENV]?.trim() || null;
  if (token && (!TOKEN_PATTERN.test(token) || token.length > 8192)) {
    fail("DEPLOYMENT_PROOF_LAUNCH_TOKEN_INVALID", `${LAUNCH_TOKEN_ENV} is malformed or oversized.`);
  }

  let sessionCookie = null;
  if (token) {
    const firstLaunch = await request(origin, `/launch?token=${encodeURIComponent(token)}`, {
      accept: "text/html",
      maximumBytes: 256 * 1024,
    });
    sessionCookie = workspaceCookie(firstLaunch.cookies);
    const firstLocation = sameOriginLocation(origin, firstLaunch.response.headers.get("location"));
    checks.push(checkRecord({
      id: "signed-launch-first-use",
      category: "signed-launch",
      requiredForRelease: true,
      status: [302, 303, 307, 308].includes(firstLaunch.response.status) && firstLocation === "/" && Boolean(sessionCookie) ? "passed" : "failed",
      pathname: "/launch",
      result: firstLaunch,
      origin,
      evidence: {
        redirectedToWorkspace: firstLocation === "/",
        workspaceCookieIssued: Boolean(sessionCookie),
      },
    }));

    const replay = await request(origin, `/launch?token=${encodeURIComponent(token)}`, {
      accept: "text/html",
      maximumBytes: 256 * 1024,
    });
    const replayLocation = sameOriginLocation(origin, replay.response.headers.get("location"));
    checks.push(checkRecord({
      id: "signed-launch-replay",
      category: "replay",
      requiredForRelease: true,
      status: [302, 303, 307, 308].includes(replay.response.status) && replayLocation === "/access?reason=used" && !workspaceCookie(replay.cookies) ? "passed" : "failed",
      pathname: "/launch",
      result: replay,
      origin,
      evidence: {
        replayRejected: replayLocation === "/access?reason=used",
        newWorkspaceCookieIssued: Boolean(workspaceCookie(replay.cookies)),
      },
    }));

    for (const [id, pathname] of [["private-workspace", "/"], ["private-motion-workspace", "/motion"]]) {
      const privateResult = await request(origin, pathname, {
        accept: "text/html",
        cookie: sessionCookie,
        maximumBytes: 2 * 1024 * 1024,
      });
      const text = new TextDecoder().decode(privateResult.bytes);
      checks.push(checkRecord({
        id,
        category: "private-workspace",
        requiredForRelease: true,
        status: privateResult.response.status === 200 && /EVAVO Vector Studio/i.test(text) ? "passed" : "failed",
        pathname,
        result: privateResult,
        origin,
        evidence: {
          workspaceRendered: /EVAVO Vector Studio/i.test(text),
          noindexPresent: /noindex/i.test(text),
        },
      }));
    }
  } else {
    for (const [id, category, pathname] of [
      ["signed-launch-first-use", "signed-launch", "/launch"],
      ["signed-launch-replay", "replay", "/launch"],
      ["private-workspace", "private-workspace", "/"],
      ["private-motion-workspace", "private-workspace", "/motion"],
    ]) {
      checks.push(checkRecord({
        id,
        category,
        requiredForRelease: true,
        status: "not-performed",
        pathname,
        origin,
        evidence: { reason: `${LAUNCH_TOKEN_ENV} was not supplied` },
      }));
    }
  }

  const publicRuntimePassed = checks
    .filter((check) => ["public-runtime", "capability"].includes(check.category))
    .every(passed);
  const signedLaunchPassed = passed(checks.find((check) => check.id === "signed-launch-first-use"));
  const replayRejectionPassed = passed(checks.find((check) => check.id === "signed-launch-replay"));
  const privateWorkspacesPassed = checks
    .filter((check) => check.category === "private-workspace")
    .every(passed);
  const clientReleaseEligible =
    sourceProof.passed &&
    publicRuntimePassed &&
    signedLaunchPassed &&
    replayRejectionPassed &&
    privateWorkspacesPassed;
  const completedAtMs = Date.now();
  const proof = Object.freeze({
    version: "1.0",
    service: "evavo-vector-studio",
    repository: REPOSITORY,
    commit,
    origin,
    startedAt: new Date(startedAtMs).toISOString(),
    completedAt: new Date(completedAtMs).toISOString(),
    durationMs: completedAtMs - startedAtMs,
    releaseDecision: Object.freeze({
      sourceChecksPassed: sourceProof.passed,
      publicRuntimePassed,
      signedLaunchPassed,
      replayRejectionPassed,
      clientReleaseEligible,
      reason: clientReleaseEligible
        ? "Exact source proof and all required live runtime checks passed; central source promotion still requires human review."
        : `Release remains withheld: ${sourceProof.reason}; public=${publicRuntimePassed}; launch=${signedLaunchPassed}; replay=${replayRejectionPassed}; private=${privateWorkspacesPassed}.`,
    }),
    checks: Object.freeze(checks),
    sensitiveValuesRecorded: false,
  });
  const serialized = `${JSON.stringify(proof, null, 2)}\n`;
  if (Buffer.byteLength(serialized, "utf8") > MAX_PROOF_BYTES) {
    fail("DEPLOYMENT_PROOF_OUTPUT_TOO_LARGE", "The bounded deployment proof exceeded its maximum size.");
  }
  if ((token && serialized.includes(token)) || (sessionCookie && serialized.includes(sessionCookie))) {
    fail("DEPLOYMENT_PROOF_SECRET_LEAK", "Sensitive launch material entered the deployment proof.");
  }
  const output = options.out ?? path.join("artifacts", "deployment-proof", `${commit}.json`);
  const written = await atomicNewFile(output, serialized);
  process.stdout.write(`${JSON.stringify({
    ok: publicRuntimePassed && (!options.requireLaunch || (signedLaunchPassed && replayRejectionPassed && privateWorkspacesPassed)),
    output: written,
    commit,
    origin,
    sourceChecksPassed: sourceProof.passed,
    publicRuntimePassed,
    signedLaunchPassed,
    replayRejectionPassed,
    clientReleaseEligible,
    sensitiveValuesRecorded: false,
  }, null, 2)}\n`);
  if (!publicRuntimePassed || (options.requireLaunch && !clientReleaseEligible)) process.exit(1);
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    error: error instanceof Error && "code" in error ? error.code : "DEPLOYMENT_PROOF_FAILED",
    message: error instanceof Error ? error.message : String(error),
    details: error instanceof Error && "details" in error ? error.details : undefined,
    sensitiveValuesRecorded: false,
  }, null, 2)}\n`);
  process.exit(1);
});
