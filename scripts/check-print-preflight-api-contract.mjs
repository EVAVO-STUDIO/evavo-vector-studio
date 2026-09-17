import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const errors = [];
const checkedFiles = new Set();

async function read(relativePath) {
  checkedFiles.add(relativePath);
  try { return (await fs.readFile(path.join(root, relativePath), "utf8")).replace(/^\uFEFF/, ""); }
  catch (error) { errors.push(`Missing or unreadable print-preflight file: ${relativePath} (${error instanceof Error ? error.message : String(error)})`); return ""; }
}
async function readJson(relativePath) {
  const source = await read(relativePath);
  if (!source) return null;
  try { return JSON.parse(source); } catch (error) { errors.push(`Invalid JSON: ${relativePath} (${error instanceof Error ? error.message : String(error)})`); return null; }
}
async function requireAbsent(relativePath) {
  checkedFiles.add(relativePath);
  try { await fs.access(path.join(root, relativePath)); errors.push(`Retired print workflow must remain absent: ${relativePath}.`); }
  catch (error) { if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) errors.push(`Could not verify absence of ${relativePath}.`); }
}
function requireTokens(relativePath, source, tokens) { for (const token of tokens) if (!source.includes(token)) errors.push(`${relativePath} is missing print-preflight token: ${token}`); }
function forbidTokens(relativePath, source, tokens) { for (const token of tokens) if (source.includes(token)) errors.push(`${relativePath} contains prohibited print-preflight material: ${token}`); }

const files = Object.freeze({
  package: "package.json",
  core: "packages/vector-core/src/print-preflight.ts",
  coreIndex: "packages/vector-core/src/index.ts",
  coreTests: "packages/vector-core/src/print-preflight.test.ts",
  cli: "packages/cli/src/print-cli.ts",
  cliPackage: "packages/cli/package.json",
  cliShim: "packages/cli/bin/evavo-vector-print.mjs",
  mcpPrint: "packages/mcp/src/print-tools.ts",
  mcpPrintTests: "packages/mcp/src/print-tools.test.ts",
  mcpServer: "packages/mcp/src/server.ts",
  route: "apps/web/app/api/v1/print/preflight/route.ts",
  capabilities: "apps/web/app/api/v1/capabilities/route.ts",
  documentation: "docs/PRINT-PREFLIGHT.md",
  capabilityDocumentation: "docs/CAPABILITIES.md",
});
const sources = Object.fromEntries(await Promise.all(Object.entries(files).map(async ([key, relativePath]) => [key, await read(relativePath)])));
const packageJson = await readJson(files.package);
const cliPackageJson = await readJson(files.cliPackage);
await requireAbsent(".github/workflows/print-preflight-contract.yml");

if (packageJson?.scripts?.["print-api:check"] !== "node scripts/check-print-preflight-api-contract.mjs") errors.push("package.json must expose print-api:check.");
if (!String(packageJson?.scripts?.check ?? "").includes("pnpm print-api:check")) errors.push("package.json check must include print-api:check.");
if (packageJson?.scripts?.["vector:print:preflight"] !== "pnpm vector:build && node packages/cli/dist/print-cli.js preflight") errors.push("package.json must expose vector:print:preflight.");
if (packageJson?.scripts?.["vector:print:capabilities"] !== "pnpm vector:build && node packages/cli/dist/print-cli.js capabilities") errors.push("package.json must expose vector:print:capabilities.");
if (!String(packageJson?.scripts?.["build:packages"] ?? "").includes("--filter=@evavo/vector-core") || !String(packageJson?.scripts?.["build:packages"] ?? "").includes("--filter=@evavo/vector-mcp")) errors.push("build:packages must include Vector core and MCP packages.");
if (cliPackageJson?.bin?.["evavo-vector-print"] !== "./bin/evavo-vector-print.mjs") errors.push("packages/cli must expose evavo-vector-print through checked-in launcher.");
if (sources.cliShim !== '#!/usr/bin/env node\nimport "../dist/print-cli.js";\n') errors.push("print CLI shim must import exactly the compiled entrypoint.");

requireTokens(files.core, sources.core, [
  'SVG_PRINT_PREFLIGHT_CONTRACT_VERSION = "1.0"', '"commercial"', '"large-format"', '"cut-vinyl"', '"screen-print"',
  "trimWidthMm", "trimHeightMm", "bleedMm", "minimumStrokePt", "maximumProcessColours",
  "cmykOrSpotColourProofAvailable: false", 'approval: "review-required"', "preflightSvgForPrint",
]);
requireTokens(files.coreIndex, sources.coreIndex, ['export * from "./print-preflight.js"']);
for (const token of ["commercial preflight verifies exact trim and bleed dimensions", "cut-vinyl preflight rejects live text", "screen-print preflight enforces a configured process-colour ceiling", "preflight requires trim dimensions as an atomic pair"]) {
  if (!sources.coreTests.includes(token)) errors.push(`Core print tests missing: ${token}`);
}
requireTokens(files.cli, sources.cli, ["evavo-vector-print preflight", "evavo-vector-print capabilities", "SVG_PRINT_PREFLIGHT_CONTRACT_VERSION", "preflightSvgForPrint", 'approval: "review-required"']);
forbidTokens(files.cli, sources.cli, ['approval: "approved"', "writeFile(", "appendFile("]);
requireTokens(files.mcpPrint, sources.mcpPrint, ['VECTOR_MCP_PRINT_CONTRACT_VERSION = "1.0"', '"vector_preflight_svg_print"', "preflightSvgForPrint", "pathPolicy.resolveInputFile", "outputWritten: false", "generatedBodiesInModelContext: false", "productionApproval: false", 'approval: "review-required"', 'mcpContractVersion: "1.6"']);
forbidTokens(files.mcpPrint, sources.mcpPrint, ["resolveOutputFile", "commitNewVectorFiles", "generatedBodiesInModelContext: true", "outputWritten: true", "productionApproval: true", 'approval: "approved"']);
requireTokens(files.mcpPrintTests, sources.mcpPrintTests, ["exposes print preflight through the MCP handshake and writes no file", "fails cancellation before reading an SVG", "rejects non-SVG input", 'name: "vector_preflight_svg_print"']);
requireTokens(files.mcpServer, sources.mcpServer, ['VECTOR_MCP_SERVER_CONTRACT_VERSION = "1.6"', "registerVectorMcpPrintTools", "extendVectorMcpPrintCapabilities"]);
requireTokens(files.route, sources.route, ['export const runtime = "nodejs"', 'export const dynamic = "force-dynamic"', 'const MAX_SVG_INPUT_BYTES = 5 * 1024 * 1024', "apiAuthorisationFailure(request", "allowWorkspaceSession: true", "preflightSvgForPrint(source, optionsFromForm(form))", 'operation: "print-preflight"', '"x-vector-review-required": "true"', "generatedBodiesIncluded: false", "productionApproval: false"]);
forbidTokens(files.route, sources.route, ["request.json()", "console.log(", "process.env", "productionApproval: true", 'approval: "approved"']);
requireTokens(files.capabilities, sources.capabilities, ["SVG_PRINT_PREFLIGHT_CONTRACT_VERSION", 'MCP_CONTRACT_VERSION = "1.6"', "MCP_TOOL_COUNT = 16", 'printPreflight: "/api/v1/print/preflight"', "physicalDimensions: true", "trimAndBleed: true", "productionApproval: false", 'approval: "review-required"']);
requireTokens(files.documentation, sources.documentation, ["# Governed SVG print preflight", "evavo-vector-print preflight", "POST /api/v1/print/preflight", "commercial", "large-format", "cut-vinyl", "screen-print", "cmykOrSpotColourProofAvailable: false", "productionApproval: false", "review-required", "pnpm print-api:check"]);
requireTokens(files.capabilityDocumentation, sources.capabilityDocumentation, ["vector_preflight_svg_print", "MCP contract `1.6`", "16 tools", "writes no file"]);

if (errors.length > 0) {
  process.stderr.write(`${JSON.stringify({ check: "evavo-vector-studio-print-preflight-api", ok: false, contractVersion: "2.0", errors }, null, 2)}\n`);
  process.exit(1);
}
process.stdout.write(`${JSON.stringify({
  check: "evavo-vector-studio-print-preflight-api",
  ok: true,
  contractVersion: "2.0",
  providerFreeValidation: true,
  retiredWorkflowAbsent: true,
  endpoint: "/api/v1/print/preflight",
  cli: "evavo-vector-print",
  mcpTool: "vector_preflight_svg_print",
  mcpContractVersion: "1.6",
  profiles: ["commercial", "large-format", "cut-vinyl", "screen-print"],
  deterministic: true,
  readOnly: true,
  receiptOnly: true,
  productionApproval: false,
  checkedFiles: [...checkedFiles].sort(),
}, null, 2)}\n`);
