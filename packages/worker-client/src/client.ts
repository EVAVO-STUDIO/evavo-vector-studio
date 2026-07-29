import { Buffer } from "node:buffer";
import {
  VECTOR_WORKER_PROTOCOL_VERSION,
  type VectorWorkerLeaseRequest,
  type VectorWorkerLeaseResponse,
  type VectorWorkerProtocolRecord,
} from "@evavo/worker-protocol";
import { VectorWorkerClientError } from "./errors.js";
import {
  DEFAULT_WORKER_CLIENT_MAX_RESPONSE_BYTES,
  DEFAULT_WORKER_CLIENT_TIMEOUT_MS,
  VECTOR_WORKER_CLIENT_VERSION,
  type VectorWorkerCapabilitiesResponse,
  type VectorWorkerClient,
  type VectorWorkerClientOptions,
  type VectorWorkerCompleteInput,
  type VectorWorkerHeartbeatResponse,
  type VectorWorkerRecordResponse,
  type VectorWorkerRequestOptions,
} from "./types.js";
import type { HostedJobFailureInput } from "@evavo/job-control";

const JOB_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

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
      "Non-local worker control URLs must use HTTPS unless insecure HTTP is explicitly enabled.",
      { details: { hostname: url.hostname } },
    );
  }
  url.search = "";
  url.hash = "";
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

function jobPath(jobId: string, suffix: string): string {
  if (!JOB_ID.test(jobId)) {
    throw new VectorWorkerClientError(
      "VECTOR_WORKER_CLIENT_OPTIONS_INVALID",
      "jobId must be a portable identifier.",
      { details: { jobId } },
    );
  }
  return `api/v1/worker/jobs/${encodeURIComponent(jobId)}/${suffix}`;
}

function protocolRecord(value: unknown): VectorWorkerProtocolRecord {
  const source = record(value);
  if (!source || typeof source.id !== "string" || typeof source.status !== "string") {
    throw new VectorWorkerClientError(
      "VECTOR_WORKER_CLIENT_RESPONSE_INVALID",
      "The worker control response does not contain a valid hosted job record.",
    );
  }
  const lease = source.lease;
  if (lease !== null) {
    const leaseRecord = record(lease);
    if (!leaseRecord || leaseRecord.tokenPresent !== true || "token" in leaseRecord) {
      throw new VectorWorkerClientError(
        "VECTOR_WORKER_CLIENT_RESPONSE_INVALID",
        "Worker control records must redact lease tokens.",
      );
    }
  }
  return source as unknown as VectorWorkerProtocolRecord;
}

function recordResponse(value: unknown): VectorWorkerRecordResponse {
  const source = record(value);
  if (!source) {
    throw new VectorWorkerClientError(
      "VECTOR_WORKER_CLIENT_RESPONSE_INVALID",
      "The worker control response must be a JSON object.",
    );
  }
  return Object.freeze({
    ...source,
    record: protocolRecord(source.record),
  }) as VectorWorkerRecordResponse;
}

function heartbeatResponse(value: unknown): VectorWorkerHeartbeatResponse {
  const source = recordResponse(value);
  if (typeof source.cancellationRequested !== "boolean") {
    throw new VectorWorkerClientError(
      "VECTOR_WORKER_CLIENT_RESPONSE_INVALID",
      "The heartbeat response is missing cancellationRequested.",
    );
  }
  return source as VectorWorkerHeartbeatResponse;
}

export function createVectorWorkerClient(
  options: VectorWorkerClientOptions,
): VectorWorkerClient {
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
    DEFAULT_WORKER_CLIENT_TIMEOUT_MS,
    1_000,
    5 * 60 * 1_000,
    "timeoutMs",
  );
  const maximumResponseBytes = boundedInteger(
    options.maximumResponseBytes,
    DEFAULT_WORKER_CLIENT_MAX_RESPONSE_BYTES,
    1_024,
    4 * 1024 * 1024,
    "maximumResponseBytes",
  );

  async function request(
    method: "GET" | "POST",
    relativePath: string,
    body: unknown,
    requestOptions: VectorWorkerRequestOptions = {},
  ): Promise<Readonly<{ status: number; body: unknown | null }>> {
    const url = new URL(relativePath, base);
    const controller = new AbortController();
    let timedOut = false;
    const onAbort = () => controller.abort(requestOptions.signal?.reason);
    if (requestOptions.signal?.aborted) onAbort();
    else requestOptions.signal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort(new Error("worker-control-timeout"));
    }, timeoutMs);
    try {
      let response: Response;
      try {
        response = await fetchImpl(url, {
          method,
          headers: {
            accept: "application/json",
            authorization: `Bearer ${token}`,
            ...(method === "POST" ? { "content-type": "application/json" } : {}),
          },
          body: method === "POST" ? JSON.stringify(body) : undefined,
          cache: "no-store",
          redirect: "error",
          signal: controller.signal,
        });
      } catch (error) {
        if (timedOut) {
          throw new VectorWorkerClientError(
            "VECTOR_WORKER_CLIENT_TIMEOUT",
            "The worker control request exceeded its timeout.",
            { retryable: true, details: { timeoutMs }, cause: error },
          );
        }
        if (requestOptions.signal?.aborted) {
          throw new VectorWorkerClientError(
            "VECTOR_WORKER_CLIENT_ABORTED",
            "The worker control request was cancelled.",
            { retryable: true, cause: error },
          );
        }
        throw new VectorWorkerClientError(
          "VECTOR_WORKER_CLIENT_NETWORK_FAILED",
          "The worker control request could not reach the server.",
          { retryable: true, cause: error },
        );
      }

      if (response.status === 204) {
        return Object.freeze({ status: 204, body: null });
      }
      const declaredLength = Number(response.headers.get("content-length") ?? 0);
      if (
        Number.isFinite(declaredLength) &&
        declaredLength > maximumResponseBytes
      ) {
        throw new VectorWorkerClientError(
          "VECTOR_WORKER_CLIENT_RESPONSE_TOO_LARGE",
          "The worker control response exceeds the configured byte limit.",
          {
            status: response.status,
            details: { declaredLength, maximumResponseBytes },
          },
        );
      }
      const text = await response.text();
      const bytes = Buffer.byteLength(text, "utf8");
      if (bytes > maximumResponseBytes) {
        throw new VectorWorkerClientError(
          "VECTOR_WORKER_CLIENT_RESPONSE_TOO_LARGE",
          "The worker control response exceeds the configured byte limit.",
          {
            status: response.status,
            details: { bytes, maximumResponseBytes },
          },
        );
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(text) as unknown;
      } catch (error) {
        throw new VectorWorkerClientError(
          "VECTOR_WORKER_CLIENT_RESPONSE_INVALID",
          "The worker control response is not valid JSON.",
          { status: response.status, cause: error },
        );
      }
      if (!response.ok) {
        const failure = record(parsed);
        throw new VectorWorkerClientError(
          "VECTOR_WORKER_CLIENT_HTTP_FAILED",
          typeof failure?.message === "string"
            ? failure.message
            : "The worker control server rejected the request.",
          {
            status: response.status,
            retryable: failure?.retryable === true,
            details: Object.freeze({
              serverCode:
                typeof failure?.error === "string" ? failure.error : null,
              serverDetails: record(failure?.details),
            }),
          },
        );
      }
      const protocol = response.headers.get("x-vector-worker-protocol");
      if (protocol !== VECTOR_WORKER_PROTOCOL_VERSION) {
        throw new VectorWorkerClientError(
          "VECTOR_WORKER_CLIENT_RESPONSE_INVALID",
          "The worker control response uses an unsupported protocol version.",
          { status: response.status, details: { protocol } },
        );
      }
      return Object.freeze({ status: response.status, body: parsed });
    } finally {
      clearTimeout(timer);
      requestOptions.signal?.removeEventListener("abort", onAbort);
    }
  }

  return Object.freeze({
    version: VECTOR_WORKER_CLIENT_VERSION,
    baseUrl: base.href,
    async capabilities(requestOptions = {}) {
      const response = await request("GET", "api/v1/worker", null, requestOptions);
      const source = record(response.body);
      if (!source || typeof source.service !== "string" || !record(source.contract)) {
        throw new VectorWorkerClientError(
          "VECTOR_WORKER_CLIENT_RESPONSE_INVALID",
          "The worker capability response is invalid.",
        );
      }
      return source as unknown as VectorWorkerCapabilitiesResponse;
    },
    async acquireLease(input: VectorWorkerLeaseRequest, requestOptions = {}) {
      const response = await request("POST", "api/v1/worker/lease", input, requestOptions);
      if (response.status === 204) return null;
      const source = record(response.body);
      if (
        !source ||
        source.protocolVersion !== VECTOR_WORKER_PROTOCOL_VERSION ||
        typeof source.leaseToken !== "string" ||
        source.leaseToken.length < 16
      ) {
        throw new VectorWorkerClientError(
          "VECTOR_WORKER_CLIENT_RESPONSE_INVALID",
          "The worker lease response is invalid.",
        );
      }
      return Object.freeze({
        protocolVersion: VECTOR_WORKER_PROTOCOL_VERSION,
        leaseToken: source.leaseToken,
        record: protocolRecord(source.record),
      }) as VectorWorkerLeaseResponse;
    },
    async start(jobId, leaseToken, requestOptions = {}) {
      const response = await request(
        "POST",
        jobPath(jobId, "start"),
        { leaseToken },
        requestOptions,
      );
      return recordResponse(response.body);
    },
    async heartbeat(jobId, leaseToken, leaseMs, requestOptions = {}) {
      const response = await request(
        "POST",
        jobPath(jobId, "heartbeat"),
        { leaseToken, leaseMs },
        requestOptions,
      );
      return heartbeatResponse(response.body);
    },
    async complete(jobId, completion: VectorWorkerCompleteInput, requestOptions = {}) {
      const response = await request(
        "POST",
        jobPath(jobId, "complete"),
        completion,
        requestOptions,
      );
      return recordResponse(response.body);
    },
    async fail(
      jobId,
      leaseToken,
      failure: HostedJobFailureInput,
      requestOptions = {},
    ) {
      const response = await request(
        "POST",
        jobPath(jobId, "fail"),
        { leaseToken, ...failure },
        requestOptions,
      );
      return recordResponse(response.body);
    },
    async acknowledgeCancellation(jobId, leaseToken, requestOptions = {}) {
      const response = await request(
        "POST",
        jobPath(jobId, "acknowledge-cancellation"),
        { leaseToken },
        requestOptions,
      );
      return recordResponse(response.body);
    },
  });
}
