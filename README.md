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
- optional audited white-to-red visual-difference heatmap PNGs with bounded dimensions and SHA-256 evidence;
- browser-side verification of returned PNG bytes, signature, dimensions, selected candidate and SHA-256;
- responsive browser review for source, selected SVG, difference image, topology, candidates, metrics and downloads;
- authenticated multipart APIs for bounded synchronous tracing, animated SVG, Lottie JSON and dotLottie v2 creation;
- JSON-first CLI suitable for people, ChatGPT, Claude and workers;
- deterministic, script-free animated SVG generation from validated ID-targeted motion plans;
- opacity, translation, scale and rotation keyframes with easing and mandatory reduced-motion fallback;
- motion-plan JSON Schema, normalized-plan validation, animated-SVG inspection and SHA-256 evidence;
- responsive browser Motion Director with source screening, target discovery, presets, tracks, keyframes, playback controls, replay and verified downloads;
- browser verification of source/output SHA-256, motion identity, style identity, target order, reduced-motion fallback and script-free evidence;
- governed path-based Lottie JSON engine with SVG command conversion, source-order preservation, solid fill and stroke support, layer-transform motion and structural inspection;
- Lottie CLI export and inspection with atomic new-file-only output, SHA-256 evidence and explicit player-compatibility non-claims;
- authenticated Lottie HTTP API with strict fields, bounded inputs and outputs, exact serialized JSON delivery and compact evidence headers;
- browser Lottie player preview through the official LottieFiles React player after exact JSON, source hash, output hash and structural evidence verification;
- reduced-motion-aware Lottie autoplay suppression, stale-result signalling, replay controls and separate JSON and evidence downloads;
- deterministic dotLottie v2 packaging with fixed ZIP metadata, DEFLATE compression, strict manifest layout and SHA-256 evidence;
- hostile-archive inspection for traversal, duplicates, ZIP64, encryption, entry overlap, unsupported semantics and oversized declared content;
- atomic new-file-only `evavo-dotlottie` CLI packaging and inspection with optional evidence output;
- authenticated dotLottie API with direct archive delivery or bounded base64 wrapper evidence;
- local stdio MCP contract 1.2 with eleven governed raster, SVG, motion and Lottie tools;
- receipt-only Lottie MCP export and inspection with canonical allowed-root access, no-overwrite transactions and no generated JSON body in model context;
- tests for format, decompression-bomb, multi-image, topology, candidate-selection, alpha-comparison, PNG, motion, Lottie geometry, Lottie structural output, dotLottie determinism, hostile ZIPs, MCP SDK, path-policy and transaction boundaries;
- dependency-free contract gates plus the GitHub Actions quality workflow.

Animated SVG production is available through the browser Motion Director, core motion package, HTTP API, CLI and MCP.

Governed Lottie JSON export and inspection are available through the core Lottie package, CLI and HTTP API. MCP and browser review use the same governed Lottie contract.

Deterministic dotLottie packaging and inspection are available through the core package, CLI and `POST /api/v1/motion/dotlottie`. MCP archive tools and browser archive-load validation remain unavailable. Independent player-render and browser archive-load validation also remain unavailable.

All execution surfaces remain `human-review-required`. Successful processing and verification do not grant artistic, brand, accessibility or player-equivalence approval.

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
http://localhost:3000/motion   browser Motion Director and Lottie review
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

White regions in the visual-difference heatmap are measured matches. Red regions mark visual difference using a declared display amplification. The heatmap is review evidence, not a substitute for inspecting curves, compound paths, negative space and brand geometry.

### Motion Director

Open `/motion` to author motion against a governed, ID-structured SVG. The browser Motion Director can:

1. screen the SVG for scripts, external references, duplicate IDs and pre-existing animation before preview;
2. discover portable target IDs and flag base transforms;
3. add multiple target tracks;
4. apply fade, rise, slide, soft-pop, rotate-settle and drift-loop presets;
5. edit offsets, opacity, translation, scale, rotation, easing, transform box and transform origin;
6. control duration, delay, iteration, direction, fill mode and reduced-motion strategy;
7. generate through `POST /api/v1/motion/svg`;
8. verify source/output SHA-256, motion/style identity, target order, reduced-motion fallback and script-free evidence before display;
9. replay and download the animated SVG, normalized motion plan and evidence record;
10. mark the displayed result stale when the editor changes after generation;
11. preflight the smaller Lottie playback subset and generate through `POST /api/v1/motion/lottie`;
12. verify exact Lottie JSON bytes, SHA-256, parsed metadata, layers, structural inspection and compatibility non-claims;
13. load only verified JSON into the official client-only LottieFiles player, with autoplay and looping disabled when reduced motion is preferred;
14. download Lottie JSON and a separate browser evidence record without embedding duplicate animation data.

The animated-SVG editor uses Blob-backed `<img>` previews rather than injecting returned SVG markup into the application document. The Lottie preview uses `@lottiefiles/dotlottie-react` with the exact verified JSON string. Neither preview grants approval: the Lottie player surface is a delivery-context check, not independent source-to-player validation.

Browser dotLottie archive generation and archive-load validation are not yet exposed.

## CLI

```powershell
# Inspect a static raster without creating output
pnpm vector:raster:inspect -- .\fixtures\mark.png

# Create a governed SVG and optional difference PNG
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

# Package and inspect deterministic dotLottie v2
pnpm vector:dotlottie:package -- `
  .\outputs\gentle-entrance.lottie.json `
  --out .\outputs\gentle-entrance.lottie `
  --animation-id gentle-entrance `
  --evidence-out .\outputs\gentle-entrance.dotlottie.evidence.json
pnpm vector:dotlottie:inspect -- .\outputs\gentle-entrance.lottie
pnpm vector:dotlottie:capabilities

# Print machine-readable contracts
pnpm vector:input-policy
pnpm vector:manifest
```

CLI output commands use atomic new-file-only transactions. Existing destinations, source/output collisions and multi-output collisions are rejected. See [`docs/CLI.md`](docs/CLI.md), [`docs/MOTION.md`](docs/MOTION.md), [`docs/LOTTIE.md`](docs/LOTTIE.md) and [`docs/DOTLOTTIE.md`](docs/DOTLOTTIE.md).

## Local MCP automation

Build and start the local stdio server with:

```powershell
$env:VECTOR_MCP_ALLOWED_ROOTS = "C:\GitRepos\evavo-vector-studio;C:\EVAVO\VectorAssets"
pnpm vector:mcp
```

MCP contract `1.2` exposes:

- `vector_capabilities`;
- `vector_input_policy`;
- `vector_inspect_raster`;
- `vector_trace_raster`;
- `vector_inspect_svg`;
- `vector_optimise_svg`;
- `vector_validate_motion_plan`;
- `vector_animate_svg`;
- `vector_inspect_animated_svg`;
- `vector_export_lottie`;
- `vector_inspect_lottie`.

MCP inputs must be existing regular files beneath a configured canonical root. Outputs use new-files-only semantics: existing destinations, path collisions and ordinary symlink escapes are rejected. Related outputs commit atomically and return path, MIME type, byte count and SHA-256 receipts instead of complete generated bodies.

`vector_trace_raster` supports compact `summary` and complete `full` evidence. Motion and Lottie plans may be supplied inline or through allowed-root JSON files. `vector_export_lottie` creates Lottie JSON and optional evidence atomically; `vector_inspect_lottie` checks the committed result. The Lottie MCP contract never places generated Lottie JSON into model context.

MCP dotLottie archive packaging is not yet exposed. Every MCP operation remains `human-review-required`; successful execution records completion and evidence, not artistic or player approval. See [`docs/MCP.md`](docs/MCP.md).

## API

The authenticated API exposes:

- `POST /api/v1/trace` for static raster reconstruction, candidate evidence and optional base64 difference PNG;
- `POST /api/v1/motion/svg` for validated animated SVG creation from an inline or uploaded motion-v1 plan;
- `POST /api/v1/motion/lottie` for governed path-based Lottie JSON from the same validated motion plan;
- `POST /api/v1/motion/dotlottie` for deterministic dotLottie v2 packaging from the same SVG and motion inputs.

All endpoints use strict bounded synchronous execution and no-store responses. Production access is closed unless `VECTOR_API_TOKEN` is configured and supplied as a bearer token.

The Lottie endpoint accepts one SVG up to 5 MiB and one plan up to 256 KiB, limits the generated body to 20 MiB, and supports wrapper JSON evidence or direct `video/lottie+json` delivery. Its operation-level evidence preserves `playerRenderValidation: not-yet-performed` because source-to-player equivalence is not measured.

The dotLottie API uses the same source and plan limits, creates deterministic manifest-v2 archives up to 25 MiB, supports direct `application/zip+dotlottie` delivery, and permits wrapper base64 only through 8 MiB. Its evidence retains archive, embedded-Lottie, player-render and browser archive-load states separately.

See [`docs/API.md`](docs/API.md) for complete fields, limits, response shapes and error contracts.

## Quality model

A trace, animated SVG build, Lottie JSON export or dotLottie package can finish successfully while remaining `review-required`.

The tracing engine may choose a lower-complexity candidate only when it remains inside explicit visual-cost, mismatch and aspect-ratio tolerances relative to the best visual candidate. If every candidate requires review, the best measured visual result wins rather than sacrificing fidelity for smaller geometry.

Every trace retains exact settings, attempted candidates, selected and best-visual IDs, geometry and topology counts, multi-scale render metrics, difference artefact evidence, warnings and timings. Animated SVG retains normalized playback, target and keyframe counts, hashes, deterministic identity, reduced-motion and script-free safety evidence. Lottie retains source and output hashes, normalized motion, dimensions, frame rate, layer and path counts, structural inspection and exact compatibility non-claims.

Every dotLottie package retains source and embedded JSON hashes, exact manifest, archive hash, entry order, compressed and uncompressed byte totals, deterministic ZIP policy, archive inspection, embedded-Lottie inspection and player/browser validation non-claims.

A base64 difference PNG, deterministic CSS animation, structurally valid Lottie file, deterministic dotLottie archive or successful browser player load cannot prove deliberate Bézier placement, compound-path quality, future editability, motion direction, player equivalence or brand fidelity. Production auto-approval therefore remains unavailable.

Detailed contracts:

- [`docs/QUALITY-EVIDENCE.md`](docs/QUALITY-EVIDENCE.md)
- [`docs/INPUT-SAFETY.md`](docs/INPUT-SAFETY.md)
- [`docs/MOTION.md`](docs/MOTION.md)
- [`docs/LOTTIE.md`](docs/LOTTIE.md)
- [`docs/DOTLOTTIE.md`](docs/DOTLOTTIE.md)
- [`docs/MCP.md`](docs/MCP.md)
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)

## Repository layout

```text
apps/web                  Next.js trace workspace, Motion Director, Lottie review and authenticated SVG/Lottie/dotLottie APIs
packages/vector-core      shared job, SVG safety, geometry and topology contracts
packages/raster-engine    guarded decoding, analysis, tracing, comparison and difference evidence
packages/motion-engine    validated deterministic animated SVG production
packages/lottie-engine    governed Lottie JSON plus deterministic dotLottie packaging and inspection
packages/cli              JSON-first tracing, optimisation, motion, Lottie and dotLottie automation
packages/mcp              local stdio tracing, SVG, motion and Lottie tools with allowed-root policies
schemas                   machine-readable governed production contracts
fixtures                  deterministic raster, SVG, motion, Lottie and archive validation inputs
scripts                   dependency-free release, topology, browser, MCP, motion, Lottie, dotLottie, API and workspace gates
docs                      architecture and production contracts
```

## Deployment boundary

The EVAVO website hub integration remains a signed federated candidate. This repository does not mark itself client-released until deployment, authentication, runtime limits and live smoke evidence are verified.

The current APIs are bounded synchronous surfaces, not durable queues. Persistent jobs, resumability, object storage, worker retries and signed hub handoff belong in a later deployment phase. The local stdio MCP server is also synchronous and bounded; it does not claim durable background execution.

## Philosophy

Preserve source intent. Reconstruct deliberate geometry. Minimise unnecessary anchors. Keep outputs editable. Direct motion intentionally. Translate formats explicitly. Record material decisions. Reject unsafe or misleading results instead of silently producing something different.
