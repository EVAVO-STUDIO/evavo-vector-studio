import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const errors = [];
const checkedFiles = new Set();
const MCP_CONTRACT_VERSION = "1.6";

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
  printTools: "packages/mcp/src/print-tools.ts",
  lottieTools: "packages/mcp/src/lottie-tools.ts",
  dotLottieTools: "packages/mcp/src/dotlottie-tools.ts",
  batchTools: "packages/mcp/src/batch-tools.ts",
  errors: "packages/mcp/src/errors.ts",
  pathPolicy: "packages/mcp/src/path-policy.ts",
  transaction: "packages/mcp/src/file-transaction.ts",
  pathTests: "packages/mcp/src/path-policy.test.ts",
  transactionTests: "packages/mcp/src/file-transaction.test.ts",
  serverTests: "packages/mcp/src/server.test.ts",
  printTests: "packages/mcp/src/print-tools.test.ts",
  serverBatchTests: "packages/mcp/src/server-batch.test.ts",
  batchToolTests: "packages/mcp/src/batch-tools.test.ts",
  docs: "docs/MCP.md",
  printDocs: "docs/PRINT-PREFLIGHT.md",
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
  "@evavo/job-engine": "workspace:*",
  "@evavo/lottie-engine": "workspace:*",
  "@evavo/motion-engine": "workspace:*",
  "@evavo/raster-engine": "workspace:*",
  "@evavo/vector-core": "workspace:*",
  "@evavo/vector-jobs": "workspace:*",
  "@modelcontextprotocol/sdk": "1.25.3",
  zod: "3.25.76",
})) {
  if (mcpPackage?.dependencies?.[dependency] !== expected) {
    fail(`MCP dependency ${dependency} must be pinned to ${expected}.`);
  }
}
if (mcpPackage?.bin?.["evavo-vector-mcp"] !== "./dist/index.js") {
  fail("packages/mcp/package.json must expose evavo-vector-mcp.");
}
if (rootPackage?.scripts?.["mcp:check"] !== "node scripts/check-mcp-contract.mjs") {
  fail("package.json must expose mcp:check.");
}
if (!String(rootPackage?.scripts?.check ?? "").includes("pnpm mcp:check")) {
  fail("package.json check must include mcp:check.");
}
if (rootPackage?.scripts?.["vector:mcp:build"] !== "turbo run build --filter=@evavo/vector-mcp") {
  fail("package.json must expose vector:mcp:build.");
}
if (rootPackage?.scripts?.["vector:mcp"] !== "pnpm vector:mcp:build && node packages/mcp/dist/index.js") {
  fail("package.json must expose vector:mcp.");
}

const directTools = [...sources.server.matchAll(/server\.registerTool\(\s*"([^"]+)"/g)]
  .map((match) => match[1]);
function parseToolArray(relativePath, source, name) {
  const block = source.match(
    new RegExp(`export const ${name} = Object\\.freeze\\(\\[([\\s\\S]*?)\\] as const\\);`),
  )?.[1] ?? "";
  if (!block) fail(`${relativePath} is missing ${name}.`);
  return [...block.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
}
const printTools = parseToolArray(files.printTools, sources.printTools, "VECTOR_MCP_PRINT_TOOL_NAMES");
const lottieTools = parseToolArray(files.lottieTools, sources.lottieTools, "VECTOR_MCP_LOTTIE_TOOL_NAMES");
const dotLottieTools = parseToolArray(files.dotLottieTools, sources.dotLottieTools, "VECTOR_MCP_DOTLOTTIE_TOOL_NAMES");
const batchTools = parseToolArray(files.batchTools, sources.batchTools, "VECTOR_MCP_BATCH_TOOL_NAMES");
const allTools = [...directTools, ...printTools, ...lottieTools, ...dotLottieTools, ...batchTools];
const uniqueTools = [...new Set(allTools)];
if (directTools.length !== 9) fail(`Expected 9 direct MCP tools; found ${directTools.length}.`);
if (printTools.length !== 1) fail(`Expected 1 print MCP tool; found ${printTools.length}.`);
if (lottieTools.length !== 2) fail(`Expected 2 Lottie MCP tools; found ${lottieTools.length}.`);
if (dotLottieTools.length !== 2) fail(`Expected 2 dotLottie MCP tools; found ${dotLottieTools.length}.`);
if (batchTools.length !== 2) fail(`Expected 2 batch MCP tools; found ${batchTools.length}.`);
if (allTools.length !== 16) fail(`Expected 16 MCP tools; found ${allTools.length}.`);
if (uniqueTools.length !== allTools.length) fail("MCP tool names must be unique.");

requireTokens(files.index, sources.index, [
  "StdioServerTransport",
  "createVectorMcpServer",
  "VECTOR_MCP_ALLOWED_ROOTS",
  "transport.onclose",
  "transport.onerror",
  "server.connect(transport)",
  "process.stdout.write",
  "process.stdout.on(\"error\"",
  "process.stderr.write",
  "VECTOR_MCP_STDOUT_WRITE_FAILED",
  "VECTOR_MCP_STDOUT_UNCAUGHT_OUTPUT",
  "sensitiveValuesRecorded: false",
]);
forbidTokens(files.index, sources.index, ["console.log(", "console.info(", "console.debug("]);

requireTokens(files.server, sources.server, [
  `VECTOR_MCP_SERVER_CONTRACT_VERSION = "${MCP_CONTRACT_VERSION}"`,
  "new McpServer",
  "instructions:",
  "registerVectorMcpPrintTools",
  "extendVectorMcpPrintCapabilities",
  "printOperations",
  "registerVectorMcpLottieTools",
  "registerVectorMcpDotLottieTools",
  "registerVectorMcpBatchTools",
  "deliveryProfileSchema",
  "stableIdPrefixSchema",
  "extra.signal",
  "print preflight",
  "without writing a file",
  "physical production approval",
]);

requireTokens(files.operations, sources.operations, [
  'VECTOR_MCP_CONTRACT_VERSION = "1.2"',
  'VECTOR_MCP_VERSION = "0.4.0"',
  "createVectorMcpOperations",
  "pathPolicy.resolveInputFile",
  "pathPolicy.resolveOutputFile",
  "commitNewVectorFiles",
  "traceRaster",
  "inspectRaster",
  "inspectSvg",
  "optimiseSvg",
  "deliveryProfile",
  "stableIdPrefix",
  "safetyRollbackApplied",
  "runtimeGuard",
  "signal",
  "generatedBodiesInModelContext: false",
  'approval: "human-review-required"',
]);

requireTokens(files.printTools, sources.printTools, [
  'VECTOR_MCP_PRINT_CONTRACT_VERSION = "1.0"',
  "VECTOR_MCP_PRINT_MAX_INPUT_BYTES",
  '"vector_preflight_svg_print"',
  "createVectorMcpPrintOperations",
  "registerVectorMcpPrintTools",
  "extendVectorMcpPrintCapabilities",
  "pathPolicy.resolveInputFile",
  "preflightSvgForPrint",
  "VECTOR_MCP_CANCELLED",
  'mcpContractVersion: "1.6"',
  "printPreflightEvidence: true",
  "printPreflightWritesFiles: false",
  "printProductionApproval: false",
  "generatedBodiesInModelContext: false",
  "outputWritten: false",
  "productionApproval: false",
  'approval: "review-required"',
]);
forbidTokens(files.printTools, sources.printTools, [
  "resolveOutputFile",
  "commitNewVectorFiles",
  "writeFile(",
  "appendFile(",
  "generatedBodiesInModelContext: true",
  "outputWritten: true",
  "productionApproval: true",
  'approval: "approved"',
]);

requireTokens(files.lottieTools, sources.lottieTools, [
  'VECTOR_MCP_PUBLIC_CONTRACT_VERSION = "1.2"',
  "VECTOR_MCP_LOTTIE_TOOL_NAMES",
  "vector_export_lottie",
  "vector_inspect_lottie",
  "commitNewVectorFiles",
  "generatedBodiesInModelContext: false",
]);
requireTokens(files.dotLottieTools, sources.dotLottieTools, [
  'VECTOR_MCP_DOTLOTTIE_CONTRACT_VERSION = "1.3"',
  "VECTOR_MCP_DOTLOTTIE_TOOL_NAMES",
  "vector_package_dotlottie",
  "vector_inspect_dotlottie",
  "commitNewVectorFiles",
  "modelContextIncludesArchiveBytes: false",
]);
requireTokens(files.batchTools, sources.batchTools, [
  'VECTOR_MCP_BATCH_CONTRACT_VERSION = "1.0"',
  "VECTOR_MCP_BATCH_MAX_ITEMS = 100",
  "VECTOR_MCP_BATCH_TOOL_NAMES",
  "vector_run_batch",
  "vector_inspect_batch",
  "createVectorBatchOperationRegistry",
  "runDurableBatch",
  "inspectDurableBatch",
  "pathPolicy.roots",
  "VECTOR_MCP_BATCH_TOO_LARGE",
  "deliveryEvidenceRetained: true",
  "generatedBodiesInModelContext: false",
  "hostedBackgroundQueue: false",
]);

requireTokens(files.pathPolicy, sources.pathPolicy, [
  "VECTOR_MCP_ALLOWED_ROOTS",
  "realpath",
  "lstat",
  "path.relative",
  "VECTOR_MCP_PATH_OUTSIDE_ROOT",
  "VECTOR_MCP_PATH_SYMLINK_REJECTED",
  "VECTOR_MCP_OUTPUT_EXISTS",
]);
requireTokens(files.transaction, sources.transaction, [
  "commitNewVectorFiles",
  'flag: "wx"',
  "link(temporary, absolute)",
  "sha256",
  "VECTOR_MCP_OUTPUT_PATH_DUPLICATE",
  "VECTOR_MCP_OUTPUT_COMMIT_FAILED",
]);
requireTokens(files.errors, sources.errors, [
  "class VectorMcpOperationError",
  "vectorMcpFailure",
  "retryable",
  "details",
  "VECTOR_MCP_INTERNAL_ERROR",
]);
forbidTokens(files.errors, sources.errors, ["error.stack"]);

requireTokens(files.pathTests, sources.pathTests, [
  "rejects input traversal outside the canonical allowed roots",
  "rejects symlink input escapes",
]);
requireTokens(files.transactionTests, sources.transactionTests, [
  "does not overwrite an existing output",
  "rolls back earlier members when a later atomic commit fails",
]);
requireTokens(files.serverTests, sources.serverTests, [
  "InMemoryTransport",
  "VECTOR_MCP_SERVER_CONTRACT_VERSION",
  "VECTOR_MCP_PRINT_TOOL_NAMES",
  'name: "vector_capabilities"',
  'name: "vector_preflight_svg_print"',
  "printPreflightEvidence",
  "printPreflightWritesFiles",
  "printProductionApproval",
  "generatedBodiesInModelContext",
]);
requireTokens(files.printTests, sources.printTests, [
  "exposes print preflight through the MCP handshake and writes no file",
  "fails cancellation before reading an SVG",
  "rejects non-SVG input through the stable MCP error boundary",
  "assert.deepEqual(await readdir(root), before)",
]);
requireTokens(files.serverBatchTests, sources.serverBatchTests, [
  "VECTOR_MCP_SERVER_CONTRACT_VERSION",
  "VECTOR_MCP_BATCH_CONTRACT_VERSION",
  "VECTOR_MCP_BATCH_MAX_ITEMS",
  "runs, paginates, inspects and safely resumes",
  "rejects manifests above the MCP batch item limit",
]);
requireTokens(files.batchToolTests, sources.batchToolTests, [
  "delivery profiles propagate through the shared durable registry",
  "MCP durable batch delivery profiles execute and resume through the public operations",
]);

requireTokens(files.docs, sources.docs, [
  "# EVAVO Vector Studio MCP server",
  "MCP contract 1.6",
  "tools 16",
  "vector_preflight_svg_print",
  "commercial",
  "large-format",
  "cut-vinyl",
  "screen-print",
  "writes no file",
  "CMYK or spot proof available",
  "production approval",
  "VECTOR_MCP_ALLOWED_ROOTS",
  "hosted background queue",
  "human review",
]);
requireTokens(files.printDocs, sources.printDocs, [
  "# Governed SVG print preflight",
  "POST /api/v1/print/preflight",
  "evavo-vector-print",
  "cmykOrSpotColourProofAvailable: false",
  "productionApproval: false",
]);
requireTokens(files.deliveryDocs, sources.deliveryDocs, [
  "editable",
  "web",
  "motion",
  "print",
  "stable IDs",
  "Safety rollback",
]);
requireTokens(files.batchDocs, sources.batchDocs, [
  "deliveryProfile",
  "stableIdPrefix",
  "safetyRollbackApplied",
  "human-review-required",
]);
requireTokens(files.lottieDocs, sources.lottieDocs, ["player-render", "human review"]);
requireTokens(files.dotLottieDocs, sources.dotLottieDocs, ["manifest v2", "human review"]);
requireTokens(files.readme, sources.readme, ["MCP", "pnpm vector:mcp"]);
requireTokens(files.environment, sources.environment, [
  "VECTOR_MCP_ALLOWED_ROOTS",
  "VECTOR_TRACE_TIMEOUT_MS",
  "VECTOR_TRACE_MAX_CONCURRENT",
  "VECTOR_TRACE_RETRY_AFTER_SECONDS",
]);

for (const [relativePath, source] of [
  [files.server, sources.server],
  [files.operations, sources.operations],
  [files.printTools, sources.printTools],
  [files.batchTools, sources.batchTools],
]) {
  forbidTokens(relativePath, source, [
    "hostedBackgroundQueue: true",
    "generatedBodiesInModelContext: true",
    'approval: "approved"',
  ]);
}

if (errors.length > 0) {
  process.stderr.write(`${JSON.stringify({
    check: "evavo-vector-studio-mcp",
    ok: false,
    contractVersion: MCP_CONTRACT_VERSION,
    errors,
  }, null, 2)}\n`);
  process.exit(1);
}

process.stdout.write(`${JSON.stringify({
  check: "evavo-vector-studio-mcp",
  ok: true,
  contractVersion: MCP_CONTRACT_VERSION,
  toolCount: uniqueTools.length,
  tools: uniqueTools.sort(),
  deliveryProfiles: ["editable", "web", "motion", "print"],
  printPreflight: Object.freeze({
    tool: "vector_preflight_svg_print",
    profiles: ["commercial", "large-format", "cut-vinyl", "screen-print"],
    readOnly: true,
    receiptOnly: true,
    productionApproval: false,
  }),
  lottie: true,
  dotLottie: true,
  durableBatch: true,
  generatedBodiesInModelContext: false,
  hostedBackgroundQueue: false,
  approval: "human-review-required",
  checkedFiles: [...checkedFiles].sort(),
}, null, 2)}\n`);
