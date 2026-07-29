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
    if (!source.includes(token)) {
      errors.push(`${relativePath} is missing object-transfer token: ${token}`);
    }
  }
}

function forbidTokens(relativePath, source, tokens) {
  for (const token of tokens) {
    if (source.includes(token)) {
      errors.push(`${relativePath} contains prohibited object-transfer token: ${token}`);
    }
  }
}

const files = {
  rootPackage: "package.json",
  webPackage: "apps/web/package.json",
  workerPackage: "packages/worker-engine/package.json",
  protocol: "packages/worker-protocol/src/object-transfer.ts",
  protocolIndex: "packages/worker-protocol/src/index.ts",
  workerErrors: "packages/worker-engine/src/base-errors.ts",
  objectStoreIndex: "packages/worker-engine/src/object-store.ts",
  coordinator: "packages/worker-engine/src/object-transaction-store.ts",
  coordinatorTests: "packages/worker-engine/src/object-transaction-store.test.ts",
  runtime: "apps/web/lib/worker-object-store.ts",
  helpers: "apps/web/lib/worker-object-api.ts",
  route: "apps/web/app/api/v1/worker/objects/route.ts",
  discovery: "apps/web/app/api/v1/worker/route.ts",
  workerApi: "apps/web/lib/worker-api.ts",
  security: "apps/web/lib/api-security.ts",
  environment: ".env.example",
  docs: "docs/OBJECT-TRANSFER.md",
  workerDocs: "docs/WORKER-API.md",
  apiDocs: "docs/API.md",
  architecture: "docs/ARCHITECTURE.md",
  readme: "README.md",
  workflow: ".github/workflows/quality.yml",
};
const sources = Object.fromEntries(
  await Promise.all(
    Object.entries(files).map(async ([key, relativePath]) => [
      key,
      await read(relativePath),
    ]),
  ),
);
const rootPackage = await readJson(files.rootPackage);
const webPackage = await readJson(files.webPackage);
const workerPackage = await readJson(files.workerPackage);

if (
  rootPackage?.scripts?.["object-transfer-api:check"] !==
    "node scripts/check-object-transfer-api-contract.mjs"
) {
  errors.push("package.json must expose object-transfer-api:check.");
}
if (!String(rootPackage?.scripts?.check ?? "").includes("pnpm object-transfer-api:check")) {
  errors.push("package.json check must include object-transfer-api:check before dependency-backed checks.");
}
if (webPackage?.dependencies?.["@evavo/worker-engine"] !== "workspace:*") {
  errors.push("apps/web must consume @evavo/worker-engine through the workspace.");
}
if (workerPackage?.dependencies?.["@evavo/worker-protocol"] !== "workspace:*") {
  errors.push("packages/worker-engine must consume @evavo/worker-protocol through the workspace.");
}
if (!workerPackage?.exports?.["./object-store"]) {
  errors.push("packages/worker-engine must expose the dependency-light object-store subpath.");
}

requireTokens(files.protocol, sources.protocol, [
  'VECTOR_OBJECT_TRANSFER_CONTRACT_VERSION = "1.0"',
  'VECTOR_OBJECT_TRANSACTION_CONTENT_TYPE =',
  '"application/vnd.evavo.vector-object-transaction"',
  "VECTOR_OBJECT_MAX_BYTES = 32 * 1024 * 1024",
  "VECTOR_OBJECT_TRANSACTION_MAX_BYTES = 64 * 1024 * 1024",
  "VECTOR_OBJECT_TRANSACTION_MAX_ITEMS = 16",
  "encodeVectorObjectTransaction",
  "decodeVectorObjectTransaction",
  'const TRANSACTION_MAGIC_TEXT = "EVAVOOB1"',
  'createHash("sha256")',
  "canonicalHostedJobJson(manifest)",
]);
requireTokens(files.protocolIndex, sources.protocolIndex, [
  'export * from "./object-transfer.js"',
]);
requireTokens(files.workerErrors, sources.workerErrors, [
  '"VECTOR_WORKER_OBJECT_TRANSACTION_CONFLICT"',
]);
requireTokens(files.objectStoreIndex, sources.objectStoreIndex, [
  'export * from "./object-transaction-store.js"',
  'export * from "./file-object-store.js"',
]);
requireTokens(files.coordinator, sources.coordinator, [
  "commitVectorObjectTransactionIdempotently",
  "inspectExistingTransaction",
  'mimeTypeVerification: contentOnly ? "content-only" : "verified"',
  'path: `object://${item.objectKey}`',
  '"VECTOR_WORKER_OBJECT_TRANSACTION_CONFLICT"',
  "existingObjectKeys",
  "missingObjectKeys",
  "store.putManyNew(transaction.writes",
  "existingObjectsOverwritten: false",
]);
forbidTokens(files.coordinator, sources.coordinator, [
  "targetPath",
  "rootPath",
  "temporaryPath",
  "existingObjectsOverwritten: true",
]);
requireTokens(files.coordinatorTests, sources.coordinatorTests, [
  "commits a new transaction and replays the same immutable content",
  "rejects changed bytes or MIME",
  "rejects partial overlap",
  "content-only replay",
  "honours cancellation",
]);

requireTokens(files.runtime, sources.runtime, [
  "VECTOR_OBJECT_STORE_MODE",
  'mode === "disabled"',
  'mode !== "file"',
  "VECTOR_OBJECT_FILE_STORE_PERSISTENT",
  "FileVectorObjectStore.open",
  "objectTransferAvailable: true",
  "resetWorkerObjectStoreRuntimeForTests",
]);
forbidTokens(files.runtime, sources.runtime, ['mode: "memory"']);
requireTokens(files.helpers, sources.helpers, [
  "workerObjectRuntimeView",
  "requireWorkerObjectRuntime",
  "parseWorkerObjectTransaction",
  "parseWorkerObjectKey",
  "workerObjectDownloadResponse",
  "workerObjectErrorResponse",
  "VECTOR_OBJECT_TRANSACTION_CONTENT_TYPE",
  "request.arrayBuffer()",
  '"content-type": "application/octet-stream"',
  '"x-vector-object-sha256"',
  '"VECTOR_WORKER_OBJECT_STORE_NOT_CONFIGURED"',
  "PUBLIC_DETAIL_FIELDS",
]);
forbidTokens(files.helpers, sources.helpers, [
  "rootPath",
  "temporaryPath",
  '"content-type": object.mimeType',
]);
requireTokens(files.route, sources.route, [
  "workerApiAuthorisationFailure(request)",
  'runtime = "nodejs"',
  'dynamic = "force-dynamic"',
  "export async function POST",
  "export async function GET",
  "requireWorkerObjectRuntime",
  "parseWorkerObjectTransaction",
  "commitVectorObjectTransactionIdempotently",
  "parseWorkerObjectKey",
  "workerObjectDownloadResponse",
  "idempotentReplay: committed.replayed",
  "generatedBodiesInJson: false",
  'committed.replayed ? 200 : 201',
]);
forbidTokens(files.route, sources.route, [
  "request.formData()",
  "JSON.stringify(transaction.writes)",
  "existingObjectsOverwritten: true",
]);
requireTokens(files.discovery, sources.discovery, [
  "getWorkerObjectStoreRuntime",
  "workerObjectRuntimeView(objectRuntime)",
  "workerRuntimeView(runtimeValue, objectRuntime)",
]);
requireTokens(files.workerApi, sources.workerApi, [
  'objects: "/api/v1/worker/objects"',
  'objectDownload: "/api/v1/worker/objects?key={objectKey}"',
  "objectTransferAvailable",
  "failClosedWithoutObjectStore: true",
]);
requireTokens(files.security, sources.security, [
  "workerApiAuthorisationFailure",
  "VECTOR_WORKER_API_TOKEN",
]);
requireTokens(files.environment, sources.environment, [
  "VECTOR_OBJECT_STORE_MODE=disabled",
  "VECTOR_OBJECT_STORE_PATH",
  "VECTOR_OBJECT_FILE_STORE_PERSISTENT=false",
]);
requireTokens(files.docs, sources.docs, [
  "Worker object-transfer contract `1.0`",
  "POST /api/v1/worker/objects",
  "GET  /api/v1/worker/objects?key={objectKey}",
  "EVAVOOB1",
  "mimeTypeVerification: content-only",
  "VECTOR_WORKER_OBJECT_TRANSACTION_CONFLICT",
  "application/octet-stream",
  "provider-backed cloud object storage",
]);
requireTokens(files.workerDocs, sources.workerDocs, [
  "/api/v1/worker/objects",
]);
requireTokens(files.apiDocs, sources.apiDocs, [
  "/api/v1/worker/objects",
]);
requireTokens(files.architecture, sources.architecture, [
  "object transfer",
]);
requireTokens(files.readme, sources.readme, [
  "Worker object transfer",
  "/api/v1/worker/objects",
]);
requireTokens(files.workflow, sources.workflow, [
  "Verify worker object-transfer API contract",
  "node scripts/check-object-transfer-api-contract.mjs",
]);

if (errors.length > 0) {
  process.stderr.write(`${JSON.stringify({
    check: "evavo-vector-studio-object-transfer-api-contract",
    ok: false,
    objectTransferContractVersion: "1.0",
    errors,
  }, null, 2)}\n`);
  process.exit(1);
}

process.stdout.write(`${JSON.stringify({
  check: "evavo-vector-studio-object-transfer-api-contract",
  ok: true,
  objectTransferContractVersion: "1.0",
  endpoints: [
    "/api/v1/worker/objects",
    "/api/v1/worker/objects?key={objectKey}",
  ],
  exactContentReplay: true,
  partialReplayRejected: true,
  existingObjectsOverwritten: false,
  generatedBodiesInJson: false,
  providerBackedObjectStorageAvailable: false,
  checkedFiles: [...checkedFiles].sort(),
}, null, 2)}\n`);
