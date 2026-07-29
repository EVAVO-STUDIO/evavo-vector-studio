import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const errors = [];
const checkedFiles = new Set();

function fail(message) {
  errors.push(message);
}

async function read(relativePath) {
  checkedFiles.add(relativePath);
  try {
    return (await fs.readFile(path.join(root, relativePath), "utf8")).replace(/^\uFEFF/, "");
  } catch (error) {
    fail(`Missing or unreadable file: ${relativePath} (${error instanceof Error ? error.message : String(error)})`);
    return "";
  }
}

async function readJson(relativePath) {
  const source = await read(relativePath);
  if (!source) return null;
  try {
    return JSON.parse(source);
  } catch (error) {
    fail(`Invalid JSON: ${relativePath} (${error instanceof Error ? error.message : String(error)})`);
    return null;
  }
}

function requireTokens(relativePath, source, tokens) {
  for (const token of tokens) {
    if (!source.includes(token)) fail(`${relativePath} is missing motion API contract token: ${token}`);
  }
}

function forbidTokens(relativePath, source, tokens) {
  for (const token of tokens) {
    if (source.includes(token)) fail(`${relativePath} contains prohibited motion API contract token: ${token}`);
  }
}

const rootPackage = await readJson("package.json");
const webPackage = await readJson("apps/web/package.json");
const files = {
  route: "apps/web/app/api/v1/motion/svg/route.ts",
  apiSecurity: "apps/web/lib/api-security.ts",
  workspace: "apps/web/app/motion/components/MotionWorkspace.tsx",
  apiDocs: "docs/API.md",
  motionDocs: "docs/MOTION.md",
  readme: "README.md",
  page: "apps/web/app/page.tsx",
};
const sources = Object.fromEntries(
  await Promise.all(Object.entries(files).map(async ([key, relativePath]) => [key, await read(relativePath)])),
);

if (webPackage?.dependencies?.["@evavo/motion-engine"] !== "workspace:*") {
  fail("apps/web must depend on @evavo/motion-engine through the workspace.");
}
if (rootPackage?.scripts?.["motion-api:check"] !== "node scripts/check-motion-api-contract.mjs") {
  fail("package.json must expose motion-api:check.");
}
if (!String(rootPackage?.scripts?.check ?? "").includes("pnpm motion-api:check")) {
  fail("package.json check must include motion-api:check before dependency-backed gates.");
}

requireTokens(files.apiSecurity, sources.apiSecurity, [
  "export function apiAuthorisationFailure(",
  "allowWorkspaceSession?: boolean",
  "configuredToken = process.env.VECTOR_API_TOKEN?.trim()",
  "vectorWorkspaceContextFromRequest(request)",
  "vectorWorkspaceSessionMutationAllowed(request)",
  'error: "VECTOR_WORKSPACE_ORIGIN_REJECTED"',
  'error: "VECTOR_API_UNAUTHORISED"',
]);
requireTokens(files.route, sources.route, [
  'import { apiAuthorisationFailure } from "../../../../../lib/api-security"',
  'endpoint: "/api/v1/motion/svg"',
  "MAX_SVG_INPUT_BYTES = 5 * 1024 * 1024",
  "MAX_MOTION_PLAN_BYTES = 256 * 1024",
  'apiAuthorisationFailure(request, { allowWorkspaceSession: true })',
  'authentication: "same-origin Vector workspace session or Bearer VECTOR_API_TOKEN"',
  'headers.set("vary", "authorization, cookie, origin")',
  'contentType.startsWith("multipart/form-data")',
  'Provide exactly one of motion or motionFile.',
  'stringField(form, "format") ?? "json"',
  'validateAnimatedSvgMotionSpec(motionSource.plan)',
  'createAnimatedSvg(source, normalizedMotion)',
  '"x-vector-motion-contract": MOTION_CONTRACT_VERSION',
  '"x-vector-reduced-motion": "true"',
  'normalized: normalizedMotion',
  'lottieJsonExportAvailable: true',
  'lottieEndpoint: "/api/v1/motion/lottie"',
  'lottiePlayerRenderValidationAvailable: false',
  'dotLottieAvailable: false',
  'approval: result.evidence.approval',
  'headers.set("cache-control", "no-store, max-age=0")',
]);
forbidTokens(files.route, sources.route, [
  'configuredToken = process.env.VECTOR_API_TOKEN?.trim()',
  "function authorisationFailure(",
  'lottiePlayerRenderValidationAvailable: true',
  'dotLottieAvailable: true',
  "eval(",
  "new Function(",
]);

requireTokens(files.workspace, sources.workspace, [
  'fetch("/api/v1/motion/svg"',
  'form.set("motion", JSON.stringify(planState.plan))',
  "await verifyMotionResponse(payload, sourceText, planState.plan)",
]);

requireTokens(files.apiDocs, sources.apiDocs, [
  "POST /api/v1/motion/svg",
  "motionFile",
  "5 MiB",
  "256 KiB",
  "X-Vector-Motion-Id",
  "separately governed Lottie endpoint",
]);
requireTokens(files.motionDocs, sources.motionDocs, [
  "motion authoring through the HTTP API",
  "/api/v1/motion/svg",
  "inline plan",
  "direct animated SVG",
  "browser Motion Director",
  "Lottie HTTP API is available",
]);
requireTokens(files.readme, sources.readme, [
  "/api/v1/motion/svg",
  "browser Motion Director",
  "human-review-required",
  "/api/v1/motion/lottie",
]);
requireTokens(files.page, sources.page, [
  "UI + API + CLI + MCP",
  'href="/motion"',
]);

if (errors.length > 0) {
  process.stderr.write(`${JSON.stringify({
    check: "evavo-vector-studio-motion-api-contract",
    ok: false,
    motionContractVersion: "1.1",
    errors,
  }, null, 2)}\n`);
  process.exit(1);
}

process.stdout.write(`${JSON.stringify({
  check: "evavo-vector-studio-motion-api-contract",
  ok: true,
  motionContractVersion: "1.1",
  endpoint: "/api/v1/motion/svg",
  authentication: "workspace-session-or-bearer",
  lottieEndpoint: "/api/v1/motion/lottie",
  browserConsumer: "/motion",
  checkedFiles: [...checkedFiles].sort(),
}, null, 2)}\n`);
