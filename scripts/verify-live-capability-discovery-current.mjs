import { createHash } from "node:crypto";
import { link, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const CONTRACT_VERSION = "1.0";
const REPOSITORY = "EVAVO-STUDIO/evavo-vector-studio";
const ORIGIN = "https://vector.evavo.com.au";
const ENDPOINT = "/api/v1/capabilities";
const SOURCE_PROOF_ENV = "VECTOR_DEPLOYMENT_SOURCE_PROOF";
const MAX_RESPONSE_BYTES = 512 * 1024;
const MAX_PROOF_BYTES = 256 * 1024;
const MAX_RECEIPT_BYTES = 256 * 1024;
const SHA_PATTERN = /^[a-f0-9]{40}$/u;
const REQUEST_TIMEOUT_MS = 30_000;
const PROHIBITED_BODY_TOKENS = Object.freeze([
  "EVAVO_CLIENT_APP_LAUNCH_SECRET",
  "EVAVO_VECTOR_PRIVATE_SIGNING_SECRET",
  "UPSTASH_REDIS_REST_TOKEN",
  "VECTOR_API_TOKEN",
  "VECTOR_WORKER_API_TOKEN",
  "authorization: bearer",
]);

function fail(code, message, details = undefined) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  throw error;
}

function parseArgs(argv) {
  const options = { commit: null, out: null, sourceProof: process.env[SOURCE_PROOF_ENV]?.trim() || null };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!["--commit", "--out", "--source-proof"].includes(argument)) fail("LIVE_CAPABILITIES_CURRENT_ARGUMENT_INVALID", `Unknown argument: ${argument}`);
    const value = argv[index + 1];
    if (!value) fail("LIVE_CAPABILITIES_CURRENT_ARGUMENT_INVALID", `${argument} requires a value.`);
    index += 1;
    if (argument === "--commit") options.commit = value.trim().toLowerCase();
    if (argument === "--out") options.out = value;
    if (argument === "--source-proof") options.sourceProof = value;
  }
  if (!options.commit || !SHA_PATTERN.test(options.commit)) fail("LIVE_CAPABILITIES_CURRENT_COMMIT_INVALID", "Pass the exact lowercase 40-character deployment commit.");
  if (!options.out) fail("LIVE_CAPABILITIES_CURRENT_OUTPUT_REQUIRED", "Pass a create-only --out receipt path.");
  if (!options.sourceProof) fail("LIVE_CAPABILITIES_CURRENT_SOURCE_PROOF_REQUIRED", "Pass --source-proof or VECTOR_DEPLOYMENT_SOURCE_PROOF.");
  return options;
}

async function boundedBody(response) {
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
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        fail("LIVE_CAPABILITIES_CURRENT_RESPONSE_TOO_LARGE", "Capability response exceeded its bounded limit.");
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

async function loadSourceProof(file, commit) {
  const source = await readFile(path.resolve(file), "utf8");
  if (Buffer.byteLength(source, "utf8") > MAX_PROOF_BYTES) fail("LIVE_CAPABILITIES_CURRENT_SOURCE_PROOF_TOO_LARGE", "Source proof exceeded its bounded limit.");
  let value;
  try { value = JSON.parse(source); } catch { fail("LIVE_CAPABILITIES_CURRENT_SOURCE_PROOF_INVALID", "Source proof is not valid JSON."); }
  const valid = value?.version === "1.0" && value?.repository === REPOSITORY && value?.commit === commit && value?.frozenInstall === true && value?.fullCheck === true && value?.productionBuild === true && value?.sensitiveValuesRecorded === false;
  if (!valid) fail("LIVE_CAPABILITIES_CURRENT_SOURCE_PROOF_MISMATCH", "Source proof does not bind the exact commit and required source checks.");
  return Object.freeze({ accepted: true, commit });
}

function headerIncludes(headers, name, token) {
  return String(headers.get(name) ?? "").toLowerCase().includes(token.toLowerCase());
}

async function requestCapabilities() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(new URL(ENDPOINT, ORIGIN), {
      method: "GET",
      headers: { accept: "application/json", "accept-encoding": "identity" },
      cache: "no-store",
      redirect: "error",
      signal: controller.signal,
    });
    const bytes = await boundedBody(response);
    if (response.status !== 200) fail("LIVE_CAPABILITIES_CURRENT_HTTP_FAILED", `Capability endpoint returned ${response.status}.`);
    if (!headerIncludes(response.headers, "content-type", "application/json")) fail("LIVE_CAPABILITIES_CURRENT_CONTENT_TYPE_INVALID", "Capability endpoint must return JSON.");
    if (!headerIncludes(response.headers, "cache-control", "no-store")) fail("LIVE_CAPABILITIES_CURRENT_CACHE_INVALID", "Capability endpoint must be no-store.");
    if (response.headers.get("x-vector-private-response-contract") !== "1.0") fail("LIVE_CAPABILITIES_CURRENT_PRIVATE_RESPONSE_INVALID", "Capability endpoint must retain private-response contract 1.0.");
    return Object.freeze({ response, bytes });
  } finally {
    clearTimeout(timeout);
  }
}

function validateDocument(document) {
  if (!document || typeof document !== "object" || Array.isArray(document)) fail("LIVE_CAPABILITIES_CURRENT_DOCUMENT_INVALID", "Capability document must be an object.");
  const checks = Object.freeze({
    service: document.service?.name === "evavo-vector-studio",
    capabilityContract: document.service?.capabilitiesContractVersion === "1.0",
    discovery: document.discovery?.endpoint === ENDPOINT && document.discovery?.sensitiveValuesIncluded === false && document.discovery?.generatedBodiesIncluded === false,
    mcpContract: document.interfaces?.mcp?.contractVersion === "1.6",
    mcpToolCount: document.interfaces?.mcp?.toolCount === 16,
    mcpTransport: document.interfaces?.mcp?.transport === "stdio",
    providerQueueNonClaim: document.deploymentBoundaries?.providerQueueDelivery === false,
    managedExecutionNonClaim: document.deploymentBoundaries?.managedRemoteExecution === false,
    autoscalingNonClaim: document.deploymentBoundaries?.distributedAutoscaling === false,
    machineCompletionNotApproval: document.approval?.machineCompletionIsProductionApproval === false,
    autoApprovalUnavailable: document.approval?.productionAutoApprovalAvailable === false,
    humanReview: document.approval?.state === "human-review-required",
  });
  const failed = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
  if (failed.length) fail("LIVE_CAPABILITIES_CURRENT_DOCUMENT_MISMATCH", `Capability document failed current governed fields: ${failed.join(", ")}.`);
  return checks;
}

async function atomicNewFile(target, source) {
  const absolute = path.resolve(target);
  await mkdir(path.dirname(absolute), { recursive: true });
  const temporary = `${absolute}.tmp-${process.pid}-${Date.now()}`;
  try {
    await writeFile(temporary, source, { encoding: "utf8", flag: "wx", mode: 0o600 });
    await link(temporary, absolute);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "EEXIST") fail("LIVE_CAPABILITIES_CURRENT_OUTPUT_EXISTS", `Capability proof already exists: ${absolute}`);
    throw error;
  } finally {
    await rm(temporary, { force: true });
  }
  return absolute;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const sourceProof = await loadSourceProof(options.sourceProof, options.commit);
  const { response, bytes } = await requestCapabilities();
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const lower = text.toLowerCase();
  for (const token of PROHIBITED_BODY_TOKENS) {
    if (lower.includes(token.toLowerCase())) fail("LIVE_CAPABILITIES_CURRENT_SENSITIVE_BODY", `Capability response contains prohibited material: ${token}.`);
  }
  let document;
  try { document = JSON.parse(text); } catch { fail("LIVE_CAPABILITIES_CURRENT_JSON_INVALID", "Capability response is not valid UTF-8 JSON."); }
  const checks = validateDocument(document);
  const receipt = Object.freeze({
    contractVersion: CONTRACT_VERSION,
    check: "vector-live-capability-discovery-current",
    repository: REPOSITORY,
    commit: options.commit,
    origin: ORIGIN,
    endpoint: ENDPOINT,
    status: response.status,
    responseBytes: bytes.byteLength,
    responseSha256: createHash("sha256").update(bytes).digest("hex"),
    sourceProof,
    serviceVersion: document.service?.version ?? null,
    mcpContractVersion: document.interfaces?.mcp?.contractVersion ?? null,
    mcpToolCount: document.interfaces?.mcp?.toolCount ?? null,
    checks,
    responseBodyRecorded: false,
    sensitiveValuesRecorded: false,
  });
  const serialized = `${JSON.stringify(receipt, null, 2)}\n`;
  if (Buffer.byteLength(serialized, "utf8") > MAX_RECEIPT_BYTES) fail("LIVE_CAPABILITIES_CURRENT_RECEIPT_TOO_LARGE", "Capability receipt exceeded its bounded size.");
  const output = await atomicNewFile(options.out, serialized);
  process.stdout.write(`${JSON.stringify({ ok: true, output, commit: options.commit, mcpContractVersion: receipt.mcpContractVersion, mcpToolCount: receipt.mcpToolCount, responseBodyRecorded: false, sensitiveValuesRecorded: false }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({ ok: false, error: error instanceof Error && "code" in error ? error.code : "LIVE_CAPABILITIES_CURRENT_FAILED", message: error instanceof Error ? error.message : String(error), details: error instanceof Error && "details" in error ? error.details : undefined, responseBodyRecorded: false, sensitiveValuesRecorded: false }, null, 2)}\n`);
  process.exit(1);
});
