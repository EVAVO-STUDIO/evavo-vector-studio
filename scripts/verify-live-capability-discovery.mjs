import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { link, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const CONTRACT_VERSION = "1.0";
const REPOSITORY = "EVAVO-STUDIO/evavo-vector-studio";
const PRODUCTION_ORIGIN = "https://vector.evavo.com.au";
const CAPABILITIES_PATH = "/api/v1/capabilities";
const SOURCE_PROOF_ENV = "VECTOR_DEPLOYMENT_SOURCE_PROOF";
const MAX_RESPONSE_BYTES = 512 * 1024;
const MAX_SOURCE_PROOF_BYTES = 256 * 1024;
const MAX_RECEIPT_BYTES = 256 * 1024;
const REQUEST_TIMEOUT_MS = 30_000;
const SHA_PATTERN = /^[a-f0-9]{40}$/;
const SEMVER_PATTERN = /^\d+\.\d+\.\d+$/;

const EXPECTED_TOP_LEVEL_KEYS = Object.freeze([
  "approval",
  "automation",
  "deploymentBoundaries",
  "discovery",
  "dotLottie",
  "interfaces",
  "lottie",
  "motion",
  "raster",
  "service",
]);
const EXPECTED_DELIVERY_PROFILES = Object.freeze([
  "editable",
  "web",
  "motion",
  "print",
]);
const EXPECTED_STABLE_ID_PROFILES = Object.freeze(["editable", "motion"]);
const EXPECTED_WORKER_OPERATIONS = Object.freeze([
  "trace-raster",
  "optimise-svg",
  "animate-svg",
  "export-lottie",
  "package-dotlottie",
]);
const REQUIRED_ROBOTS_TOKENS = Object.freeze([
  "noindex",
  "nofollow",
  "noarchive",
  "nosnippet",
  "noimageindex",
]);
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
  const result = { commit: null, out: null, selfTest: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--self-test") {
      result.selfTest = true;
      continue;
    }
    if (!["--commit", "--out"].includes(argument)) {
      fail("LIVE_CAPABILITIES_ARGUMENT_INVALID", `Unknown argument: ${argument}`);
    }
    const value = argv[index + 1];
    if (!value) fail("LIVE_CAPABILITIES_ARGUMENT_INVALID", `${argument} requires a value.`);
    index += 1;
    if (argument === "--commit") result.commit = value;
    if (argument === "--out") result.out = value;
  }
  if (!result.selfTest && (!result.commit || !SHA_PATTERN.test(result.commit))) {
    fail(
      "LIVE_CAPABILITIES_COMMIT_INVALID",
      "Pass the exact lowercase 40-character deployment commit with --commit.",
    );
  }
  return result;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, expected, label) {
  if (!isPlainObject(value)) {
    fail("LIVE_CAPABILITIES_DOCUMENT_INVALID", `${label} must be a JSON object.`);
  }
  const actual = Object.keys(value).sort();
  const canonical = [...expected].sort();
  if (
    actual.length !== canonical.length ||
    actual.some((item, index) => item !== canonical[index])
  ) {
    fail(
      "LIVE_CAPABILITIES_DOCUMENT_INVALID",
      `${label} contains an unexpected field set.`,
      { label, actual, expected: canonical },
    );
  }
}

function exactArray(value, expected, label) {
  if (
    !Array.isArray(value) ||
    value.length !== expected.length ||
    value.some((item, index) => item !== expected[index])
  ) {
    fail(
      "LIVE_CAPABILITIES_DOCUMENT_INVALID",
      `${label} does not match the governed ordered values.`,
      { label, expected },
    );
  }
}

function requireValue(condition, label, actual = undefined) {
  if (!condition) {
    fail(
      "LIVE_CAPABILITIES_DOCUMENT_INVALID",
      `The live capability document failed ${label}.`,
      actual === undefined ? { label } : { label, actual },
    );
  }
}

function capabilityEvidence(document, expectedVersion) {
  exactKeys(document, EXPECTED_TOP_LEVEL_KEYS, "capability document");
  requireValue(document.service?.name === "evavo-vector-studio", "service identity", document.service?.name);
  requireValue(document.service?.version === expectedVersion, "service version", document.service?.version);
  requireValue(
    document.service?.capabilitiesContractVersion === "1.0",
    "capability contract version",
    document.service?.capabilitiesContractVersion,
  );

  requireValue(document.discovery?.endpoint === CAPABILITIES_PATH, "discovery endpoint", document.discovery?.endpoint);
  requireValue(
    document.discovery?.authentication === "public non-sensitive capability metadata",
    "non-sensitive discovery authentication declaration",
    document.discovery?.authentication,
  );
  requireValue(document.discovery?.cache === "no-store", "discovery cache declaration", document.discovery?.cache);
  requireValue(document.discovery?.generatedBodiesIncluded === false, "generated-body exclusion");
  requireValue(document.discovery?.sensitiveValuesIncluded === false, "sensitive-value exclusion");

  requireValue(document.interfaces?.browser?.traceWorkspace === "/", "trace workspace route");
  requireValue(document.interfaces?.browser?.motionDirector === "/motion", "motion workspace route");
  requireValue(document.interfaces?.api?.trace === "/api/v1/trace", "trace API route");
  requireValue(document.interfaces?.api?.workerControl === "/api/v1/worker", "worker API route");
  requireValue(document.interfaces?.mcp?.transport === "stdio", "MCP transport");
  requireValue(document.interfaces?.mcp?.contractVersion === "1.5", "MCP contract version");
  requireValue(document.interfaces?.mcp?.toolCount === 15, "MCP tool count", document.interfaces?.mcp?.toolCount);
  requireValue(document.interfaces?.mcp?.generatedBodiesInModelContext === false, "MCP body exclusion");

  requireValue(document.raster?.contractVersion === "1.4", "raster contract version");
  requireValue(document.raster?.inputPolicy === "one-static-image-per-trace", "static raster policy");
  exactArray(document.raster?.deliveryProfiles, EXPECTED_DELIVERY_PROFILES, "raster delivery profiles");
  exactArray(document.raster?.stableIdProfiles, EXPECTED_STABLE_ID_PROFILES, "stable-ID profiles");
  requireValue(document.raster?.defaultDeliveryProfile === "editable", "default delivery profile");
  requireValue(document.raster?.alphaAwareAnalysis === true, "alpha-aware analysis");
  requireValue(document.raster?.visibleContentBounds === true, "visible content bounds");
  requireValue(document.raster?.safetyRollbackEvidence === true, "safety rollback evidence");
  requireValue(document.raster?.renderComparison === "alpha-aware-multi-scale", "render comparison policy");

  requireValue(document.motion?.contractVersion === "1.0", "motion contract version");
  requireValue(document.motion?.output === "script-free-css-animated-svg", "motion output boundary");
  requireValue(document.motion?.reducedMotionFallbackRequired === true, "reduced-motion fallback");
  requireValue(document.motion?.existingAnimationRejected === true, "existing animation rejection");

  requireValue(document.lottie?.contractVersion === "1.0", "Lottie contract version");
  requireValue(document.lottie?.shapeLayersOnly === true, "Lottie shape-layer subset");
  requireValue(document.lottie?.playerRenderValidationAvailable === false, "Lottie render non-claim");
  requireValue(document.dotLottie?.contractVersion === "1.0", "dotLottie contract version");
  requireValue(document.dotLottie?.manifestVersion === "2", "dotLottie manifest version");
  requireValue(document.dotLottie?.deterministicArchive === true, "deterministic dotLottie archive");
  requireValue(document.dotLottie?.browserArchiveLoadValidationAvailable === true, "browser archive load evidence");
  requireValue(document.dotLottie?.playerRenderValidationAvailable === false, "dotLottie render non-claim");

  requireValue(document.automation?.durableBatch?.contractVersion === "1.0", "batch contract version");
  requireValue(document.automation?.durableBatch?.maximumLocalItems === 1_000, "local batch ceiling");
  requireValue(document.automation?.durableBatch?.maximumMcpItems === 100, "MCP batch ceiling");
  requireValue(document.automation?.durableBatch?.persistentState === true, "persistent batch state");
  requireValue(document.automation?.durableBatch?.resumable === true, "batch resumability");
  requireValue(
    document.automation?.durableBatch?.completedOutputReverification === true,
    "completed-output re-verification",
  );
  requireValue(
    document.automation?.durableBatch?.existingOutputsOverwritten === false,
    "batch no-overwrite boundary",
  );
  exactArray(
    document.automation?.durableBatch?.deliveryProfiles,
    EXPECTED_DELIVERY_PROFILES,
    "batch delivery profiles",
  );

  requireValue(document.automation?.worker?.contractVersion === "1.0", "worker contract version");
  exactArray(document.automation?.worker?.operations, EXPECTED_WORKER_OPERATIONS, "worker operations");
  requireValue(document.automation?.worker?.immutableSourceHashVerification === true, "worker source hash verification");
  requireValue(document.automation?.worker?.atomicObjectTransactions === true, "worker object transactions");
  requireValue(
    document.automation?.worker?.generatedBodiesInControlResponses === false,
    "worker control body exclusion",
  );

  requireValue(document.deploymentBoundaries?.synchronousProductionRoutes === true, "synchronous routes");
  requireValue(document.deploymentBoundaries?.localWorkerExecution === true, "local worker availability");
  requireValue(document.deploymentBoundaries?.httpCoordinatedWorkerExecution === true, "HTTP worker availability");
  requireValue(document.deploymentBoundaries?.providerQueueDelivery === false, "provider queue non-claim");
  requireValue(document.deploymentBoundaries?.managedRemoteExecution === false, "managed execution non-claim");
  requireValue(document.deploymentBoundaries?.distributedAutoscaling === false, "autoscaling non-claim");
  requireValue(
    document.deploymentBoundaries?.signedHubLaunch === "deployment-and-configuration-dependent",
    "signed launch boundary",
  );

  requireValue(document.approval?.machineCompletionIsProductionApproval === false, "approval separation");
  requireValue(document.approval?.productionAutoApprovalAvailable === false, "auto-approval non-claim");
  requireValue(document.approval?.state === "human-review-required", "human review state");

  return Object.freeze({
    serviceVersion: document.service.version,
    capabilitiesContractVersion: document.service.capabilitiesContractVersion,
    mcpContractVersion: document.interfaces.mcp.contractVersion,
    mcpToolCount: document.interfaces.mcp.toolCount,
    rasterContractVersion: document.raster.contractVersion,
    motionContractVersion: document.motion.contractVersion,
    lottieContractVersion: document.lottie.contractVersion,
    dotLottieContractVersion: document.dotLottie.contractVersion,
    batchContractVersion: document.automation.durableBatch.contractVersion,
    maximumLocalBatchItems: document.automation.durableBatch.maximumLocalItems,
    maximumMcpBatchItems: document.automation.durableBatch.maximumMcpItems,
    workerContractVersion: document.automation.worker.contractVersion,
    workerOperationCount: document.automation.worker.operations.length,
    deliveryProfiles: Object.freeze([...document.raster.deliveryProfiles]),
    providerQueueDelivery: document.deploymentBoundaries.providerQueueDelivery,
    managedRemoteExecution: document.deploymentBoundaries.managedRemoteExecution,
    distributedAutoscaling: document.deploymentBoundaries.distributedAutoscaling,
    approvalState: document.approval.state,
  });
}

function headerEvidence(headers) {
  const contentType = (headers.get("content-type") ?? "").toLowerCase();
  const cacheControl = (headers.get("cache-control") ?? "").toLowerCase();
  const robots = (headers.get("x-robots-tag") ?? "").toLowerCase();
  const vary = (headers.get("vary") ?? "").toLowerCase();
  requireValue(contentType.includes("application/json"), "JSON content type", contentType);
  requireValue(cacheControl.includes("no-store"), "no-store response cache", cacheControl);
  requireValue(headers.get("x-content-type-options") === "nosniff", "nosniff response header");
  requireValue(
    headers.get("x-vector-private-response-contract") === "1.0",
    "private response contract header",
  );
  requireValue(headers.get("referrer-policy") === "no-referrer", "no-referrer policy");
  requireValue(headers.get("x-frame-options") === "DENY", "frame denial");
  requireValue(REQUIRED_ROBOTS_TOKENS.every((token) => robots.includes(token)), "robots exclusion", robots);
  requireValue(["authorization", "cookie", "origin"].every((token) => vary.includes(token)), "vary boundary", vary);
  return Object.freeze({
    contentType,
    cacheControl,
    privateResponseContract: headers.get("x-vector-private-response-contract"),
    referrerPolicy: headers.get("referrer-policy"),
    frameOptions: headers.get("x-frame-options"),
    robots,
    vary,
  });
}

async function readBoundedResponse(response) {
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
        fail(
          "LIVE_CAPABILITIES_RESPONSE_TOO_LARGE",
          "The live capability response exceeded its bounded limit.",
          { maximumBytes: MAX_RESPONSE_BYTES },
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

async function expectedServiceVersion() {
  const source = await readFile("package.json", "utf8");
  const value = JSON.parse(source);
  if (!SEMVER_PATTERN.test(String(value?.version ?? ""))) {
    fail("LIVE_CAPABILITIES_LOCAL_VERSION_INVALID", "The local package version is not canonical semantic version text.");
  }
  return value.version;
}

async function sourceProofEvidence(commit) {
  const configured = String(process.env[SOURCE_PROOF_ENV] ?? "").trim();
  if (!configured) {
    fail(
      "LIVE_CAPABILITIES_SOURCE_PROOF_REQUIRED",
      `${SOURCE_PROOF_ENV} must reference the exact source proof used for deployment.`,
    );
  }
  const absolute = path.resolve(configured);
  const information = await stat(absolute);
  if (!information.isFile() || information.size < 2 || information.size > MAX_SOURCE_PROOF_BYTES) {
    fail(
      "LIVE_CAPABILITIES_SOURCE_PROOF_INVALID",
      "The source proof must be a bounded regular JSON file.",
      { bytes: information.size, maximumBytes: MAX_SOURCE_PROOF_BYTES },
    );
  }
  const bytes = await readFile(absolute);
  let proof;
  try {
    proof = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    fail("LIVE_CAPABILITIES_SOURCE_PROOF_INVALID", "The source proof is not valid strict UTF-8 JSON.");
  }
  if (
    proof?.version !== "1.0" ||
    proof?.repository !== REPOSITORY ||
    proof?.commit !== commit ||
    proof?.frozenInstall !== true ||
    proof?.fullCheck !== true ||
    proof?.productionBuild !== true ||
    proof?.sensitiveValuesRecorded !== false
  ) {
    fail(
      "LIVE_CAPABILITIES_SOURCE_PROOF_MISMATCH",
      "The source proof does not bind this exact checked and built commit.",
    );
  }
  return Object.freeze({
    path: absolute,
    bytes: bytes.byteLength,
    sha256: sha256(bytes),
    commit: proof.commit,
    frozenInstall: true,
    fullCheck: true,
    productionBuild: true,
  });
}

async function requestCapabilities() {
  const url = new URL(CAPABILITIES_PATH, PRODUCTION_ORIGIN);
  let response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: {
        accept: "application/json",
        "accept-encoding": "identity",
      },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    fail(
      "LIVE_CAPABILITIES_REQUEST_FAILED",
      "The live capability discovery request failed before a usable response.",
      { cause: error instanceof Error ? error.name : "REQUEST_FAILED" },
    );
  }
  const bytes = await readBoundedResponse(response);
  if (response.status !== 200) {
    fail(
      "LIVE_CAPABILITIES_HTTP_FAILED",
      "The live capability discovery endpoint did not return HTTP 200.",
      { status: response.status },
    );
  }
  const headers = headerEvidence(response.headers);
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const lower = text.toLowerCase();
  for (const token of PROHIBITED_BODY_TOKENS) {
    if (lower.includes(token.toLowerCase())) {
      fail(
        "LIVE_CAPABILITIES_SENSITIVE_MATERIAL",
        "The live capability response contains prohibited sensitive or authority material.",
        { token },
      );
    }
  }
  let document;
  try {
    document = JSON.parse(text);
  } catch {
    fail("LIVE_CAPABILITIES_JSON_INVALID", "The live capability response is not valid JSON.");
  }
  return Object.freeze({ bytes, headers, document });
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
      fail("LIVE_CAPABILITIES_OUTPUT_EXISTS", `The live capability proof already exists: ${absolute}`);
    }
    throw error;
  } finally {
    await rm(temporary, { force: true });
  }
  return absolute;
}

async function writeReceipt(options, receipt) {
  const serialized = `${JSON.stringify(receipt, null, 2)}\n`;
  if (Buffer.byteLength(serialized, "utf8") > MAX_RECEIPT_BYTES) {
    fail("LIVE_CAPABILITIES_RECEIPT_TOO_LARGE", "The bounded live capability proof exceeded its limit.");
  }
  const target = options.out ?? path.join("artifacts", "live-capabilities", `${options.commit}.json`);
  return atomicNewFile(target, serialized);
}

function sampleDocument(version = "0.4.0") {
  return {
    service: { name: "evavo-vector-studio", version, capabilitiesContractVersion: "1.0" },
    discovery: {
      endpoint: CAPABILITIES_PATH,
      authentication: "public non-sensitive capability metadata",
      cache: "no-store",
      generatedBodiesIncluded: false,
      sensitiveValuesIncluded: false,
    },
    interfaces: {
      browser: { traceWorkspace: "/", motionDirector: "/motion" },
      api: { trace: "/api/v1/trace", workerControl: "/api/v1/worker" },
      mcp: { transport: "stdio", contractVersion: "1.5", toolCount: 15, generatedBodiesInModelContext: false },
    },
    raster: {
      contractVersion: "1.4",
      inputPolicy: "one-static-image-per-trace",
      deliveryProfiles: [...EXPECTED_DELIVERY_PROFILES],
      stableIdProfiles: [...EXPECTED_STABLE_ID_PROFILES],
      defaultDeliveryProfile: "editable",
      alphaAwareAnalysis: true,
      visibleContentBounds: true,
      safetyRollbackEvidence: true,
      renderComparison: "alpha-aware-multi-scale",
    },
    motion: {
      contractVersion: "1.0",
      output: "script-free-css-animated-svg",
      reducedMotionFallbackRequired: true,
      existingAnimationRejected: true,
    },
    lottie: { contractVersion: "1.0", shapeLayersOnly: true, playerRenderValidationAvailable: false },
    dotLottie: {
      contractVersion: "1.0",
      manifestVersion: "2",
      deterministicArchive: true,
      browserArchiveLoadValidationAvailable: true,
      playerRenderValidationAvailable: false,
    },
    automation: {
      durableBatch: {
        contractVersion: "1.0",
        maximumLocalItems: 1_000,
        maximumMcpItems: 100,
        persistentState: true,
        resumable: true,
        completedOutputReverification: true,
        existingOutputsOverwritten: false,
        deliveryProfiles: [...EXPECTED_DELIVERY_PROFILES],
      },
      worker: {
        contractVersion: "1.0",
        operations: [...EXPECTED_WORKER_OPERATIONS],
        immutableSourceHashVerification: true,
        atomicObjectTransactions: true,
        generatedBodiesInControlResponses: false,
      },
    },
    deploymentBoundaries: {
      synchronousProductionRoutes: true,
      localWorkerExecution: true,
      httpCoordinatedWorkerExecution: true,
      providerQueueDelivery: false,
      managedRemoteExecution: false,
      distributedAutoscaling: false,
      signedHubLaunch: "deployment-and-configuration-dependent",
    },
    approval: {
      machineCompletionIsProductionApproval: false,
      productionAutoApprovalAvailable: false,
      state: "human-review-required",
    },
  };
}

async function runSelfTest() {
  const evidence = capabilityEvidence(sampleDocument(), "0.4.0");
  assert.equal(evidence.mcpToolCount, 15);
  assert.equal(evidence.maximumMcpBatchItems, 100);
  assert.equal(evidence.managedRemoteExecution, false);

  const invalid = sampleDocument();
  invalid.deploymentBoundaries.managedRemoteExecution = true;
  assert.throws(
    () => capabilityEvidence(invalid, "0.4.0"),
    (error) => error?.code === "LIVE_CAPABILITIES_DOCUMENT_INVALID",
  );

  const headers = new Headers({
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store, max-age=0",
    "x-content-type-options": "nosniff",
    "x-vector-private-response-contract": "1.0",
    "referrer-policy": "no-referrer",
    "x-frame-options": "DENY",
    "x-robots-tag": "noindex, nofollow, noarchive, nosnippet, noimageindex",
    vary: "authorization, cookie, origin",
  });
  assert.equal(headerEvidence(headers).privateResponseContract, "1.0");

  process.stdout.write(`${JSON.stringify({
    ok: true,
    check: "vector-studio-live-capability-discovery-self-test",
    contractVersion: CONTRACT_VERSION,
    mutationPerformed: false,
    responseBodyRecorded: false,
    sensitiveValuesRecorded: false,
  }, null, 2)}\n`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.selfTest) {
    await runSelfTest();
    return;
  }

  const startedAtMs = Date.now();
  const expectedVersion = await expectedServiceVersion();
  const sourceProof = await sourceProofEvidence(options.commit);
  const response = await requestCapabilities();
  const capabilities = capabilityEvidence(response.document, expectedVersion);
  const completedAtMs = Date.now();

  const receipt = Object.freeze({
    version: CONTRACT_VERSION,
    check: "vector-studio-live-capability-discovery",
    repository: REPOSITORY,
    commit: options.commit,
    origin: PRODUCTION_ORIGIN,
    endpoint: CAPABILITIES_PATH,
    startedAt: new Date(startedAtMs).toISOString(),
    completedAt: new Date(completedAtMs).toISOString(),
    durationMs: completedAtMs - startedAtMs,
    passed: true,
    sourceProof: Object.freeze({
      bytes: sourceProof.bytes,
      sha256: sourceProof.sha256,
      exactCommit: sourceProof.commit === options.commit,
      frozenInstall: sourceProof.frozenInstall,
      fullCheck: sourceProof.fullCheck,
      productionBuild: sourceProof.productionBuild,
    }),
    response: Object.freeze({
      status: 200,
      bytes: response.bytes.byteLength,
      sha256: sha256(response.bytes),
      headers: response.headers,
    }),
    capabilities,
    mutationPerformed: false,
    responseBodyRecorded: false,
    sensitiveValuesRecorded: false,
  });
  const output = await writeReceipt(options, receipt);
  process.stdout.write(`${JSON.stringify({
    ok: true,
    output,
    commit: options.commit,
    sourceProofBound: true,
    responseSha256: receipt.response.sha256,
    capabilitiesContractVersion: capabilities.capabilitiesContractVersion,
    mcpToolCount: capabilities.mcpToolCount,
    maximumMcpBatchItems: capabilities.maximumMcpBatchItems,
    approvalState: capabilities.approvalState,
    mutationPerformed: false,
    responseBodyRecorded: false,
    sensitiveValuesRecorded: false,
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    error: error instanceof Error && "code" in error ? error.code : "LIVE_CAPABILITIES_FAILED",
    message: error instanceof Error ? error.message : String(error),
    details: error instanceof Error && "details" in error ? error.details : undefined,
    mutationPerformed: false,
    responseBodyRecorded: false,
    sensitiveValuesRecorded: false,
  }, null, 2)}\n`);
  process.exit(1);
});
