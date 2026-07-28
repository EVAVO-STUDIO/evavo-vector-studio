# EVAVO Vector Studio Durable Batch Contract

Vector Studio batch v1 runs a fixed manifest of governed production operations with persistent state, append-only events, exclusive locking, input revisions and output receipts.

The objective is reliable local and agent-driven production. A terminal can stop, a machine can restart, or one item can fail without losing the retained state of unrelated completed work.

This is a crash-resumable local runner. It is not yet a hosted background queue, multi-node scheduler or remote job service.

## Current operations

The `evavo-vector-batch` CLI exposes:

- `trace-raster`;
- `optimise-svg`;
- `animate-svg`;
- `export-lottie`;
- `package-dotlottie`.

Every operation uses the same governed engine as the existing CLI, API, browser and MCP surfaces. Every operation requires an explicit evidence JSON output.

## Commands

```powershell
pnpm vector:batch:capabilities

pnpm vector:batch:run -- `
  .\batches\brand-assets.batch.json `
  --root C:\EVAVO\VectorAssets

pnpm vector:batch:inspect -- `
  .\batches\brand-assets.batch.json `
  --root C:\EVAVO\VectorAssets `
  --event-limit 50
```

The installed binary is:

```text
evavo-vector-batch
```

Commands:

```text
evavo-vector-batch run <manifest.json>
evavo-vector-batch inspect <manifest.json>
evavo-vector-batch capabilities
```

`run` and `resume` are aliases. `inspect` and `status` are aliases.

## Manifest schema

The machine-readable schema is:

```text
schemas/batch-v1.schema.json
```

Example:

```json
{
  "$schema": "https://evavo.com.au/schemas/vector-studio/batch-v1.schema.json",
  "version": "1.0",
  "id": "brand-assets-2026-07",
  "name": "Brand asset production",
  "failureMode": "continue",
  "items": [
    {
      "id": "primary-mark",
      "operation": "trace-raster",
      "spec": {
        "inputPath": "source/primary-mark.png",
        "outputSvgPath": "output/primary-mark.vector.svg",
        "differenceOutputPath": "output/primary-mark.difference.png",
        "evidenceOutputPath": "output/primary-mark.trace.evidence.json",
        "profile": "logo",
        "candidateMode": "adaptive",
        "maxColours": 8,
        "preservePalette": true,
        "optimise": true,
        "differenceMaxDimension": 512,
        "title": "Primary brand mark"
      }
    },
    {
      "id": "primary-mark-motion",
      "operation": "animate-svg",
      "spec": {
        "inputPath": "output/primary-mark.vector.svg",
        "motionPath": "plans/primary-mark.motion.json",
        "outputPath": "output/primary-mark.animated.svg",
        "evidenceOutputPath": "output/primary-mark.motion.evidence.json"
      }
    },
    {
      "id": "primary-mark-lottie",
      "operation": "export-lottie",
      "spec": {
        "inputPath": "output/primary-mark.vector.svg",
        "motionPath": "plans/primary-mark.motion.json",
        "outputPath": "output/primary-mark.lottie.json",
        "evidenceOutputPath": "output/primary-mark.lottie.evidence.json",
        "frameRate": 60,
        "precision": 4,
        "name": "Primary mark entrance"
      }
    },
    {
      "id": "primary-mark-archive",
      "operation": "package-dotlottie",
      "spec": {
        "inputPath": "output/primary-mark.lottie.json",
        "outputPath": "output/primary-mark.lottie",
        "evidenceOutputPath": "output/primary-mark.dotlottie.evidence.json",
        "animationId": "primary-mark"
      }
    }
  ]
}
```

Manifest root and item fields are strict. Item IDs must be unique. A manifest supports 1 to 1,000 items.

A job ID permanently binds to the canonical manifest SHA-256 once state exists. Changing item order, operation, spec, name or failure mode under the same job ID is rejected as `BATCH_MANIFEST_CHANGED`. Create a new revisioned job ID for a changed manifest.

## Operation specs

### `trace-raster`

Required:

- `inputPath`;
- `outputSvgPath`;
- `evidenceOutputPath`.

Optional:

- `differenceOutputPath`;
- `profile`: `auto`, `logo`, `icon`, `line-art`, `illustration` or `photo`;
- `candidateMode`: `adaptive` or `single`;
- `maxColours`: 1 to 256;
- `preservePalette`;
- `optimise`;
- `title`;
- `differenceMaxDimension`: 32 to 1024 when a difference output is requested.

### `optimise-svg`

Required:

- `inputPath`;
- `outputPath`;
- `evidenceOutputPath`.

### `animate-svg`

Required:

- `inputPath`;
- `motionPath`;
- `outputPath`;
- `evidenceOutputPath`.

### `export-lottie`

Required:

- `inputPath`;
- `motionPath`;
- `outputPath`;
- `evidenceOutputPath`.

Optional:

- `frameRate`: 1 to 120;
- `precision`: 0 to 6;
- `name`: 1 to 120 characters.

### `package-dotlottie`

Required:

- `inputPath`;
- `outputPath`;
- `evidenceOutputPath`.

Optional:

- `animationId`: portable 1 to 64 character ID.

All manifest paths resolve beneath `--root`. Attempts to escape that root are rejected. Inputs and outputs must be distinct.

## Durable state layout

By default, state is retained beneath the execution root:

```text
.evavo-vector-jobs/<job-id>/
  state.json
  events.ndjson
  runner.lock
```

A separate state root can be selected with `--state-root`.

`state.json` is replaced atomically through a staged file and rename. `events.ndjson` is append-only. `runner.lock` is created with exclusive new-file semantics.

## Revision and reuse policy

Before executing an item, its handler computes a lowercase SHA-256 revision from:

- operation name;
- canonical operation spec;
- relative input paths;
- exact input bytes.

A completed item is reused only when:

1. its current revision matches the retained revision;
2. every output path still exists as a regular file;
3. every output byte count matches;
4. every output SHA-256 matches.

If the source changes, reuse fails with `BATCH_ITEM_REVISION_MISMATCH`. If an output is missing or modified, reuse fails with `BATCH_COMPLETED_OUTPUT_INVALID`.

The runner never silently regenerates a completed revision over existing output files.

## Interrupted execution

An item retained as `running` means the previous process stopped before a terminal state was committed. On the next run it is reset to `pending`, an interruption event is recorded, and its next execution increments the attempt number.

Operation outputs use the existing atomic new-file transaction. A handler either commits its declared output set or reports failure. Existing outputs are never overwritten.

## Failure modes

`continue`:

- retain the failed item;
- continue with later independent items;
- finish the job as `failed` when any item failed.

`fail-fast`:

- retain the failed item;
- stop before later pending items;
- leave those items pending for inspection or a future corrected job revision.

Failures are represented with stable codes, messages and optional details.

## Lock and recovery policy

Only one runner may own a job at once. A second runner receives `BATCH_JOB_LOCKED` with `retryable: true`.

The default stale-lock threshold is six hours. A stale lock is renamed aside before a new lock is created. The lock token is checked before release so one process cannot remove another process's active lock.

This protects ordinary local workflows. It is not a distributed lease or hostile-filesystem sandbox.

## Evidence and approval

Each completed item retains receipts containing:

```text
path
mimeType
bytes
sha256
```

Full engine evidence is written to the explicit evidence JSON output. Durable state keeps compact operation evidence so a large batch does not duplicate every generated body.

Successful batch completion proves that requested handlers executed, revisions matched and output receipts verified. It does not grant artistic, brand, accessibility, geometry, motion or player-equivalence approval.

Every production output remains `human-review-required` or `review-required` according to its underlying engine contract.

## Deployment boundary

The current runner resumes when invoked again. It does not continue executing after its process or machine is stopped.

A hosted worker phase still needs:

- persistent database-backed job records;
- object storage;
- queue visibility and leases;
- worker heartbeats;
- remote cancellation;
- bounded retries and backoff;
- workspace-scoped authorisation;
- signed EVAVO hub launch;
- deployment and native-runtime smoke evidence.
