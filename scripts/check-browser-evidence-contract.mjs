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
    if (!source.includes(token)) errors.push(`${relativePath} is missing browser evidence token: ${token}`);
  }
}

const files = {
  verifier: "packages/vector-core/src/difference-artifact-verification.ts",
  verifierTests: "packages/vector-core/src/difference-artifact-verification.test.ts",
  workspace: "apps/web/app/components/TraceWorkspace.tsx",
  topology: "apps/web/app/components/TopologyEvidence.tsx",
  topologyStyles: "apps/web/app/components/TopologyEvidence.module.css",
  traceApi: "apps/web/app/api/v1/trace/route.ts",
  inputPolicyApi: "apps/web/app/api/v1/input-policy/route.ts",
  inputPolicy: "packages/raster-engine/src/input-policy.ts",
};
const sources = Object.fromEntries(await Promise.all(Object.entries(files).map(async ([key, relativePath]) => [key, await read(relativePath)])));

requireTokens(files.verifier, sources.verifier, [
  "DifferenceArtifactVerificationError",
  "DifferenceArtifactPayload",
  "PNG_SIGNATURE",
  "SHA256_PATTERN",
  "globalThis.atob",
  'String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]) !== "IHDR"',
  'cryptoApi.subtle.digest("SHA-256", bytes)',
  '"DIFFERENCE_CANDIDATE_MISMATCH"',
  '"DIFFERENCE_BYTE_COUNT_MISMATCH"',
  '"DIFFERENCE_DIMENSIONS_MISMATCH"',
  '"DIFFERENCE_SHA256_INVALID"',
]);

requireTokens(files.verifierTests, sources.verifierTests, [
  "verifies a base64 PNG against dimensions, bytes, candidate and SHA-256",
  "rejects a difference artefact for another candidate",
  "rejects an incorrect byte count",
  "rejects dimensions that do not match the PNG IHDR",
  "rejects an incorrect SHA-256",
  "rejects a non-PNG stream",
]);

requireTokens(files.workspace, sources.workspace, [
  "verifyDifferenceArtifactPayload,",
  "type DifferenceArtifactPayload",
  "await verifyDifferenceArtifactPayload(",
  "payload.evidence.selection.selectedCandidateId",
  "<TopologyEvidence topology={result.inspection.topology} findings={result.inspection.findings} />",
  "shared SHA-256 verifier passed",
  "Animated containers and multi-page TIFF are rejected before decoding",
]);

requireTokens(files.topology, sources.topology, [
  "TopologyInspection",
  "SVG_DUPLICATE_ID",
  "SVG_LOCAL_REFERENCE_UNRESOLVED",
  "SVG_TEXT_NOT_OUTLINED",
  "SVG_DUPLICATE_PATH_DATA",
  "SVG_OPEN_FILLED_SUBPATH",
  "Structural blockers detected",
  "Reviewable editability risks",
]);

requireTokens(files.topologyStyles, sources.topologyStyles, [
  ".blocked",
  ".review",
  ".clear",
  ".findings",
]);

requireTokens(files.traceApi, sources.traceApi, [
  'encoding: "base64" as const',
  'Buffer.from(differencePng).toString("base64")',
  "differenceEvidence && differencePng",
]);

requireTokens(files.inputPolicy, sources.inputPolicy, [
  'mode: "one-static-image-per-trace"',
  '"multi-frame-apng"',
  '"animated-gif"',
  '"animated-webp"',
  '"jpeg-mpo"',
  '"multi-page-tiff"',
]);

requireTokens(files.inputPolicyApi, sources.inputPolicyApi, [
  "RASTER_INPUT_POLICY",
  'errorCode: "RASTER_MULTI_IMAGE_UNSUPPORTED"',
  "maxDecodedPixels: DEFAULT_MAX_PIXELS",
]);

if (errors.length > 0) {
  process.stderr.write(`${JSON.stringify({ check: "browser-evidence-contract", ok: false, errors }, null, 2)}\n`);
  process.exit(1);
}

process.stdout.write(`${JSON.stringify({
  check: "browser-evidence-contract",
  ok: true,
  verifiedBoundaries: [
    "shared base64 transport verifier",
    "PNG signature and dimensions",
    "SHA-256",
    "selected candidate binding",
    "topology review UI",
    "static input policy discovery",
  ],
}, null, 2)}\n`);
