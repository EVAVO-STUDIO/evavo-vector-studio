# EVAVO Vector Studio HTTP-Coordinated Worker

HTTP worker contract `1.0` executes governed vector jobs against a trusted immutable object store while coordinating leases and terminal state through the authenticated Worker Control API.

This is a practical self-hosted execution bridge. It is not a managed queue, an object-transfer service or an autoscaled distributed worker platform.

## Boundary

```text
HTTP lease coordination             available
Shared immutable object execution   available
Lease heartbeats                    available
Cancellation observation            available
Receipt-backed completion replay    available
Generated bodies in HTTP control     false
Object upload/download API          unavailable
Queue delivery                       unavailable
Managed remote execution             unavailable
```

The control API transports bounded JSON records, lease tokens, receipts and compact evidence. Raster, SVG, Lottie JSON and dotLottie archive bodies remain in the trusted object store selected by `VECTOR_OBJECT_STORE_PATH`.

The API and worker must therefore see the same immutable object namespace through a trusted shared volume or another deployment-specific adapter. The current implementation does not copy source or output bodies over HTTP.

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
$env:VECTOR_OBJECT_STORE_PATH = "C:\EVAVO\VectorWorker\objects"
$env:VECTOR_WORKER_ID = "greg-workstation-01"
```

`VECTOR_WORKER_API_TOKEN` is never accepted as a CLI flag. Keeping it out of arguments reduces accidental exposure through shell history and process listings.

Non-local control URLs require HTTPS. Local `http://localhost`, `127.0.0.1` and `::1` URLs are accepted for development. Any other plain-HTTP target requires the explicit `--allow-insecure-http` flag and remains unsuitable for production.

Optional controls:

```text
--lease-ms                 5000 to 900000, default 60000
--heartbeat-ms             at least 1000 and below half the lease, default 15000
--poll-ms                  100 to 60000, default 1000
--control-timeout-ms       1000 to 300000, CLI default 10000
--maximum-response-bytes   1024 to 4194304, default 524288
--completion-attempts      1 to 10, default 3
--completion-retry-ms      100 to 30000, default 500
--operations               comma-separated governed operation names
--max-jobs                 positive safe integer
--idle-exit-ms             non-negative safe integer
--object-store             explicit immutable object-store root
--worker-id                explicit portable worker identity
```

## Execution sequence

For each job the worker:

1. requests one compatible lease;
2. starts the exact leased record;
3. reconstructs an internal execution record with the opaque lease token;
4. heartbeats while the governed engine runs;
5. aborts before output commit when cancellation is observed early enough;
6. commits generated bodies atomically to immutable object storage;
7. reports only output receipts and compact evidence;
8. replays completion only for network, timeout or malformed-response uncertainty;
9. records success, retryable requeue, terminal failure, cancellation or control uncertainty.

The executor supports:

```text
trace-raster
optimise-svg
animate-svg
export-lottie
package-dotlottie
```

`run-batch` remains outside this worker protocol. Batch manifests use the durable batch CLI or MCP tools.

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

It does not automatically replay ordinary rejected mutations.

When all completion attempts remain uncertain, the worker returns:

```text
outcome: control-uncertain
error: HTTP_WORKER_COMPLETION_UNCERTAIN
exit code: 75
```

It does not report the job as failed because immutable outputs may already exist and the server may already have retained success.

## Cancellation

Heartbeat responses include `cancellationRequested`.

Before output commit, the worker aborts execution and acknowledges cancellation. When cancellation races after immutable output commit, receipt-backed completion wins and retains:

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

## Remaining deployment work

A managed remote release still needs:

- provider-backed immutable object transfer;
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

Until those controls are deployed and verified, the HTTP worker truthfully reports:

```text
objectTransferAvailable: false
queueDeliveryAvailable: false
managedRemoteExecutionAvailable: false
```
