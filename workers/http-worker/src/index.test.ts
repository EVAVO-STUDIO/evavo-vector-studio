import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

const TOKEN = "http-worker-cli-test-token-at-least-24-characters";

function runCli(
  args: readonly string[],
  environment: NodeJS.ProcessEnv,
): Promise<Readonly<{ code: number | null; stdout: string; stderr: string }>> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(process.cwd(), "dist", "index.js"), ...args], {
      cwd: process.cwd(),
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => resolve(Object.freeze({ code, stdout, stderr })));
  });
}

test("fails closed when the worker control token is absent", async () => {
  const environment = { ...process.env };
  delete environment.VECTOR_WORKER_API_TOKEN;
  environment.VECTOR_WORKER_CONTROL_URL = "http://localhost:1";
  const result = await runCli(["capabilities"], environment);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /VECTOR_WORKER_API_TOKEN is required/);
  assert.doesNotMatch(result.stderr, /authorization/i);
});

test("runs one idle HTTP-coordinated worker cycle without leaking its token", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "evavo-http-worker-cli-"));
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    assert.equal(request.headers.authorization, `Bearer ${TOKEN}`);
    if (request.method === "POST" && request.url === "/api/v1/worker/lease") {
      response.writeHead(204, {
        "cache-control": "no-store",
        "x-vector-worker-protocol": "1.0",
      });
      response.end();
      return;
    }
    response.writeHead(404, {
      "content-type": "application/json",
      "x-vector-worker-protocol": "1.0",
    });
    response.end(JSON.stringify({ error: "NOT_FOUND", retryable: false }));
  });
  try {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const result = await runCli(["run-once"], {
      ...process.env,
      VECTOR_WORKER_CONTROL_URL: `http://127.0.0.1:${address.port}`,
      VECTOR_WORKER_API_TOKEN: TOKEN,
      VECTOR_OBJECT_STORE_PATH: path.join(root, "objects"),
      VECTOR_WORKER_ID: "http-worker-cli-test",
    });
    assert.equal(result.code, 0, result.stderr);
    const payload = JSON.parse(result.stdout) as {
      command?: string;
      result?: {
        outcome?: string;
        generatedBodiesInConsole?: boolean;
      };
    };
    assert.equal(payload.command, "run-once");
    assert.equal(payload.result?.outcome, "idle");
    assert.equal(payload.result?.generatedBodiesInConsole, false);
    assert.doesNotMatch(result.stdout, new RegExp(TOKEN));
    assert.equal(result.stderr, "");
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve()),
    );
    await rm(root, { recursive: true, force: true });
  }
});
