# EVAVO Vector Studio Worker Control API

Worker control protocol `1.0` exposes authenticated hosted-job lease transitions and separately configured immutable object transfer over HTTP. Generated bodies never enter job records or JSON control responses.

The control protocol is disabled until both are configured:

```text
VECTOR_WORKER_API_TOKEN
VECTOR_JOB_STORE_MODE=file
```

The object-transfer surface is independently disabled until:

```text
VECTOR_OBJECT_STORE_MODE=file
VECTOR_OBJECT_STORE_PATH=/persistent/vector-objects
```

Production file-backed records and objects additionally require:

```text
VECTOR_JOB_FILE_STORE_PERSISTENT=true
VECTOR_OBJECT_FILE_STORE_PERSISTENT=true
```

The worker token is separate from `VECTOR_API_TOKEN`. Worker routes never fall open in development when the worker token is absent.

## Current boundary

```text
Authenticated worker control API available when configured
Persistent hosted job records available when configured
Lease acquisition and state transitions available
Immutable object upload/download available when separately configured
Queue delivery unavailable
Managed remote execution unavailable
```

A worker may use the object-transfer endpoints or a trusted shared mounted object store. Provider-backed cloud object storage, queue delivery and autoscaling remain later deployment phases.

## Service discovery

```http
GET /api/v1/worker
Authorization: Bearer <VECTOR_WORKER_API_TOKEN>
```

The response declares:

- protocol and hosted-job contract versions;
- supported operations;
- record-store availability;
- object-store availability;
- endpoint templates;
- separate worker authentication;
- dynamic `objectTransferAvailable`;
- `queueDeliveryAvailable: false`;
- `remoteExecutionAvailable: false`.

The nested `objectTransfer` document declares the binary content type, byte and item limits, persistence state, replay policy and upload/download endpoints.

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

## Worker object transfer

```text
POST /api/v1/worker/objects
GET  /api/v1/worker/objects?key={objectKey}
```

Uploads use:

```http
Content-Type: application/vnd.evavo.vector-object-transaction
```

The deterministic `EVAVOOB1` transaction contains a canonical manifest followed by ordered object bytes. It supports up to 16 objects, 32 MiB per object and 64 MiB for the complete encoded transaction.

A new atomic no-overwrite commit returns `201`. A complete retained content replay returns `200`. Changed bytes or partial overlap fail with `VECTOR_WORKER_OBJECT_TRANSACTION_CONFLICT`.

Downloads return raw `application/octet-stream` bytes with object key, byte count and SHA-256 headers. Clients must verify those headers before using the body.

The current file adapter does not retain authoritative MIME metadata beside raw bytes. Replays may therefore report `mimeTypeVerification: content-only`; key, byte count and SHA-256 remain verified.

See [`OBJECT-TRANSFER.md`](OBJECT-TRANSFER.md) for the complete binary, replay and persistence contract.

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
- object transfer capability discoverable through `GET /api/v1/worker`;
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

Exact receipt-backed completion replay is idempotent. A changed replay fails with `HOSTED_JOB_COMPLETION_CONFLICT`.

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

JSON control requests are bounded to 272 KiB including transport allowance. Binary object transactions use their separate 64 MiB limit. The protocols reject:

- unknown JSON fields;
- malformed worker IDs;
- lease durations outside 5 seconds to 15 minutes;
- opaque lease tokens shorter than 16 or longer than 256 characters;
- `run-batch` and unknown operations;
- empty completion receipts;
- invalid byte counts, MIME types or SHA-256 receipts;
- non-finite or oversized evidence and failure details;
- generated object bodies embedded in JSON;
- malformed or oversized binary transactions;
- traversal, duplicate keys and changed immutable objects.

## Authentication and secrecy

`VECTOR_WORKER_API_TOKEN` must be a long, random, server-only value. It grants mutation access to worker leases and immutable objects and must not be exposed to browsers, ordinary API clients, ChatGPT prompts, logs or public environment variables.

The worker API is a trusted-worker boundary. It verifies uploaded transaction bytes and retained object hashes. Workspace-scoped object authorization, provider IAM and malware scanning remain deployment responsibilities.

## Deployment boundary

The protocol now enables secure control-plane coordination and file-backed immutable object transfer when explicitly configured. A distributed release still needs:

- database-backed job and event records;
- provider-backed shared object storage;
- queue delivery and visibility timeouts;
- distributed lease guarantees;
- worker identity and secret rotation;
- network policies and TLS termination;
- autoscaling, health checks and incident telemetry;
- workspace-scoped authorization;
- signed EVAVO hub launch;
- deployment and native-runtime smoke evidence.

Current capability reporting is:

```text
objectTransferAvailable: configured-runtime-dependent
queueDeliveryAvailable: false
remoteExecutionAvailable: false
```
