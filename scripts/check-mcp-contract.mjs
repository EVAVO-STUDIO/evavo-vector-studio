import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const errors = [];
const checkedFiles = new Set();
const MCP_CONTRACT_VERSION = "1.5";

function fail(message) {
  errors.push(message);
}

async function read(relativePath) {
  checkedFiles.add(relativePath);
  try {
    return (await fs.readFile(path.join(root, relativePath), "utf8")).replace(/^\uFEFF/, "");
  } catch (error) {
    fail(`Missing or unreadable file: ${relativePath} (${error instanceof Error ? error.message : String(error)})`);
    return "";
  }
}

async function readJson(relativePath) {
  const source = await read(relativePath);
  if (!source) return null;
  try {
    return JSON.parse(source);
  } catch (error) {
    fail(`Invalid JSON: ${relativePath} (${error instanceof Error ? error.message : String(error)})`);
    return null;
  }
}

function requireTokens(relativePath, source, tokens) {
  for (const token of tokens) {
    if (!source.includes(token)) fail(`${relativePath} is missing MCP contract token: ${token}`);
  }
}

function forbidTokens(relativePath, source, tokens) {
  for (const token of tokens) {
    if (source.includes(token)) fail(`${relativePath} contains prohibited MCP contract token: ${token}`);
  }
}

const files = {
  rootPackage: "package.json",
  mcpPackage: "packages/mcp/package.json",
  index: "packages/mcp/src/index.ts",
  server: "packages/mcp/src/server.ts",
  operations: "packages/mcp/src/operations.ts",
  lottieTools: "packages/mcp/src/lottie-tools.ts",
  dotLottieTools: "packages/mcp/src/dotlottie-tools.ts",
  batchTools: "packages/mcp/src/batch-tools.ts",
  errors: "packages/mcp/src/errors.ts",
  pathPolicy: "packages/mcp/src/path-policy.ts",
  transaction: "packages/mcp/src/file-transaction.ts",
  pathTests: "packages/mcp/src/path-policy.test.ts",
  transactionTests: "packages/mcp/src/file-transaction.test.ts",
  serverTests: "packages/mcp/src/server.test.ts",
  serverBatchTests: "packages/mcp/src/server-batch.test.ts",
  batchToolTests: "packages/mcp/src/batch-tools.test.ts",
  docs: "docs/MCP.md",
  deliveryDocs: "docs/DELIVERY-PROFILES.md",
  batchDocs: "docs/BATCH.md",
  lottieDocs: "docs/LOTTIE.md",
  dotLottieDocs: "docs/DOTLOTTIE.md",
  readme: "README.md",
  environment: ".env.example",
};
const sources = Object.fromEntries(
  await Promise.all(Object.entries(files).map(async ([key, relativePath]) => [key, await read(relativePath)])),
);
const rootPackage = await readJson(files.rootPackage);
const mcpPackage = await readJson(files.mcpPackage);

if (mcpPackage?.version !== rootPackage?.version) {
  fail(`MCP package version ${String(mcpPackage?.version)} does not match root ${String(rootPackage?.version)}.`);
}
for (const [dependency, expected] of Object.entries({
  "@modelcontextprotocol/sdk": "1.30.0",
  zod: "3.25.76",
  "@evavo/motion-engine": "workspace:*",
  "@evavo/lottie-engine": "workspace:*",
  "@evavo/job-engine": "workspace:*",
  "@evavo/vector-jobs": "workspace:*",
})) {
  if (mcpPackage?.dependencies?.[dependency] !== expected) {
    fail(`packages/mcp dependency ${dependency} must equal ${expected}.`);
  }
}
if (mcpPackage?.bin?.["evavo-vector-mcp"] !== "./dist/index.js") {
  fail("packages/mcp must expose the evavo-vector-mcp binary.");
}
for (const [script, expected] of Object.entries({
  "mcp:check": "node scripts/check-mcp-contract.mjs",
  "vector:mcp:build": "turbo run build --filter=@evavo/vector-mcp",
  "vector:mcp": "pnpm vector:mcp:build && node packages/mcp/dist/index.js",
})) {
  if (rootPackage?.scripts?.[script] !== expected) fail(`package.json script ${script} must equal: ${expected}`);
}
if (!String(rootPackage?.scripts?.["build:packages"] ?? "").includes("--filter=@evavo/vector-mcp")) {
  fail("package.json build:packages must build @evavo/vector-mcp.");
}
if (!String(rootPackage?.scripts?.check ?? "").includes("pnpm mcp:check")) {
  fail("package.json check must include the dependency-free MCP contract gate.");
}

const toolNames = [
  "vector_capabilities",
  "vector_input_policy",
  "vector_inspect_raster",
  "vector_trace_raster",
  "vector_inspect_svg",
  "vector_optimise_svg",
  "vector_validate_motion_plan",
  "vector_animate_svg",
  "vector_inspect_animated_svg",
  "vector_export_lottie",
  "vector_inspect_lottie",
  "vector_package_dotlottie",
  "vector_inspect_dotlottie",
  "vector_run_batch",
  "vector_inspect_batch",
];

requireTokens(files.index, sources.index, [
  "@modelcontextprotocol/sdk/server/stdio.js",
  "new StdioServerTransport()",
  "await server.connect(transport)",
  "process.stderr.write",
]);
forbidTokens(files.index, sources.index, ["process.stdout", "console.log("]);

requireTokens(files.server, sources.server, [
  'VECTOR_MCP_SERVER_CONTRACT_VERSION = "1.5"',
  "new McpServer(",
  "structuredContent: payload",
  "isError: true",
  "extra.signal",
  'const deliveryProfileSchema = z.enum(["editable", "web", "motion", "print"]).optional()',
  "stableIdPrefixSchema",
  "deliveryProfile: deliveryProfileSchema",
  "stableIdPrefix: stableIdPrefixSchema",
  "Tracing and optimisation support editable, web, motion and print delivery profiles",
  "registerVectorMcpLottieTools",
  "registerVectorMcpDotLottieTools",
  "registerVectorMcpBatchTools",
  "extendVectorMcpCapabilities",
  "extendVectorMcpDotLottieCapabilities",
  "extendVectorMcpBatchCapabilities",
  "lottieOperations",
  "dotLottieOperations",
  "batchOperations",
  ...toolNames.slice(0, 9).map((name) => `"${name}"`),
]);
forbidTokens(files.server, sources.server, [
  "z.any()",
  "z.unknown().optional(),\n        deliveryProfile",
  'approval: "approved"',
]);

requireTokens(files.operations, sources.operations, [
  'VECTOR_MCP_CONTRACT_VERSION = "1.2"',
  'transport: "stdio"',
  'outputMode: "new-files-only"',
  "atomicMultiFileCommit: true",
  "commitNewVectorFiles",
  "RasterDeliveryProfile",
  "resolveDeliveryOptions",
  'deliveryProfile: result.evidence.output.deliveryProfile',
  "stablePathIdCount: result.evidence.output.stablePathIdCount",
  "optimiseSvg(source, delivery)",
  "includeDifferenceArtifact: Boolean(resolvedDifferencePath)",
  'evidenceLevel === "full"',
  "validateAnimatedSvgMotionSpec",
  "createAnimatedSvg(source, plan.normalized)",
  "inspectAnimatedSvg(source)",
  "alphaAwareAnalysis: true",
  "deliveryProfiles: Object.freeze([\"editable\", \"web\", \"motion\", \"print\"])",
  "responsiveWebSvg: true",
  "motionReadySvg: true",
  "printSafeSvg: true",
  'approval: "human-review-required"',
]);
forbidTokens(files.operations, sources.operations, [
  "svg: result.svg",
  "differencePng: result.artifacts.differencePng",
  'approval: "approved"',
]);

requireTokens(files.lottieTools, sources.lottieTools, [
  'VECTOR_MCP_PUBLIC_CONTRACT_VERSION = "1.2"',
  '"vector_export_lottie"',
  '"vector_inspect_lottie"',
  "createVectorMcpLottieOperations",
  "registerVectorMcpLottieTools",
  "createLottieFromSvgMotion",
  "inspectLottie",
  "commitNewVectorFiles",
  'mimeType: "video/lottie+json"',
  "modelContextIncludesGeneratedJson: false",
  "playerRenderValidation: false",
  "VECTOR_MCP_LOTTIE_OUTPUT_TOO_LARGE",
]);
forbidTokens(files.lottieTools, sources.lottieTools, [
  "json: result.json",
  "animation: result.animation",
  'playerRenderValidation: "passed"',
  'approval: "approved"',
]);

requireTokens(files.dotLottieTools, sources.dotLottieTools, [
  'VECTOR_MCP_DOTLOTTIE_CONTRACT_VERSION = "1.3"',
  '"vector_package_dotlottie"',
  '"vector_inspect_dotlottie"',
  "createVectorMcpDotLottieOperations",
  "registerVectorMcpDotLottieTools",
  "createDotLottiePackage",
  "inspectDotLottie",
  "commitNewVectorFiles",
  "modelContextIncludesArchiveBytes: false",
  "modelContextIncludesEmbeddedJson: false",
  "archiveInspection: true",
  "embeddedLottieInspection: true",
  "playerRenderValidation: false",
  "browserArchiveLoadValidation: false",
]);
forbidTokens(files.dotLottieTools, sources.dotLottieTools, [
  "archiveBytes: result.bytes",
  "bytes: result.bytes",
  "lottieJson: input.source",
  'playerRenderValidation: "passed"',
  'browserArchiveLoadValidation: "passed"',
  'approval: "approved"',
]);

requireTokens(files.batchTools, sources.batchTools, [
  'VECTOR_MCP_BATCH_CONTRACT_VERSION = "1.0"',
  "VECTOR_MCP_BATCH_MAX_ITEMS = 100",
  '"vector_run_batch"',
  '"vector_inspect_batch"',
  "createVectorMcpBatchOperations",
  "registerVectorMcpBatchTools",
  "extendVectorMcpBatchCapabilities",
  "runDurableBatch",
  "inspectDurableBatch",
  "createVectorBatchOperationRegistry",
  "extra.signal",
  "pathPolicy.roots",
  "itemOffset",
  "itemLimit",
  "eventLimit",
  "generatedBodiesInModelContext: false",
  "hostedBackgroundQueue: false",
]);
forbidTokens(files.batchTools, sources.batchTools, [
  "pathPolicy.allowedRoots",
  "svg: result.svg",
  "differencePng: result",
  "archiveBytes: result",
  'hostedBackgroundQueue: true',
  'approval: "approved"',
]);

requireTokens(files.errors, sources.errors, [
  "BatchEngineError",
  "LottieEngineError",
  "MotionEngineError",
  "RasterRuntimeGuardError",
  "VectorMcpPathError",
  "VectorMcpFileCommitError",
  '"VECTOR_MCP_OPERATION_FAILED"',
]);
requireTokens(files.pathPolicy, sources.pathPolicy, [
  'VECTOR_MCP_ALLOWED_ROOTS_ENV = "VECTOR_MCP_ALLOWED_ROOTS"',
  "await realpath(absolute)",
  '"VECTOR_MCP_PATH_OUTSIDE_ROOT"',
  '"VECTOR_MCP_OUTPUT_EXISTS"',
]);
requireTokens(files.transaction, sources.transaction, [
  "await link(item.temporaryPath, item.targetPath)",
  'flag: "wx"',
  "...committed.map((item) => rm(item.targetPath, { force: true }))",
  'createHash("sha256")',
]);
requireTokens(files.pathTests, sources.pathTests, ["VECTOR_MCP_PATH_OUTSIDE_ROOT", "VECTOR_MCP_OUTPUT_EXISTS", "symlink"]);
requireTokens(files.transactionTests, sources.transactionTests, ["rolls back files already committed", "returns byte and SHA-256 receipts"]);

requireTokens(files.serverTests, sources.serverTests, [
  "InMemoryTransport.createLinkedPair()",
  "await client.listTools()",
  "VECTOR_MCP_BATCH_TOOL_NAMES",
  "VECTOR_MCP_SERVER_CONTRACT_VERSION",
  'name: "vector_capabilities"',
  'name: "vector_inspect_svg"',
  'name: "vector_animate_svg"',
  'name: "vector_export_lottie"',
  'name: "vector_package_dotlottie"',
  "doesNotMatch(JSON.stringify(payload), /<svg",
  'doesNotMatch(JSON.stringify(payload), /"layers"',
  "assert.doesNotMatch(JSON.stringify(payload), /UEsDB/)",
  '"VECTOR_MCP_INPUT_NOT_FOUND"',
  '"VECTOR_MCP_OUTPUT_EXISTS"',
]);
requireTokens(files.serverBatchTests, sources.serverBatchTests, [
  "InMemoryTransport.createLinkedPair()",
  "VECTOR_MCP_BATCH_CONTRACT_VERSION",
  "VECTOR_MCP_BATCH_MAX_ITEMS",
  "VECTOR_MCP_BATCH_TOOL_NAMES",
  'name: "vector_run_batch"',
  'name: "vector_inspect_batch"',
  "itemOffset",
  "itemLimit",
  "eventLimit",
  "item-reused",
  '"VECTOR_MCP_BATCH_TOO_LARGE"',
  "doesNotMatch(JSON.stringify(firstPayload), /<svg",
]);
requireTokens(files.batchToolTests, sources.batchToolTests, ["AbortController", "VECTOR_MCP_CANCELLED", "retryable", ".evavo-vector-jobs", 'error.code === "ENOENT"']);

requireTokens(files.docs, sources.docs, [
  "MCP contract version `1.5`",
  "editable master",
  "web compact",
  "motion ready",
  "print safe",
  "deliveryProfile",
  "stableIdPrefix",
  "vector_trace_raster",
  "vector_animate_svg",
  "vector_export_lottie",
  "vector_package_dotlottie",
  "vector_run_batch",
  "vector_inspect_batch",
  "100 items",
  "paginated",
  "hosted background queue",
  "VECTOR_MCP_ALLOWED_ROOTS",
  "generated Lottie JSON",
  "generated dotLottie archive bytes",
  "Human review",
]);
requireTokens(files.deliveryDocs, sources.deliveryDocs, [
  "# Vector delivery profiles",
  "alpha-aware",
  "editable",
  "web",
  "motion",
  "print",
  "stable path IDs",
  "safety rollback",
  "human review",
]);
requireTokens(files.batchDocs, sources.batchDocs, ["MCP contract `1.5`", "vector_run_batch", "vector_inspect_batch", "100 items", "itemOffset", "itemLimit", "eventLimit", "not a hosted background queue"]);
requireTokens(files.lottieDocs, sources.lottieDocs, ["vector_export_lottie", "vector_inspect_lottie", "playerRenderValidation: not-yet-performed"]);
requireTokens(files.dotLottieDocs, sources.dotLottieDocs, ["vector_package_dotlottie", "vector_inspect_dotlottie", "browserArchiveLoadValidation: not-yet-performed"]);
requireTokens(files.readme, sources.readme, [
  "vector_export_lottie",
  "vector_inspect_lottie",
  "vector_package_dotlottie",
  "vector_inspect_dotlottie",
  "vector_run_batch",
  "vector_inspect_batch",
  "MCP contract `1.5`",
  "editable, web, motion and print delivery profiles",
]);
requireTokens(files.environment, sources.environment, ["VECTOR_MCP_ALLOWED_ROOTS"]);

if (errors.length > 0) {
  process.stderr.write(`${JSON.stringify({
    check: "evavo-vector-studio-mcp-contract",
    ok: false,
    mcpContractVersion: MCP_CONTRACT_VERSION,
    errors,
  }, null, 2)}\n`);
  process.exit(1);
}

process.stdout.write(`${JSON.stringify({
  check: "evavo-vector-studio-mcp-contract",
  ok: true,
  mcpContractVersion: MCP_CONTRACT_VERSION,
  tools: toolNames,
  deliveryProfiles: ["editable", "web", "motion", "print"],
  alphaAwareRasterAnalysis: true,
  generatedBodiesInModelContext: false,
  hostedBackgroundQueue: false,
  checkedFiles: [...checkedFiles].sort(),
}, null, 2)}\n`);
