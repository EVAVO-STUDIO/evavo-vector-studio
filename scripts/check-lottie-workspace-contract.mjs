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
    if (!source.includes(token)) errors.push(`${relativePath} is missing browser Lottie token: ${token}`);
  }
}

function forbidTokens(relativePath, source, tokens) {
  for (const token of tokens) {
    if (source.includes(token)) errors.push(`${relativePath} contains prohibited browser Lottie token: ${token}`);
  }
}

const files = {
  rootPackage: "package.json",
  webPackage: "apps/web/package.json",
  workflow: ".github/workflows/quality.yml",
  workspace: "apps/web/app/motion/components/MotionWorkspace.tsx",
  review: "apps/web/app/motion/components/LottieReview.tsx",
  preview: "apps/web/app/motion/components/LottiePreview.tsx",
  styles: "apps/web/app/motion/components/LottieReview.module.css",
  api: "apps/web/app/api/v1/motion/lottie/route.ts",
  home: "apps/web/app/page.tsx",
  readme: "README.md",
  motionDocs: "docs/MOTION.md",
  lottieDocs: "docs/LOTTIE.md",
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
if (rootPackage?.scripts?.["lottie-workspace:check"] !== "node scripts/check-lottie-workspace-contract.mjs") {
  errors.push("package.json must expose lottie-workspace:check.");
}
if (!String(rootPackage?.scripts?.check ?? "").includes("pnpm lottie-workspace:check")) {
  errors.push("package.json check must include lottie-workspace:check before dependency-backed gates.");
}

requireTokens(files.workflow, sources.workflow, [
  "Verify browser Lottie contract",
  "node scripts/check-lottie-workspace-contract.mjs",
]);
requireTokens(files.workspace, sources.workspace, [
  'import LottieReview from "./LottieReview"',
  "<LottieReview",
  "sourceFile={sourceFile}",
  "sourceText={sourceText}",
  "plan={planState.plan}",
  "planJson={planJson}",
  "prefersReducedMotion={prefersReducedMotion}",
]);
requireTokens(files.review, sources.review, [
  '"use client"',
  'import styles from "./LottieReview.module.css"',
  'fetch("/api/v1/motion/lottie"',
  'form.set("motion", planJson)',
  'form.set("format", "json")',
  'form.set("frameRate", String(frameRate))',
  'form.set("precision", String(precision))',
  'globalThis.crypto.subtle.digest("SHA-256"',
  "verifyLottieResponse",
  "JSON.parse(response.lottie.data)",
  'playerRenderValidation !== "not-yet-performed"',
  'dotLottiePackaging !== "not-yet-available"',
  "independent source-to-player render validation has not been performed",
  "Download Lottie JSON",
  "Download Lottie evidence",
  "prefersReducedMotion",
  "LottiePreview",
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
  'playerRenderValidation: true',
  'approval: "approved"',
]);
requireTokens(files.preview, sources.preview, [
  'dynamic(',
  '@lottiefiles/dotlottie-react',
  'ssr: false',
  'data={data}',
  'autoplay={autoplay}',
  'loop={loop}',
  'layout={{ fit: "contain", align: [0.5, 0.5] }}',
  "Official LottieFiles player preview",
]);
forbidTokens(files.preview, sources.preview, [
  "dangerouslySetInnerHTML",
  "eval(",
  "new Function(",
]);
requireTokens(files.styles, sources.styles, [
  ".lottiePanel",
  ".lottieControls",
  ".lottiePreview",
  ".lottieCanvas",
  ".lottieNotice",
  ".lottieEvidence",
  ".staleBadge",
  ".verifiedBadge",
  "@media (max-width: 760px)",
  "@media (prefers-reduced-motion: reduce)",
]);
requireTokens(files.api, sources.api, [
  'endpoint: "/api/v1/motion/lottie"',
  'format: ["json", "lottie"]',
  'data: result.json',
  'playerRenderValidation: false',
  'dotLottiePackaging: false',
]);
requireTokens(files.home, sources.home, [
  "Core + CLI + API available · MCP + browser preview",
  "Independent player-render validation",
  "dotLottie remain planned",
]);
requireTokens(files.readme, sources.readme, [
  "browser Lottie player preview",
  "independent player-render validation remains unavailable",
  "/api/v1/motion/lottie",
]);
requireTokens(files.motionDocs, sources.motionDocs, [
  "browser Lottie player preview",
  "Independent player-render validation",
]);
requireTokens(files.lottieDocs, sources.lottieDocs, [
  "browser Lottie player preview",
  "@lottiefiles/dotlottie-react",
  "not independent source-to-player validation",
]);
requireTokens(files.apiDocs, sources.apiDocs, [
  "/api/v1/motion/lottie",
  "browser Motion Director",
  "player preview",
]);

if (errors.length > 0) {
  process.stderr.write(`${JSON.stringify({
    check: "evavo-vector-studio-lottie-workspace-contract",
    ok: false,
    contractVersion: "1.0",
    errors,
  }, null, 2)}\n`);
  process.exit(1);
}

process.stdout.write(`${JSON.stringify({
  check: "evavo-vector-studio-lottie-workspace-contract",
  ok: true,
  contractVersion: "1.0",
  player: "@lottiefiles/dotlottie-react@0.19.12",
  verifiedBoundaries: [
    "exact JSON transport verification",
    "source and output SHA-256",
    "structural inspection",
    "isolated client-only player",
    "reduced-motion autoplay suppression",
    "stale-result signalling",
    "downloadable JSON and evidence",
    "player-equivalence non-claim",
  ],
  checkedFiles: [...checkedFiles].sort(),
}, null, 2)}\n`);
