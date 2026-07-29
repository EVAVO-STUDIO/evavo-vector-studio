# EVAVO Vector Studio Worker Control API

Worker control protocol `1.0` exposes authenticated hosted-job lease transitions over HTTP without exposing generated object bodies or claiming that distributed remote execution is available.

The protocol is disabled until both are configured:

```text
VECTOR_WORKER_API_TOKEN
VECTOR_JOB_STORE_MODE=file
```

Production file-backed records also require:

```text
VECTOR_JOB_FILE_STORE_PERSISTENT=true
```

The worker token is separate from `VECTOR_API_TOKEN`. Worker routes never fall open in development when the worker token is absent.

## Current boundary

```text
Authenticated worker control API available when configured
Persistent hosted job records available when configured
Lease acquisition and state transitions available
Object upload/download API unavailable
Queue delivery unavailable
Remote execution unavailable
```

A worker can coordinate a job only when it already has access to the referenced immutable source and output object store through another trusted deployment mechanism, such as a persistent shared volume. The API does not proxy raster, SVG, JSON or archive bodies.

## Service discovery

```http
GET /api/v1/worker
Authorization: Bearer <VECTOR_WORKER_API_TOKEN>
```

The response declares:

- protocol version;
- hosted job contract version;
- supported operations;
- record-store availability;
- endpoint templates;
- separate worker authentication;
- `objectTransferAvailable: false`;
- `queueDeliveryAvailable: false`;
- `remoteExecutionAvailable: false`.

All worker responses use `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, `Vary: Authorization` and `X-Vector-Worker-Protocol: 1.0`.

## Supported operations

```text
trace-raster
optimise-svg
animate-svg
export-lottie
package-dotlottie
```

`run-batch` is intentionally rejected. Durable manifests remain available through the local batch CLI and MCP batch tools.

## Acquire a lease

```http
POST /api/v1/worker/lease
Authorization: Bearer <VECTOR_WORKER_API_TOKEN>
Content-Type: application/json
```

```json
{
  "workerId": "remote-worker-01",
  "leaseMs": 60000,
  "operations": [
    "trace-raster",
    "optimise-svg",
    "animate-svg",
    "export-lottie",
    "package-dotlottie"
  ]
}
```

When no compatible queued job exists, the endpoint returns `204` with no body.

When a job is acquired, the response includes:

- the complete bounded job request and payload;
- redacted lease timing and worker identity;
- one top-level opaque `leaseToken`;
- `objectTransferAvailable: false`;
- `remoteExecutionAvailable: false`.

The opaque lease token is returned only by acquisition. All other responses replace it with `tokenPresent: true`.

## Start

```http
POST /api/v1/worker/jobs/{jobId}/start
```

```json
{
  "leaseToken": "opaque-lease-token"
}
```

Only the exact active lease can move a leased job into `running`.

## Heartbeat and cancellation observation

```http
POST /api/v1/worker/jobs/{jobId}/heartbeat
```

```json
{
  "leaseToken": "opaque-lease-token",
  "leaseMs": 60000
}
```

The response returns the redacted record and:

```json
{
  "cancellationRequested": false
}
```

A worker must stop before committing new objects when the field becomes `true`, then acknowledge cancellation.

## Complete with receipts

```http
POST /api/v1/worker/jobs/{jobId}/complete
```

```json
{
  "leaseToken": "opaque-lease-token",
  "outputs": [
    {
      "path": "object://workspace/mark/revision-01.svg",
      "mimeType": "image/svg+xml",
      "bytes": 12345,
      "sha256": "64-lowercase-hex-characters"
    }
  ],
  "evidence": {
    "approval": "human-review-required"
  }
}
```

Completion requires at least one valid output receipt. Generated bodies are rejected by the bounded JSON contract and are not accepted as a replacement for object storage.

If cancellation arrives after immutable outputs have already committed, receipt-backed completion can retain those outputs as succeeded while preserving cancellation metadata and:

```text
cancellationRaceResolution: committed-success-retained
```

## Report failure

```http
POST /api/v1/worker/jobs/{jobId}/fail
```

```json
{
  "leaseToken": "opaque-lease-token",
  "code": "TRANSIENT_OBJECT_STORAGE_FAILURE",
  "message": "Object storage is temporarily unavailable.",
  "retryable": true,
  "details": {
    "provider": "example"
  }
}
```

A retryable failure returns the record to `queued` while attempts remain. Terminal or exhausted failures become `failed`.

## Acknowledge cancellation

```http
POST /api/v1/worker/jobs/{jobId}/acknowledge-cancellation
```

```json
{
  "leaseToken": "opaque-lease-token"
}
```

The transition is valid only after the record entered `cancel-requested`.

## Request validation

Worker requests require `Content-Type: application/json` and are bounded to 272 KiB including transport allowance. The protocol rejects:

- unknown fields;
- malformed worker IDs;
- lease durations outside 5 seconds to 15 minutes;
- opaque lease tokens shorter than 16 or longer than 256 characters;
- `run-batch` and unknown operations;
- empty completion receipts;
- invalid byte counts, MIME types or SHA-256 receipts;
- non-finite or oversized evidence and failure details;
- generated object bodies embedded in the request.

## Authentication and secrecy

`VECTOR_WORKER_API_TOKEN` must be a long, random, server-only value. It grants mutation access to worker leases and must not be exposed to browsers, ordinary API clients, ChatGPT prompts, logs or public environment variables.

The worker API is a trusted-worker boundary. It validates receipt structure, but it cannot independently prove that a remote worker actually wrote the referenced object unless the deployment adds a shared object-storage verification adapter.

## Deployment boundary

The protocol enables secure control-plane coordination, not a released remote worker system. A distributed release still needs:

- database-backed job and event records;
- a shared immutable object-storage API or provider adapter;
- queue delivery and visibility timeouts;
- distributed lease guarantees;
- worker identity and secret rotation;
- network policies and TLS termination;
- autoscaling, health checks and incident telemetry;
- workspace-scoped authorization;
- signed EVAVO hub launch;
- deployment and native-runtime smoke evidence.

Until those exist, the contract reports:

```text
objectTransferAvailable: false
queueDeliveryAvailable: false
remoteExecutionAvailable: false
```
