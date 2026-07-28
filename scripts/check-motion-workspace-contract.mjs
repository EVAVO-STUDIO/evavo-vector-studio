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
    if (!source.includes(token)) errors.push(`${relativePath} is missing Motion Director contract token: ${token}`);
  }
}

function forbidTokens(relativePath, source, tokens) {
  for (const token of tokens) {
    if (source.includes(token)) errors.push(`${relativePath} contains prohibited Motion Director token: ${token}`);
  }
}

const files = {
  rootPackage: "package.json",
  workflow: ".github/workflows/quality.yml",
  globalStyles: "apps/web/app/styles.css",
  home: "apps/web/app/page.tsx",
  page: "apps/web/app/motion/page.tsx",
  pageStyles: "apps/web/app/motion/page.module.css",
  workspace: "apps/web/app/motion/components/MotionWorkspace.tsx",
  workspaceStyles: "apps/web/app/motion/components/MotionWorkspace.module.css",
  model: "apps/web/app/motion/components/motion-model.ts",
  api: "apps/web/app/api/v1/motion/svg/route.ts",
  readme: "README.md",
  motionDocs: "docs/MOTION.md",
  apiDocs: "docs/API.md",
};

const sources = Object.fromEntries(
  await Promise.all(Object.entries(files).map(async ([key, relativePath]) => [key, await read(relativePath)])),
);
const rootPackage = await readJson(files.rootPackage);

if (rootPackage?.scripts?.["motion-workspace:check"] !== "node scripts/check-motion-workspace-contract.mjs") {
  errors.push("package.json must expose motion-workspace:check through the dependency-free Motion Director gate.");
}
if (!String(rootPackage?.scripts?.check ?? "").includes("pnpm motion-workspace:check")) {
  errors.push("package.json check must include pnpm motion-workspace:check before dependency-backed gates.");
}

requireTokens(files.workflow, sources.workflow, [
  "Verify Motion Director contract",
  "node scripts/check-motion-workspace-contract.mjs",
]);

requireTokens(files.globalStyles, sources.globalStyles, [
  "#director form>section:nth-of-type(4)>div:first-child>span",
]);

requireTokens(files.home, sources.home, [
  'href="/motion"',
  "Motion Director",
  "UI + API + CLI + MCP",
]);

requireTokens(files.page, sources.page, [
  'import MotionWorkspace from "./components/MotionWorkspace"',
  "Motion Director · EVAVO Vector Studio",
  'id="director"',
  '<MotionWorkspace />',
  'id="boundary"',
  "Script-free output · verified evidence · human review",
]);
forbidTokens(files.page, sources.page, ["dangerouslySetInnerHTML", "<iframe", "<object", "<embed"]);

requireTokens(files.pageStyles, sources.pageStyles, [
  ".heroGrid",
  ".heroRail",
  ".introGrid",
  ".boundaryGrid",
  "@media (max-width: 720px)",
]);

requireTokens(files.workspace, sources.workspace, [
  '"use client"',
  'fetch("/api/v1/motion/svg"',
  'form.set("motion", JSON.stringify(planState.plan))',
  'form.set("format", "json")',
  'globalThis.crypto.subtle.digest("SHA-256"',
  'data-evavo-motion-contract="1.0"',
  "response.evidence.motion.id !== response.inspection.motionId",
  "response.evidence.output.styleId !== response.inspection.styleId",
  "response.inspection.reducedMotionFallback",
  'window.matchMedia("(prefers-reduced-motion: reduce)")',
  "URL.createObjectURL",
  "Plan changed after this build",
  "Download animated SVG",
  "Download motion plan",
  "Download evidence",
]);
forbidTokens(files.workspace, sources.workspace, [
  "dangerouslySetInnerHTML",
  "innerHTML",
  "document.write",
  "<iframe",
  "<object",
  "<embed",
  "eval(",
  "new Function(",
]);

requireTokens(files.workspaceStyles, sources.workspaceStyles, [
  ".workspace",
  ".editor",
  ".review",
  ".dropzoneActive",
  ".trackStack",
  ".frameRow",
  ".previewGrid",
  ".evidenceHeading",
  ".verifiedBadge",
  ".staleBadge",
  ".warnings",
  "@media (max-width: 1100px)",
  "@media (prefers-reduced-motion: reduce)",
]);

requireTokens(files.model, sources.model, [
  'MOTION_SCHEMA_URL = "https://evavo.com.au/schemas/vector-studio/motion-v1.schema.json"',
  "inspectSvgForMotion",
  "buildMotionPlan",
  "Duplicate SVG IDs must be resolved before motion authoring",
  "External asset references are not permitted",
  "existing animation was detected",
  "already has a base transform",
  "keyframe offsets must be strictly increasing",
]);
forbidTokens(files.model, sources.model, ["eval(", "new Function("]);

requireTokens(files.api, sources.api, [
  'endpoint: "/api/v1/motion/svg"',
  'format: ["json", "svg"]',
  "MAX_SVG_INPUT_BYTES",
  "MAX_MOTION_PLAN_BYTES",
  "Provide exactly one of motion or motionFile",
  "validateAnimatedSvgMotionSpec",
  "createAnimatedSvg",
  '"x-vector-reduced-motion": "true"',
  'approval: result.evidence.approval',
]);

for (const [relativePath, source, tokens] of [
  [files.readme, sources.readme, ["Motion Director", "browser", "/motion", "human-review-required"]],
  [files.motionDocs, sources.motionDocs, ["browser Motion Director", "/motion", "SHA-256", "reduced-motion"]],
  [files.apiDocs, sources.apiDocs, ["/api/v1/motion/svg", "multipart/form-data"]],
]) {
  requireTokens(relativePath, source, tokens);
}

if (errors.length > 0) {
  process.stderr.write(`${JSON.stringify({
    check: "evavo-vector-studio-motion-workspace-contract",
    ok: false,
    contractVersion: "1.0",
    errors,
  }, null, 2)}\n`);
  process.exit(1);
}

process.stdout.write(`${JSON.stringify({
  check: "evavo-vector-studio-motion-workspace-contract",
  ok: true,
  contractVersion: "1.0",
  verifiedBoundaries: [
    "route and navigation",
    "responsive authoring surface",
    "safe SVG preview",
    "motion-plan validation",
    "browser SHA-256 verification",
    "reduced-motion evidence",
    "stale-result signalling",
    "downloadable production artefacts",
  ],
  checkedFiles: [...checkedFiles].sort(),
}, null, 2)}\n`);
