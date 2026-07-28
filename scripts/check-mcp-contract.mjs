import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
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

const rootPackage = await readJson("package.json");
const mcpPackage = await readJson("packages/mcp/package.json");
const files = {
  index: "packages/mcp/src/index.ts",
  server: "packages/mcp/src/server.ts",
  operations: "packages/mcp/src/operations.ts",
  lottieTools: "packages/mcp/src/lottie-tools.ts",
  dotLottieTools: "packages/mcp/src/dotlottie-tools.ts",
  errors: "packages/mcp/src/errors.ts",
  pathPolicy: "packages/mcp/src/path-policy.ts",
  transaction: "packages/mcp/src/file-transaction.ts",
  pathTests: "packages/mcp/src/path-policy.test.ts",
  transactionTests: "packages/mcp/src/file-transaction.test.ts",
  serverTests: "packages/mcp/src/server.test.ts",
  docs: "docs/MCP.md",
  lottieDocs: "docs/LOTTIE.md",
  dotLottieDocs: "docs/DOTLOTTIE.md",
  readme: "README.md",
  environment: ".env.example",
};
const sources = Object.fromEntries(
  await Promise.all(Object.entries(files).map(async ([key, relativePath]) => [key, await read(relativePath)])),
);

if (mcpPackage?.version !== rootPackage?.version) {
  fail(`MCP package version ${String(mcpPackage?.version)} does not match root version ${String(rootPackage?.version)}`);
}
if (mcpPackage?.dependencies?.["@modelcontextprotocol/sdk"] !== "1.30.0") {
  fail("packages/mcp must pin @modelcontextprotocol/sdk to 1.30.0 for the reviewed v1 contract.");
}
if (mcpPackage?.dependencies?.zod !== "3.25.76") {
  fail("packages/mcp must pin zod to 3.25.76 for the reviewed SDK compatibility boundary.");
}
if (mcpPackage?.dependencies?.["@evavo/motion-engine"] !== "workspace:*") {
  fail("packages/mcp must consume the governed motion engine through the workspace.");
}
if (mcpPackage?.dependencies?.["@evavo/lottie-engine"] !== "workspace:*") {
  fail("packages/mcp must consume the governed Lottie engine through the workspace.");
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

requireTokens(files.index, sources.index, [
  "@modelcontextprotocol/sdk/server/stdio.js",
  "new StdioServerTransport()",
  "await server.connect(transport)",
  "process.stderr.write",
]);
forbidTokens(files.index, sources.index, ["process.stdout", "console.log("]);

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
];
requireTokens(files.server, sources.server, [
  "new McpServer(",
  "structuredContent: payload",
  "isError: true",
  "extra.signal",
  "motionPlanSchema",
  "extendVectorMcpCapabilities",
  "registerVectorMcpLottieTools",
  "lottieOperations",
  "extendVectorMcpDotLottieCapabilities",
  "registerVectorMcpDotLottieTools",
  "VECTOR_MCP_DOTLOTTIE_CONTRACT_VERSION",
  "dotLottieOperations",
  ...toolNames.slice(0, 9).map((name) => `\"${name}\"`),
]);

requireTokens(files.operations, sources.operations, [
  'VECTOR_MCP_CONTRACT_VERSION = "1.1"',
  'transport: "stdio"',
  'outputMode: "new-files-only"',
  "atomicMultiFileCommit: true",
  "commitNewVectorFiles",
  "includeDifferenceArtifact: Boolean(resolvedDifferencePath)",
  'evidenceLevel === "full"',
  "validateAnimatedSvgMotionSpec",
  "createAnimatedSvg(source, plan.normalized)",
  "inspectAnimatedSvg(source)",
  "inlinePlans: true",
  "animatedSvg: true",
  'approval: "human-review-required"',
]);
forbidTokens(files.operations, sources.operations, [
  "svg: result.svg",
  "differencePng: result.artifacts.differencePng",
]);

requireTokens(files.lottieTools, sources.lottieTools, [
  'VECTOR_MCP_PUBLIC_CONTRACT_VERSION = "1.2"',
  '"vector_export_lottie"',
  '"vector_inspect_lottie"',
  "createVectorMcpLottieOperations",
  "registerVectorMcpLottieTools",
  "extendVectorMcpCapabilities",
  "createLottieFromSvgMotion",
  "inspectLottie",
  "commitNewVectorFiles",
  'mimeType: "video/lottie+json"',
  "modelContextIncludesGeneratedJson: false",
  "playerRenderValidation: false",
  "dotLottiePackaging: false",
  "approval: result.evidence.approval",
  "VECTOR_MCP_LOTTIE_OUTPUT_TOO_LARGE",
]);
forbidTokens(files.lottieTools, sources.lottieTools, [
  "json: result.json",
  "animation: result.animation",
  'playerRenderValidation: "passed"',
  "dotLottiePackaging: true",
  'approval: "approved"',
]);

requireTokens(files.dotLottieTools, sources.dotLottieTools, [
  'VECTOR_MCP_DOTLOTTIE_CONTRACT_VERSION = "1.3"',
  '"vector_package_dotlottie"',
  '"vector_inspect_dotlottie"',
  "createVectorMcpDotLottieOperations",
  "registerVectorMcpDotLottieTools",
  "extendVectorMcpDotLottieCapabilities",
  "createDotLottiePackage",
  "inspectDotLottie",
  "commitNewVectorFiles",
  "DOTLOTTIE_MIME_TYPE",
  "modelContextIncludesArchiveBytes: false",
  "modelContextIncludesEmbeddedJson: false",
  "archiveInspection: true",
  "embeddedLottieInspection: true",
  "playerRenderValidation: false",
  "browserArchiveLoadValidation: false",
  "approval: result.evidence.approval",
  "VECTOR_MCP_DOTLOTTIE_ARCHIVE_TOO_LARGE",
]);
forbidTokens(files.dotLottieTools, sources.dotLottieTools, [
  "archiveBytes: result.bytes",
  "bytes: result.bytes",
  "lottieJson: input.source",
  'playerRenderValidation: "passed"',
  'browserArchiveLoadValidation: "passed"',
  'approval: "approved"',
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
requireTokens(files.errors, sources.errors, [
  "LottieEngineError",
  "MotionEngineError",
  "RasterRuntimeGuardError",
  "VectorMcpPathError",
  "VectorMcpFileCommitError",
  '"VECTOR_MCP_OPERATION_FAILED"',
]);
requireTokens(files.pathTests, sources.pathTests, [
  "VECTOR_MCP_PATH_OUTSIDE_ROOT",
  "VECTOR_MCP_OUTPUT_EXISTS",
  "symlink",
]);
requireTokens(files.transactionTests, sources.transactionTests, [
  "rolls back files already committed",
  "returns byte and SHA-256 receipts",
]);
requireTokens(files.serverTests, sources.serverTests, [
  "InMemoryTransport.createLinkedPair()",
  "await client.listTools()",
  'name: "vector_capabilities"',
  'name: "vector_inspect_svg"',
  'name: "vector_animate_svg"',
  'name: "vector_inspect_animated_svg"',
  'name: "vector_export_lottie"',
  'name: "vector_inspect_lottie"',
  'name: "vector_package_dotlottie"',
  'name: "vector_inspect_dotlottie"',
  "doesNotMatch(JSON.stringify(payload), /<svg",
  'doesNotMatch(JSON.stringify(payload), /"layers"',
  "assert.doesNotMatch(JSON.stringify(payload), /UEsDB/)",
  '"VECTOR_MCP_INPUT_NOT_FOUND"',
  '"VECTOR_MCP_OUTPUT_EXISTS"',
]);
requireTokens(files.docs, sources.docs, [
  "MCP contract version `1.3`",
  "vector_trace_raster",
  "vector_validate_motion_plan",
  "vector_animate_svg",
  "vector_inspect_animated_svg",
  "vector_export_lottie",
  "vector_inspect_lottie",
  "vector_package_dotlottie",
  "vector_inspect_dotlottie",
  "VECTOR_MCP_ALLOWED_ROOTS",
  "new-files-only",
  "summary",
  "full",
  "inline",
  "generated Lottie JSON",
  "generated dotLottie archive bytes",
  "Human review",
]);
requireTokens(files.lottieDocs, sources.lottieDocs, [
  "vector_export_lottie",
  "vector_inspect_lottie",
  "playerRenderValidation: not-yet-performed",
  "dotLottiePackaging: not-yet-available",
]);
requireTokens(files.dotLottieDocs, sources.dotLottieDocs, [
  "vector_package_dotlottie",
  "vector_inspect_dotlottie",
  "browserArchiveLoadValidation: not-yet-performed",
]);
requireTokens(files.readme, sources.readme, [
  "vector_export_lottie",
  "vector_inspect_lottie",
  "vector_package_dotlottie",
  "vector_inspect_dotlottie",
  "MCP contract `1.3`",
]);
requireTokens(files.environment, sources.environment, ["VECTOR_MCP_ALLOWED_ROOTS"]);

if (errors.length > 0) {
  process.stderr.write(`${JSON.stringify({
    check: "evavo-vector-studio-mcp-contract",
    ok: false,
    mcpContractVersion: "1.3",
    errors,
  }, null, 2)}\n`);
  process.exit(1);
}

process.stdout.write(`${JSON.stringify({
  check: "evavo-vector-studio-mcp-contract",
  ok: true,
  mcpContractVersion: "1.3",
  tools: toolNames,
  generatedBodiesInModelContext: false,
  checkedFiles: [...checkedFiles].sort(),
}, null, 2)}\n`);
