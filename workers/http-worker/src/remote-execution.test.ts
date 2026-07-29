import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import path from "node:path";
import test from "node:test";
import {
  HostedJobController,
  MemoryHostedJobStore,
  completeHostedJobIdempotently,
} from "@evavo/job-control";
import {
  MemoryVectorObjectStore,
  commitVectorObjectTransactionIdempotently,
} from "@evavo/worker-engine/object-store";
import {
  decodeVectorObjectTransaction,
  validateWorkerCompleteRequest,
  validateWorkerFailRequest,
  validateWorkerHeartbeatRequest,
  validateWorkerLeaseRequest,
  validateWorkerLeaseTokenRequest,
  workerLeaseResponse,
  workerProtocolRecord,
} from "@evavo/worker-protocol";

const TOKEN = "remote-execution-test-token-at-least-24-characters";

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

async function body(request: IncomingMessage): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return new Uint8Array(Buffer.concat(chunks));
}

async function jsonBody(request: IncomingMessage): Promise<unknown> {
  return JSON.parse(new TextDecoder().decode(await body(request))) as unknown;
}

function json(
  response: ServerResponse,
  status: number,
  value: unknown,
  headers: Record<string, string> = {},
): void {
  const source = JSON.stringify(value);
  response.writeHead(status, {
    "content-type": "application/json",
    "content-length": String(Buffer.byteLength(source)),
    "cache-control": "no-store",
    "x-vector-worker-protocol": "1.0",
    ...headers,
  });
  response.end(source);
}

function runCli(
  url: string,
): Promise<Readonly<{ code: number | null; stdout: string; stderr: string }>> {
  const environment = { ...process.env };
  delete environment.VECTOR_OBJECT_STORE_PATH;
  environment.VECTOR_WORKER_CONTROL_URL = url;
  environment.VECTOR_WORKER_API_TOKEN = TOKEN;
  environment.VECTOR_HTTP_WORKER_OBJECT_STORE_MODE = "http";
  environment.VECTOR_WORKER_ID = "remote-execution-test";
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        path.join(process.cwd(), "dist", "index.js"),
        "run-once",
        "--object-store-mode",
        "http",
        "--allow-insecure-http",
        "--lease-ms",
        "5000",
        "--heartbeat-ms",
        "1000",
        "--object-download-attempts",
        "2",
        "--object-upload-attempts",
        "2",
        "--object-retry-ms",
        "100",
      ],
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

test("optimises one SVG using only HTTP control and object transfer", async () => {
  const source = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><title>Remote mark</title><path id="mark" fill="#ff244e" d="M2 2 H18 V18 H2 Z"/></svg>';
  const jobStore = new MemoryHostedJobStore();
  const controller = new HostedJobController(jobStore);
  const objects = new MemoryVectorObjectStore();
  objects.seed("source/mark.svg", source, "image/svg+xml");
  const created = await controller.create({
    workspaceId: "remote-execution-tests",
    idempotencyKey: "optimise-mark-revision-01",
    operation: "optimise-svg",
    priority: 5,
    maxAttempts: 2,
    payload: {
      source: {
        objectKey: "source/mark.svg",
        sha256: sha256(source),
      },
      outputs: {
        svgObjectKey: "output/mark.optimised.svg",
        evidenceObjectKey: "output/mark.evidence.json",
      },
    },
  });

  const calls = {
    discovery: 0,
    lease: 0,
    start: 0,
    complete: 0,
    objectGet: 0,
    objectPost: 0,
  };

  const server = createServer(async (request, response) => {
    try {
      assert.equal(request.headers.authorization, `Bearer ${TOKEN}`);
      const url = new URL(request.url ?? "/", "http://127.0.0.1");

      if (request.method === "GET" && url.pathname === "/api/v1/worker") {
        calls.discovery += 1;
        json(response, 200, {
          service: "evavo-vector-studio-worker-control",
          contract: {
            objectTransferAvailable: true,
            queueDeliveryAvailable: false,
            remoteExecutionAvailable: false,
          },
        });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/v1/worker/lease") {
        calls.lease += 1;
        const input = validateWorkerLeaseRequest(await jsonBody(request));
        const leased = await controller.acquireLease(input);
        if (!leased) {
          response.writeHead(204, {
            "cache-control": "no-store",
            "x-vector-worker-protocol": "1.0",
          });
          response.end();
          return;
        }
        json(response, 200, workerLeaseResponse(leased));
        return;
      }

      if (request.method === "POST" && url.pathname.endsWith("/start")) {
        calls.start += 1;
        const jobId = url.pathname.split("/").at(-2)!;
        const input = validateWorkerLeaseTokenRequest(await jsonBody(request));
        const record = await controller.start(jobId, input.leaseToken);
        json(response, 200, { record: workerProtocolRecord(record) });
        return;
      }

      if (request.method === "POST" && url.pathname.endsWith("/heartbeat")) {
        const jobId = url.pathname.split("/").at(-2)!;
        const input = validateWorkerHeartbeatRequest(await jsonBody(request));
        const record = await controller.heartbeat(
          jobId,
          input.leaseToken,
          input.leaseMs,
        );
        json(response, 200, {
          record: workerProtocolRecord(record),
          cancellationRequested: record.status === "cancel-requested",
        });
        return;
      }

      if (request.method === "POST" && url.pathname.endsWith("/complete")) {
        calls.complete += 1;
        const jobId = url.pathname.split("/").at(-2)!;
        const input = validateWorkerCompleteRequest(await jsonBody(request));
        const completed = await completeHostedJobIdempotently(
          controller,
          jobStore,
          jobId,
          input.leaseToken,
          { outputs: input.outputs, evidence: input.evidence },
        );
        json(response, 200, {
          record: workerProtocolRecord(completed.record),
          idempotentReplay: completed.replayed,
          generatedBodiesAccepted: false,
          approval: "human-review-required",
        });
        return;
      }

      if (request.method === "POST" && url.pathname.endsWith("/fail")) {
        const jobId = url.pathname.split("/").at(-2)!;
        const input = validateWorkerFailRequest(await jsonBody(request));
        const record = await controller.fail(jobId, input.leaseToken, {
          code: input.code,
          message: input.message,
          retryable: input.retryable,
          details: input.details,
        });
        json(response, 200, { record: workerProtocolRecord(record) });
        return;
      }

      if (
        request.method === "POST" &&
        url.pathname.endsWith("/acknowledge-cancellation")
      ) {
        const jobId = url.pathname.split("/").at(-2)!;
        const input = validateWorkerLeaseTokenRequest(await jsonBody(request));
        const record = await controller.acknowledgeCancellation(
          jobId,
          input.leaseToken,
        );
        json(response, 200, { record: workerProtocolRecord(record) });
        return;
      }

      if (url.pathname === "/api/v1/worker/objects" && request.method === "POST") {
        calls.objectPost += 1;
        const transaction = decodeVectorObjectTransaction(await body(request));
        const committed = await commitVectorObjectTransactionIdempotently(
          objects,
          transaction,
        );
        json(
          response,
          committed.replayed ? 200 : 201,
          {
            service: "evavo-vector-studio-worker-object-transfer",
            contractVersion: "1.0",
            transactionId: committed.transactionId,
            bodySha256: committed.bodySha256,
            idempotentReplay: committed.replayed,
            mimeTypeVerification: committed.mimeTypeVerification,
            objects: committed.receipts,
            existingObjectsOverwritten: false,
            generatedBodiesInJson: false,
          },
          {
            "x-vector-object-transfer-contract": "1.0",
            "x-vector-object-transaction-id": committed.transactionId,
            "x-vector-object-count": String(committed.receipts.length),
            "x-vector-object-replayed": String(committed.replayed),
          },
        );
        return;
      }

      if (url.pathname === "/api/v1/worker/objects" && request.method === "GET") {
        calls.objectGet += 1;
        const key = url.searchParams.get("key") ?? "";
        const object = await objects.get(key);
        response.writeHead(200, {
          "content-type": "application/octet-stream",
          "content-length": String(object.byteCount),
          "cache-control": "no-store",
          "x-vector-worker-protocol": "1.0",
          "x-vector-object-transfer-contract": "1.0",
          "x-vector-object-key": object.objectKey,
          "x-vector-object-bytes": String(object.byteCount),
          "x-vector-object-sha256": object.sha256,
          "x-vector-object-stored-mime": object.mimeType,
        });
        response.end(Buffer.from(object.bytes));
        return;
      }

      json(response, 404, {
        error: "TEST_ROUTE_NOT_FOUND",
        message: "Unexpected test route.",
        retryable: false,
      });
    } catch (error) {
      json(response, 500, {
        error: "TEST_SERVER_FAILURE",
        message: error instanceof Error ? error.message : String(error),
        retryable: false,
      });
    }
  });

  try {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const result = await runCli(`http://127.0.0.1:${address.port}`);

    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stderr, "");
    const payload = JSON.parse(result.stdout) as {
      command?: string;
      result?: {
        outcome?: string;
        record?: { status?: string; result?: { outputs?: unknown[] } };
        generatedBodiesInConsole?: boolean;
      };
    };
    assert.equal(payload.command, "run-once");
    assert.equal(payload.result?.outcome, "succeeded");
    assert.equal(payload.result?.record?.status, "succeeded");
    assert.equal(payload.result?.record?.result?.outputs?.length, 2);
    assert.equal(payload.result?.generatedBodiesInConsole, false);
    assert.doesNotMatch(result.stdout, /<svg\b/i);
    assert.doesNotMatch(result.stdout, new RegExp(TOKEN));

    const retained = await controller.get(created.record.id);
    assert.equal(retained.status, "succeeded");
    assert.equal(retained.result?.outputs.length, 2);
    assert.equal(objects.has("output/mark.optimised.svg"), true);
    assert.equal(objects.has("output/mark.evidence.json"), true);
    assert.match(
      new TextDecoder().decode(
        (await objects.get("output/mark.optimised.svg")).bytes,
      ),
      /<svg\b/i,
    );
    assert.match(
      new TextDecoder().decode(
        (await objects.get("output/mark.evidence.json")).bytes,
      ),
      /"approval":"human-review-required"/,
    );
    assert.equal(calls.discovery, 1);
    assert.equal(calls.lease, 1);
    assert.equal(calls.start, 1);
    assert.equal(calls.complete, 1);
    assert.equal(calls.objectGet, 1);
    assert.equal(calls.objectPost, 1);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve()),
    );
  }
});
