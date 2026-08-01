import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const MCP_CONTRACT_VERSION = "1.6";
const SERVICE_VERSION = "0.4.0";
const EXPECTED_TOOLS = Object.freeze([
  "vector_animate_svg",
  "vector_capabilities",
  "vector_export_lottie",
  "vector_input_policy",
  "vector_inspect_animated_svg",
  "vector_inspect_batch",
  "vector_inspect_dotlottie",
  "vector_inspect_lottie",
  "vector_inspect_raster",
  "vector_inspect_svg",
  "vector_optimise_svg",
  "vector_package_dotlottie",
  "vector_preflight_svg_print",
  "vector_run_batch",
  "vector_trace_raster",
  "vector_validate_motion_plan",
]);
const errors = [];
const checkedFiles = new Set();

function fail(message) {
  errors.push(message);
}

async function read(relativePath) {
  checkedFiles.add(relativePath);
  try {
    return (await fs.readFile(path.join(root, relativePath), "utf8")).replace(/^\uFEFF/, "");
  } catch (error) {
    fail(
      `Missing or unreadable file: ${relativePath} (${
        error instanceof Error ? error.message : String(error)
      })`,
    );
    return "";
  }
}

async function readJson(relativePath) {
  const source = await read(relativePath);
  if (!source) return null;
  try {
    return JSON.parse(source);
  } catch (error) {
    fail(
      `Invalid JSON: ${relativePath} (${
        error instanceof Error ? error.message : String(error)
      })`,
    );
    return null;
  }
}

function requireTokens(relativePath, source, tokens) {
  for (const token of tokens) {
    if (!source.includes(token)) {
      fail(`${relativePath} is missing MCP contract token: ${token}`);
    }
  }
}

function requireTokensInsensitive(relativePath, source, tokens) {
  const lower = source.toLowerCase();
  for (const token of tokens) {
    if (!lower.includes(token.toLowerCase())) {
      fail(`${relativePath} is missing MCP contract text: ${token}`);
    }
  }
}

function forbidTokens(relativePath, source, tokens) {
  for (const token of tokens) {
    if (source.includes(token)) {
      fail(`${relativePath} contains prohibited MCP contract token: ${token}`);
    }
  }
}

function parseToolArray(relativePath, source, name) {
  const expression = new RegExp(
    `export const ${name} = Object\\.freeze\\(\\[([\\s\\S]*?)\\] as const\\);`,
  );
  const block = source.match(expression)?.[1] ?? "";
  if (!block) {
    fail(`${relativePath} is missing ${name}.`);
    return [];
  }
  return [...block.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
}

function compareExactArray(label, actual, expected) {
  const left = [...actual].sort();
  const right = [...expected].sort();
  if (
    left.length !== right.length ||
    left.some((item, index) => item !== right[index])
  ) {
    fail(
      `${label} does not match the governed contract. Expected ${JSON.stringify(
        right,
      )}; received ${JSON.stringify(left)}.`,
    );
  }
}

const files = Object.freeze({
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
  serverTests: "packages/mcp/src/server.test.ts",
  printTests: "packages/mcp/src/print-tools.test.ts",
  serverBatchTests: "packages/mcp/src/server-batch.test.ts",
  docs: "docs/MCP.md",
  printDocs: "docs/PRINT-PREFLIGHT.md",
  deliveryDocs: "docs/DELIVERY-PROFILES.md",
  batchDocs: "docs/BATCH.md",
  lottieDocs: "docs/LOTTIE.md",
  dotLottieDocs: "docs/DOTLOTTIE.md",
  readme: "README.md",
  environment: ".env.example",
});

const sourceEntries = await Promise.all(
  Object.entries(files)
    .filter(([key]) => !key.endsWith("Package"))
    .map(async ([key, relativePath]) => [key, await read(relativePath)]),
);
const sources = Object.fromEntries(sourceEntries);
const rootPackage = await readJson(files.rootPackage);
const mcpPackage = await readJson(files.mcpPackage);

if (rootPackage?.version !== SERVICE_VERSION) {
  fail(`Root package version must be ${SERVICE_VERSION}.`);
}
if (mcpPackage?.version !== rootPackage?.version) {
  fail(
    `MCP package version ${String(
      mcpPackage?.version,
    )} does not match root ${String(rootPackage?.version)}.`,
  );
}

const expectedDependencies = Object.freeze({
  "@evavo/job-engine": "workspace:*",
  "@evavo/lottie-engine": "workspace:*",
  "@evavo/motion-engine": "workspace:*",
  "@evavo/raster-engine": "workspace:*",
  "@evavo/vector-core": "workspace:*",
  "@evavo/vector-jobs": "workspace:*",
  "@modelcontextprotocol/sdk": "1.30.0",
  zod: "3.25.76",
});
for (const [dependency, expected] of Object.entries(expectedDependencies)) {
  if (mcpPackage?.dependencies?.[dependency] !== expected) {
    fail(`MCP dependency ${dependency} must equal ${expected}.`);
  }
}
if (mcpPackage?.bin?.["evavo-vector-mcp"] !== "./dist/index.js") {
  fail("packages/mcp/package.json must expose evavo-vector-mcp.");
}
for (const [script, expected] of Object.entries({
  "mcp:check": "node scripts/check-mcp-contract.mjs",
  "vector:mcp:build": "turbo run build --filter=@evavo/vector-mcp",
  "vector:mcp": "pnpm vector:mcp:build && node packages/mcp/dist/index.js",
})) {
  if (rootPackage?.scripts?.[script] !== expected) {
    fail(`package.json script ${script} must equal: ${expected}`);
  }
}
if (
  !String(rootPackage?.scripts?.["build:packages"] ?? "").includes(
    "--filter=@evavo/vector-mcp",
  )
) {
  fail("package.json build:packages must build @evavo/vector-mcp.");
}
if (!String(rootPackage?.scripts?.check ?? "").includes("pnpm mcp:check")) {
  fail("package.json check must include the dependency-free MCP contract gate.");
}

const baseTools = parseToolArray(
  files.operations,
  sources.operations,
  "VECTOR_MCP_TOOL_NAMES",
);
const printTools = parseToolArray(
  files.printTools,
  sources.printTools,
  "VECTOR_MCP_PRINT_TOOL_NAMES",
);
const lottieTools = parseToolArray(
  files.lottieTools,
  sources.lottieTools,
  "VECTOR_MCP_LOTTIE_TOOL_NAMES",
);
const dotLottieTools = parseToolArray(
  files.dotLottieTools,
  sources.dotLottieTools,
  "VECTOR_MCP_DOTLOTTIE_TOOL_NAMES",
);
const batchTools = parseToolArray(
  files.batchTools,
  sources.batchTools,
  "VECTOR_MCP_BATCH_TOOL_NAMES",
);
const allTools = [
  ...baseTools,
  ...printTools,
  ...lottieTools,
  ...dotLottieTools,
  ...batchTools,
];
if (new Set(allTools).size !== allTools.length) {
  fail("MCP tool names must be unique.");
}
compareExactArray("MCP tool set", allTools, EXPECTED_TOOLS);

requireTokens(files.index, sources.index, [
  '@modelcontextprotocol/sdk/server/stdio.js',
  "new StdioServerTransport()",
  "await server.connect(transport)",
  "process.stderr.write",
]);
forbidTokens(files.index, sources.index, [
  "process.stdout",
  "console.log(",
  "console.info(",
  "console.debug(",
]);

requireTokens(files.server, sources.server, [
  `VECTOR_MCP_SERVER_CONTRACT_VERSION = "${MCP_CONTRACT_VERSION}"`,
  "new McpServer(",
  "structuredContent: payload",
  "isError: true",
  "extra.signal",
  "deliveryProfileSchema",
  "stableIdPrefixSchema",
  "extendVectorMcpPrintCapabilities",
  "registerVectorMcpPrintTools",
  "registerVectorMcpLottieTools",
  "registerVectorMcpDotLottieTools",
  "registerVectorMcpBatchTools",
  "printOperations",
  "lottieOperations",
  "dotLottieOperations",
  "batchOperations",
  "without writing a file",
  "production approval",
  ...baseTools.map((name) => `"${name}"`),
]);
forbidTokens(files.server, sources.server, [
  "z.any()",
  'approval: "approved"',
  "generatedBodiesInModelContext: true",
]);

requireTokens(files.operations, sources.operations, [
  'VECTOR_MCP_CONTRACT_VERSION = "1.2"',
  `VECTOR_MCP_VERSION = "${SERVICE_VERSION}"`,
  'transport: "stdio"',
  'outputMode: "new-files-only"',
  "atomicMultiFileCommit: true",
  "commitNewVectorFiles",
  "RasterDeliveryProfile",
  "resolveDeliveryOptions",
  "pathPolicy.resolveInputFile",
  "pathPolicy.resolveOutputFile",
  "deliveryProfile",
  "stableIdPrefix",
  "validateAnimatedSvgMotionSpec",
  "createAnimatedSvg(source, plan.normalized)",
  "inspectAnimatedSvg(source)",
  "alphaAwareAnalysis: true",
  'approval: "human-review-required"',
]);
forbidTokens(files.operations, sources.operations, [
  "svg: result.svg",
  "differencePng: result.artifacts.differencePng",
  'approval: "approved"',
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
  `mcpContractVersion: "${MCP_CONTRACT_VERSION}"`,
  "printPreflightEvidence: true",
  "printPreflightWritesFiles: false",
  "printProductionApproval: false",
  "generatedBodiesInModelContext: false",
  "outputWritten: false",
  "productionApproval: false",
  'approval: "review-required"',
  '"commercial"',
  '"large-format"',
  '"cut-vinyl"',
  '"screen-print"',
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
  '"vector_export_lottie"',
  '"vector_inspect_lottie"',
  "createVectorMcpLottieOperations",
  "registerVectorMcpLottieTools",
  "createLottieFromSvgMotion",
  "inspectLottie",
  "commitNewVectorFiles",
  "modelContextIncludesGeneratedJson: false",
  "playerRenderValidation: false",
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
  "hostedBackgroundQueue: true",
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
forbidTokens(files.errors, sources.errors, ["error.stack"]);

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

requireTokens(files.serverTests, sources.serverTests, [
  "InMemoryTransport.createLinkedPair()",
  "await client.listTools()",
  "VECTOR_MCP_SERVER_CONTRACT_VERSION",
  "VECTOR_MCP_PRINT_TOOL_NAMES",
  'name: "vector_capabilities"',
  'name: "vector_preflight_svg_print"',
  "printPreflightEvidence",
  "printPreflightWritesFiles",
  "printProductionApproval",
]);
requireTokens(files.printTests, sources.printTests, [
  "exposes print preflight through the MCP handshake and writes no file",
  "fails cancellation before reading an SVG",
  "rejects non-SVG input through the stable MCP error boundary",
  "expectedCanvasWidthMm",
  "expectedCanvasHeightMm",
  "dimensionsMatched",
  "assert.deepEqual(await readdir(root), before)",
]);
requireTokens(files.serverBatchTests, sources.serverBatchTests, [
  "InMemoryTransport.createLinkedPair()",
  "VECTOR_MCP_BATCH_CONTRACT_VERSION",
  "VECTOR_MCP_BATCH_MAX_ITEMS",
  'name: "vector_run_batch"',
  'name: "vector_inspect_batch"',
  '"VECTOR_MCP_BATCH_TOO_LARGE"',
]);

requireTokensInsensitive(files.docs, sources.docs, [
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
requireTokensInsensitive(files.deliveryDocs, sources.deliveryDocs, [
  "editable",
  "web",
  "motion",
  "print",
  "stable",
  "safety rollback",
  "human review",
]);
requireTokensInsensitive(files.batchDocs, sources.batchDocs, [
  "vector_run_batch",
  "vector_inspect_batch",
  "100 items",
  "not a hosted background queue",
]);
requireTokensInsensitive(files.lottieDocs, sources.lottieDocs, [
  "vector_export_lottie",
  "vector_inspect_lottie",
  "playerRenderValidation",
  "human review",
]);
requireTokensInsensitive(files.dotLottieDocs, sources.dotLottieDocs, [
  "vector_package_dotlottie",
  "vector_inspect_dotlottie",
  "browserArchiveLoadValidation",
  "human review",
]);
requireTokensInsensitive(files.readme, sources.readme, [
  "MCP",
  "pnpm vector:mcp",
  "editable, web, motion and print",
]);
requireTokens(files.environment, sources.environment, [
  "VECTOR_MCP_ALLOWED_ROOTS",
  "VECTOR_TRACE_TIMEOUT_MS",
  "VECTOR_TRACE_MAX_CONCURRENT",
  "VECTOR_TRACE_RETRY_AFTER_SECONDS",
]);

if (errors.length > 0) {
  process.stderr.write(
    `${JSON.stringify(
      {
        check: "evavo-vector-studio-mcp",
        ok: false,
        contractVersion: MCP_CONTRACT_VERSION,
        errors,
      },
      null,
      2,
    )}\n`,
  );
  process.exit(1);
}

process.stdout.write(
  `${JSON.stringify(
    {
      check: "evavo-vector-studio-mcp",
      ok: true,
      contractVersion: MCP_CONTRACT_VERSION,
      toolCount: allTools.length,
      tools: [...allTools].sort(),
      deliveryProfiles: ["editable", "web", "motion", "print"],
      printPreflight: {
        tool: "vector_preflight_svg_print",
        profiles: ["commercial", "large-format", "cut-vinyl", "screen-print"],
        readOnly: true,
        receiptOnly: true,
        productionApproval: false,
      },
      generatedBodiesInModelContext: false,
      hostedBackgroundQueue: false,
      approval: "human-review-required",
      checkedFiles: [...checkedFiles].sort(),
    },
    null,
    2,
  )}\n`,
);
