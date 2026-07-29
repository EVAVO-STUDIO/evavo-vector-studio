# EVAVO Vector Studio Local Worker

The local worker contract `1.0` turns hosted job records and immutable object revisions into a real single-process execution service.

It is designed for local Windows development, self-hosted machines and explicitly persistent mounted volumes. It is not a managed cloud queue, distributed worker pool or proof of remote deployment.

## Components

```text
workers/local-worker
@evavo/local-worker
evavo-vector-worker
```

The process combines:

- `FileHostedJobStore` for persistent job records;
- `HostedJobController` for leases, heartbeats, retries and cancellation;
- `FileVectorObjectStore` for immutable source and generated objects;
- `@evavo/worker-engine` for governed raster, SVG, motion, Lottie and dotLottie execution;
- `LocalVectorWorker` for one-shot or polling execution.

## Supported operations

```text
trace-raster
optimise-svg
animate-svg
export-lottie
package-dotlottie
```

`run-batch` remains intentionally unsupported by the hosted worker engine. Use the durable batch CLI or MCP batch tools for manifest execution.

## Quick start

```powershell
Set-Location C:\GitRepos\evavo-vector-studio
git pull origin main
corepack enable
pnpm install

$env:VECTOR_JOB_STORE_PATH = "C:\EVAVO\VectorWorker\jobs"
$env:VECTOR_OBJECT_STORE_PATH = "C:\EVAVO\VectorWorker\objects"
$env:VECTOR_WORKER_ID = "greg-workstation-01"

pnpm worker:capabilities
```

The default paths, when environment variables and flags are absent, are:

```text
.evavo-vector-hosted-jobs
.evavo-vector-objects
```

Use explicit absolute paths for long-lived production work.

## Commands

### Import an immutable source object

```powershell
pnpm worker:import -- `
  .\fixtures\motion\gentle-entrance.source.svg `
  --key source/gentle-entrance/revision-01.svg `
  --mime image/svg+xml
```

Import is new-object-only. Existing object keys are rejected instead of overwritten. The result includes object key, local path, MIME type, byte count and SHA-256.

### Submit an idempotent job record

```powershell
pnpm worker:submit -- .\fixtures\hosted-jobs\optimise-svg.request.json
```

The request uses hosted job contract `1.0`. Record creation does not execute work. Reusing the same workspace and idempotency key with identical intent returns the retained record; changed intent is rejected.

### Inspect, list and cancel

```powershell
pnpm worker:inspect -- vjob_...
pnpm worker:list -- --status queued --limit 100
pnpm worker:cancel -- vjob_... `
  --requested-by Greg `
  --reason "Superseded by revision 02"
pnpm worker:reclaim
```

Lease tokens are never printed. Inspection reports only worker identity, timing and `tokenPresent: true` for an active lease.

### Execute one available job

```powershell
pnpm worker:run-once -- `
  --worker-id greg-workstation-01 `
  --lease-ms 60000 `
  --heartbeat-ms 15000
```

The command returns one JSON document. Possible outcomes are:

```text
idle
succeeded
queued
failed
cancelled
```

A retryable execution failure returns the record to `queued` while attempts remain.

### Run a polling process

```powershell
pnpm worker:run -- `
  --worker-id greg-workstation-01 `
  --poll-ms 1000 `
  --lease-ms 60000 `
  --heartbeat-ms 15000 `
  --operations trace-raster,optimise-svg,animate-svg,export-lottie,package-dotlottie
```

Optional bounded execution:

```powershell
pnpm worker:run -- `
  --max-jobs 20 `
  --idle-exit-ms 30000
```

Polling mode writes newline-delimited JSON:

```text
worker-started
worker-result
worker-summary
```

SIGINT and SIGTERM are forwarded as cancellation signals. The process stops safely and leaves retained job state available for later inspection or recovery.

## Lease lifecycle

For each job the worker:

1. reclaims expired leases;
2. acquires one compatible queued job;
3. starts it with the exact lease token;
4. renews the heartbeat before half the lease duration;
5. observes `cancel-requested` state;
6. executes against immutable source hashes;
7. commits all declared outputs in one new-object-only transaction;
8. records only output receipts and compact evidence in the job record;
9. succeeds, requeues, fails or acknowledges cancellation.

The worker advertises only operations implemented by `@evavo/worker-engine`.

## Cancellation and committed outputs

Cancellation is cooperative before output commit. The heartbeat monitor aborts execution after observing `cancel-requested`.

A narrow race remains possible between the final cancellation check and an atomic immutable-object commit. When outputs have already committed and valid receipts exist, `succeedCommitted` records the job as `succeeded` while retaining the cancellation metadata. This prevents generated immutable objects from becoming orphaned and unreferenced.

The retained evidence reports:

```text
cancellationRaceResolution: committed-success-retained
```

A cancellation observed before object commit is acknowledged normally and produces no output transaction.

## Storage and integrity

The job store provides:

- atomic JSON replacement;
- workspace-scoped idempotency indexes;
- optimistic compare-and-swap versions;
- exclusive locks and stale-lock recovery.

The object store provides:

- portable slash-separated object keys;
- canonical root checks;
- source and output symlink-escape rejection;
- source byte limits;
- source SHA-256 verification;
- atomic multi-object output commit;
- rollback when any output cannot commit;
- immutable no-overwrite semantics.

Generated SVG, PNG, Lottie JSON and archive bodies are never written to command output or job records. Job results retain receipts only.

## Output and approval boundary

Normal commands return JSON. Polling mode returns NDJSON. Errors use stable code, message, retryability and details, with retryable process errors using exit code `75`.

Successful execution proves that:

- a valid lease was held;
- exact source revisions were read;
- the governed engine completed;
- declared outputs committed atomically;
- byte and SHA-256 receipts were retained.

It does not grant artistic, brand, accessibility, topology, motion or player-equivalence approval. Every generated asset remains `human-review-required`.

## Deployment boundary

The local worker process is available. Remote execution is not.

A managed hosted release still needs:

- database-backed job and event records;
- shared object storage;
- durable queue delivery and visibility timeouts;
- distributed leases and worker identity;
- autoscaling and worker health monitoring;
- secrets and workspace-scoped authorisation;
- signed EVAVO hub launch;
- deployment, cold-start and native-runtime smoke evidence.

The process reports:

```text
hostedBackgroundQueue: false
remoteExecutionAvailable: false
```
