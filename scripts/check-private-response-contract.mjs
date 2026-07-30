import { execFileSync } from "node:child_process";
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

function requireTokens(relativePath, source, tokens) {
  for (const token of tokens) {
    if (!source.includes(token)) errors.push(`${relativePath} is missing private-response token: ${token}`);
  }
}

function forbidTokens(relativePath, source, tokens) {
  for (const token of tokens) {
    if (source.includes(token)) errors.push(`${relativePath} contains prohibited private-response token: ${token}`);
  }
}

const files = {
  package: "package.json",
  middleware: "apps/web/middleware.ts",
  layout: "apps/web/app/layout.tsx",
  access: "apps/web/app/access/page.tsx",
  launch: "apps/web/app/launch/route.ts",
  health: "apps/web/app/api/health/route.ts",
  liveProof: "scripts/verify-live-private-response.mjs",
  docs: "docs/PRIVATE-APPLICATION-SECURITY.md",
  workflow: ".github/workflows/vercel-deployment-contract.yml",
  publicProofWorkflow: ".github/workflows/public-deployment-proof.yml",
};
const sources = Object.fromEntries(
  await Promise.all(Object.entries(files).map(async ([key, relativePath]) => [key, await read(relativePath)])),
);
const packageJson = JSON.parse(sources.package || "{}");

if (packageJson?.scripts?.["private-response:check"] !== "node scripts/check-private-response-contract.mjs") {
  errors.push("package.json must expose private-response:check.");
}
if (!String(packageJson?.scripts?.check ?? "").includes("pnpm private-response:check")) {
  errors.push("package.json check must include private-response:check.");
}

requireTokens(files.middleware, sources.middleware, [
  'VECTOR_PRIVATE_RESPONSE_CONTRACT_VERSION = "1.0"',
  '"cross-origin-opener-policy": "same-origin"',
  '"cross-origin-resource-policy": "same-origin"',
  '"origin-agent-cluster": "?1"',
  '"permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()"',
  '"referrer-policy": "no-referrer"',
  '"strict-transport-security": "max-age=63072000; includeSubDomains"',
  '"x-content-type-options": "nosniff"',
  '"x-frame-options": "DENY"',
  '"x-robots-tag": "noindex, nofollow, noarchive, nosnippet, noimageindex"',
  'response.headers.set("vary", "authorization, cookie, origin")',
  'request.nextUrl.pathname.startsWith("/api/")',
  'response.headers.set("cache-control", "no-store, max-age=0")',
  "_next/static",
  "_next/image",
  "manifest.webmanifest",
]);
forbidTokens(files.middleware, sources.middleware, [
  "process.env.VECTOR_API_TOKEN",
  "process.env.VECTOR_WORKER_API_TOKEN",
  "EVAVO_CLIENT_APP_LAUNCH_SECRET",
  "EVAVO_VECTOR_PRIVATE_SIGNING_SECRET",
  "request.cookies.get",
  "request.headers.get(\"authorization\")",
]);

requireTokens(files.layout, sources.layout, [
  'robots: { index: false, follow: false',
  'referrer: "no-referrer"',
]);
requireTokens(files.access, sources.access, ["Return to EVAVO hub", "noindex"]);
requireTokens(files.launch, sources.launch, ["verifyVectorHubLaunchToken", "replayStore.consume"]);
requireTokens(files.health, sources.health, ["privateApplication: true", "clientReleaseEligible: false"]);
requireTokens(files.liveProof, sources.liveProof, [
  'const CANONICAL_ORIGIN = "https://vector.evavo.com.au"',
  'const CONTRACT_VERSION = "1.0"',
  '"x-vector-private-response-contract": CONTRACT_VERSION',
  '"x-robots-tag"',
  '"cache-control"',
  '"authorization", "cookie", "origin"',
  '"__Host-evavo-vector-session"',
  "redirect: \"manual\"",
  '"accept-encoding": "identity"',
  "sensitiveValuesRecorded: false",
  "atomicNewFile",
]);
forbidTokens(files.liveProof, sources.liveProof, [
  "VECTOR_DEPLOYMENT_PROOF_LAUNCH_TOKEN",
  "EVAVO_CLIENT_APP_LAUNCH_SECRET",
  "EVAVO_VECTOR_PRIVATE_SIGNING_SECRET",
  "VECTOR_API_TOKEN",
  "VECTOR_WORKER_API_TOKEN",
]);
requireTokens(files.docs, sources.docs, [
  "X-Robots-Tag",
  "Referrer-Policy",
  "Permissions-Policy",
  "Cross-Origin-Opener-Policy",
  "verify-live-private-response.mjs",
  "does not authenticate",
  "client release remains withheld",
]);
requireTokens(files.workflow, sources.workflow, [
  "node scripts/check-private-response-contract.mjs",
  "pnpm install --frozen-lockfile",
]);
requireTokens(files.publicProofWorkflow, sources.publicProofWorkflow, [
  "Verify live private response boundary",
  "node scripts/verify-live-private-response.mjs",
  ".ci/vector-private-response-proof.json",
  "PRIVATE_OUTCOME",
  "source, private response and public runtime proof passed",
]);

if (sources.liveProof) {
  try {
    execFileSync(process.execPath, ["--check", path.join(root, files.liveProof)], {
      stdio: "pipe",
    });
  } catch (error) {
    errors.push(`${files.liveProof} failed node --check (${error instanceof Error ? error.message : String(error)})`);
  }
}

if (errors.length > 0) {
  process.stderr.write(`${JSON.stringify({
    check: "evavo-vector-private-response",
    ok: false,
    contractVersion: "1.0",
    errors,
  }, null, 2)}\n`);
  process.exit(1);
}

process.stdout.write(`${JSON.stringify({
  check: "evavo-vector-private-response",
  ok: true,
  contractVersion: "1.0",
  indexing: "forbidden",
  framing: "forbidden",
  referrerPolicy: "no-referrer",
  liveDeploymentProof: true,
  authenticationImplementedInMiddleware: false,
  checkedFiles: [...checkedFiles].sort(),
}, null, 2)}\n`);
