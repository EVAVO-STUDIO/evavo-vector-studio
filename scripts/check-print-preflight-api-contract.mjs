import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const errors = [];
const checkedFiles = new Set();

async function read(relativePath) {
  checkedFiles.add(relativePath);
  try {
    return (await fs.readFile(path.join(root, relativePath), "utf8")).replace(/^\uFEFF/, "");
  } catch (error) {
    errors.push(`Missing or unreadable print-preflight file: ${relativePath} (${error instanceof Error ? error.message : String(error)})`);
    return "";
  }
}

async function readJson(relativePath) {
  const source = await read(relativePath);
  if (!source) return null;
  try {
    return JSON.parse(source);
  } catch (error) {
    errors.push(`Invalid JSON: ${relativePath} (${error instanceof Error ? error.message : String(error)})`);
    return null;
  }
}

function requireTokens(relativePath, source, tokens) {
  for (const token of tokens) {
    if (!source.includes(token)) {
      errors.push(`${relativePath} is missing print-preflight token: ${token}`);
    }
  }
}

function forbidTokens(relativePath, source, tokens) {
  for (const token of tokens) {
    if (source.includes(token)) {
      errors.push(`${relativePath} contains prohibited print-preflight material: ${token}`);
    }
  }
}

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
  workflow: ".github/workflows/print-preflight-contract.yml",
});
const sources = Object.fromEntries(
  await Promise.all(Object.entries(files).map(async ([key, relativePath]) => [key, await read(relativePath)])),
);
const packageJson = await readJson(files.package);
const cliPackageJson = await readJson(files.cliPackage);

if (
  packageJson?.scripts?.["print-api:check"] !==
  "node scripts/check-print-preflight-api-contract.mjs"
) {
  errors.push("package.json must expose print-api:check.");
}
if (!String(packageJson?.scripts?.check ?? "").includes("pnpm print-api:check")) {
  errors.push("package.json check must include print-api:check before dependency-backed gates.");
}
if (
  packageJson?.scripts?.["vector:print:preflight"] !==
  "pnpm vector:build && node packages/cli/dist/print-cli.js preflight"
) {
  errors.push("package.json must expose vector:print:preflight.");
}
if (
  packageJson?.scripts?.["vector:print:capabilities"] !==
  "pnpm vector:build && node packages/cli/dist/print-cli.js capabilities"
) {
  errors.push("package.json must expose vector:print:capabilities.");
}
if (cliPackageJson?.bin?.["evavo-vector-print"] !== "./bin/evavo-vector-print.mjs") {
  errors.push("packages/cli must expose evavo-vector-print through the checked-in install-safe launcher.");
}
if (sources.cliShim !== '#!/usr/bin/env node\nimport "../dist/print-cli.js";\n') {
  errors.push("packages/cli/bin/evavo-vector-print.mjs must import exactly the compiled print CLI entrypoint.");
}

requireTokens(files.core, sources.core, [
  'SVG_PRINT_PREFLIGHT_CONTRACT_VERSION = "1.0"',
  '"commercial"',
  '"large-format"',
  '"cut-vinyl"',
  '"screen-print"',
  "trimWidthMm",
  "trimHeightMm",
  "bleedMm",
  "minimumStrokePt",
  "maximumProcessColours",
  "cmykOrSpotColourProofAvailable: false",
  'approval: "review-required"',
  "preflightSvgForPrint",
]);
requireTokens(files.coreIndex, sources.coreIndex, [
  'export * from "./print-preflight.js"',
]);
requireTokens(files.coreTests, sources.coreTests, [
  "commercial preflight verifies exact trim and bleed dimensions",
  "large-format preflight permits CSS pixel dimensions with a warning",
  "cut-vinyl preflight rejects live text and complex paint",
  "screen-print preflight enforces a configured process-colour ceiling",
  "cut-vinyl preflight rejects measured strokes below the line-weight floor",
  "preflight requires trim dimensions as an atomic pair",
]);

requireTokens(files.cli, sources.cli, [
  "evavo-vector-print preflight",
  "evavo-vector-print capabilities",
  "SVG_PRINT_PREFLIGHT_CONTRACT_VERSION",
  "preflightSvgForPrint",
  'approval: "review-required"',
  'error: "VECTOR_PRINT_OPTION_UNKNOWN"',
  'error: "VECTOR_PRINT_INPUT_EXTENSION_INVALID"',
]);
forbidTokens(files.cli, sources.cli, [
  'approval: "approved"',
  "writeFile(",
  "appendFile(",
]);

requireTokens(files.mcpPrint, sources.mcpPrint, [
  'VECTOR_MCP_PRINT_CONTRACT_VERSION = "1.0"',
  "VECTOR_MCP_PRINT_MAX_INPUT_BYTES",
  '"vector_preflight_svg_print"',
  "preflightSvgForPrint",
  "pathPolicy.resolveInputFile",
  "VECTOR_MCP_CANCELLED",
  "outputWritten: false",
  "generatedBodiesInModelContext: false",
  "productionApproval: false",
  'approval: "review-required"',
  'mcpContractVersion: "1.6"',
  "printPreflightEvidence: true",
  "printPreflightWritesFiles: false",
  "printProductionApproval: false",
]);
forbidTokens(files.mcpPrint, sources.mcpPrint, [
  "resolveOutputFile",
  "commitNewVectorFiles",
  "writeFile(",
  "appendFile(",
  "generatedBodiesInModelContext: true",
  "outputWritten: true",
  "productionApproval: true",
  'approval: "approved"',
]);
requireTokens(files.mcpPrintTests, sources.mcpPrintTests, [
  "exposes print preflight through the MCP handshake and writes no file",
  "fails cancellation before reading an SVG",
  "rejects non-SVG input through the stable MCP error boundary",
  'name: "vector_preflight_svg_print"',
  "VECTOR_MCP_SERVER_CONTRACT_VERSION",
  "printPreflightWritesFiles",
  "productionApproval",
  "assert.deepEqual(await readdir(root), before)",
]);
requireTokens(files.mcpServer, sources.mcpServer, [
  'VECTOR_MCP_SERVER_CONTRACT_VERSION = "1.6"',
  "registerVectorMcpPrintTools",
  "extendVectorMcpPrintCapabilities",
  "printOperations",
  "print preflight",
]);

requireTokens(files.route, sources.route, [
  'export const runtime = "nodejs"',
  'export const dynamic = "force-dynamic"',
  'const MAX_SVG_INPUT_BYTES = 5 * 1024 * 1024',
  'const MAX_REQUEST_BYTES = MAX_SVG_INPUT_BYTES + MULTIPART_OVERHEAD_ALLOWANCE',
  'const ALLOWED_FORM_FIELDS = new Set([',
  '"trimWidthMm"',
  '"trimHeightMm"',
  '"bleedMm"',
  '"minimumStrokePt"',
  '"maximumProcessColours"',
  '"allowText"',
  '"allowEmbeddedRaster"',
  '"allowTransparency"',
  "apiAuthorisationFailure(request",
  "allowWorkspaceSession: true",
  'contentType.startsWith("multipart/form-data")',
  "inspectFormShape(form)",
  "duplicateFields",
  "unknownFields",
  "new TextDecoder(\"utf-8\", { fatal: true })",
  "preflightSvgForPrint(source, optionsFromForm(form))",
  'operation: "print-preflight"',
  '"x-vector-print-preflight-contract"',
  '"x-vector-print-passed"',
  '"x-vector-review-required": "true"',
  "generatedBodiesIncluded: false",
  "productionApproval: false",
  "SvgPrintPreflightError",
  'error: "VECTOR_PRINT_PREFLIGHT_FAILED"',
]);
forbidTokens(files.route, sources.route, [
  "request.json()",
  'method: "GET"',
  "console.log(",
  "process.env",
  'productionApproval: true',
  'approval: "approved"',
  "message: error instanceof Error",
]);

requireTokens(files.capabilities, sources.capabilities, [
  "SVG_PRINT_PREFLIGHT_CONTRACT_VERSION",
  'MCP_CONTRACT_VERSION = "1.6"',
  "MCP_TOOL_COUNT = 16",
  'printPreflight: "/api/v1/print/preflight"',
  'printPreflight: "evavo-vector-print"',
  "printPreflight: Object.freeze({",
  '"commercial"',
  '"large-format"',
  '"cut-vinyl"',
  '"screen-print"',
  "physicalDimensions: true",
  "trimAndBleed: true",
  "minimumLineWeight: true",
  "processColourTokenInspection: true",
  "cmykOrSpotColourProofAvailable: false",
  "productionApproval: false",
  'approval: "review-required"',
]);

requireTokens(files.documentation, sources.documentation, [
  "# Governed SVG print preflight",
  "evavo-vector-print preflight",
  "POST /api/v1/print/preflight",
  "commercial",
  "large-format",
  "cut-vinyl",
  "screen-print",
  "strict `multipart/form-data`",
  "cmykOrSpotColourProofAvailable: false",
  "productionApproval: false",
  "review-required",
  "pnpm print-api:check",
]);
requireTokens(files.capabilityDocumentation, sources.capabilityDocumentation, [
  "vector_preflight_svg_print",
  "MCP contract `1.6`",
  "16 tools",
  "writes no file",
  "never places SVG markup in model context",
]);

requireTokens(files.workflow, sources.workflow, [
  "name: Vector Studio print preflight",
  '"apps/web/app/api/v1/print/preflight/**"',
  '"packages/vector-core/src/print-preflight.ts"',
  '"packages/cli/src/print-cli.ts"',
  '"packages/cli/bin/evavo-vector-print.mjs"',
  '"packages/mcp/src/print-tools.ts"',
  '"packages/mcp/src/print-tools.test.ts"',
  "node scripts/check-print-preflight-api-contract.mjs",
  "pnpm install --frozen-lockfile",
  "Failed to create bin",
  "Build canonical workspace packages",
  "pnpm build:packages",
  "DEPENDENCIES_OUTCOME: ${{ steps.dependencies.outcome }}",
  'process.env.DEPENDENCIES_OUTCOME === "success"',
  'test "$DEPENDENCIES_OUTCOME" = "success"',
  "pnpm --filter @evavo/vector-core test",
  "pnpm --filter @evavo/vector-cli test",
  "pnpm --filter @evavo/vector-mcp test",
  "pnpm --filter @evavo/vector-web typecheck",
  "pnpm exec turbo run build --filter=@evavo/vector-web",
  '"print/vector-preflight-contract"',
  '"print/vector-preflight-tests"',
  '"print/vector-preflight-build"',
]);
forbidTokens(files.workflow, sources.workflow, [
  "contents: write",
  "git push",
  "vercel deploy",
]);

if (errors.length > 0) {
  process.stderr.write(`${JSON.stringify({
    check: "evavo-vector-studio-print-preflight-api",
    ok: false,
    contractVersion: "1.1",
    errors,
  }, null, 2)}\n`);
  process.exit(1);
}

process.stdout.write(`${JSON.stringify({
  check: "evavo-vector-studio-print-preflight-api",
  ok: true,
  contractVersion: "1.1",
  endpoint: "/api/v1/print/preflight",
  cli: "evavo-vector-print",
  cliInstallSafeLauncher: true,
  mcpTool: "vector_preflight_svg_print",
  mcpContractVersion: "1.6",
  profiles: ["commercial", "large-format", "cut-vinyl", "screen-print"],
  deterministic: true,
  readOnly: true,
  receiptOnly: true,
  workspaceDependenciesBuiltBeforeCliAndMcpTests: true,
  productionApproval: false,
  checkedFiles: [...checkedFiles].sort(),
}, null, 2)}\n`);
