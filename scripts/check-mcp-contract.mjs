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
  errors: "packages/mcp/src/errors.ts",
  pathPolicy: "packages/mcp/src/path-policy.ts",
  transaction: "packages/mcp/src/file-transaction.ts",
  pathTests: "packages/mcp/src/path-policy.test.ts",
  transactionTests: "packages/mcp/src/file-transaction.test.ts",
  docs: "docs/MCP.md",
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
];
requireTokens(files.server, sources.server, [
  "new McpServer(",
  "structuredContent: payload",
  "isError: true",
  "extra.signal",
  ...toolNames.map((name) => `\"${name}\"`),
]);

requireTokens(files.operations, sources.operations, [
  'VECTOR_MCP_CONTRACT_VERSION = "1.0"',
  'transport: "stdio"',
  'outputMode: "new-files-only"',
  "atomicMultiFileCommit: true",
  "commitNewVectorFiles",
  "includeDifferenceArtifact: Boolean(resolvedDifferencePath)",
  'evidenceLevel === "full"',
  'animatedSvg: false',
  'lottie: false',
  'approval: "human-review-required"',
]);
forbidTokens(files.operations, sources.operations, [
  "svg: result.svg",
  "differencePng: result.artifacts.differencePng",
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
requireTokens(files.docs, sources.docs, [
  "vector_trace_raster",
  "VECTOR_MCP_ALLOWED_ROOTS",
  "new-files-only",
  "summary",
  "full",
  "Human review",
]);
requireTokens(files.environment, sources.environment, ["VECTOR_MCP_ALLOWED_ROOTS"]);

if (errors.length > 0) {
  process.stderr.write(`${JSON.stringify({
    check: "evavo-vector-studio-mcp-contract",
    ok: false,
    mcpContractVersion: "1.0",
    errors,
  }, null, 2)}\n`);
  process.exit(1);
}

process.stdout.write(`${JSON.stringify({
  check: "evavo-vector-studio-mcp-contract",
  ok: true,
  mcpContractVersion: "1.0",
  tools: toolNames,
  checkedFiles: [...checkedFiles].sort(),
}, null, 2)}\n`);
