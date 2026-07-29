# EVAVO Vector Studio Hosted Job Control Plane

Hosted job control contract `1.0` records production intent, idempotency, status, leases, cancellation, attempts, output receipts and terminal evidence without claiming that a remote worker exists.

The control plane and execution plane are separate. This is not a hosted background queue.

```text
Control plane now available
  idempotent record creation
  record inspection
  cancellation requests
  optimistic state transitions
  worker leases and heartbeats in the core package
  retry and expired-lease recovery
  output receipts and terminal evidence

Execution plane not yet deployed
  hosted queue dispatch
  remote worker processes
  object storage transfer
  distributed leases
  worker autoscaling
  signed workspace launch
```

Creating a hosted job record does not schedule execution. API responses explicitly retain:

```text
executionScheduled: false
remoteExecutionAvailable: false
```

## Package

The provider-neutral implementation is:

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

The API does not accept raw source files here. Source and output object references become meaningful only after object storage and a worker adapter are deployed.

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

Queued work is cancelled immediately. Leased or running work becomes `cancel-requested`; a cooperative worker must acknowledge cancellation before the record becomes `cancelled`.

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
```

Every mutation increments an optimistic integer version. Concurrent writers use compare-and-swap; a stale writer cannot silently replace a newer state.

## Worker boundary

The package exposes lease operations, but no public worker HTTP endpoint is released yet.

A future worker integration must:

1. authenticate independently from browser/API clients;
2. acquire only supported operation kinds;
3. start with the exact lease token;
4. heartbeat before lease expiry;
5. stop promptly on `cancel-requested`;
6. write generated bodies to object storage, not the job record;
7. finish with path/object-key, MIME type, byte count and SHA-256 receipts;
8. retain human-review-required output policy.

The current file adapter is suitable for local development, self-hosted processes and explicitly persistent mounted volumes. It is not suitable for an ephemeral serverless filesystem.

## Configuration

Default:

```text
VECTOR_JOB_STORE_MODE=disabled
```

Local or mounted-volume records:

```text
VECTOR_JOB_STORE_MODE=file
VECTOR_JOB_STORE_PATH=/persistent/vector-job-records
```

Production file mode additionally requires:

```text
VECTOR_JOB_FILE_STORE_PERSISTENT=true
```

This flag is an operator acknowledgement, not automatic proof. Do not set it on an ephemeral Vercel or function filesystem.

When the store is absent or unsafe, API creation and inspection fail closed with:

```text
HOSTED_JOB_STORE_NOT_CONFIGURED
HTTP 503
```

## File-store safety

The file adapter uses:

- a canonical root created and resolved through `realpath`;
- one JSON record per job;
- a hashed workspace/idempotency index;
- atomic staged writes and rename;
- exclusive lock files;
- stale-lock recovery;
- rollback when idempotency-index creation fails;
- strict record parsing;
- optimistic compare-and-swap versions.

This is an ordinary-process durability boundary, not protection against a hostile operating-system account continuously replacing directories or files.

## Deployment phase still required

A real hosted worker release still needs:

- database-backed job and event records;
- object storage with immutable source revisions;
- queue visibility and delivery guarantees;
- distributed worker leases and heartbeats;
- remote cancellation;
- bounded retries and dead-letter handling;
- workspace-scoped authorization;
- signed EVAVO hub launch;
- deployment, cold-start and native-binary smoke evidence;
- operational metrics and incident diagnostics.

Until those exist, Vector Studio can create durable job records only when a deliberately configured record store is available. It does not claim hosted execution.
