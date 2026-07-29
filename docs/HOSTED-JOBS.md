# EVAVO Vector Studio Hosted Job Control Plane

Hosted job control contract `1.0` records production intent, idempotency, status, leases, cancellation, attempts, output receipts and terminal evidence without claiming distributed remote execution exists.

The control plane and execution plane are separate. This is not a hosted background queue.

```text
Control plane available
  idempotent record creation
  record inspection
  cancellation requests
  optimistic state transitions
  worker leases and heartbeats
  retry and expired-lease recovery
  output receipts and terminal evidence

Local execution bridge available
  immutable source object import
  one-shot and polling worker process
  governed raster, SVG, Lottie and archive execution
  receipt-only completion records

Worker control API available when configured
  separately authenticated lease acquisition
  start and heartbeat transitions
  receipt-backed completion and failure reporting
  cancellation acknowledgement

Distributed execution not deployed
  hosted queue dispatch
  shared remote object storage
  distributed leases
  worker autoscaling
  signed workspace launch
```

Creating a hosted job record does not automatically schedule execution. API responses explicitly retain:

```text
executionScheduled: false
remoteExecutionAvailable: false
```

A separately started local worker can lease and execute a record from the same persistent job store. A trusted worker can also coordinate state through the worker control API when it already has separate access to the immutable object store.

## Package

The provider-neutral control-plane implementation is:

```text
packages/job-control
@evavo/job-control
```

It includes:

- `HostedJobController`;
- `MemoryHostedJobStore` for tests and embedded development;
- `FileHostedJobStore` for durable local or mounted-volume records;
- canonical request hashing;
- workspace-scoped idempotency;
- optimistic compare-and-swap versions;
- worker lease, start, heartbeat, completion and failure transitions;
- cancellation request and acknowledgement;
- retry exhaustion and expired-lease recovery;
- validated output receipts.

## Supported operations

```text
trace-raster
optimise-svg
animate-svg
export-lottie
package-dotlottie
run-batch
```

The hosted record contract can describe all six operations. The local worker and worker control API execute or coordinate the first five. `run-batch` remains available through the durable batch CLI and MCP batch tools rather than the hosted worker engine.

The payload is a bounded JSON object describing references and options. It is not a transport for raw raster, SVG, Lottie or archive bodies.

Limits:

```text
Canonical payload JSON  256 KiB
Priority                0 to 9
Maximum attempts        1 to 10
Worker lease            5 seconds to 15 minutes
Output receipts         32 maximum
```

## Create a record

```http
POST /api/v1/jobs
Authorization: Bearer <VECTOR_API_TOKEN>
Content-Type: application/json
```

```json
{
  "workspaceId": "evavo-studio",
  "idempotencyKey": "primary-mark:trace:revision-01",
  "operation": "trace-raster",
  "priority": 7,
  "maxAttempts": 3,
  "payload": {
    "source": {
      "objectKey": "workspace/primary-mark/source.png",
      "sha256": "replace-with-source-sha256"
    },
    "outputs": {
      "svgObjectKey": "workspace/primary-mark/revision-01.svg",
      "evidenceObjectKey": "workspace/primary-mark/revision-01.evidence.json"
    },
    "options": {
      "profile": "logo",
      "candidateMode": "adaptive",
      "maxColours": 8
    }
  }
}
```

A new record returns `201`. Reusing the same workspace and idempotency key with the same canonical request returns `200` and the existing job. Reusing the key with different intent fails with:

```text
HOSTED_JOB_IDEMPOTENCY_CONFLICT
```

The API does not accept raw source files here. A source object is imported separately and the payload pins its exact SHA-256 revision.

## Inspect and cancel

```http
GET /api/v1/jobs/{jobId}
DELETE /api/v1/jobs/{jobId}
```

Optional cancellation body:

```json
{
  "requestedBy": "greg",
  "reason": "Superseded by revision 02"
}
```

Queued work is cancelled immediately. Leased or running work becomes `cancel-requested`; a cooperative worker must observe and acknowledge cancellation.

Terminal jobs are not rewritten by a later cancellation request.

## State machine

```text
queued
  -> leased
  -> cancelled

leased
  -> running
  -> queued       retryable failure or expired lease
  -> failed       terminal failure or exhausted attempts
  -> cancel-requested

running
  -> succeeded
  -> queued       retryable failure
  -> failed
  -> cancel-requested

cancel-requested
  -> cancelled
  -> succeeded    only when immutable outputs already committed
```

Every mutation increments an optimistic integer version. Concurrent writers use compare-and-swap; a stale writer cannot silently replace a newer state.

A cancellation that arrives after immutable outputs commit is resolved as receipt-backed success with cancellation metadata retained and:

```text
cancellationRaceResolution: committed-success-retained
```

This prevents committed output objects from becoming orphaned.

## Local worker execution

The local worker is available through:

```text
workers/local-worker
@evavo/local-worker
evavo-vector-worker
```

It combines:

- `FileHostedJobStore`;
- `HostedJobController`;
- immutable `FileVectorObjectStore` storage;
- `@evavo/worker-engine`;
- lease-aware heartbeat and polling logic.

It supports immutable import, idempotent submit, inspect, list, cancel, expired-lease reclaim, one-shot execution and polling execution. Commands return JSON; polling mode returns NDJSON.

```powershell
$env:VECTOR_JOB_STORE_PATH = "C:\EVAVO\VectorWorker\jobs"
$env:VECTOR_OBJECT_STORE_PATH = "C:\EVAVO\VectorWorker\objects"
$env:VECTOR_WORKER_ID = "greg-workstation-01"

pnpm worker:capabilities
pnpm worker:run-once
pnpm worker:run -- --idle-exit-ms 30000
```

Generated bodies are stored as immutable objects. Job records and process output retain receipts and compact evidence only.

See [`LOCAL-WORKER.md`](LOCAL-WORKER.md).

## Worker control API

Worker control protocol `1.0` exposes authenticated lease transitions over HTTP when a safe job store is configured.

```text
GET  /api/v1/worker
POST /api/v1/worker/lease
POST /api/v1/worker/jobs/{jobId}/start
POST /api/v1/worker/jobs/{jobId}/heartbeat
POST /api/v1/worker/jobs/{jobId}/complete
POST /api/v1/worker/jobs/{jobId}/fail
POST /api/v1/worker/jobs/{jobId}/acknowledge-cancellation
```

Every request requires the separate server-only `VECTOR_WORKER_API_TOKEN`. This token is not interchangeable with the normal API token and worker routes never fall open in development.

Lease acquisition is the only response that returns the opaque lease token. Later records expose timing and worker identity with `tokenPresent: true` instead.

The worker control API accepts bounded JSON state transitions and receipt-backed completion only. It does not accept or return generated object bodies.

```text
objectTransferAvailable: false
queueDeliveryAvailable: false
remoteExecutionAvailable: false
```

A worker using this API must already have trusted access to the immutable object store through a separate shared-volume or future provider adapter. The API validates receipt structure but cannot independently prove that a remote object exists.

See [`WORKER-API.md`](WORKER-API.md).

## Worker boundary

Local execution authenticates through operating-system and filesystem access. HTTP worker coordination authenticates with `VECTOR_WORKER_API_TOKEN`.

Any distributed worker integration must:

1. authenticate independently from browser/API clients;
2. acquire only supported operation kinds;
3. start with the exact lease token;
4. heartbeat before lease expiry;
5. stop promptly on `cancel-requested`;
6. write generated bodies to object storage, not the job record;
7. finish with path/object-key, MIME type, byte count and SHA-256 receipts;
8. retain human-review-required output policy.

The current file adapters are suitable for local development, self-hosted processes and explicitly persistent mounted volumes. They are not suitable for an ephemeral serverless filesystem.

## Configuration

API record-store default:

```text
VECTOR_JOB_STORE_MODE=disabled
```

Local or mounted-volume records:

```text
VECTOR_JOB_STORE_MODE=file
VECTOR_JOB_STORE_PATH=/persistent/vector-job-records
```

Local worker object storage:

```text
VECTOR_OBJECT_STORE_PATH=/persistent/vector-objects
VECTOR_WORKER_ID=worker-01
```

Worker control authentication:

```text
VECTOR_WORKER_API_TOKEN=replace-with-a-long-random-secret
```

Production API file mode additionally requires:

```text
VECTOR_JOB_FILE_STORE_PERSISTENT=true
```

This flag is an operator acknowledgement, not automatic proof. Do not set it on an ephemeral Vercel or function filesystem.

When the store is absent or unsafe, API creation and inspection fail closed with:

```text
HOSTED_JOB_STORE_NOT_CONFIGURED
HTTP 503
```

Worker control routes also fail closed when the dedicated worker token or job store is unavailable.

## File-store safety

The job adapter uses:

- a canonical root created and resolved through `realpath`;
- one JSON record per job;
- a hashed workspace/idempotency index;
- atomic staged writes and rename;
- exclusive lock files;
- stale-lock recovery;
- rollback when idempotency-index creation fails;
- strict record parsing;
- optimistic compare-and-swap versions.

The object adapter uses:

- portable slash-separated object keys;
- canonical root and symlink checks;
- immutable no-overwrite writes;
- atomic multi-object commit and rollback;
- exact source and output SHA-256 receipts.

These are ordinary-process durability boundaries, not protection against a hostile operating-system account continuously replacing directories or files.

## Deployment phase still required

A real distributed hosted worker release still needs:

- database-backed job and event records;
- shared object storage with immutable source revisions;
- queue visibility and delivery guarantees;
- distributed worker leases and heartbeats;
- remote cancellation;
- bounded retries and dead-letter handling;
- workspace-scoped authorization;
- signed EVAVO hub launch;
- deployment, cold-start and native-binary smoke evidence;
- operational metrics and incident diagnostics.

The local worker and authenticated control API are available, but neither claims distributed remote execution. Until the distributed controls exist, Vector Studio remains a local/self-hosted execution system and a signed federated candidate rather than a released EVAVO hub worker service.
