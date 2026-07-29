# EVAVO Vector Studio Worker Control Client

Worker control client `1.0` is the typed HTTP consumer for worker protocol `1.0`.

```text
packages/worker-client
@evavo/worker-client
```

It is a control-plane client only. It does not fetch source objects, upload generated assets, start a queue or claim that managed remote execution is available.

## Create a client

```ts
import { createVectorWorkerClient } from "@evavo/worker-client";

const client = createVectorWorkerClient({
  baseUrl: "https://vector-worker-control.example.com/",
  token: process.env.VECTOR_WORKER_API_TOKEN!,
});
```

The token remains private inside the client closure. It is added only to the `Authorization: Bearer` header and is never included in returned records, errors or diagnostics.

## URL and transport policy

- non-local control URLs require HTTPS;
- `http://localhost`, `http://127.0.0.1` and `http://[::1]` are allowed for local development;
- other insecure HTTP requires the explicit `allowInsecureHttp` option;
- base URLs cannot contain credentials, query parameters or fragments;
- redirects are rejected;
- responses are bounded to 512 KiB by default;
- timeouts default to 30 seconds;
- caller cancellation and timeout are reported separately;
- successful responses must carry `X-Vector-Worker-Protocol: 1.0`.

## Methods

```text
capabilities
acquireLease
start
heartbeat
complete
fail
acknowledgeCancellation
```

Example lease flow:

```ts
const leased = await client.acquireLease({
  workerId: "remote-worker-01",
  leaseMs: 60_000,
  operations: ["optimise-svg", "animate-svg"],
});

if (leased) {
  await client.start(leased.record.id, leased.leaseToken);
  const heartbeat = await client.heartbeat(
    leased.record.id,
    leased.leaseToken,
    60_000,
  );

  if (heartbeat.cancellationRequested) {
    await client.acknowledgeCancellation(
      leased.record.id,
      leased.leaseToken,
    );
  }
}
```

Completion sends receipts rather than generated bodies:

```ts
await client.complete(jobId, {
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

## No automatic mutation retries

The client deliberately does not auto-retry lease acquisition, start, completion, failure or cancellation acknowledgement.

A control request may have reached the server even when its response was lost. Blind retry could:

- acquire a lease whose token was never received;
- attempt a second transition against a changed record;
- hide an expired or superseded lease;
- duplicate operator assumptions about completion.

Callers must reconcile uncertain outcomes explicitly through hosted job inspection or lease expiry. Network and timeout failures are marked retryable as transport facts, but retry policy remains with the worker orchestration layer.

## Response validation

The client validates:

- bounded JSON body size;
- JSON syntax;
- HTTP failure envelopes;
- protocol response header;
- acquisition protocol version;
- opaque lease-token presence only in the acquisition envelope;
- redacted record leases containing `tokenPresent: true` and no `token` field;
- heartbeat `cancellationRequested` state;
- minimum record identity and status fields.

It does not validate that output objects exist. Object verification belongs to a future shared object-storage adapter.

## Stable errors

```text
VECTOR_WORKER_CLIENT_OPTIONS_INVALID
VECTOR_WORKER_CLIENT_ABORTED
VECTOR_WORKER_CLIENT_TIMEOUT
VECTOR_WORKER_CLIENT_NETWORK_FAILED
VECTOR_WORKER_CLIENT_HTTP_FAILED
VECTOR_WORKER_CLIENT_RESPONSE_TOO_LARGE
VECTOR_WORKER_CLIENT_RESPONSE_INVALID
```

Server failures preserve HTTP status, retryability, stable server code and bounded server details. The configured worker token is never copied into the error.

## Injected transport

A Fetch-compatible transport can be injected for tests, controlled runtimes and future observability wrappers:

```ts
const client = createVectorWorkerClient({
  baseUrl,
  token,
  fetch: instrumentedFetch,
});
```

Instrumentation must not log the `Authorization` header or completion lease tokens.

## Current deployment boundary

The client can securely coordinate the worker control API. It cannot make remote execution complete by itself.

```text
Worker control HTTP client available
Object transfer unavailable
Queue delivery unavailable
Managed remote execution unavailable
```

A future remote worker process must combine this client with a trusted shared object-storage adapter, governed worker executor, heartbeat monitor and explicit reconciliation policy.
