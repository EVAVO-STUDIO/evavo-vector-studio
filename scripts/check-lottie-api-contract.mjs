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
    if (!source.includes(token)) errors.push(`${relativePath} is missing Lottie API contract token: ${token}`);
  }
}

function forbidTokens(relativePath, source, tokens) {
  for (const token of tokens) {
    if (source.includes(token)) errors.push(`${relativePath} contains prohibited Lottie API contract token: ${token}`);
  }
}

const rootPackage = await readJson("package.json");
const webPackage = await readJson("apps/web/package.json");
const files = {
  route: "apps/web/app/api/v1/motion/lottie/route.ts",
  motionRoute: "apps/web/app/api/v1/motion/svg/route.ts",
  dotLottieRoute: "apps/web/app/api/v1/motion/dotlottie/route.ts",
  page: "apps/web/app/page.tsx",
  readme: "README.md",
  apiDocs: "docs/API.md",
  lottieDocs: "docs/LOTTIE.md",
  motionDocs: "docs/MOTION.md",
  workflow: ".github/workflows/quality.yml",
};
const sources = Object.fromEntries(
  await Promise.all(Object.entries(files).map(async ([key, relativePath]) => [key, await read(relativePath)])),
);

if (webPackage?.dependencies?.["@evavo/lottie-engine"] !== "workspace:*") {
  errors.push("apps/web must depend on @evavo/lottie-engine through the workspace.");
}
if (rootPackage?.scripts?.["lottie-api:check"] !== "node scripts/check-lottie-api-contract.mjs") {
  errors.push("package.json must expose lottie-api:check.");
}
if (!String(rootPackage?.scripts?.check ?? "").includes("pnpm lottie-api:check")) {
  errors.push("package.json check must include lottie-api:check before dependency-backed gates.");
}

requireTokens(files.route, sources.route, [
  'endpoint: "/api/v1/motion/lottie"',
  "MAX_SVG_INPUT_BYTES = 5 * 1024 * 1024",
  "MAX_MOTION_PLAN_BYTES = 256 * 1024",
  "MAX_LOTTIE_OUTPUT_BYTES = 20 * 1024 * 1024",
  'configuredToken = process.env.VECTOR_API_TOKEN?.trim()',
  'contentType.startsWith("multipart/form-data")',
  'const ALLOWED_FORM_FIELDS = new Set([',
  '"frameRate"',
  '"precision"',
  '"name"',
  '"LOTTIE_REQUEST_FIELD_UNSUPPORTED"',
  '"LOTTIE_REQUEST_FIELD_DUPLICATE"',
  '"LOTTIE_MULTIPART_INVALID"',
  "Provide exactly one of motion or motionFile.",
  'format !== "json" && format !== "lottie"',
  'createLottieFromSvgMotion(',
  '"content-type": "video/lottie+json; charset=utf-8"',
  '"x-vector-lottie-contract": LOTTIE_CONTRACT_VERSION',
  '"x-vector-lottie-structural-inspection": "passed"',
  '"x-vector-lottie-player-validation": "not-performed"',
  'encoding: "utf8-json"',
  'data: result.json',
  'playerRenderValidation: false',
  'approval: result.evidence.approval',
  'headers.set("cache-control", "no-store, max-age=0")',
]);
forbidTokens(files.route, sources.route, [
  "eval(",
  "new Function(",
  'playerRenderValidation: true',
  'approval: "approved"',
]);

requireTokens(files.motionRoute, sources.motionRoute, [
  'lottieJsonExportAvailable: true',
  'lottieEndpoint: "/api/v1/motion/lottie"',
  'lottiePlayerRenderValidationAvailable: false',
]);
requireTokens(files.dotLottieRoute, sources.dotLottieRoute, [
  'endpoint: "/api/v1/motion/dotlottie"',
  'createDotLottiePackage(lottie.json',
  'playerRenderValidation: false',
]);
requireTokens(files.page, sources.page, [
  "Lottie + dotLottie",
  "UI + API + CLI + MCP available",
  "Independent source-to-player render validation",
]);
requireTokens(files.readme, sources.readme, [
  "POST /api/v1/motion/lottie",
  "Governed Lottie JSON export and inspection are available through the core Lottie package, CLI and HTTP API",
  "Independent player-render and browser archive-load validation also remain unavailable",
]);
requireTokens(files.apiDocs, sources.apiDocs, [
  "# Lottie JSON API",
  "POST /api/v1/motion/lottie",
  "video/lottie+json",
  "20 MiB",
  "X-Vector-Lottie-Player-Validation",
  "not-performed",
  "separate `/api/v1/motion/dotlottie` endpoint",
]);
requireTokens(files.lottieDocs, sources.lottieDocs, [
  "## HTTP API workflow",
  "/api/v1/motion/lottie",
  "format=lottie",
  "playerRenderValidation: not-yet-performed",
  "/api/v1/motion/dotlottie",
]);
requireTokens(files.motionDocs, sources.motionDocs, [
  "Lottie HTTP API is available",
  "/api/v1/motion/lottie",
  "Independent player-render validation",
]);
requireTokens(files.workflow, sources.workflow, [
  "Verify Lottie API contract",
  "node scripts/check-lottie-api-contract.mjs",
]);

if (errors.length > 0) {
  process.stderr.write(`${JSON.stringify({
    check: "evavo-vector-studio-lottie-api-contract",
    ok: false,
    lottieContractVersion: "1.0",
    errors,
  }, null, 2)}\n`);
  process.exit(1);
}

process.stdout.write(`${JSON.stringify({
  check: "evavo-vector-studio-lottie-api-contract",
  ok: true,
  lottieContractVersion: "1.0",
  endpoint: "/api/v1/motion/lottie",
  directMimeType: "video/lottie+json",
  separateDotLottieEndpoint: "/api/v1/motion/dotlottie",
  compatibility: {
    structuralInspection: true,
    playerRenderValidation: false,
  },
  checkedFiles: [...checkedFiles].sort(),
}, null, 2)}\n`);
