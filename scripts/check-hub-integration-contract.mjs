import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const errors = [];
const checkedFiles = new Set();

async function read(file) {
  checkedFiles.add(file);
  try {
    return (await fs.readFile(path.join(root, file), "utf8")).replace(/^\uFEFF/, "");
  } catch (error) {
    errors.push(`Missing or unreadable file: ${file} (${error instanceof Error ? error.message : String(error)})`);
    return "";
  }
}

async function json(file) {
  const source = await read(file);
  if (!source) return null;
  try {
    return JSON.parse(source);
  } catch (error) {
    errors.push(`Invalid JSON: ${file} (${error instanceof Error ? error.message : String(error)})`);
    return null;
  }
}

function requireTokens(file, source, tokens) {
  for (const token of tokens) {
    if (!source.includes(token)) errors.push(`${file} is missing hub token: ${token}`);
  }
}

function forbidTokens(file, source, tokens) {
  for (const token of tokens) {
    if (source.includes(token)) errors.push(`${file} contains prohibited hub token: ${token}`);
  }
}

const files = {
  rootPackage: "package.json",
  webPackage: "apps/web/package.json",
  hubPackage: "packages/hub-auth/package.json",
  launch: "packages/hub-auth/src/launch.ts",
  session: "packages/hub-auth/src/session.ts",
  replay: "packages/hub-auth/src/replay.ts",
  launchTests: "packages/hub-auth/src/launch.test.ts",
  sessionTests: "packages/hub-auth/src/session.test.ts",
  replayTests: "packages/hub-auth/src/replay.test.ts",
  runtime: "apps/web/lib/hub-runtime.ts",
  sessionAdapter: "apps/web/lib/hub-session.ts",
  workspaceAccess: "apps/web/lib/workspace-access.ts",
  launchRoute: "apps/web/app/launch/route.ts",
  accessPage: "apps/web/app/access/page.tsx",
  healthRoute: "apps/web/app/api/health/route.ts",
  logoutRoute: "apps/web/app/api/auth/logout/route.ts",
  apiSecurity: "apps/web/lib/api-security.ts",
  home: "apps/web/app/page.tsx",
  motion: "apps/web/app/motion/page.tsx",
  card: "apps/web/public/hub/evavo-vector-studio.card.json",
  entry: "apps/web/public/hub/evavo-vector-studio.hub-entry.json",
  deployment: "apps/web/public/hub/evavo-vector-studio.deployment.json",
  manifest: "apps/web/public/manifest.webmanifest",
  docs: "docs/HUB-INTEGRATION.md",
  environment: ".env.example",
  workflow: ".github/workflows/hub-contract.yml",
};
const sources = Object.fromEntries(
  await Promise.all(Object.entries(files).map(async ([key, file]) => [key, await read(file)])),
);
const rootPackage = await json(files.rootPackage);
const webPackage = await json(files.webPackage);
const hubPackage = await json(files.hubPackage);
const card = await json(files.card);
const entry = await json(files.entry);
const deployment = await json(files.deployment);
const manifest = await json(files.manifest);

if (hubPackage?.version !== rootPackage?.version) errors.push("Hub auth package version must match the root release.");
if (hubPackage?.scripts?.test !== "tsc -p tsconfig.json && node --test dist/*.test.js") errors.push("Hub auth must compile and execute tests.");
if (webPackage?.dependencies?.["@evavo/hub-auth"] !== "workspace:*") errors.push("Vector web must consume @evavo/hub-auth through the workspace.");
if (rootPackage?.scripts?.["hub:check"] !== "node scripts/check-hub-integration-contract.mjs") errors.push("package.json must expose hub:check.");
if (!String(rootPackage?.scripts?.check ?? "").includes("pnpm hub:check")) errors.push("package.json check must include hub:check.");
if (!String(rootPackage?.scripts?.["build:packages"] ?? "").includes("--filter=@evavo/hub-auth")) errors.push("build:packages must build @evavo/hub-auth.");

requireTokens(files.launch, sources.launch, [
  'VECTOR_HUB_LAUNCH_VERSION = "evavo-client-app-launch-v1"',
  'VECTOR_HUB_APPLICATION_KEY = "vector-studio"',
  'VECTOR_HUB_APPLICATION_LABEL = "EVAVO Vector Studio"',
  'VECTOR_HUB_TARGET_HOST = "vector.evavo.com.au"',
  "VECTOR_HUB_LAUNCH_TTL_SECONDS = 120",
  "VECTOR_HUB_LAUNCH_CLOCK_SKEW_SECONDS = 15",
  "assertVectorHubSecretsSeparated",
  "timingSafeEqual",
  "verifyVectorHubLaunchToken",
  "exactKeys",
  "replayKey:",
]);
requireTokens(files.session, sources.session, [
  'VECTOR_WORKSPACE_SESSION_VERSION = "evavo-vector-session-v1"',
  "VECTOR_WORKSPACE_SESSION_TTL_SECONDS = 8 * 60 * 60",
  'const SESSION_DOMAIN = "evavo-vector-session"',
  "createVectorWorkspaceSessionToken",
  "verifyVectorWorkspaceSessionToken",
  'actorType: "local-development"',
]);
requireTokens(files.replay, sources.replay, [
  "MemoryVectorHubLaunchReplayStore",
  "createUpstashVectorHubLaunchReplayStore",
  '["SET", replayKey, "1", "EX", ttlSeconds, "NX"]',
  'mode: "upstash-rest"',
  'url.hostname.endsWith(".upstash.io")',
  'redirect: "error"',
]);
forbidTokens(files.replay, sources.replay, ["_token=", "console.log(", "rawLaunchToken"]);
requireTokens(files.launchTests, sources.launchTests, ["verifies the exact generic EVAVO hub handoff", "requires separate hub and Vector Studio private signing authorities"]);
requireTokens(files.sessionTests, sources.sessionTests, ["app-private eight-hour session", "cannot forge an app-private session"]);
requireTokens(files.replayTests, sources.replayTests, ["exactly one concurrent memory replay consume", "doesNotMatch(requests[0]?.url"]);

requireTokens(files.runtime, sources.runtime, [
  "VECTOR_PUBLIC_ORIGIN",
  "EVAVO_CLIENT_APP_LAUNCH_SECRET",
  "EVAVO_VECTOR_PRIVATE_SIGNING_SECRET",
  "VECTOR_HUB_REPLAY_MODE",
  'production && mode === "memory"',
  "createUpstashVectorHubLaunchReplayStore",
  "secretsReturned: false",
]);
requireTokens(files.sessionAdapter, sources.sessionAdapter, [
  'VECTOR_WORKSPACE_SESSION_COOKIE = "__Host-evavo-vector-session"',
  "HttpOnly",
  "SameSite=Lax",
  "vectorWorkspaceSessionMutationAllowed",
  'fetchSite === "same-origin"',
]);
requireTokens(files.workspaceAccess, sources.workspaceAccess, ["cookies()", "localOrSignedVectorWorkspaceContext"]);
requireTokens(files.launchRoute, sources.launchRoute, [
  "verifyVectorHubLaunchToken",
  "createVectorWorkspaceSessionToken",
  "replayStore.consume",
  "vectorWorkspaceSessionCookieHeader",
  'accessPath("used")',
  'accessPath("temporarily-unavailable")',
  '"x-vector-hub-launch": "consumed"',
]);
forbidTokens(files.launchRoute, sources.launchRoute, ["console.log(", "clearVectorWorkspaceSessionCookieHeader"]);
requireTokens(files.accessPage, sources.accessPage, ["Return to EVAVO hub", "single use", "app-private HttpOnly session"]);
requireTokens(files.healthRoute, sources.healthRoute, ['promotionStatus: "staged"', "clientReleaseEligible: false", "vectorHubRuntimePublicView()"]);
requireTokens(files.logoutRoute, sources.logoutRoute, ["clearVectorWorkspaceSessionCookieHeader", 'new URL("/access"']);
requireTokens(files.apiSecurity, sources.apiSecurity, [
  "allowWorkspaceSession",
  "vectorWorkspaceContextFromRequest",
  "vectorWorkspaceSessionMutationAllowed",
  'error: "VECTOR_WORKSPACE_ORIGIN_REJECTED"',
]);
requireTokens(files.home, sources.home, ["currentVectorWorkspaceContext", 'redirect("/access")', "workspace.workspace.name"]);
requireTokens(files.motion, sources.motion, ["currentVectorWorkspaceContext", 'redirect("/access")', "workspace.workspace.name"]);

for (const [name, document] of [["card", card], ["entry", entry]]) {
  if (document?.productSlug !== "vector-studio" || document?.title !== "EVAVO Vector Studio") errors.push(`${name} metadata must identify Vector Studio.`);
  if (document?.status !== "active-development") errors.push(`${name} metadata must remain active-development.`);
}
if (entry?.visibility?.defaultVisible !== false || entry?.visibility?.requiresAppEntitlement !== true) errors.push("Hub entry must remain hidden by default and entitlement gated.");
if (deployment?.productionOrigin !== "https://vector.evavo.com.au") errors.push("Deployment metadata must use the canonical origin.");
if (deployment?.promotionState?.status !== "staged" || deployment?.promotionState?.clientReleaseEligible !== false) errors.push("Deployment metadata must remain staged and client-ineligible.");
for (const [key, value] of Object.entries(deployment?.promotionState ?? {})) {
  if (key.endsWith("Verified") && value !== false) errors.push(`Staged deployment evidence ${key} cannot be true.`);
}
if (manifest?.start_url !== "/access" || manifest?.theme_color !== "#ff244e") errors.push("The private manifest must re-enter through /access with EVAVO cherry theming.");

requireTokens(files.docs, sources.docs, [
  "federated-candidate",
  "EVAVO_CLIENT_APP_LAUNCH_SECRET",
  "EVAVO_VECTOR_PRIVATE_SIGNING_SECRET",
  "SET <derived-key> 1 EX <ttl> NX",
  "__Host-evavo-vector-session",
  "clientReleaseEligible",
  "pnpm hub:check",
]);
requireTokens(files.environment, sources.environment, [
  "VECTOR_PUBLIC_ORIGIN",
  "EVAVO_CLIENT_APP_LAUNCH_SECRET",
  "EVAVO_VECTOR_PRIVATE_SIGNING_SECRET",
  "VECTOR_HUB_REPLAY_MODE",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
]);
requireTokens(files.workflow, sources.workflow, ["EVAVO hub integration contract", "node scripts/check-hub-integration-contract.mjs"]);
forbidTokens(files.card, sources.card, ["C:\\\\", "tokenValue"]);
forbidTokens(files.entry, sources.entry, ["C:\\\\", "tokenValue"]);
forbidTokens(files.deployment, sources.deployment, ["C:\\\\", "replace-with", "tokenValue"]);

if (errors.length > 0) {
  process.stderr.write(`${JSON.stringify({ check: "evavo-vector-studio-hub-integration", ok: false, hubContractVersion: "1.0", errors }, null, 2)}\n`);
  process.exit(1);
}

process.stdout.write(`${JSON.stringify({
  check: "evavo-vector-studio-hub-integration",
  ok: true,
  hubContractVersion: "1.0",
  applicationKey: "vector-studio",
  targetHost: "vector.evavo.com.au",
  promotionStatus: "staged",
  clientReleaseEligible: false,
  signedLaunchReceiver: true,
  appPrivateSession: true,
  durableReplayAdapter: true,
  checkedFiles: [...checkedFiles].sort(),
}, null, 2)}\n`);
