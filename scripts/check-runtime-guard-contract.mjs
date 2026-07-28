import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const errors = [];

async function read(relativePath) {
  try {
    return (await fs.readFile(path.join(root, relativePath), "utf8")).replace(/^\uFEFF/, "");
  } catch (error) {
    errors.push(`Missing or unreadable file: ${relativePath} (${error instanceof Error ? error.message : String(error)})`);
    return "";
  }
}

function requireTokens(relativePath, source, tokens) {
  for (const token of tokens) {
    if (!source.includes(token)) errors.push(`${relativePath} is missing runtime guard token: ${token}`);
  }
}

const files = {
  guard: "packages/raster-engine/src/runtime-guard.ts",
  tests: "packages/raster-engine/src/runtime-guard.test.ts",
  index: "packages/raster-engine/src/index.ts",
  route: "apps/web/app/api/v1/trace/route.ts",
  environment: ".env.example",
  apiDocs: "docs/API.md",
};
const sources = Object.fromEntries(await Promise.all(Object.entries(files).map(async ([key, relativePath]) => [key, await read(relativePath)])));

requireTokens(files.guard, sources.guard, [
  "DEFAULT_TRACE_TIMEOUT_MS = 45_000",
  "MIN_TRACE_TIMEOUT_MS = 5_000",
  "MAX_TRACE_TIMEOUT_MS = 180_000",
  "DEFAULT_TRACE_MAX_CONCURRENT = 1",
  "MAX_TRACE_MAX_CONCURRENT = 4",
  '"RASTER_RUNTIME_BUSY"',
  '"RASTER_RUNTIME_CONFIG_INVALID"',
  "resolveRasterRuntimeGuardConfigFromEnvironment",
  "createRasterRuntimeGuard",
  "controller.signal.aborted) return",
  'DOMException("The bounded raster runtime timed out.", "TimeoutError")',
  "requestSignal?.removeEventListener",
  "activeExecutions = Math.max(0, activeExecutions - 1)",
]);

requireTokens(files.tests, sources.tests, [
  "resolves defaults and bounded environment-style values",
  "rejects invalid runtime configuration",
  "rejects work above the concurrency ceiling",
  "aborts at the execution timeout",
  "without later misclassifying it as a timeout",
]);

requireTokens(files.index, sources.index, ['export * from "./runtime-guard.js"']);

requireTokens(files.route, sources.route, [
  "RasterRuntimeGuardError",
  "createRasterRuntimeGuard(resolveRasterRuntimeGuardConfigFromEnvironment())",
  "TRACE_RUNTIME_GUARD.acquire(request.signal)",
  'error: "RASTER_RUNTIME_TIMEOUT"',
  '"retry-after": String(error.retryAfterSeconds)',
  "signal: lease.signal",
  "if (lease.timedOut()) return runtimeTimeoutResponse()",
  "finally {",
  "lease.release()",
  "runtimeGuard: TRACE_RUNTIME_GUARD.snapshot()",
]);

requireTokens(files.environment, sources.environment, [
  "VECTOR_TRACE_TIMEOUT_MS=45000",
  "VECTOR_TRACE_MAX_CONCURRENT=1",
  "VECTOR_TRACE_RETRY_AFTER_SECONDS=5",
]);

requireTokens(files.apiDocs, sources.apiDocs, [
  "RASTER_RUNTIME_BUSY",
  "RASTER_RUNTIME_TIMEOUT",
  "VECTOR_TRACE_TIMEOUT_MS",
  "VECTOR_TRACE_MAX_CONCURRENT",
]);

if (errors.length > 0) {
  process.stderr.write(`${JSON.stringify({ check: "raster-runtime-guard-contract", ok: false, errors }, null, 2)}\n`);
  process.exit(1);
}

process.stdout.write(`${JSON.stringify({
  check: "raster-runtime-guard-contract",
  ok: true,
  bounds: {
    defaultTimeoutMs: 45000,
    maximumTimeoutMs: 180000,
    defaultMaxConcurrent: 1,
    maximumMaxConcurrent: 4,
  },
}, null, 2)}\n`);
