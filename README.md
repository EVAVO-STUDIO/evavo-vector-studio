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
- authenticated multipart API for bounded synchronous execution;
- JSON-first CLI suitable for people, ChatGPT, Claude and workers;
- deterministic, script-free animated SVG generation from validated ID-targeted motion plans;
- opacity, translation, scale and rotation keyframes with easing and mandatory reduced-motion fallback;
- motion-plan JSON Schema, normalized-plan validation, animated-SVG inspection and SHA-256 evidence;
- atomic new-file-only CLI transactions for optimised, traced and animated outputs;
- local stdio MCP server with six governed tracing and SVG tools for ChatGPT-compatible MCP hosts, Claude, editors and agent runtimes;
- canonical allowed-root access, new-files-only output, atomic multi-file commit and SHA-256 file receipts for MCP operations;
- tests for format, decompression-bomb, multi-image, topology, candidate-selection, alpha-comparison, PNG, motion, MCP path-policy and transaction boundaries;
- dependency-free contract gates plus the GitHub Actions quality workflow source.

Animated SVG production is available through the core motion package and CLI. The browser timeline/editor, motion API and MCP motion tool remain to be implemented. Lottie and dotLottie export remain unavailable until a separate validated renderer-compatibility contract exists.

## Quick start on Windows PowerShell

```powershell
Set-Location C:\GitRepos\evavo-vector-studio
git pull origin main
corepack enable
pnpm install
pnpm check
pnpm dev
```

Open `http://localhost:3000` for the tracing and evidence workspace.

For a protected production deployment, set a long server-only `VECTOR_API_TOKEN`. The browser accepts it per tab and does not require a public environment variable.

## Browser workflow

The current browser workspace can:

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

Motion authoring is currently CLI-first. The browser does not yet claim a working timeline editor.

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

# Print machine-readable contracts
pnpm vector:input-policy
pnpm vector:manifest
```

CLI output commands use atomic new-file-only transactions. Existing destinations, source/output collisions and multi-output collisions are rejected. See [`docs/CLI.md`](docs/CLI.md) and [`docs/MOTION.md`](docs/MOTION.md) for the complete contracts.

## Local MCP automation

Build and start the local stdio MCP server with:

```powershell
$env:VECTOR_MCP_ALLOWED_ROOTS = "C:\GitRepos\evavo-vector-studio;C:\EVAVO\VectorAssets"
pnpm vector:mcp
```

The server currently exposes:

- `vector_capabilities`;
- `vector_input_policy`;
- `vector_inspect_raster`;
- `vector_trace_raster`;
- `vector_inspect_svg`;
- `vector_optimise_svg`.

MCP inputs must be existing regular files beneath a configured canonical root. Outputs use new-files-only semantics: existing destinations, path collisions and ordinary symlink escapes are rejected. A trace writes its SVG and optional difference PNG through one no-overwrite transaction, then returns path, MIME type, byte count and SHA-256 receipts instead of placing full SVG markup or binary PNG data into model context.

`vector_trace_raster` supports compact `summary` evidence and complete `full` evidence. Both remain `human-review-required`; a successful tool call records completion and evidence, not artistic approval.

Animated SVG creation is not yet exposed as an MCP tool. See [`docs/MCP.md`](docs/MCP.md) for the current tool boundary.

## API

`POST /api/v1/trace` accepts `multipart/form-data` and returns either:

- JSON containing the SVG, inspection, topology, candidate evidence and optional base64 difference PNG; or
- a direct SVG response when no separate difference artefact is requested.

Production access is closed unless `VECTOR_API_TOKEN` is configured and supplied as a bearer token. Motion authoring is not yet exposed through the API. See [`docs/API.md`](docs/API.md) for the current tracing contract.

## Quality model

A trace or motion build can finish successfully while remaining `review-required`.

The tracing engine may choose a lower-complexity candidate only when it remains inside explicit visual-cost, mismatch and aspect-ratio tolerances relative to the best visual candidate. If every candidate requires review, the best measured visual candidate wins rather than sacrificing fidelity for smaller geometry.

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

Pixel similarity and deterministic animation cannot prove deliberate Bézier placement, compound-path quality, future editability, motion direction or brand fidelity. Production auto-approval therefore remains unavailable.

Detailed contracts:

- [`docs/QUALITY-EVIDENCE.md`](docs/QUALITY-EVIDENCE.md) explains source, reconstruction, topology, render, selection and approval evidence.
- [`docs/INPUT-SAFETY.md`](docs/INPUT-SAFETY.md) explains the one-static-image policy and pre-decode rejection rules.
- [`docs/MOTION.md`](docs/MOTION.md) defines the animated SVG v1 plan and review boundary.
- [`docs/MCP.md`](docs/MCP.md) defines the local agent tool and filesystem contract.
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) defines runtime boundaries and the path toward durable workers.

## Repository layout

```text
apps/web                  Next.js tracing, evidence UI and authenticated tracing API
packages/vector-core      shared job, SVG safety, geometry and topology contracts
packages/raster-engine    guarded decoding, analysis, tracing, comparison and difference evidence
packages/motion-engine    validated deterministic animated SVG production
packages/cli              JSON-first tracing, optimisation and motion automation
packages/mcp              local stdio tracing and SVG tools with allowed-root policies
schemas                   machine-readable governed production contracts
fixtures                  deterministic raster, SVG and motion validation inputs
scripts                   dependency-free release, topology, browser, MCP and motion gates
docs                      architecture, CLI, API, MCP, motion, quality, input safety and hub records
```

## Deployment boundary

The EVAVO website hub integration remains a signed federated candidate. This repository does not mark itself client-released until its deployment, authentication, runtime limits and live smoke evidence are verified.

The current API is a bounded synchronous tracing surface, not a durable queue. Persistent jobs, resumability, object storage, worker retries and signed hub handoff belong in the next deployment phase. The local stdio MCP server is also synchronous and bounded; it does not claim durable background execution.

## Philosophy

Preserve source intent. Reconstruct deliberate geometry. Minimise unnecessary anchors. Keep outputs editable. Direct motion intentionally. Record material decisions. Reject unsafe or misleading results instead of silently producing something different.
