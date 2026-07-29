# EVAVO Vector Studio HTTP-Coordinated Worker

HTTP worker contract `1.0` executes governed vector jobs while coordinating leases and terminal state through the authenticated Worker Control API.

Two immutable object transports are available:

```text
shared-file  trusted shared or mounted FileVectorObjectStore
worker-api   verified authenticated binary object-transfer API
```

This is a practical self-hosted execution bridge. It is not a managed queue or autoscaled distributed worker platform.

## Boundary

```text
HTTP lease coordination             available
Shared immutable file execution     available
Verified HTTP object transfer       available when server configured
Lease heartbeats                    available
Cancellation observation            available
Receipt-backed completion replay    available
Generated bodies in JSON control    false
Queue delivery                      unavailable
Managed remote execution            unavailable
```

The control API transports bounded JSON records, lease tokens, receipts and compact evidence. Source and generated bodies remain in immutable object storage.

In `file` mode the API and worker see the same object namespace through a trusted shared volume. In `http` mode the worker downloads and uploads verified objects through `/api/v1/worker/objects`, so a shared filesystem is not required.

## Package and binary

```text
workers/http-worker
@evavo/http-worker
evavo-vector-http-worker
```

Root commands:

```powershell
pnpm http-worker:capabilities
pnpm http-worker:run-once
pnpm http-worker:run -- --idle-exit-ms 30000
```

## Required configuration

```powershell
$env:VECTOR_WORKER_CONTROL_URL = "https://vector.evavo.com.au"
$env:VECTOR_WORKER_API_TOKEN = "replace-with-a-long-worker-only-secret"
$env:VECTOR_WORKER_ID = "greg-workstation-01"
```

`VECTOR_WORKER_API_TOKEN` is never accepted as a CLI flag. Keeping it out of arguments reduces accidental exposure through shell history and process listings.

Non-local control URLs require HTTPS. Local `http://localhost`, `127.0.0.1` and `::1` URLs are accepted for development. Any other plain-HTTP target requires the explicit `--allow-insecure-http` flag and remains unsuitable for production.

## Shared-file mode

Shared-file mode remains the default:

```powershell
$env:VECTOR_HTTP_WORKER_OBJECT_STORE_MODE = "file"
$env:VECTOR_OBJECT_STORE_PATH = "C:\EVAVO\VectorWorker\objects"
pnpm http-worker:run
```

The process opens one canonical `FileVectorObjectStore`. Sources and outputs remain on that trusted volume. Generated objects use atomic no-overwrite transactions.

## Worker-API object mode

```powershell
$env:VECTOR_HTTP_WORKER_OBJECT_STORE_MODE = "http"
pnpm http-worker:run
```

Equivalent CLI selection:

```powershell
pnpm http-worker:run -- --object-store-mode http
```

Before acquiring a lease, HTTP mode calls `GET /api/v1/worker` and requires:

```text
objectTransferAvailable: true
```

When unavailable, startup fails before lease acquisition with:

```text
HTTP_WORKER_OBJECT_TRANSFER_UNAVAILABLE
exit code 75
```

The HTTP object adapter:

- downloads raw objects only after object-key, byte-count and SHA-256 verification;
- creates deterministic `EVAVOOB1` upload transactions;
- defensively copies output bytes before the first upload attempt;
- retries only safe download uncertainty or the exact deterministic upload body;
- accepts an exact server replay;
- never retries cancellation, validation failure or immutable-content conflict;
- maps stable HTTP object failures into governed worker errors;
- never exposes the worker token, raw lease token or generated bodies in process output.

The generic object client makes one request only. Bounded replay policy belongs to `HttpVectorObjectStore`, where exact transaction identity is known.

## Optional controls

```text
--lease-ms                    5000 to 900000, default 60000
--heartbeat-ms                at least 1000 and below half the lease, default 15000
--poll-ms                     100 to 60000, default 1000
--control-timeout-ms          1000 to 300000, CLI default 10000
--maximum-response-bytes      1024 to 4194304, default 524288
--completion-attempts         1 to 10, default 3
--completion-retry-ms         100 to 30000, default 500
--operations                  comma-separated governed operation names
--max-jobs                    positive safe integer
--idle-exit-ms                non-negative safe integer
--object-store-mode           file or http, default file
--object-store                shared-file object-store root
--object-timeout-ms           HTTP object request timeout, default 60000
--object-maximum-json-bytes   upload receipt JSON bound, default 524288
--object-download-attempts    1 to 10, default 3
--object-upload-attempts      1 to 10, default 3
--object-retry-ms             100 to 30000, default 500
--worker-id                   explicit portable worker identity
```

## Execution sequence

For each job the worker:

1. verifies object-transfer service discovery when HTTP mode is selected;
2. requests one compatible lease;
3. starts the exact leased record;
4. reconstructs an internal execution record with the opaque lease token;
5. heartbeats while the governed engine runs;
6. aborts before output commit when cancellation is observed early enough;
7. reads source bytes through the selected verified object store;
8. commits generated bodies atomically through the selected immutable store;
9. reports only output receipts and compact evidence;
10. replays completion only for network, timeout or malformed-response uncertainty;
11. records success, retryable requeue, terminal failure, cancellation or control uncertainty.

The executor supports:

```text
trace-raster
optimise-svg
animate-svg
export-lottie
package-dotlottie
```

`run-batch` remains outside this worker protocol. Batch manifests use the durable batch CLI or MCP tools.

## Object-transfer retry boundary

Safe object retries are intentionally narrow.

Download retries are allowed after:

```text
VECTOR_WORKER_CLIENT_TIMEOUT
VECTOR_WORKER_CLIENT_NETWORK_FAILED
VECTOR_WORKER_CLIENT_RESPONSE_INVALID
retryable HTTP failure
```

Upload retries use the same categories but always resend the exact defensively copied deterministic transaction. Server-side idempotent content replay prevents an uncertain successful commit from turning into an overwrite.

These are never retried:

```text
VECTOR_WORKER_CLIENT_ABORTED
VECTOR_WORKER_OBJECT_TRANSACTION_CONFLICT
VECTOR_WORKER_OBJECT_HASH_MISMATCH
object too large
invalid object key
non-retryable HTTP rejection
```

## Receipt-backed completion reconciliation

Output objects commit before the terminal HTTP transition. A network failure can therefore occur after objects exist but before the worker receives the completion response.

The hosted controller accepts an exact replay of a previously retained completion without changing the terminal record. A replay with different receipts or evidence fails as:

```text
HOSTED_JOB_COMPLETION_CONFLICT
```

The HTTP worker performs a small explicit replay budget only for transport uncertainty:

```text
VECTOR_WORKER_CLIENT_TIMEOUT
VECTOR_WORKER_CLIENT_NETWORK_FAILED
VECTOR_WORKER_CLIENT_RESPONSE_INVALID
```

It does not automatically replay ordinary rejected control mutations.

When all completion attempts remain uncertain, the worker returns:

```text
outcome: control-uncertain
error: HTTP_WORKER_COMPLETION_UNCERTAIN
exit code: 75
```

It does not report the job as failed because immutable outputs may already exist and the server may already have retained success.

## Cancellation

Heartbeat responses include `cancellationRequested`.

Before output commit, the worker aborts execution and acknowledges cancellation. Object downloads, uploads, retry delays and engine work all receive the same cancellation signal.

When cancellation races after immutable output commit, receipt-backed completion wins and retains:

```text
cancellationRaceResolution: committed-success-retained
```

This avoids orphaning immutable generated objects.

## Process output

`run-once` returns JSON. `run` emits NDJSON records:

```text
http-worker-started
http-worker-result
http-worker-summary
```

Process output never includes:

- the worker API token;
- raw lease tokens;
- source bodies;
- generated SVG or PNG bodies;
- generated Lottie JSON;
- dotLottie archive bytes.

Capabilities identify the active transport:

```text
objectTransport: shared-file | worker-api
sharedImmutableObjectStoreRequired: true | false
objectTransferAvailable: false | true
```

## Remaining deployment work

A managed remote release still needs:

- provider-backed cloud object storage or a hardened persistent transfer service;
- database-backed job and event records;
- queue visibility and delivery guarantees;
- distributed lease semantics;
- worker identity rotation and revocation;
- network policy and TLS termination evidence;
- autoscaling and health supervision;
- metrics, tracing and incident diagnostics;
- workspace-scoped authorization;
- signed EVAVO hub launch;
- deployment and native-runtime smoke evidence.

Current non-claims remain:

```text
queueDeliveryAvailable: false
managedRemoteExecutionAvailable: false
```
