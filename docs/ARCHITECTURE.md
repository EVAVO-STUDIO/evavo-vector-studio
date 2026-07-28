# Architecture

EVAVO Vector Studio separates source inspection, vector reconstruction, evidence, delivery and future motion authoring so that no one successful native call is mistaken for a professionally approved asset.

## Current execution pipeline

1. **Encoded preflight**
   - identify PNG, JPEG, WebP, GIF, BMP or classic TIFF from bytes;
   - reject empty, malformed, oversized or excessive-canvas input before native decoding.
2. **Decode and source analysis**
   - decode one RGBA buffer;
   - verify dimensions and complete pixel length;
   - record source hash, alpha coverage, palette signals, tone, entropy and edge density.
3. **Profile resolution**
   - resolve `auto` to logo, icon, line-art, illustration or photo;
   - preserve the requested and resolved profile in evidence.
4. **Bounded candidate planning**
   - create base, fidelity and economy configurations where source-pixel budgets permit;
   - cap work at three, two or one candidate according to decoded size.
5. **Geometry reconstruction**
   - reconstruct spline paths from decoded RGBA data;
   - retain the exact colour, hierarchy, corner, length, splice and precision settings.
6. **Safe SVG optimisation**
   - run the native safe optimiser under a bounded multipass policy;
   - apply an optional escaped accessibility title.
7. **Independent SVG inspection**
   - reject scripts, `foreignObject`, event handlers, `javascript:` links and network-dependent references;
   - record paths, path data, commands, subpaths, curves, straight segments and estimated anchors.
8. **Multi-scale render comparison**
   - render each completed candidate with system fonts disabled;
   - compare against the decoded source at bounded scales using alpha-aware black and white compositing.
9. **Visual-first candidate selection**
   - retain the best visual candidate when all results require review;
   - otherwise allow a lower-geometry candidate only inside explicit visual, mismatch and aspect-ratio tolerances.
10. **Selected-candidate difference evidence**
    - optionally render a bounded white-to-red PNG heatmap for the selected candidate;
    - record dimensions, bytes, SHA-256, source sampling, display amplification and candidate binding.
11. **Packaging**
    - return the selected SVG, complete evidence and optional PNG bytes through the engine;
    - expose them through the browser, authenticated API and JSON-first CLI without overwriting source files.

## Evidence and approval

Machine completion, measured render quality and professional approval are separate states.

The system can establish that:

- input and output passed declared safety checks;
- the SVG rendered within measured error bounds;
- a candidate was selected under a published policy;
- a difference image belongs to the selected candidate;
- geometry complexity was counted consistently.

It cannot establish automatically that:

- Bézier handles are placed as a senior vector artist would place them;
- negative space and compound paths are semantically ideal;
- a brand mark preserves every intentional optical correction;
- layers are organised for every future editing workflow;
- motion direction is creatively appropriate.

`productionApproval` therefore remains `review-required`.

## Runtime surfaces

### Browser

The Next.js workspace submits bounded multipart jobs, previews raster and SVG outputs without injecting generated markup, displays evidence and offers separate SVG and difference-PNG downloads.

### API

`POST /api/v1/trace` is synchronous and bearer-protected in production. JSON is the complete evidence transport. Direct SVG delivery is available only when no second artefact is requested.

### CLI

The CLI is the preferred local and agent automation surface. It writes explicit output paths, rejects collisions and emits machine-readable JSON to stdout.

## Deployment boundary

The current runtime is not a durable worker system. A production deployment must still add or verify:

- actual host request-body and execution limits;
- object storage for source and generated artefacts;
- persistent job records and idempotency keys;
- resumable workers, retries and cancellation;
- signed EVAVO hub launch and workspace-scoped authorisation;
- live smoke, native-binary and cold-start evidence.

Until those controls exist, Vector Studio remains a federated candidate rather than a released EVAVO hub application.

## Planned motion layer

Animated SVG and Lottie remain downstream of approved static geometry. The future motion system must operate on explicit layers, supported renderer features, reduced-motion fallbacks and timeline evidence. It must not animate an unreviewed trace and call that polish.
