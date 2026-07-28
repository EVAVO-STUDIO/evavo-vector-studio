import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const errors = [];

async function read(relativePath) {
  try {
    return (await fs.readFile(path.join(root, relativePath), "utf8")).replace(/^\uFEFF/, "");
  } catch (error) {
    errors.push(`Missing or unreadable file: ${relativePath} (${error instanceof Error ? error.message : String(error)})`);
    return "";
  }
}

function requireTokens(relativePath, source, tokens) {
  for (const token of tokens) {
    if (!source.includes(token)) errors.push(`${relativePath} is missing topology token: ${token}`);
  }
}

const files = {
  topology: "packages/vector-core/src/svg-topology.ts",
  inspection: "packages/vector-core/src/svg.ts",
  index: "packages/vector-core/src/index.ts",
  tests: "packages/vector-core/src/svg-topology.test.ts",
};
const sources = Object.fromEntries(await Promise.all(Object.entries(files).map(async ([key, relativePath]) => [key, await read(relativePath)])));

requireTokens(files.topology, sources.topology, [
  "duplicateIdCount",
  "unresolvedReferenceCount",
  "duplicatePathDataCount",
  "compoundPathCount",
  "closedSubpathCount",
  "openSubpathCount",
  "potentialOpenFilledPathCount",
  "textElementCount",
  "useElementCount",
  "styleElementCount",
  "transformedElementCount",
  "nonPathShapeCount",
  "inspectSvgTopology",
]);

requireTokens(files.inspection, sources.inspection, [
  'import { inspectSvgTopology, type SvgTopologyInspection } from "./svg-topology.js"',
  "topology: SvgTopologyInspection",
  "const topology = inspectSvgTopology(trimmed)",
  'code: "SVG_DUPLICATE_ID"',
  'code: "SVG_LOCAL_REFERENCE_UNRESOLVED"',
  'code: "SVG_TEXT_NOT_OUTLINED"',
  'code: "SVG_DUPLICATE_PATH_DATA"',
  'code: "SVG_OPEN_FILLED_SUBPATH"',
  "topology,",
]);

requireTokens(files.index, sources.index, ['export * from "./svg-topology.js"']);
requireTokens(files.tests, sources.tests, [
  "rejects duplicate IDs and unresolved local references",
  "reports duplicate paths, open filled geometry and unoutlined text",
  "counts compound and explicitly even-odd geometry",
]);

if (errors.length > 0) {
  process.stderr.write(`${JSON.stringify({ check: "svg-topology-contract", ok: false, errors }, null, 2)}\n`);
  process.exit(1);
}

process.stdout.write(`${JSON.stringify({
  check: "svg-topology-contract",
  ok: true,
  findings: [
    "duplicate IDs",
    "unresolved local references",
    "duplicate path data",
    "open filled subpaths",
    "unoutlined text",
    "use and style indirection",
    "compound and even-odd geometry",
  ],
}, null, 2)}\n`);
