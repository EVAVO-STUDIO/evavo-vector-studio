import { createHash } from "node:crypto";
import {
  VECTOR_OBJECT_MAX_BYTES,
  VECTOR_OBJECT_TRANSACTION_CONTENT_TYPE,
  VECTOR_OBJECT_TRANSFER_CONTRACT_VERSION,
  VECTOR_WORKER_PROTOCOL_VERSION,
  encodeVectorObjectTransaction,
  type EncodedVectorObjectTransaction,
  type VectorObjectTransferManifestItem,
  type VectorObjectTransferWrite,
} from "@evavo/worker-protocol";
import { VectorWorkerClientError } from "./errors.js";
import {
  DEFAULT_WORKER_OBJECT_CLIENT_MAX_JSON_BYTES,
  DEFAULT_WORKER_OBJECT_CLIENT_TIMEOUT_MS,
  VECTOR_WORKER_OBJECT_CLIENT_VERSION,
  type VectorWorkerObjectClient,
  type VectorWorkerObjectClientOptions,
  type VectorWorkerObjectDownloadResult,
  type VectorWorkerObjectReceipt,
  type VectorWorkerObjectRequestOptions,
  type VectorWorkerObjectUploadResult,
} from "./object-types.js";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const SHA256 = /^[a-f0-9]{64}$/;
const OBJECT_KEY = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,1023}$/;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function resolveBaseUrl(
  value: string,
  allowInsecureHttp: boolean,
): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch (error) {
    throw new VectorWorkerClientError(
      "VECTOR_WORKER_CLIENT_OPTIONS_INVALID",
      "baseUrl must be an absolute HTTP or HTTPS URL.",
      { details: { baseUrl: value }, cause: error },
    );
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new VectorWorkerClientError(
      "VECTOR_WORKER_CLIENT_OPTIONS_INVALID",
      "baseUrl cannot contain credentials, query parameters or a fragment.",
    );
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new VectorWorkerClientError(
      "VECTOR_WORKER_CLIENT_OPTIONS_INVALID",
      "baseUrl must use HTTP or HTTPS.",
      { details: { protocol: url.protocol } },
    );
  }
  if (
    url.protocol === "http:" &&
    !LOCAL_HOSTS.has(url.hostname) &&
    !allowInsecureHttp
  ) {
    throw new VectorWorkerClientError(
      "VECTOR_WORKER_CLIENT_OPTIONS_INVALID",
      "Non-local worker object URLs must use HTTPS unless insecure HTTP is explicitly enabled.",
      { details: { hostname: url.hostname } },
    );
  }
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return url;
}

function boundedInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  field: string,
): number {
  const resolved = value ?? fallback;
  if (
    !Number.isSafeInteger(resolved) ||
    resolved < minimum ||
    resolved > maximum
  ) {
    throw new VectorWorkerClientError(
      "VECTOR_WORKER_CLIENT_OPTIONS_INVALID",
      `${field} must be an integer from ${minimum} to ${maximum}.`,
      { details: { field, value: resolved, minimum, maximum } },
    );
  }
  return resolved;
}

function secret(value: string): string {
  const token = value.trim();
  if (token.length < 24 || token.length > 4_096 || /\s/.test(token)) {
    throw new VectorWorkerClientError(
      "VECTOR_WORKER_CLIENT_OPTIONS_INVALID",
      "token must contain 24 to 4096 non-whitespace characters.",
    );
  }
  return token;
}

function objectKey(value: string): string {
  if (
    !OBJECT_KEY.test(value) ||
    value.startsWith("/") ||
    value.includes("\\") ||
    value.includes("\0") ||
    value.split("/").some((segment) =>
      !segment || segment === "." || segment === ".."
    )
  ) {
    throw new VectorWorkerClientError(
      "VECTOR_WORKER_CLIENT_OPTIONS_INVALID",
      "objectKey must be a portable relative slash-separated key.",
      { details: { objectKey: value } },
    );
  }
  return value;
}

function mimeType(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 160 ||
    value.trim() !== value ||
    /[\0\r\n]/.test(value)
  ) {
    throw new VectorWorkerClientError(
      "VECTOR_WORKER_CLIENT_RESPONSE_INVALID",
      "The worker object response contains an invalid MIME type.",
    );
  }
  return value;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256")
    .update(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength))
    .digest("hex");
}

function bodyBuffer(bytes: Uint8Array): ArrayBuffer {
  const body = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(body).set(bytes);
  return body;
}

function responseFailure(
  response: Response,
  parsed: unknown,
): VectorWorkerClientError {
  const failure = record(parsed);
  return new VectorWorkerClientError(
    "VECTOR_WORKER_CLIENT_HTTP_FAILED",
    typeof failure?.message === "string"
      ? failure.message
      : "The worker object server rejected the request.",
    {
      status: response.status,
      retryable: failure?.retryable === true,
      details: Object.freeze({
        serverCode: typeof failure?.error === "string" ? failure.error : null,
        serverDetails: record(failure?.details),
      }),
    },
  );
}

async function readBoundedResponse(
  response: Response,
  maximumBytes: number,
  controller: AbortController,
): Promise<Uint8Array> {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > maximumBytes) {
    controller.abort(new Error("worker-object-response-too-large"));
    throw new VectorWorkerClientError(
      "VECTOR_WORKER_CLIENT_RESPONSE_TOO_LARGE",
      "The worker object response exceeds the configured byte limit.",
      {
        status: response.status,
        details: { declaredLength: declared, maximumBytes },
      },
    );
  }
  if (!response.body) return new Uint8Array();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel("worker-object-response-too-large").catch(() => undefined);
        throw new VectorWorkerClientError(
          "VECTOR_WORKER_CLIENT_RESPONSE_TOO_LARGE",
          "The worker object response exceeds the configured byte limit.",
          {
            status: response.status,
            details: { bytes: total, maximumBytes },
          },
        );
      }
      chunks.push(new Uint8Array(value));
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function parseJson(bytes: Uint8Array, response: Response): unknown {
  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    throw new VectorWorkerClientError(
      "VECTOR_WORKER_CLIENT_RESPONSE_INVALID",
      "The worker object response is not valid UTF-8.",
      { status: response.status, cause: error },
    );
  }
  try {
    return JSON.parse(source) as unknown;
  } catch (error) {
    throw new VectorWorkerClientError(
      "VECTOR_WORKER_CLIENT_RESPONSE_INVALID",
      "The worker object response is not valid JSON.",
      { status: response.status, cause: error },
    );
  }
}

function requireProtocolHeaders(response: Response): void {
  const workerProtocol = response.headers.get("x-vector-worker-protocol");
  const transferContract = response.headers.get(
    "x-vector-object-transfer-contract",
  );
  if (
    workerProtocol !== VECTOR_WORKER_PROTOCOL_VERSION ||
    transferContract !== VECTOR_OBJECT_TRANSFER_CONTRACT_VERSION
  ) {
    throw new VectorWorkerClientError(
      "VECTOR_WORKER_CLIENT_RESPONSE_INVALID",
      "The worker object response uses unsupported protocol headers.",
      {
        status: response.status,
        details: { workerProtocol, transferContract },
      },
    );
  }
}

function receipt(
  value: unknown,
  expected: VectorObjectTransferManifestItem,
): VectorWorkerObjectReceipt {
  const source = record(value);
  if (
    !source ||
    source.objectKey !== expected.objectKey ||
    source.path !== `object://${expected.objectKey}` ||
    source.mimeType !== expected.mimeType ||
    source.bytes !== expected.bytes ||
    source.sha256 !== expected.sha256
  ) {
    throw new VectorWorkerClientError(
      "VECTOR_WORKER_CLIENT_RESPONSE_INVALID",
      "The worker object upload receipt does not match the encoded transaction.",
      { details: { objectKey: expected.objectKey } },
    );
  }
  return Object.freeze({
    objectKey: expected.objectKey,
    path: `object://${expected.objectKey}`,
    mimeType: expected.mimeType,
    bytes: expected.bytes,
    sha256: expected.sha256,
  });
}

function uploadResult(
  response: Response,
  parsed: unknown,
  encoded: EncodedVectorObjectTransaction,
): VectorWorkerObjectUploadResult {
  requireProtocolHeaders(response);
  const source = record(parsed);
  const replayed = response.status === 200;
  const verification = source?.mimeTypeVerification;
  const objects = source?.objects;
  if (
    !source ||
    source.service !== "evavo-vector-studio-worker-object-transfer" ||
    source.contractVersion !== VECTOR_OBJECT_TRANSFER_CONTRACT_VERSION ||
    source.transactionId !== encoded.transactionId ||
    source.bodySha256 !== encoded.bodySha256 ||
    source.idempotentReplay !== replayed ||
    (verification !== "verified" && verification !== "content-only") ||
    source.existingObjectsOverwritten !== false ||
    source.generatedBodiesInJson !== false ||
    !Array.isArray(objects) ||
    objects.length !== encoded.manifest.objects.length
  ) {
    throw new VectorWorkerClientError(
      "VECTOR_WORKER_CLIENT_RESPONSE_INVALID",
      "The worker object upload response does not match the encoded transaction.",
      { status: response.status },
    );
  }
  if (
    response.headers.get("x-vector-object-transaction-id") !==
      encoded.transactionId ||
    Number(response.headers.get("x-vector-object-count")) !== objects.length ||
    response.headers.get("x-vector-object-replayed") !== String(replayed)
  ) {
    throw new VectorWorkerClientError(
      "VECTOR_WORKER_CLIENT_RESPONSE_INVALID",
      "The worker object upload evidence headers do not match the response body.",
      { status: response.status },
    );
  }
  return Object.freeze({
    contractVersion: VECTOR_OBJECT_TRANSFER_CONTRACT_VERSION,
    transactionId: encoded.transactionId,
    bodySha256: encoded.bodySha256,
    replayed,
    mimeTypeVerification: verification,
    receipts: Object.freeze(
      objects.map((value, index) =>
        receipt(value, encoded.manifest.objects[index]!)
      ),
    ),
    existingObjectsOverwritten: false as const,
  });
}

function configuredRequest(
  requestOptions: VectorWorkerObjectRequestOptions,
  fallbackMaximum: number,
): Readonly<{ maximumBytes: number; signal?: AbortSignal }> {
  return Object.freeze({
    maximumBytes: boundedInteger(
      requestOptions.maximumBytes,
      fallbackMaximum,
      1,
      VECTOR_OBJECT_MAX_BYTES,
      "maximumBytes",
    ),
    ...(requestOptions.signal ? { signal: requestOptions.signal } : {}),
  });
}

export function createVectorWorkerObjectClient(
  options: VectorWorkerObjectClientOptions,
): VectorWorkerObjectClient {
  const base = resolveBaseUrl(options.baseUrl, options.allowInsecureHttp ?? false);
  const token = secret(options.token);
  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new VectorWorkerClientError(
      "VECTOR_WORKER_CLIENT_OPTIONS_INVALID",
      "A Fetch-compatible transport is required.",
    );
  }
  const timeoutMs = boundedInteger(
    options.timeoutMs,
    DEFAULT_WORKER_OBJECT_CLIENT_TIMEOUT_MS,
    1_000,
    10 * 60 * 1_000,
    "timeoutMs",
  );
  const maximumJsonBytes = boundedInteger(
    options.maximumJsonBytes,
    DEFAULT_WORKER_OBJECT_CLIENT_MAX_JSON_BYTES,
    1_024,
    4 * 1024 * 1024,
    "maximumJsonBytes",
  );

  async function execute(
    method: "GET" | "POST",
    relativePath: string,
    headers: HeadersInit,
    body: BodyInit | null,
    requestOptions: VectorWorkerObjectRequestOptions,
    maximumBytes: number,
  ): Promise<Readonly<{ response: Response; bytes: Uint8Array }>> {
    const url = new URL(relativePath, base);
    const controller = new AbortController();
    let timedOut = false;
    const onAbort = () => controller.abort(requestOptions.signal?.reason);
    if (requestOptions.signal?.aborted) onAbort();
    else requestOptions.signal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort(new Error("worker-object-timeout"));
    }, timeoutMs);
    try {
      let response: Response;
      try {
        response = await fetchImpl(url, {
          method,
          headers: {
            authorization: `Bearer ${token}`,
            "accept-encoding": "identity",
            ...headers,
          },
          ...(body === null ? {} : { body }),
          cache: "no-store",
          redirect: "error",
          signal: controller.signal,
        });
        const bytes = await readBoundedResponse(
          response,
          maximumBytes,
          controller,
        );
        return Object.freeze({ response, bytes });
      } catch (error) {
        if (error instanceof VectorWorkerClientError) throw error;
        if (timedOut) {
          throw new VectorWorkerClientError(
            "VECTOR_WORKER_CLIENT_TIMEOUT",
            "The worker object request exceeded its timeout.",
            { retryable: true, details: { timeoutMs }, cause: error },
          );
        }
        if (requestOptions.signal?.aborted) {
          throw new VectorWorkerClientError(
            "VECTOR_WORKER_CLIENT_ABORTED",
            "The worker object request was cancelled.",
            { retryable: true, cause: error },
          );
        }
        throw new VectorWorkerClientError(
          "VECTOR_WORKER_CLIENT_NETWORK_FAILED",
          "The worker object request could not reach the server.",
          { retryable: true, cause: error },
        );
      }
    } finally {
      clearTimeout(timer);
      requestOptions.signal?.removeEventListener("abort", onAbort);
    }
  }

  return Object.freeze({
    version: VECTOR_WORKER_OBJECT_CLIENT_VERSION,
    baseUrl: base.href,
    async uploadObjects(writes, requestOptions = {}) {
      let encoded: EncodedVectorObjectTransaction;
      try {
        encoded = encodeVectorObjectTransaction(writes);
      } catch (error) {
        throw new VectorWorkerClientError(
          "VECTOR_WORKER_CLIENT_OPTIONS_INVALID",
          "The object upload transaction is invalid.",
          {
            details: {
              protocolCode: error instanceof Error && "code" in error
                ? String(error.code)
                : null,
            },
            cause: error,
          },
        );
      }
      const configured = configuredRequest(requestOptions, maximumJsonBytes);
      const { response, bytes } = await execute(
        "POST",
        "api/v1/worker/objects",
        {
          accept: "application/json",
          "content-type": VECTOR_OBJECT_TRANSACTION_CONTENT_TYPE,
          "content-length": String(encoded.body.byteLength),
        },
        bodyBuffer(encoded.body),
        configured,
        configured.maximumBytes,
      );
      const parsed = parseJson(bytes, response);
      if (!response.ok) throw responseFailure(response, parsed);
      if (response.status !== 200 && response.status !== 201) {
        throw new VectorWorkerClientError(
          "VECTOR_WORKER_CLIENT_RESPONSE_INVALID",
          "The worker object upload returned an unsupported success status.",
          { status: response.status },
        );
      }
      return uploadResult(response, parsed, encoded);
    },
    async downloadObject(value, requestOptions = {}) {
      const key = objectKey(value);
      const configured = configuredRequest(requestOptions, VECTOR_OBJECT_MAX_BYTES);
      const { response, bytes } = await execute(
        "GET",
        `api/v1/worker/objects?key=${encodeURIComponent(key)}`,
        { accept: "application/octet-stream" },
        null,
        configured,
        configured.maximumBytes,
      );
      if (!response.ok) {
        throw responseFailure(response, parseJson(bytes, response));
      }
      requireProtocolHeaders(response);
      const responseContentType = response.headers.get("content-type")
        ?.split(";", 1)[0]
        ?.trim()
        .toLowerCase();
      const contentEncoding = response.headers.get("content-encoding");
      const responseKey = response.headers.get("x-vector-object-key");
      const declaredBytes = Number(response.headers.get("x-vector-object-bytes"));
      const digest = response.headers.get("x-vector-object-sha256");
      const storedMimeType = response.headers.get("x-vector-object-stored-mime");
      if (
        responseContentType !== "application/octet-stream" ||
        (contentEncoding !== null && contentEncoding !== "identity") ||
        responseKey !== key ||
        !Number.isSafeInteger(declaredBytes) ||
        declaredBytes < 1 ||
        declaredBytes > configured.maximumBytes ||
        !digest ||
        !SHA256.test(digest) ||
        bytes.byteLength !== declaredBytes
      ) {
        throw new VectorWorkerClientError(
          "VECTOR_WORKER_CLIENT_RESPONSE_INVALID",
          "The worker object download evidence headers do not match the response body.",
          {
            status: response.status,
            details: {
              objectKey: key,
              responseKey,
              declaredBytes,
              actualBytes: bytes.byteLength,
              responseContentType,
              contentEncoding,
            },
          },
        );
      }
      const actualSha256 = sha256(bytes);
      if (actualSha256 !== digest) {
        throw new VectorWorkerClientError(
          "VECTOR_WORKER_CLIENT_RESPONSE_INVALID",
          "The worker object download SHA-256 does not match its bytes.",
          {
            status: response.status,
            details: {
              objectKey: key,
              expectedSha256: digest,
              actualSha256,
            },
          },
        );
      }
      const result: VectorWorkerObjectDownloadResult = Object.freeze({
        objectKey: key,
        mimeType: mimeType(storedMimeType),
        bytes: new Uint8Array(bytes),
        byteCount: bytes.byteLength,
        sha256: digest,
      });
      return result;
    },
  });
}
