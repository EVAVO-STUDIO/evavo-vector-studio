import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import path from "node:path";
import test from "node:test";

const TOKEN = "http-object-mode-test-token-at-least-24-characters";

function runCli(
  args: readonly string[],
  environment: NodeJS.ProcessEnv,
): Promise<Readonly<{ code: number | null; stdout: string; stderr: string }>> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [path.join(process.cwd(), "dist", "index.js"), ...args],
      {
        cwd: process.cwd(),
        env: environment,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
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

function environment(url: string): NodeJS.ProcessEnv {
  const value = { ...process.env };
  delete value.VECTOR_OBJECT_STORE_PATH;
  value.VECTOR_WORKER_CONTROL_URL = url;
  value.VECTOR_WORKER_API_TOKEN = TOKEN;
  value.VECTOR_HTTP_WORKER_OBJECT_STORE_MODE = "http";
  value.VECTOR_WORKER_ID = "http-object-mode-test";
  return value;
}

test("runs an idle cycle in verified worker-api object mode", async () => {
  let discoveryCalls = 0;
  let leaseCalls = 0;
  let objectCalls = 0;
  const server = createServer(async (request, response) => {
    assert.equal(request.headers.authorization, `Bearer ${TOKEN}`);
    if (request.method === "GET" && request.url === "/api/v1/worker") {
      discoveryCalls += 1;
      response.writeHead(200, {
        "content-type": "application/json",
        "x-vector-worker-protocol": "1.0",
      });
      response.end(JSON.stringify({
        service: "evavo-vector-studio-worker-control",
        contract: {
          objectTransferAvailable: true,
          queueDeliveryAvailable: false,
          remoteExecutionAvailable: false,
        },
      }));
      return;
    }
    if (request.method === "POST" && request.url === "/api/v1/worker/lease") {
      leaseCalls += 1;
      for await (const _chunk of request) {
        // Drain the bounded JSON request.
      }
      response.writeHead(204, {
        "cache-control": "no-store",
        "x-vector-worker-protocol": "1.0",
      });
      response.end();
      return;
    }
    if (request.url?.startsWith("/api/v1/worker/objects")) {
      objectCalls += 1;
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
    const result = await runCli(
      ["run-once", "--object-store-mode", "http", "--allow-insecure-http"],
      environment(`http://127.0.0.1:${address.port}`),
    );
    assert.equal(result.code, 0, result.stderr);
    const payload = JSON.parse(result.stdout) as {
      command?: string;
      result?: { outcome?: string; generatedBodiesInConsole?: boolean };
    };
    assert.equal(payload.command, "run-once");
    assert.equal(payload.result?.outcome, "idle");
    assert.equal(payload.result?.generatedBodiesInConsole, false);
    assert.equal(discoveryCalls, 1);
    assert.equal(leaseCalls, 1);
    assert.equal(objectCalls, 0);
    assert.doesNotMatch(result.stdout, new RegExp(TOKEN));
    assert.equal(result.stderr, "");
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve()),
    );
  }
});

test("fails before lease acquisition when object transfer is unavailable", async () => {
  let leaseCalls = 0;
  const server = createServer((request, response) => {
    assert.equal(request.headers.authorization, `Bearer ${TOKEN}`);
    if (request.method === "GET" && request.url === "/api/v1/worker") {
      response.writeHead(200, {
        "content-type": "application/json",
        "x-vector-worker-protocol": "1.0",
      });
      response.end(JSON.stringify({
        service: "evavo-vector-studio-worker-control",
        contract: { objectTransferAvailable: false },
      }));
      return;
    }
    if (request.url === "/api/v1/worker/lease") leaseCalls += 1;
    response.writeHead(500, {
      "content-type": "application/json",
      "x-vector-worker-protocol": "1.0",
    });
    response.end(JSON.stringify({ error: "UNEXPECTED", retryable: false }));
  });

  try {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const result = await runCli(
      ["run-once", "--object-store-mode", "http", "--allow-insecure-http"],
      environment(`http://127.0.0.1:${address.port}`),
    );
    assert.equal(result.code, 75);
    assert.match(result.stderr, /HTTP_WORKER_OBJECT_TRANSFER_UNAVAILABLE/);
    assert.equal(leaseCalls, 0);
    assert.doesNotMatch(result.stderr, new RegExp(TOKEN));
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve()),
    );
  }
});
