# EVAVO Vector Studio

EVAVO Vector Studio is a governed raster-to-vector production workspace for reconstructing logos, icons, line art, illustrations and selected photographic sources as editable SVG assets.

The objective is not to call one automatic trace “finished”. The system inspects the source, builds bounded candidates, measures visual equivalence, records geometric and topology evidence, selects transparently and keeps professional approval separate from machine completion.

## Implemented foundation

- guarded static PNG, JPEG, WebP, GIF, BMP and single-page classic TIFF preflight;
- pre-decode rejection of APNG, animated GIF, animated WebP, MPO JPEG and multi-page TIFF;
- 25 MiB encoded-input and 40 million decoded-pixel limits;
- native RGBA decoding and spline-based raster reconstruction;
- source SHA-256, alpha, palette, tonal, entropy and edge analysis;
- automatic or explicit logo, icon, line-art, illustration and photo profiles;
- adaptive base, fidelity and economy candidates under source-pixel budgets;
- explicit visual-cost, geometry-cost and candidate-selection evidence;
- safe multipass SVG optimisation;
- SVG path-command, subpath and estimated-anchor inspection;
- topology checks for duplicate IDs, unresolved references, duplicate paths, open filled subpaths, unoutlined text and document indirection;
- rejection of scripts, `foreignObject`, inline handlers, `javascript:` links and network-dependent references;
- alpha-aware source-versus-SVG rendering at up to 64, 256 and 1024 pixels;
- visual MAE, RMS error, alpha error, black/white composite error, mismatch fraction and aspect-ratio evidence;
- optional audited white-to-red PNG difference heatmaps with bounded dimensions and SHA-256 evidence;
- browser-side verification of returned PNG bytes, signature, dimensions, selected candidate and SHA-256;
- responsive browser review for source, selected SVG, difference image, topology, candidates, metrics and downloads;
- authenticated multipart APIs for bounded synchronous tracing and animated SVG creation;
- JSON-first CLI suitable for people, ChatGPT, Claude and workers;
- deterministic, script-free animated SVG generation from validated ID-targeted motion plans;
- opacity, translation, scale and rotation keyframes with easing and mandatory reduced-motion fallback;
- motion-plan JSON Schema, normalized-plan validation, animated-SVG inspection and SHA-256 evidence;
- responsive browser Motion Director with source screening, target discovery, presets, tracks, keyframes, playback controls, replay and verified downloads;
- browser verification of source/output SHA-256, motion identity, style identity, target order, reduced-motion fallback and script-free evidence;
- governed path-based Lottie JSON engine with SVG command conversion, source-order preservation, solid fill and stroke support, layer-transform motion and structural inspection;
- Lottie CLI export and inspection with atomic new-file-only output, SHA-256 evidence and explicit player-compatibility non-claims;
- atomic new-file-only CLI transactions for optimised, traced, animated and Lottie outputs;
- local stdio MCP server with nine governed tracing, SVG and motion tools for ChatGPT-compatible MCP hosts, Claude, editors and agent runtimes;
- canonical allowed-root access, new-files-only output, atomic multi-file commit and SHA-256 file receipts for MCP operations;
- inline or file-based MCP motion plans, normalized-plan output, animated SVG creation and motion inspection without placing SVG bodies in model context;
- tests for format, decompression-bomb, multi-image, topology, candidate-selection, alpha-comparison, PNG, motion, Lottie geometry, Lottie structural output, MCP SDK, path-policy and transaction boundaries;
- dependency-free contract gates plus the GitHub Actions quality workflow source.

Animated SVG production is available through the browser Motion Director, core motion package, HTTP API, CLI and MCP. Governed Lottie JSON export and inspection are available through the core Lottie package and CLI. Lottie HTTP API, Lottie MCP tools, browser player validation and dotLottie packaging remain unavailable.

## Quick start on Windows PowerShell

```powershell
Set-Location C:\GitRepos\evavo-vector-studio
git pull origin main
corepack enable
pnpm install
pnpm check
pnpm dev
```

Open:

```text
http://localhost:3000          trace and evidence workspace
http://localhost:3000/motion   Motion Director
```

For a protected production deployment, set a long server-only `VECTOR_API_TOKEN`. The browser accepts it per tab and does not require a public environment variable.

## Browser workflows

### Trace workspace

The trace workspace can:

1. preview the selected raster locally;
2. choose an automatic or directed trace profile;
3. choose adaptive candidate review or a single candidate;
4. control palette intent and safe optimisation;
5. request a bounded difference PNG;
6. compare the source, selected SVG and visual-difference heatmap;
7. verify difference bytes and SHA-256 in the browser;
8. inspect topology, editability, candidate and geometry evidence;
9. download the SVG and optional difference PNG separately.

White regions in the heatmap are measured matches. Red regions mark visual difference using a declared display amplification. The heatmap is review evidence, not a substitute for inspecting curves, compound paths, negative space and brand geometry.

### Motion Director

Open `/motion` to author motion against a governed, ID-structured SVG. The browser Motion Director can:

1. screen the SVG for scripts, external references, duplicate IDs and pre-existing animation before preview;
2. discover portable target IDs and flag base transforms;
3. add multiple target tracks;
4. apply fade, rise, slide, soft-pop, rotate-settle and drift-loop presets;
5. edit offsets, opacity, translation, scale, rotation, easing, transform box and transform origin;
6. control duration, delay, iteration, direction, fill mode and reduced-motion strategy;
7. generate through the authenticated motion API;
8. verify source/output SHA-256, motion/style identity, target order, reduced-motion fallback and script-free evidence before display;
9. replay and download the animated SVG, normalized motion plan and evidence record;
10. mark the displayed result stale when the editor changes after generation.

The editor uses Blob-backed `<img>` previews rather than injecting returned SVG markup into the application document. Browser completion and API completion remain `human-review-required`.

## CLI

```powershell
# Inspect a static raster without creating output
pnpm vector:raster:inspect -- .\fixtures\mark.png

# Create a governed SVG, JSON evidence and visual-difference PNG
pnpm vector:trace -- `
  .\fixtures\mark.png `
  --out .\outputs\mark.vector.svg `
  --profile auto `
  --candidate-mode adaptive `
  --max-colours 16 `
  --diff-out .\outputs\mark.vector.difference.png `
  --difference-max-dimension 512 `
  --title "Brand mark"

# Inspect or conservatively optimise an existing SVG
pnpm vector:inspect -- .\fixtures\mark.svg
pnpm vector:optimise -- .\fixtures\mark.svg --out .\outputs\mark.optimised.svg

# Validate and apply a governed animated-SVG motion plan
pnpm vector:motion:validate -- .\fixtures\motion\gentle-entrance.motion.json
pnpm vector:animate-svg -- `
  .\fixtures\motion\gentle-entrance.source.svg `
  --motion .\fixtures\motion\gentle-entrance.motion.json `
  --out .\outputs\gentle-entrance.animated.svg `
  --evidence-out .\outputs\gentle-entrance.motion.evidence.json
pnpm vector:motion:inspect -- .\outputs\gentle-entrance.animated.svg

# Export and inspect governed Lottie JSON
pnpm vector:lottie:export -- `
  .\fixtures\motion\gentle-entrance.source.svg `
  --motion .\fixtures\motion\gentle-entrance.motion.json `
  --out .\outputs\gentle-entrance.lottie.json `
  --evidence-out .\outputs\gentle-entrance.lottie.evidence.json
pnpm vector:lottie:inspect -- .\outputs\gentle-entrance.lottie.json

# Print machine-readable contracts
pnpm vector:input-policy
pnpm vector:manifest
```

CLI output commands use atomic new-file-only transactions. Existing destinations, source/output collisions and multi-output collisions are rejected. See [`docs/CLI.md`](docs/CLI.md), [`docs/MOTION.md`](docs/MOTION.md) and [`docs/LOTTIE.md`](docs/LOTTIE.md) for the complete contracts.

## Local MCP automation

Build and start the local stdio MCP server with:

```powershell
$env:VECTOR_MCP_ALLOWED_ROOTS = "C:\GitRepos\evavo-vector-studio;C:\EVAVO\VectorAssets"
pnpm vector:mcp
```

MCP contract `1.1` exposes:

- `vector_capabilities`;
- `vector_input_policy`;
- `vector_inspect_raster`;
- `vector_trace_raster`;
- `vector_inspect_svg`;
- `vector_optimise_svg`;
- `vector_validate_motion_plan`;
- `vector_animate_svg`;
- `vector_inspect_animated_svg`.

MCP inputs must be existing regular files beneath a configured canonical root. Outputs use new-files-only semantics: existing destinations, path collisions and ordinary symlink escapes are rejected. Related outputs commit atomically and return path, MIME type, byte count and SHA-256 receipts instead of placing full SVG markup or binary PNG data into model context.

`vector_trace_raster` supports compact `summary` evidence and complete `full` evidence. Motion plans may be supplied inline or through an allowed-root JSON file. `vector_validate_motion_plan` can optionally save a normalized plan; `vector_animate_svg` can atomically write animated SVG plus evidence JSON.

Lottie is not yet exposed through MCP. All current tools remain `human-review-required`; successful execution records completion and evidence, not artistic approval. See [`docs/MCP.md`](docs/MCP.md) for the full tool, filesystem and motion contract.

## API

The authenticated API exposes:

- `POST /api/v1/trace` for static raster reconstruction, candidate evidence and optional difference PNG;
- `POST /api/v1/motion/svg` for validated animated SVG creation from an inline or uploaded motion v1 plan.

Both support JSON evidence or direct SVG delivery where the output contract permits it. In trace JSON mode, the optional base64 difference PNG is returned with its dimensions, byte count, SHA-256 and selected-candidate binding so clients can verify it before display. Production access is closed unless `VECTOR_API_TOKEN` is configured and supplied as a bearer token.

The motion endpoint limits one SVG to 5 MiB and one plan to 256 KiB, returns normalized plan and full evidence in JSON mode, and emits compact identity, hash, reduced-motion and review headers in direct SVG mode.

Lottie is not yet exposed through the HTTP API. See [`docs/API.md`](docs/API.md) for complete fields, limits, response shapes and error contracts.

## Quality model

A trace, animated SVG build or Lottie export can finish successfully while remaining `review-required`.

The tracing engine may choose a lower-complexity candidate only when it remains inside explicit visual-cost, mismatch and aspect-ratio tolerances relative to the best visual candidate. If every candidate requires review, the best measured visual result wins rather than sacrificing fidelity for smaller geometry.

Every trace retains:

- exact reconstruction settings;
- all attempted candidate outcomes;
- selected and best-visual candidate IDs;
- output bytes, paths, commands, subpaths and estimated anchors;
- IDs, local references, compound paths, open/closed subpaths and editability findings;
- multi-scale render metrics and thresholds;
- difference artefact dimensions, size, hash and selected-candidate binding when requested;
- warnings and timing evidence.

Every animated SVG build retains:

- normalized playback and easing settings;
- target IDs, track count and keyframe count;
- source and output hashes;
- deterministic motion/style identity;
- reduced-motion and script-free safety assertions;
- warnings and approval state.

Every Lottie export retains:

- source bytes, hash, viewBox and governed SVG inspection;
- normalized motion plan and static/animated layer counts;
- output bytes, hash, dimensions, frame rate, duration, layer and path counts;
- exact supported and unsupported subset;
- structural inspection evidence;
- `playerRenderValidation: not-yet-performed`;
- `dotLottiePackaging: not-yet-available`;
- warnings and approval state.

Pixel similarity, deterministic animation and structural Lottie validity cannot prove deliberate Bézier placement, compound-path quality, future editability, motion direction, player equivalence or brand fidelity. Production auto-approval therefore remains unavailable.

Detailed contracts:

- [`docs/QUALITY-EVIDENCE.md`](docs/QUALITY-EVIDENCE.md) explains source, reconstruction, topology, render, selection and approval evidence.
- [`docs/INPUT-SAFETY.md`](docs/INPUT-SAFETY.md) explains the one-static-image policy and pre-decode rejection rules.
- [`docs/MOTION.md`](docs/MOTION.md) defines the animated SVG v1 plan, Motion Director and review boundary.
- [`docs/LOTTIE.md`](docs/LOTTIE.md) defines the Lottie source subset, motion subset, structural inspection and compatibility boundary.
- [`docs/MCP.md`](docs/MCP.md) defines the local agent tool and filesystem contract.
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) defines runtime boundaries and the path toward durable workers.

## Repository layout

```text
apps/web                  Next.js trace workspace, Motion Director and authenticated APIs
packages/vector-core      shared job, SVG safety, geometry and topology contracts
packages/raster-engine    guarded decoding, analysis, tracing, comparison and difference evidence
packages/motion-engine    validated deterministic animated SVG production
packages/lottie-engine    governed path-based Lottie JSON generation and structural inspection
packages/cli              JSON-first tracing, optimisation, motion and Lottie automation
packages/mcp              local stdio tracing, SVG and motion tools with allowed-root policies
schemas                   machine-readable governed production contracts
fixtures                  deterministic raster, SVG, motion and Lottie validation inputs
scripts                   dependency-free release, topology, browser, MCP, motion, Lottie, API and workspace gates
docs                      architecture, CLI, API, MCP, motion, Lottie, quality, input safety and hub records
```

## Deployment boundary

The EVAVO website hub integration remains a signed federated candidate. This repository does not mark itself client-released until its deployment, authentication, runtime limits and live smoke evidence are verified.

The current APIs are bounded synchronous surfaces, not durable queues. Persistent jobs, resumability, object storage, worker retries and signed hub handoff belong in the next deployment phase. The local stdio MCP server is also synchronous and bounded; it does not claim durable background execution.

## Philosophy

Preserve source intent. Reconstruct deliberate geometry. Minimise unnecessary anchors. Keep outputs editable. Direct motion intentionally. Translate formats explicitly. Record material decisions. Reject unsafe or misleading results instead of silently producing something different.
