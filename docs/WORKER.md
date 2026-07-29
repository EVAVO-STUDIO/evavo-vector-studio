# EVAVO Vector Studio Worker Execution Engine

Vector worker contract `1.0` converts a running hosted job record into governed output objects and receipts.

The execution engine is provider-neutral. It does not own queue polling, remote deployment, authentication or autoscaling. Those concerns sit above the package.

## Package

```text
packages/worker-engine
@evavo/worker-engine
```

It contains:

- strict operation-specific hosted payload validation;
- immutable source-object SHA-256 verification;
- a local filesystem object-store adapter;
- an in-memory deterministic object-store adapter for tests;
- atomic multi-object output commit;
- no-overwrite semantics;
- byte and SHA-256 receipts;
- governed trace, SVG optimisation, animated SVG, Lottie and dotLottie execution;
- cancellation checks before source reads, engine calls and object commits;
- stable retryability-aware worker errors.

## Supported execution operations

```text
trace-raster
optimise-svg
animate-svg
export-lottie
package-dotlottie
```

`run-batch` can be recorded by the hosted control plane but is not yet accepted by this worker executor. A worker advertises only the operations it can execute, so unsupported work remains queued for another future worker class.

## Object-reference payloads

Worker jobs reference immutable source objects. They do not embed raw raster, SVG, Lottie or ZIP bodies inside the job record.

Common source shape:

```json
{
  "source": {
    "objectKey": "workspace/primary-mark/source.svg",
    "sha256": "replace-with-lowercase-source-sha256"
  }
}
```

A source is read only when its exact bytes match the retained SHA-256. Mismatch fails with:

```text
VECTOR_WORKER_OBJECT_HASH_MISMATCH
```

### Optimise SVG example

```json
{
  "source": {
    "objectKey": "workspace/primary-mark/source.svg",
    "sha256": "replace-with-lowercase-source-sha256"
  },
  "outputs": {
    "svgObjectKey": "workspace/primary-mark/revision-01.optimised.svg",
    "evidenceObjectKey": "workspace/primary-mark/revision-01.optimised.evidence.json"
  }
}
```

### Animated SVG example

```json
{
  "source": {
    "objectKey": "workspace/primary-mark/source.svg",
    "sha256": "replace-with-lowercase-source-sha256"
  },
  "motion": {
    "version": "1.0",
    "name": "Gentle entrance",
    "durationMs": 800,
    "iterations": 1,
    "direction": "normal",
    "fillMode": "both",
    "reducedMotion": "last-frame",
    "tracks": [
      {
        "targetId": "mark",
        "keyframes": [
          { "offset": 0, "opacity": 0, "translateY": 8 },
          { "offset": 1, "opacity": 1, "translateY": 0 }
        ]
      }
    ]
  },
  "outputs": {
    "svgObjectKey": "workspace/primary-mark/revision-01.animated.svg",
    "evidenceObjectKey": "workspace/primary-mark/revision-01.motion.evidence.json"
  }
}
```

Trace, Lottie and dotLottie payloads use the same source-reference and explicit output-key model. Unknown fields and unsupported options are rejected.

## Limits

```text
Source object                32 MiB
Inline motion JSON           256 KiB
Single generated object      32 MiB
Objects per transaction      16
Object key length            1 to 1,024 characters
```

The underlying engines retain their smaller format-specific limits where applicable.

## Immutable object-store contract

`FileVectorObjectStore`:

- creates and resolves one canonical root;
- accepts portable relative slash-separated keys only;
- rejects parent, dot, empty, absolute and backslash segments;
- resolves existing inputs through `realpath`;
- rejects source symlink escapes;
- resolves output parents from the nearest existing canonical directory;
- rejects output-directory symlink escapes;
- rejects existing output keys;
- stages each output in its destination directory;
- uses hard-link creation for atomic new-file commit;
- rolls back already committed transaction members when a later member fails;
- removes staging files in all terminal paths;
- returns object key, path, MIME type, byte count and SHA-256 receipts.

This is an ordinary-process integrity boundary, not a hostile operating-system sandbox against an account continuously replacing directories during a transaction.

## Execution result

The executor returns a `HostedJobCompletion` containing:

```text
outputs[]
  path
  mimeType
  bytes
  sha256

evidence
  source revision
  operation evidence summary
  output object identities
  approval: human-review-required
```

Generated SVG, PNG, Lottie JSON or archive bodies are committed to object storage, not returned in the completion evidence.

Detailed engine evidence is written to the explicit evidence object named in the payload.

## Cancellation boundary

An `AbortSignal` is checked:

- before source resolution;
- after source reads;
- before governed engine execution;
- before staging outputs;
- before each object commit.

Pre-cancelled work creates no output objects.

A future lease-aware process runner must continue heartbeat and cancellation polling while an engine is running. That orchestration is intentionally separate from this asset executor.

## Current deployment boundary

The worker engine is available as a tested package. A hosted worker process is not yet released.

Still required:

- queue or lease polling process;
- worker identity and authentication;
- object-store provider adapter shared with API upload flows;
- lease heartbeat scheduling;
- cancellation polling;
- process shutdown and recovery;
- operation metrics and logs;
- deployment and native-binary smoke tests;
- distributed queue and storage guarantees.

Until those are implemented, `remoteExecutionAvailable` remains `false` and hosted record creation retains `executionScheduled: false`.
