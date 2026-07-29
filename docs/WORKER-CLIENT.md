# EVAVO Vector Studio Worker Clients

`@evavo/worker-client` provides two typed HTTP clients for worker protocol `1.0`:

```text
createVectorWorkerClient        JSON lease and state coordination
createVectorWorkerObjectClient  immutable binary upload and download
```

Neither client starts a queue, embeds generated bodies in job records, or claims managed remote execution is deployed.

## Shared security policy

Both clients require a worker-only bearer secret:

```text
VECTOR_WORKER_API_TOKEN
```

The token remains private inside each client closure. It is added only to `Authorization: Bearer` and is never included in returned records, receipts, errors, or diagnostics.

Transport policy:

- non-local URLs require HTTPS;
- `http://localhost`, `http://127.0.0.1`, and `http://[::1]` are allowed for local development;
- other insecure HTTP requires explicit `allowInsecureHttp`;
- base URLs cannot contain credentials, query parameters, or fragments;
- redirects are rejected;
- caller cancellation and timeout are distinct;
- successful responses require `X-Vector-Worker-Protocol: 1.0`;
- no mutation is retried automatically by the clients.

## Control client

```ts
import { createVectorWorkerClient } from "@evavo/worker-client";

const control = createVectorWorkerClient({
  baseUrl: "https://vector-worker-control.example.com/",
  token: process.env.VECTOR_WORKER_API_TOKEN!,
});
```

Defaults:

```text
JSON response limit  512 KiB
Timeout              30 seconds
```

Methods:

```text
capabilities
acquireLease
start
heartbeat
complete
fail
acknowledgeCancellation
```

Example:

```ts
const leased = await control.acquireLease({
  workerId: "remote-worker-01",
  leaseMs: 60_000,
  operations: ["optimise-svg", "animate-svg"],
});

if (leased) {
  await control.start(leased.record.id, leased.leaseToken);
  const heartbeat = await control.heartbeat(
    leased.record.id,
    leased.leaseToken,
    60_000,
  );

  if (heartbeat.cancellationRequested) {
    await control.acknowledgeCancellation(
      leased.record.id,
      leased.leaseToken,
    );
  }
}
```

Completion sends receipts rather than generated bodies:

```ts
await control.complete(jobId, {
  leaseToken,
  outputs: [
    {
      path: "object://workspace/mark/revision-01.svg",
      mimeType: "image/svg+xml",
      bytes: 12345,
      sha256: "64-lowercase-hex-characters",
    },
  ],
  evidence: {
    approval: "human-review-required",
  },
});
```

The control client validates bounded JSON, syntax, failure envelopes, protocol headers, acquisition version, lease-token placement, redacted records, heartbeat cancellation state, and minimum record identity.

## Object-transfer client

```ts
import { createVectorWorkerObjectClient } from "@evavo/worker-client";

const objects = createVectorWorkerObjectClient({
  baseUrl: "https://vector-worker-control.example.com/",
  token: process.env.VECTOR_WORKER_API_TOKEN!,
});
```

Defaults:

```text
JSON receipt limit   512 KiB
Object limit         32 MiB
Request timeout      60 seconds
Transaction limit    governed by EVAVOOB1, 64 MiB
```

Methods:

```text
uploadObjects
downloadObject
```

Upload example:

```ts
const uploaded = await objects.uploadObjects([
  {
    objectKey: "workspace/source/mark.svg",
    mimeType: "image/svg+xml",
    bytes: new TextEncoder().encode(svg),
  },
]);
```

`uploadObjects`:

1. validates the writes through the worker-protocol encoder;
2. creates one deterministic `EVAVOOB1` transaction;
3. sends the exact binary body with the worker token;
4. requires worker and object-transfer protocol headers;
5. verifies transaction ID and body SHA-256;
6. verifies status against replay state;
7. verifies every receipt in manifest order;
8. confirms existing objects were not overwritten;
9. returns receipts without returning generated bodies.

An exact retained content replay is accepted. Changed or partial object overlap remains a server conflict.

Download example:

```ts
const downloaded = await objects.downloadObject(
  "workspace/source/mark.svg",
  { maximumBytes: 5 * 1024 * 1024 },
);
```

`downloadObject`:

- validates the portable object key;
- requests `Accept-Encoding: identity`;
- streams the response under an active byte limit;
- rejects unsupported content encoding;
- requires `application/octet-stream`;
- verifies returned object key;
- verifies declared and actual byte count;
- verifies SHA-256 before exposing bytes;
- returns a defensive byte copy;
- preserves the server’s stored MIME evidence separately.

## Retry boundary

The clients deliberately perform no automatic mutation retries.

Blindly retrying lease and state transitions could hide changed control-plane state. `uploadObjects` is exact-content replay-safe at the server, but the base client still performs one request so orchestration owns retry timing, backoff, and cancellation.

The HTTP worker object-store adapter may later apply bounded retries to the same deterministic upload body because the server can reconcile an exact replay. That policy belongs in the worker execution layer, not the generic client.

## Stable client errors

```text
VECTOR_WORKER_CLIENT_OPTIONS_INVALID
VECTOR_WORKER_CLIENT_ABORTED
VECTOR_WORKER_CLIENT_TIMEOUT
VECTOR_WORKER_CLIENT_NETWORK_FAILED
VECTOR_WORKER_CLIENT_HTTP_FAILED
VECTOR_WORKER_CLIENT_RESPONSE_TOO_LARGE
VECTOR_WORKER_CLIENT_RESPONSE_INVALID
```

Server failures preserve HTTP status, retryability, stable server code, and bounded server details. The configured worker token is never copied into errors.

## Injected transport

A Fetch-compatible transport can be injected into either client for tests, controlled runtimes, and observability wrappers:

```ts
const objects = createVectorWorkerObjectClient({
  baseUrl,
  token,
  fetch: instrumentedFetch,
});
```

Instrumentation must not log authorization headers, lease tokens, source bodies, generated bodies, or complete binary transactions.

## Current deployment boundary

```text
Worker control HTTP client        available
Verified object-transfer client   available
Queue delivery                    unavailable
Managed remote execution          unavailable
```

The object client makes remote immutable transfer possible when the server runtime is configured. A complete worker still needs the governed executor, heartbeat monitoring, receipt-backed completion reconciliation, and explicit retry policy.
