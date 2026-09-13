# EVAVO Vector Studio

EVAVO Vector Studio is a governed raster-to-vector and motion-production workspace for reconstructing logos, icons, line art, illustrations and selected photographic sources as editable, web, motion and print vector assets.

The system does not call one automatic trace “finished”. It inspects visible source content, creates bounded candidates, measures visual equivalence, records geometry and topology evidence, packages the selected result for an explicit delivery intent and keeps professional approval separate from machine completion.

## Available production surfaces

### Clean SVG

Available through the browser, authenticated HTTP API, CLI, MCP and resumable batch runner.

- guarded static PNG, JPEG, WebP, GIF, BMP and single-page classic TIFF preflight;
- pre-decode rejection of APNG, animated GIF, animated WebP, MPO JPEG, multi-page TIFF and BigTIFF;
- 25 MiB encoded-input and 40 million decoded-pixel limits;
- alpha-aware visible-content bounds and colour analysis that ignores hidden RGB beneath fully transparent pixels;
- native RGBA decoding and spline reconstruction;
- automatic or explicit logo, icon, line-art, illustration and photo profiles;
- adaptive base, fidelity and economy candidates under source-pixel budgets;
- editable, web, motion and print delivery profiles;
- deterministic collision-safe stable path IDs for editable and motion outputs;
- responsive root-dimension packaging for web and motion only when a valid `viewBox` exists;
- safe multipass SVG optimisation with delivery-transform safety rollback;
- SVG safety, geometry, topology and editability inspection;
- alpha-aware multi-scale render comparison;
- optional visual-difference heatmap PNG with selected-candidate binding and SHA-256;
- browser verification of the base64 difference PNG before display or download;
- no production auto-approval.

See [`docs/DELIVERY-PROFILES.md`](docs/DELIVERY-PROFILES.md) for the governed packaging contract.

### Animated SVG

Available through the browser Motion Director, core package, API, CLI, MCP and resumable batch runner.

- ID-targeted opacity, translation, uniform scale and rotation;
- validated timing, delay, easing, iteration, direction and fill mode;
- deterministic script-free CSS keyframes;
- mandatory `prefers-reduced-motion` fallback;
- source and output SHA-256 evidence;
- normalized motion plans that remain reusable across surfaces;
- animated-SVG inspection and separate evidence output.

### Lottie JSON

Governed Lottie JSON export and inspection are available through the core Lottie package, CLI and HTTP API. MCP, the browser Motion Director and the resumable batch runner use the same governed Lottie contract.

- path-based shape layers;
- SVG path command conversion including curves and arcs;
- solid fill and stroke;
- opacity, translation, uniform scale and rotation;
- deterministic JSON and structural inspection;
- expression, image, text, precomposition, gradient, mask and filter rejection;
- browser Lottie player preview after exact JSON and SHA-256 verification;
- reduced-motion-aware autoplay and looping suppression.

### dotLottie

The deterministic dotLottie v2 packaging is available through core, CLI, `POST /api/v1/motion/dotlottie`, MCP, the browser Motion Director and the resumable batch runner.

- exact `manifest.json` plus `a/<animation-id>.json` layout;
- DEFLATE compression and fixed ZIP metadata;
- deterministic bytes and SHA-256;
- hostile-archive inspection for traversal, duplicates, encryption, ZIP64, overlap and oversized declared content;
- authenticated direct archive delivery or bounded base64 wrapper evidence;
- browser archive byte, ZIP-signature, SHA-256 and manifest verification;
- official-player `load` and `loadError` lifecycle evidence;
- separate `.lottie` and evidence downloads.

The browser archive-load validation is available after exact archive verification. Independent player-render validation remains unavailable.

### Durable batch automation

The `evavo-vector-batch` CLI provides a crash-resumable local runner for ChatGPT, Claude, scripts and production operators.

- strict batch-v1 manifests;
- persistent atomic `state.json`;
- append-only `events.ndjson`;
- exclusive runner locks and stale-lock recovery;
- immutable manifest SHA-256 per job ID;
- input revision SHA-256 per item;
- delivery intent retained inside the immutable operation revision;
- output receipt re-verification before reuse;
- interrupted-item recovery;
- `continue` and `fail-fast` modes;
- failure isolation;
- explicit evidence outputs;
- no existing-file overwrite.

The current runner resumes when invoked again. It is not yet a hosted background queue or multi-node worker service.

### Hosted job control plane

Hosted job control contract `1.0` can create idempotent persistent records, inspect state and request cancellation when a deliberate record-store adapter is configured.

- workspace-scoped idempotency;
- optimistic state versions;
- worker leases and heartbeats in `@evavo/job-control`;
- bounded retries and expired-lease recovery;
- cancellation requests and acknowledgement;
- output byte-count and SHA-256 receipts;
- production fail-closed store configuration;
- `executionScheduled: false` and `remoteExecutionAvailable: false` until a worker is deployed.

The current API records intent only. It does not claim hosted execution. See [`docs/HOSTED-JOBS.md`](docs/HOSTED-JOBS.md).

### Local worker execution

The `evavo-vector-worker` process executes supported hosted records against persistent local job and immutable object stores.

- immutable object import with SHA-256 receipts;
- idempotent submit, inspect, list and cancel commands;
- one-shot `worker:run-once` and polling `worker:run` modes;
- lease heartbeats, retryable requeue and cancellation acknowledgement;
- atomic no-overwrite output transactions;
- receipt-only job records and JSON/NDJSON process output;
- committed-output cancellation-race protection;
- generated bodies kept out of job records and console output;
- `remoteExecutionAvailable: false` and `hostedBackgroundQueue: false`.

The Local worker is available for workstation and self-hosted execution. Distributed remote execution remains unavailable. See [`docs/LOCAL-WORKER.md`](docs/LOCAL-WORKER.md).

### Worker object transfer

Worker object-transfer contract `1.0` provides separately authenticated immutable binary upload and download when a persistent object-store runtime is explicitly configured.

- `POST /api/v1/worker/objects` accepts deterministic `EVAVOOB1` transactions;
- `GET /api/v1/worker/objects?key={objectKey}` returns raw bytes with key, byte-count and SHA-256 headers;
- up to 16 objects, 32 MiB per object and 64 MiB per transaction;
- atomic new-file-only commits;
- complete content replay and concurrent exact-commit reconciliation;
- changed or partial immutable overlap rejection;
- no filesystem paths or generated bodies in JSON;
- production file mode fails closed without `VECTOR_OBJECT_FILE_STORE_PERSISTENT=true`.

The current file adapter reports `mimeTypeVerification: content-only` on retained replay because original MIME metadata is not stored beside raw bytes. Provider-backed cloud object storage, queue delivery and managed remote execution remain unavailable. See [`docs/OBJECT-TRANSFER.md`](docs/OBJECT-TRANSFER.md).

### HTTP-coordinated worker execution

`evavo-vector-http-worker` can execute through either a trusted shared file store or the verified worker object-transfer API.

```powershell
# Existing shared-volume mode
$env:VECTOR_HTTP_WORKER_OBJECT_STORE_MODE = "file"
$env:VECTOR_OBJECT_STORE_PATH = "C:\EVAVO\VectorWorker\objects"

# Verified remote object mode
$env:VECTOR_HTTP_WORKER_OBJECT_STORE_MODE = "http"
$env:VECTOR_WORKER_CONTROL_URL = "https://vector.evavo.com.au"
$env:VECTOR_WORKER_API_TOKEN = "replace-with-a-worker-only-secret"

pnpm http-worker:run
```

HTTP mode verifies service discovery before acquiring a lease, validates downloaded object key, byte count and SHA-256, and retries only safe exact transaction uncertainty. Queue delivery and managed remote execution remain unavailable. See [`docs/HTTP-WORKER.md`](docs/HTTP-WORKER.md).

## Quick start on Windows PowerShell

```powershell
Set-Location C:\GitRepos\evavo-vector-studio
git pull origin main
corepack enable
pnpm install --frozen-lockfile
pnpm check
pnpm dev
```

Open:

```text
http://localhost:3000          trace and evidence workspace
http://localhost:3000/motion   Motion Director, Lottie review and dotLottie delivery
```

For protected production deployment, configure a long server-only `VECTOR_API_TOKEN`. The browser accepts it per tab and does not require a public environment variable.

## Browser workflows

### Trace workspace

The trace workspace previews the selected raster locally, resolves a trace profile, runs adaptive or single-candidate reconstruction, compares source and selected SVG, verifies optional difference evidence, displays topology and geometry, applies the selected editable, web, motion or print delivery profile, and downloads the SVG and optional PNG separately.

White regions in the visual-difference heatmap are measured matches. Red regions identify measured difference using a declared amplification. This evidence does not replace curve, negative-space, compound-path or brand review.

### Motion Director

Open `/motion` to:

1. screen a static SVG for active content, external references, duplicate IDs and existing animation;
2. discover portable target IDs;
3. author multiple motion tracks and keyframes;
4. generate through `POST /api/v1/motion/svg`;
5. verify animated-SVG hashes, motion identity and reduced-motion evidence;
6. generate through `POST /api/v1/motion/lottie`;
7. verify exact Lottie JSON and open the browser Lottie player preview;
8. generate deterministic dotLottie v2 through `POST /api/v1/motion/dotlottie`;
9. verify archive bytes, manifest and inspection evidence;
10. pass verified archive `ArrayBuffer` data to the official player;
11. retain browser archive-load evidence without claiming source-to-player equivalence.

Every browser output remains `human-review-required` or `review-required`.

## Single-file CLI

```powershell
# Inspect one raster with alpha-aware visible-content evidence
pnpm vector:raster:inspect -- .\fixtures\mark.png

# Trace one raster as an editable master with optional difference evidence
pnpm vector:trace -- `
  .\fixtures\mark.png `
  --out .\outputs\mark.editable.svg `
  --profile logo `
  --candidate-mode adaptive `
  --delivery-profile editable `
  --stable-id-prefix mark-shape `
  --diff-out .\outputs\mark.difference.png `
  --difference-max-dimension 512

# Package an existing SVG for responsive web delivery
pnpm vector:inspect -- .\fixtures\mark.svg
pnpm vector:optimise -- `
  .\fixtures\mark.svg `
  --out .\outputs\mark.web.svg `
  --delivery-profile web

# Animated SVG
pnpm vector:motion:validate -- .\fixtures\motion\gentle-entrance.motion.json
pnpm vector:animate-svg -- `
  .\fixtures\motion\gentle-entrance.source.svg `
  --motion .\fixtures\motion\gentle-entrance.motion.json `
  --out .\outputs\gentle-entrance.animated.svg `
  --evidence-out .\outputs\gentle-entrance.motion.evidence.json

# Lottie JSON
pnpm vector:lottie:export -- `
  .\fixtures\motion\gentle-entrance.source.svg `
  --motion .\fixtures\motion\gentle-entrance.motion.json `
  --out .\outputs\gentle-entrance.lottie.json `
  --evidence-out .\outputs\gentle-entrance.lottie.evidence.json
pnpm vector:lottie:inspect -- .\outputs\gentle-entrance.lottie.json

# dotLottie
pnpm vector:dotlottie:package -- `
  .\outputs\gentle-entrance.lottie.json `
  --out .\outputs\gentle-entrance.lottie `
  --animation-id gentle-entrance `
  --evidence-out .\outputs\gentle-entrance.dotlottie.evidence.json
pnpm vector:dotlottie:inspect -- .\outputs\gentle-entrance.lottie
pnpm vector:dotlottie:capabilities
```

Single-file output commands use atomic new-file-only transactions. Existing destinations and path collisions are rejected.

## Resumable batch CLI

Create a manifest using [`schemas/batch-v1.schema.json`](schemas/batch-v1.schema.json), then run:

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

Supported operations:

```text
trace-raster
optimise-svg
animate-svg
export-lottie
package-dotlottie
```

Completed items are reused only when their current input revision and all output receipts still verify. See [`docs/BATCH.md`](docs/BATCH.md).

## Local MCP automation

Build and start the stdio server:

```powershell
$env:VECTOR_MCP_ALLOWED_ROOTS = "C:\GitRepos\evavo-vector-studio;C:\EVAVO\VectorAssets"
pnpm vector:mcp
```

MCP contract `1.6` exposes sixteen tools, including:

```text
vector_trace_raster
vector_inspect_svg
vector_optimise_svg
vector_preflight_svg_print
vector_animate_svg
vector_export_lottie
vector_inspect_lottie
vector_package_dotlottie
vector_inspect_dotlottie
vector_run_batch
vector_inspect_batch
```

The raster and SVG tools expose editable, web, motion and print delivery profiles with alpha-aware source evidence, stable IDs and safety rollback. The Lottie, dotLottie and durable batch MCP operations use canonical allowed roots, new-file-only transactions and receipt-only results. Generated SVG, PNG, Lottie JSON and ZIP bodies remain outside model context. MCP batches are paginated, cancellation-aware and resumable when invoked again, accept at most 100 manifest items, and are not a hosted background queue.

## Authenticated API

```text
GET  /api/v1/capabilities
GET  /api/v1/readiness
POST /api/v1/trace
POST /api/v1/print/preflight
POST /api/v1/motion/svg
POST /api/v1/motion/lottie
POST /api/v1/motion/dotlottie
GET  /api/v1/jobs
POST /api/v1/jobs
GET  /api/v1/jobs/{jobId}
DELETE /api/v1/jobs/{jobId}
```

`GET /api/v1/readiness` is a public non-sensitive projection of interactive, automation and release blockers. It never returns secret values and never makes Vector Studio client-release eligible. See [`docs/READINESS.md`](docs/READINESS.md).

The production endpoints are bounded synchronous surfaces with `Cache-Control: no-store`. Hosted job routes are a separately configured record control plane. They fail closed without a safe record store and do not automatically schedule execution.

## Worker control API

Worker control protocol `1.0` provides separately authenticated HTTP lease coordination through `/api/v1/worker` and `/api/v1/worker/lease`, with start, heartbeat, completion, failure and cancellation-acknowledgement routes for individual jobs.

`VECTOR_WORKER_API_TOKEN` is mandatory and distinct from the ordinary API token. Lease tokens are returned only on acquisition. Generated bodies are not accepted or returned.

```text
objectTransferAvailable: configured-runtime-dependent
queueDeliveryAvailable: false
remoteExecutionAvailable: false
```

See [`docs/WORKER-API.md`](docs/WORKER-API.md).

## Quality and approval

Machine completion, structural validity, measured render quality, archive loading and production approval are separate states.

The system can retain source visibility, safety checks, delivery settings, revisions, candidate selection, topology, render metrics, stable IDs, hashes, archive structure and output receipts. It cannot automatically establish ideal Bézier placement, semantic layer design, optical brand correction, creative motion direction, print-production fitness or cross-player pixel equivalence.

Production auto-approval is unavailable. All generated assets remain review-required.

## Repository layout

```text
apps/web                  trace workspace, Motion Director and authenticated APIs
packages/vector-core      SVG safety, geometry, topology and delivery packaging
packages/raster-engine    raster preflight, alpha-aware analysis, reconstruction and visual evidence
packages/motion-engine    governed animated SVG
packages/lottie-engine    Lottie JSON and deterministic dotLottie
packages/job-engine       persistent resumable batch state and runner
packages/job-control      hosted job records, leases, cancellation and receipts
packages/worker-engine    immutable object-backed governed job execution
packages/worker-protocol  authenticated worker control and binary transfer contracts
packages/worker-client    verified worker control and object clients
workers/local-worker      local lease processor and machine-readable CLI
workers/http-worker       HTTP-coordinated file or object-API worker
packages/cli              single-file and durable batch automation
packages/mcp              local stdio agent tools
schemas                   motion and batch contracts
fixtures                  deterministic validation fixtures
scripts                   dependency-free contract gates
docs                      architecture, API, CLI, MCP, motion, archive and job contracts
```

## Detailed contracts

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- [`docs/QUALITY-EVIDENCE.md`](docs/QUALITY-EVIDENCE.md)
- [`docs/INPUT-SAFETY.md`](docs/INPUT-SAFETY.md)
- [`docs/DELIVERY-PROFILES.md`](docs/DELIVERY-PROFILES.md)
- [`docs/READINESS.md`](docs/READINESS.md)
- [`docs/TEST-BUILD-ISOLATION.md`](docs/TEST-BUILD-ISOLATION.md)
- [`docs/CLI.md`](docs/CLI.md)
- [`docs/API.md`](docs/API.md)
- [`docs/MOTION.md`](docs/MOTION.md)
- [`docs/LOTTIE.md`](docs/LOTTIE.md)
- [`docs/DOTLOTTIE.md`](docs/DOTLOTTIE.md)
- [`docs/MCP.md`](docs/MCP.md)
- [`docs/BATCH.md`](docs/BATCH.md)
- [`docs/HOSTED-JOBS.md`](docs/HOSTED-JOBS.md)
- [`docs/WORKER.md`](docs/WORKER.md)
- [`docs/LOCAL-WORKER.md`](docs/LOCAL-WORKER.md)
- [`docs/WORKER-API.md`](docs/WORKER-API.md)
- [`docs/OBJECT-TRANSFER.md`](docs/OBJECT-TRANSFER.md)
- [`docs/WORKER-CLIENT.md`](docs/WORKER-CLIENT.md)
- [`docs/HTTP-WORKER.md`](docs/HTTP-WORKER.md)

## Deployment boundary

The EVAVO website hub integration remains a signed federated candidate. The repository does not mark itself released until deployment, authentication, host limits, signed launch and live smoke evidence are verified.

Preserve source intent. Reconstruct deliberate geometry. Minimise unnecessary anchors. Keep outputs editable. Package for the real destination. Direct motion intentionally. Translate formats explicitly. Record material decisions. Reject unsafe or misleading results instead of silently producing something different.
