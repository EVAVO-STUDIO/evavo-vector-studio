# Architecture

EVAVO Vector Studio separates source inspection, vector reconstruction, evidence, motion, delivery and durable automation so that successful execution is never mistaken for professional approval.

## Static reconstruction pipeline

1. **Encoded preflight**
   - identify PNG, JPEG, WebP, GIF, BMP or classic TIFF from bytes;
   - reject empty, malformed, oversized and excessive-canvas input before native decoding;
   - reject animation and multi-page containers rather than selecting one frame or page silently.
2. **Decode and source analysis**
   - decode one RGBA buffer;
   - verify dimensions and complete pixel length;
   - retain source SHA-256, alpha coverage, palette signals, tone, entropy and edge density.
3. **Profile resolution**
   - resolve `auto` to logo, icon, line-art, illustration or photo;
   - retain requested and resolved profiles.
4. **Bounded candidate planning**
   - create base, fidelity and economy candidates when source-pixel budgets permit;
   - cap work at three, two or one candidate.
5. **Geometry reconstruction**
   - reconstruct spline paths from decoded RGBA data;
   - retain colour, hierarchy, corner, length, splice and precision settings.
6. **Safe SVG optimisation**
   - run the reviewed optimiser under a bounded multipass policy;
   - add an escaped accessibility title when requested.
7. **Independent SVG inspection**
   - reject scripts, `foreignObject`, event handlers, `javascript:` links and external references;
   - inspect paths, commands, subpaths, curves, straight segments, anchors, IDs and topology.
8. **Multi-scale render comparison**
   - render candidates with system fonts disabled;
   - compare against the decoded source using alpha-aware black and white compositing.
9. **Visual-first selection**
   - retain the best visual candidate when every candidate requires review;
   - select lower geometry cost only inside explicit visual, mismatch and aspect-ratio tolerances.
10. **Selected-candidate difference evidence**
    - optionally create a bounded white-to-red PNG heatmap;
    - retain dimensions, byte count, SHA-256, source sampling, amplification and candidate binding.
11. **Packaging and delivery**
    - retain selected SVG, inspection, evidence and optional PNG;
    - deliver through browser, API, CLI, MCP or durable batch operation without overwriting source files.

## Motion and delivery pipeline

### Animated SVG

1. validate and normalize motion-v1 input;
2. resolve each target ID exactly once;
3. reject existing animation and unsafe base transforms;
4. emit deterministic script-free CSS keyframes;
5. add mandatory reduced-motion fallback;
6. inspect motion identity, rules, targets and fallback;
7. retain source/output SHA-256 and review evidence.

### Lottie JSON

1. require governed path-based SVG geometry;
2. convert supported SVG commands into Lottie Bézier paths;
3. preserve source paint order through explicit stack translation;
4. convert one normal motion cycle into frame keyframes;
5. reject gradients, text, images, masks, filters, expressions and precompositions;
6. serialize deterministic JSON;
7. inspect shape layers, paths, fills, strokes, transforms and keyframes;
8. retain compatibility non-claims and review state.

### dotLottie

1. require governed Lottie JSON;
2. canonicalize embedded JSON;
3. create manifest-v2 metadata;
4. package exactly `manifest.json` and `a/<animation-id>.json`;
5. use DEFLATE and fixed ZIP metadata;
6. inspect local headers, central directory, paths, sizes and manifest semantics;
7. retain archive and embedded-Lottie SHA-256 and inspection evidence;
8. optionally verify exact archive loading in the browser while keeping player-render validation separate.

## Runtime surfaces

### Browser

The Next.js application provides:

- trace, source/SVG comparison and visual-difference evidence;
- topology and candidate review;
- animated-SVG Motion Director;
- verified Lottie JSON player preview;
- verified dotLottie archive delivery and browser load evidence;
- separate asset and evidence downloads.

Generated SVG markup is not injected into the application document. Browser evidence does not grant production approval.

### Authenticated API

The API exposes bounded synchronous production routes plus a separately configured hosted job control plane:

```text
POST /api/v1/trace
POST /api/v1/motion/svg
POST /api/v1/motion/lottie
POST /api/v1/motion/dotlottie
GET  /api/v1/jobs
POST /api/v1/jobs
GET  /api/v1/jobs/{jobId}
DELETE /api/v1/jobs/{jobId}
```

Production requests require a bearer token and responses use `no-store`. The hosted job routes can retain idempotent records when a safe store is configured, but they do not schedule execution or claim a deployed worker.

### Single-file CLI

The CLI is the direct local automation surface for inspection, tracing, optimisation, animated SVG, Lottie JSON and dotLottie. Output paths are explicit, collisions are rejected and operational results are JSON.

### MCP

The stdio MCP server exposes raster, SVG, motion, Lottie, dotLottie and durable batch operations through canonical allowed roots. Generated bodies are written to files and represented in model context by path, MIME type, byte count and SHA-256 receipts.

### Durable batch

`@evavo/job-engine` and `evavo-vector-batch` add restartable manifest execution around the same governed engines.

A durable batch retains:

```text
.evavo-vector-jobs/<job-id>/state.json
.evavo-vector-jobs/<job-id>/events.ndjson
.evavo-vector-jobs/<job-id>/runner.lock
```

The batch layer provides:

- canonical manifest SHA-256 and immutable job identity;
- exclusive local runner ownership;
- stale-lock recovery;
- atomic state replacement;
- append-only events;
- per-item input revisions;
- interrupted-item recovery;
- output receipt verification before reuse;
- `continue` and `fail-fast` modes;
- per-item atomic engine outputs and explicit evidence files.

A completed item is reused only when its input revision and every output receipt still match. Input drift, missing output or modified output produces an explicit failure instead of silent reuse.

The local runner resumes when invoked again. It does not execute after its process or machine has stopped and is not a distributed queue.

### Hosted job control plane

`@evavo/job-control` separates record durability from execution. It provides:

- workspace-scoped idempotency;
- canonical request SHA-256;
- optimistic record versions;
- queued, leased, running, cancellation and terminal states;
- worker lease acquisition and heartbeat renewal;
- bounded retries and expired-lease recovery;
- output receipts and terminal evidence;
- a durable local file adapter and in-memory test adapter.

The API fails closed unless `VECTOR_JOB_STORE_MODE` selects a deliberate adapter. Production file mode additionally requires `VECTOR_JOB_FILE_STORE_PERSISTENT=true` to acknowledge a genuinely persistent mounted volume.

Creating a hosted job record does not enqueue or execute work. Responses retain `executionScheduled: false` and `remoteExecutionAvailable: false` until a worker and queue are deployed.

### Local worker

`@evavo/local-worker` combines hosted job records, leases, immutable object storage and the governed worker executor into a real single-process service.

The process can import immutable objects, submit and inspect records, execute one job or poll continuously, renew heartbeats, observe cancellation, requeue retryable failures and retain receipt-only completion records. CLI commands return JSON; polling mode returns NDJSON.

A late cancellation that arrives after immutable outputs commit is recorded as receipt-backed success with retained cancellation metadata and `cancellationRaceResolution: committed-success-retained`. This prevents generated objects from becoming orphaned.

Local worker execution is available. Distributed queue delivery, shared remote storage and autoscaled remote workers remain unavailable.

### Worker object transfer

The worker object-transfer API separates binary object movement from JSON job control:

1. require the independent worker bearer token;
2. fail closed unless `VECTOR_OBJECT_STORE_MODE=file` is deliberately configured;
3. require a production persistent-volume acknowledgement for file mode;
4. decode one bounded canonical `EVAVOOB1` transaction;
5. verify transaction and per-object SHA-256 before storage;
6. inspect retained immutable keys before writing;
7. atomically commit all new objects or none;
8. return complete content replay without overwriting;
9. reject partial or changed immutable revisions;
10. return raw downloads with key, byte-count and SHA-256 headers.

The current file adapter retains raw bytes but not authoritative original MIME metadata. File-backed replays can therefore prove content identity while reporting `mimeTypeVerification: content-only`.

The HTTP worker now supports `worker-api` object transport. It verifies service discovery before leasing work, downloads sources through key/length/SHA-256 evidence, and uploads exact deterministic transactions through bounded replay-safe retries. Shared-file mode remains available and remains the default.

## Evidence and approval

Machine completion, structural validity, measured render quality, archive loading and professional approval are separate states.

The system can establish that:

- input and output passed declared safety checks;
- selected SVG rendering was measured under published thresholds;
- a candidate was selected under a retained policy;
- a difference image belongs to the selected candidate;
- geometry and topology were counted consistently;
- motion follows the validated contract and reduced-motion policy;
- Lottie JSON passed the governed structural subset;
- dotLottie passed archive and embedded-Lottie inspection;
- a browser player accepted exact verified archive bytes;
- a durable item retained the same input revision and output receipts;
- a hosted job record preserved canonical intent, idempotency and state transitions;
- a local worker retained exact input and output receipts under a valid lease;
- an HTTP worker verified transferred source and output object identities without requiring a shared filesystem.

It cannot establish automatically that:

- Bézier handles are placed as a senior vector artist would place them;
- negative space and compound paths are semantically ideal;
- optical brand corrections are preserved perfectly;
- layers are ideal for every future editing workflow;
- motion direction and rhythm are creatively appropriate;
- one browser player is pixel-equivalent to the source or every other player;
- a hosted worker ran merely because a job record exists;
- local or HTTP-coordinated execution proves managed queue or autoscaling readiness.

Production auto-approval is unavailable. Outputs remain `review-required` or `human-review-required`.

## Security and integrity boundaries

- encoded raster limits precede native decode;
- static-image policy rejects animated and multi-page ambiguity;
- SVG active content and external references are rejected;
- filesystem outputs are new-file-only;
- MCP paths stay within canonical allowed roots;
- batch operation paths stay beneath the declared root;
- hosted job requests use strict bounded canonical JSON;
- hosted record mutation uses optimistic compare-and-swap versions;
- hosted file records use exclusive locks and atomic replacement;
- local worker inputs use immutable object keys and SHA-256 revisions;
- local worker outputs commit atomically with no-overwrite semantics;
- object transfer verifies canonical manifests, transaction hashes and object hashes;
- object-transfer replays reject partial and changed immutable revisions;
- related files commit atomically;
- archive entry names, counts and sizes are checked before decompression;
- durable manifest drift and completed output drift are rejected.

These controls are application boundaries, not an operating-system sandbox.

## Deployment boundary

The repository now has restartable local batch execution, a provider-neutral hosted job record control plane and an executable local worker. A released hosted EVAVO application still needs:

- database-backed job and event storage for multi-instance deployment;
- shared object storage for immutable source and generated artefacts;
- queue delivery guarantees and visibility timeouts;
- distributed leases and worker heartbeats;
- bounded retry, backoff and dead-letter policy;
- remote cancellation and progress streaming;
- workspace-scoped authorisation;
- signed EVAVO hub launch;
- host request, execution and storage limits;
- native-binary, cold-start and live smoke evidence.

Until those controls are deployed and verified, Vector Studio remains a signed federated candidate rather than a released EVAVO hub application.
