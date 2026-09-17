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
    if (!source.includes(token)) errors.push(`${relativePath} is missing browser dotLottie token: ${token}`);
  }
}

function forbidTokens(relativePath, source, tokens) {
  for (const token of tokens) {
    if (source.includes(token)) errors.push(`${relativePath} contains prohibited browser dotLottie token: ${token}`);
  }
}

const files = {
  rootPackage: "package.json",
  webPackage: "apps/web/package.json",
  workflow: ".github/workflows/quality.yml",
  review: "apps/web/app/motion/components/LottieReview.tsx",
  preview: "apps/web/app/motion/components/LottiePreview.tsx",
  styles: "apps/web/app/motion/components/LottieReview.module.css",
  api: "apps/web/app/api/v1/motion/dotlottie/route.ts",
  home: "apps/web/app/page.tsx",
  readme: "README.md",
  motionDocs: "docs/MOTION.md",
  lottieDocs: "docs/LOTTIE.md",
  dotLottieDocs: "docs/DOTLOTTIE.md",
  apiDocs: "docs/API.md",
};
const sources = Object.fromEntries(
  await Promise.all(Object.entries(files).map(async ([key, relativePath]) => [key, await read(relativePath)])),
);
const rootPackage = await readJson(files.rootPackage);
const webPackage = await readJson(files.webPackage);

if (webPackage?.dependencies?.["@lottiefiles/dotlottie-react"] !== "0.19.12") {
  errors.push("apps/web must pin @lottiefiles/dotlottie-react to the reviewed 0.19.12 player.");
}
if (rootPackage?.scripts?.["dotlottie-workspace:check"] !== "node scripts/check-dotlottie-workspace-contract.mjs") {
  errors.push("package.json must expose dotlottie-workspace:check.");
}
if (!String(rootPackage?.scripts?.check ?? "").includes("pnpm dotlottie-workspace:check")) {
  errors.push("package.json check must include dotlottie-workspace:check before dependency-backed gates.");
}

requireTokens(files.workflow, sources.workflow, [
  "Verify browser dotLottie contract",
  "node scripts/check-dotlottie-workspace-contract.mjs",
]);
requireTokens(files.review, sources.review, [
  'fetch("/api/v1/motion/dotlottie"',
  'form.set("animationId", animationId)',
  "decodeBase64Archive",
  "sha256Bytes",
  "bytes[0] !== 0x50",
  "archiveHash !== evidence.output.sha256",
  'browserArchiveLoadValidation !== "not-yet-performed"',
  'setArchiveLoadState("loading")',
  'setArchiveLoadState("passed")',
  'setArchiveLoadState("failed")',
  "onLoad={() =>",
  "onLoadError={(message) =>",
  "Browser archive-load validation passed",
  "does not establish source-to-player render equivalence",
  "Download dotLottie archive",
  "Download dotLottie evidence",
  'new Blob([archiveBuffer], { type: "application/zip+dotlottie" })',
  "browserArchiveLoadValidation:",
  "playerRenderValidation: false",
]);
forbidTokens(files.review, sources.review, [
  "dangerouslySetInnerHTML",
  "innerHTML",
  "document.write",
  "<iframe",
  "<object",
  "<embed",
  "eval(",
  "new Function(",
  "playerRenderValidation: true",
  'approval: "approved"',
]);
requireTokens(files.preview, sources.preview, [
  "data: string | ArrayBuffer",
  "dotLottieRefCallback",
  'player.addEventListener("load", loaded)',
  'player.addEventListener("loadError", failed)',
  'player.removeEventListener("load", loaded)',
  'player.removeEventListener("loadError", failed)',
  "onLoad?.()",
  "onLoadError?.(message)",
]);
requireTokens(files.styles, sources.styles, [
  ".previewSwitch",
  ".previewSwitchActive",
  ".archivePassed",
  ".archiveFailed",
  ".archivePending",
  ".evidenceLabel",
]);
requireTokens(files.api, sources.api, [
  'endpoint: "/api/v1/motion/dotlottie"',
  'encoding: "base64"',
  'Buffer.from(packaged.bytes).toString("base64")',
  "browserArchiveLoadValidation: false",
  "playerRenderValidation: false",
]);
requireTokens(files.home, sources.home, [
  "Lottie + dotLottie",
  "UI + API + CLI + MCP available",
  "official-player loading",
]);
requireTokens(files.readme, sources.readme, [
  "generate deterministic dotLottie v2",
  "browser archive-load validation is available after exact archive verification",
  "Independent player-render validation remains unavailable",
  "POST /api/v1/motion/dotlottie",
]);
requireTokens(files.motionDocs, sources.motionDocs, [
  "browser Lottie player preview",
  "Deterministic dotLottie packaging is available",
  "Browser archive-load validation is available",
]);
requireTokens(files.lottieDocs, sources.lottieDocs, [
  "/api/v1/motion/dotlottie",
  "browser dotLottie archive-load validation",
  "@lottiefiles/dotlottie-react",
]);
requireTokens(files.dotLottieDocs, sources.dotLottieDocs, [
  "## Browser Motion Director workflow",
  "browser archive-load validation",
  "@lottiefiles/dotlottie-react",
  "does not establish source-to-player render equivalence",
]);
requireTokens(files.apiDocs, sources.apiDocs, [
  "# dotLottie API",
  "browser archive-load validation",
  "format=dotlottie",
]);

if (errors.length > 0) {
  process.stderr.write(`${JSON.stringify({
    check: "evavo-vector-studio-dotlottie-workspace-contract",
    ok: false,
    contractVersion: "1.1",
    errors,
  }, null, 2)}\n`);
  process.exit(1);
}

process.stdout.write(`${JSON.stringify({
  check: "evavo-vector-studio-dotlottie-workspace-contract",
  ok: true,
  contractVersion: "1.1",
  player: "@lottiefiles/dotlottie-react@0.19.12",
  verifiedBoundaries: [
    "base64 archive decoding",
    "ZIP local-file signature",
    "archive byte count and SHA-256",
    "manifest and animation identity",
    "server archive and embedded-Lottie inspection",
    "ArrayBuffer delivery to official player",
    "load and loadError lifecycle evidence",
    "reduced-motion autoplay suppression",
    "downloadable .lottie and evidence",
    "render-equivalence non-claim",
  ],
  checkedFiles: [...checkedFiles].sort(),
}, null, 2)}\n`);
