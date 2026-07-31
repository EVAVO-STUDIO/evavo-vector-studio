# EVAVO Vector Studio Durable Batch Contract

Vector Studio batch v1 runs a fixed manifest of governed production operations with persistent state, append-only events, exclusive locking, canonical paths, input revisions and output receipts.

The objective is reliable local and agent-driven production. A terminal can stop, a machine can restart, or one item can fail without losing the retained state of unrelated completed work.

This is a crash-resumable local runner. It is not yet a hosted background queue, multi-node scheduler or remote job service.

## Current operations

The same operation registry is used by the local batch CLI and MCP:

- `trace-raster`;
- `optimise-svg`;
- `animate-svg`;
- `export-lottie`;
- `package-dotlottie`.

Every operation uses the same governed raster, SVG, motion, Lottie or dotLottie engine as the single-file surfaces. Every operation requires an explicit evidence JSON output.

Raster tracing and SVG optimisation share the governed delivery profiles documented in [`DELIVERY-PROFILES.md`](./DELIVERY-PROFILES.md):

- `editable` for an editable master with deterministic stable path IDs;
- `web` for compact responsive SVG packaging;
- `motion` for stable animation-target IDs and responsive packaging;
- `print` for conservative packaging with explicit root dimensions preserved.

## Local CLI

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

The installed binary is `evavo-vector-batch`.

```text
evavo-vector-batch run <manifest.json>
evavo-vector-batch resume <manifest.json>
evavo-vector-batch inspect <manifest.json>
evavo-vector-batch status <manifest.json>
evavo-vector-batch capabilities
```

`run` and `resume` are aliases. `inspect` and `status` are aliases.

## MCP workflow

MCP contract `1.5` exposes:

- `vector_run_batch`;
- `vector_inspect_batch`.

Both tools use the same batch-v1 manifest, persistent state, canonical path policy, revision checks and output receipts as the local CLI.

MCP execution accepts at most 100 items per manifest. The local CLI accepts up to 1,000. MCP results are paginated with:

```text
itemOffset  0 to 100
itemLimit   1 to 100
eventLimit  0 to 100
```

Example:

```json
{
  "manifestPath": "C:\\EVAVO\\VectorAssets\\batches\\brand-assets.batch.json",
  "rootPath": "C:\\EVAVO\\VectorAssets",
  "itemOffset": 0,
  "itemLimit": 25,
  "eventLimit": 25
}
```

`vector_run_batch` forwards request cancellation and can resume retained state when called again. `vector_inspect_batch` reads progress without executing production work.

Neither tool places generated SVG, PNG, Lottie JSON or archive bodies in model context. This is still a local synchronous MCP surface. It is not a hosted background queue and does not continue after the MCP server process stops.

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
        "outputSvgPath": "output/primary-mark.editable.svg",
        "differenceOutputPath": "output/primary-mark.difference.png",
        "evidenceOutputPath": "output/primary-mark.trace.evidence.json",
        "profile": "logo",
        "candidateMode": "adaptive",
        "deliveryProfile": "editable",
        "stableIdPrefix": "primary-mark-shape",
        "maxColours": 8,
        "preservePalette": true,
        "optimise": true,
        "differenceMaxDimension": 512,
        "title": "Primary brand mark"
      }
    },
    {
      "id": "primary-mark-web",
      "operation": "optimise-svg",
      "spec": {
        "inputPath": "output/primary-mark.editable.svg",
        "outputPath": "output/primary-mark.web.svg",
        "evidenceOutputPath": "output/primary-mark.web.evidence.json",
        "deliveryProfile": "web"
      }
    },
    {
      "id": "primary-mark-motion-source",
      "operation": "optimise-svg",
      "spec": {
        "inputPath": "output/primary-mark.editable.svg",
        "outputPath": "output/primary-mark.motion.svg",
        "evidenceOutputPath": "output/primary-mark.motion-source.evidence.json",
        "deliveryProfile": "motion",
        "stableIdPrefix": "motion-shape"
      }
    },
    {
      "id": "primary-mark-motion",
      "operation": "animate-svg",
      "spec": {
        "inputPath": "output/primary-mark.motion.svg",
        "motionPath": "plans/primary-mark.motion.json",
        "outputPath": "output/primary-mark.animated.svg",
        "evidenceOutputPath": "output/primary-mark.motion.evidence.json"
      }
    },
    {
      "id": "primary-mark-lottie",
      "operation": "export-lottie",
      "spec": {
        "inputPath": "output/primary-mark.motion.svg",
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

Manifest root and item fields are strict. Item IDs must be unique. A manifest supports 1 to 1,000 items through the local CLI and up to 100 items through MCP.

The optional `$schema` editor annotation is accepted but excluded from the canonical production identity.

A job ID permanently binds to the canonical manifest SHA-256 once state exists. Changing item order, operation, spec, name, failure mode, delivery profile or stable ID prefix under the same job ID is rejected as `BATCH_MANIFEST_CHANGED`. Create a new revisioned job ID for a changed manifest.

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
- `deliveryProfile`: `editable`, `web`, `motion` or `print`; default `editable`;
- `stableIdPrefix`: only with `editable` or `motion`;
- `maxColours`: 1 to 256;
- `preservePalette`;
- `optimise`;
- `title`;
- `differenceMaxDimension`: 32 to 1024 when a difference output is requested.

Trace evidence records alpha-aware visible bounds, the selected candidate, delivery profile, stable path IDs, root-dimension policy, optimisation passes and render comparison.

### `optimise-svg`

Required:

- `inputPath`;
- `outputPath`;
- `evidenceOutputPath`.

Optional:

- `deliveryProfile`: `editable`, `web`, `motion` or `print`; default `editable`;
- `stableIdPrefix`: only with `editable` or `motion`.

The operation packages an existing safe SVG. It does not overwrite the source, and a profile transform rolls back when it would introduce an invalid or unresolved reference.

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

## Canonical path policy

The execution root is resolved through `realpath` before state is opened.

For every item:

- existing inputs resolve through `realpath`;
- input symlinks escaping the root are rejected;
- output parents are checked from the nearest existing canonical directory;
- output-directory symlinks escaping the root are rejected;
- an output path that is itself a symlink is rejected;
- canonical input/output and output/output collisions are rejected;
- ordinary Windows path comparisons are case-insensitive.

Existing regular output files are accepted only when verifying a retained completed item. New operations never overwrite them.

This protects ordinary local workflows. It is not a hostile-filesystem sandbox against an account replacing directories during an active call.

## Durable state layout

By default, state is retained under the execution root:

```text
.evavo-vector-jobs/<job-id>/
  state.json
  events.ndjson
  runner.lock
```

A separate state root can be selected by the local CLI.

`state.json` is replaced atomically through a staged file and rename. `events.ndjson` is append-only. `runner.lock` uses exclusive new-file creation.

## Revision and reuse policy

Before executing an item, its handler computes a lowercase SHA-256 revision from:

- operation name;
- canonical operation spec, including delivery intent;
- canonical relative input paths;
- exact input bytes.

A completed item is reused only when:

1. its current revision matches the retained revision;
2. every output still exists as a regular file;
3. every byte count matches;
4. every output SHA-256 matches.

A changed source fails with `BATCH_ITEM_REVISION_MISMATCH`. A missing or modified completed output fails with `BATCH_COMPLETED_OUTPUT_INVALID`.

The runner never silently regenerates a completed revision over existing output files.

## Interrupted execution

An item retained as `running` means the prior process stopped before a terminal state was committed. On the next run it returns to `pending`, an interruption event is recorded and the next execution increments the attempt count.

Operation outputs use atomic new-file transactions. A handler commits its complete declared output set or reports failure.

Request cancellation stops the current MCP or CLI invocation. Retained state remains available for later inspection and resume.

## Failure modes

`continue`:

- retains the failed item;
- continues later independent items;
- ends the job as failed when any item failed.

`fail-fast`:

- retains the failed item;
- stops before later pending items;
- leaves later items pending for inspection or a corrected future invocation.

Failures use stable codes, messages, retryability and optional details.

## Lock and recovery policy

Only one runner may own a job. A second runner receives `BATCH_JOB_LOCKED` with `retryable: true`.

The default stale-lock threshold is six hours. A stale lock is renamed aside before a new lock is created. The lock token is checked before release so one process cannot remove another process's active lock.

This is a single-process local lock, not a distributed lease.

## Evidence and approval

Each completed item retains receipts containing:

```text
path
mimeType
bytes
sha256
```

Full engine evidence is written to the explicit evidence JSON output. Durable state keeps compact evidence so large batches do not duplicate generated bodies.

Successful completion proves that handlers executed, revisions matched and receipts verified. It does not grant artistic, brand, accessibility, geometry, motion, print-production or player-equivalence approval.

Every production output remains `human-review-required` or `review-required` according to its underlying engine contract.

## Deployment boundary

The current runner resumes when invoked again. It does not continue after its process or machine stops.

A hosted worker phase still needs:

- database-backed job records;
- object storage;
- queue visibility and distributed leases;
- worker heartbeats;
- remote cancellation;
- bounded retries and backoff;
- workspace-scoped authorisation;
- signed EVAVO hub launch;
- deployment and native-runtime smoke evidence.
