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
    if (!source.includes(token)) errors.push(`${relativePath} is missing dotLottie API contract token: ${token}`);
  }
}

function forbidTokens(relativePath, source, tokens) {
  for (const token of tokens) {
    if (source.includes(token)) errors.push(`${relativePath} contains prohibited dotLottie API contract token: ${token}`);
  }
}

const rootPackage = await readJson("package.json");
const webPackage = await readJson("apps/web/package.json");
const files = {
  route: "apps/web/app/api/v1/motion/dotlottie/route.ts",
  lottieRoute: "apps/web/app/api/v1/motion/lottie/route.ts",
  page: "apps/web/app/page.tsx",
  readme: "README.md",
  apiDocs: "docs/API.md",
  dotLottieDocs: "docs/DOTLOTTIE.md",
  lottieDocs: "docs/LOTTIE.md",
  workflow: ".github/workflows/quality.yml",
};
const sources = Object.fromEntries(
  await Promise.all(Object.entries(files).map(async ([key, relativePath]) => [key, await read(relativePath)])),
);

if (webPackage?.dependencies?.["@evavo/lottie-engine"] !== "workspace:*") {
  errors.push("apps/web must depend on @evavo/lottie-engine through the workspace.");
}
if (rootPackage?.scripts?.["dotlottie-api:check"] !== "node scripts/check-dotlottie-api-contract.mjs") {
  errors.push("package.json must expose dotlottie-api:check.");
}
if (!String(rootPackage?.scripts?.check ?? "").includes("pnpm dotlottie-api:check")) {
  errors.push("package.json check must include dotlottie-api:check before dependency-backed gates.");
}

requireTokens(files.route, sources.route, [
  'endpoint: "/api/v1/motion/dotlottie"',
  "MAX_SVG_INPUT_BYTES = 5 * 1024 * 1024",
  "MAX_MOTION_PLAN_BYTES = 256 * 1024",
  "MAX_BASE64_ARCHIVE_BYTES = 8 * 1024 * 1024",
  "MAX_DOTLOTTIE_ARCHIVE_BYTES",
  'configuredToken = process.env.VECTOR_API_TOKEN?.trim()',
  'contentType.startsWith("multipart/form-data")',
  'const ALLOWED_FORM_FIELDS = new Set([',
  '"animationId"',
  '"DOTLOTTIE_REQUEST_FIELD_UNSUPPORTED"',
  '"DOTLOTTIE_REQUEST_FIELD_DUPLICATE"',
  '"DOTLOTTIE_MULTIPART_INVALID"',
  "Provide exactly one of motion or motionFile.",
  'format !== "json" && format !== "dotlottie"',
  "createLottieFromSvgMotion(",
  "createDotLottiePackage(lottie.json",
  '"content-type": DOTLOTTIE_MIME_TYPE',
  '"x-vector-dotlottie-contract": DOTLOTTIE_CONTRACT_VERSION',
  '"x-vector-dotlottie-manifest-version": DOTLOTTIE_MANIFEST_VERSION',
  '"x-vector-dotlottie-archive-inspection": "passed"',
  '"x-vector-dotlottie-embedded-lottie-inspection": "passed"',
  '"x-vector-player-render-validation": "not-performed"',
  '"x-vector-browser-archive-load-validation": "not-performed"',
  'encoding: "base64"',
  'Buffer.from(packaged.bytes).toString("base64")',
  'error: "DOTLOTTIE_BASE64_RESPONSE_TOO_LARGE"',
  "archiveInspection: true",
  "embeddedLottieInspection: true",
  "playerRenderValidation: false",
  "browserArchiveLoadValidation: false",
  "approval: packaged.evidence.approval",
  'headers.set("cache-control", "no-store, max-age=0")',
]);
forbidTokens(files.route, sources.route, [
  "eval(",
  "new Function(",
  'playerRenderValidation: true',
  'browserArchiveLoadValidation: true',
  'approval: "approved"',
]);

requireTokens(files.lottieRoute, sources.lottieRoute, [
  'endpoint: "/api/v1/motion/lottie"',
  'playerRenderValidation: false',
]);
requireTokens(files.page, sources.page, [
  "/api/v1/motion/dotlottie",
  "dotLottie API",
]);
requireTokens(files.readme, sources.readme, [
  "POST /api/v1/motion/dotlottie",
  "deterministic dotLottie",
  "browser archive-load validation",
]);
requireTokens(files.apiDocs, sources.apiDocs, [
  "# dotLottie API",
  "POST /api/v1/motion/dotlottie",
  "application/zip+dotlottie",
  "8 MiB",
  "X-Vector-DotLottie-Contract",
  "browser archive-load validation",
]);
requireTokens(files.dotLottieDocs, sources.dotLottieDocs, [
  "## HTTP API workflow",
  "/api/v1/motion/dotlottie",
  "format=dotlottie",
]);
requireTokens(files.lottieDocs, sources.lottieDocs, [
  "dotLottie packaging",
  "/api/v1/motion/dotlottie",
]);
requireTokens(files.workflow, sources.workflow, [
  "Verify dotLottie API contract",
  "node scripts/check-dotlottie-api-contract.mjs",
]);

if (errors.length > 0) {
  process.stderr.write(`${JSON.stringify({
    check: "evavo-vector-studio-dotlottie-api-contract",
    ok: false,
    dotLottieContractVersion: "1.0",
    errors,
  }, null, 2)}\n`);
  process.exit(1);
}

process.stdout.write(`${JSON.stringify({
  check: "evavo-vector-studio-dotlottie-api-contract",
  ok: true,
  dotLottieContractVersion: "1.0",
  endpoint: "/api/v1/motion/dotlottie",
  directMimeType: "application/zip+dotlottie",
  wrapperEncoding: "base64",
  compatibility: {
    archiveInspection: true,
    embeddedLottieInspection: true,
    playerRenderValidation: false,
    browserArchiveLoadValidation: false,
  },
  checkedFiles: [...checkedFiles].sort(),
}, null, 2)}\n`);
