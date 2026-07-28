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
    errors.push(`Missing or unreadable file: ${relativePath} (${error instanceof Error ? error.message : String(error)})`);
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
    if (!source.includes(token)) errors.push(`${relativePath} is missing native-runtime boundary token: ${token}`);
  }
}

function forbidTokens(relativePath, source, tokens) {
  for (const token of tokens) {
    if (source.includes(token)) errors.push(`${relativePath} crosses the native-runtime boundary through: ${token}`);
  }
}

const files = {
  rootPackage: "package.json",
  rasterPackage: "packages/raster-engine/package.json",
  policyEntry: "packages/raster-engine/src/policy.ts",
  inputPolicyRoute: "apps/web/app/api/v1/input-policy/route.ts",
  traceRoute: "apps/web/app/api/v1/trace/route.ts",
  nextConfig: "apps/web/next.config.mjs",
  workflow: ".github/workflows/quality.yml",
};
const sources = Object.fromEntries(
  await Promise.all(Object.entries(files).map(async ([key, relativePath]) => [key, await read(relativePath)])),
);
const rootPackage = await readJson(files.rootPackage);
const rasterPackage = await readJson(files.rasterPackage);

if (rootPackage?.scripts?.["native-runtime:check"] !== "node scripts/check-native-runtime-boundary.mjs") {
  errors.push("package.json must expose native-runtime:check.");
}
if (!String(rootPackage?.scripts?.check ?? "").includes("pnpm native-runtime:check")) {
  errors.push("package.json check must include native-runtime:check before dependency-backed gates.");
}

const policyExport = rasterPackage?.exports?.["./policy"];
if (policyExport?.types !== "./src/policy.ts" || policyExport?.import !== "./dist/policy.js" || policyExport?.default !== "./dist/policy.js") {
  errors.push("@evavo/raster-engine must publish ./policy from source types and dist runtime files.");
}

requireTokens(files.policyEntry, sources.policyEntry, [
  'from "./input-policy.js"',
  'from "./types.js"',
  "RASTER_INPUT_POLICY",
  "DEFAULT_MAX_INPUT_BYTES",
  "DEFAULT_MAX_PIXELS",
]);
forbidTokens(files.policyEntry, sources.policyEntry, [
  "./engine.js",
  "./comparison.js",
  "./difference.js",
  "@neplex/vectorizer",
  "@resvg/resvg-js",
]);

requireTokens(files.inputPolicyRoute, sources.inputPolicyRoute, [
  'from "@evavo/raster-engine/policy"',
  'errorCode: "RASTER_MULTI_IMAGE_UNSUPPORTED"',
]);
forbidTokens(files.inputPolicyRoute, sources.inputPolicyRoute, [
  'from "@evavo/raster-engine"',
  "traceRaster",
  "inspectRaster",
  "@neplex/vectorizer",
  "@resvg/resvg-js",
]);

requireTokens(files.traceRoute, sources.traceRoute, [
  'from "@evavo/raster-engine"',
  'export const runtime = "nodejs"',
  "traceRaster",
]);

requireTokens(files.nextConfig, sources.nextConfig, [
  '"@neplex/vectorizer"',
  '"@resvg/resvg-js"',
  "serverComponentsExternalPackages: nativeServerPackages",
  "webpack(config, { isServer })",
  "config.externals = [...existing, ...nativeServerPackages]",
]);

requireTokens(files.workflow, sources.workflow, [
  "Verify native runtime boundary",
  "node scripts/check-native-runtime-boundary.mjs",
]);

if (errors.length > 0) {
  process.stderr.write(`${JSON.stringify({
    check: "evavo-vector-studio-native-runtime-boundary",
    ok: false,
    errors,
  }, null, 2)}\n`);
  process.exit(1);
}

process.stdout.write(`${JSON.stringify({
  check: "evavo-vector-studio-native-runtime-boundary",
  ok: true,
  dependencyFreePolicyEntry: "@evavo/raster-engine/policy",
  externalNativePackages: ["@neplex/vectorizer", "@resvg/resvg-js"],
  checkedFiles: [...checkedFiles].sort(),
}, null, 2)}\n`);
