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
- tests for format, decompression-bomb, multi-image, topology, candidate-selection, alpha-comparison and PNG boundaries;
- dependency-free contract gates plus the GitHub Actions quality workflow source.

Animated SVG and Lottie production remain planned. The interface describes those intended outputs without claiming that timeline authoring or Lottie export is implemented.

## Quick start on Windows PowerShell

```powershell
Set-Location C:\GitRepos\evavo-vector-studio
git pull origin main
corepack enable
pnpm install
pnpm check
pnpm dev
```

Open `http://localhost:3000` for the studio workspace.

For a protected production deployment, set a long server-only `VECTOR_API_TOKEN`. The browser accepts it per tab and does not require a public environment variable.

## Browser workflow

The workspace can:

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

# Print the machine-readable automation contract
pnpm vector:manifest
```

The CLI refuses to overwrite its source, rejects SVG/difference output collisions and will not silently ignore a requested difference artefact. See [`docs/CLI.md`](docs/CLI.md) for the complete contract.

## API

`POST /api/v1/trace` accepts `multipart/form-data` and returns either:

- JSON containing the SVG, inspection, topology, candidate evidence and optional base64 difference PNG; or
- a direct SVG response when no separate difference artefact is requested.

Production access is closed unless `VECTOR_API_TOKEN` is configured and supplied as a bearer token. See [`docs/API.md`](docs/API.md) for fields, limits, response shapes and PowerShell examples.

## Quality model

A trace can finish successfully while remaining `review-required`.

The engine may choose a lower-complexity candidate only when it remains inside explicit visual-cost, mismatch and aspect-ratio tolerances relative to the best visual candidate. If every candidate requires review, the best measured visual candidate wins rather than sacrificing fidelity for smaller geometry.

Every trace retains:

- exact reconstruction settings;
- all attempted candidate outcomes;
- selected and best-visual candidate IDs;
- output bytes, paths, commands, subpaths and estimated anchors;
- IDs, local references, compound paths, open/closed subpaths and editability findings;
- multi-scale render metrics and thresholds;
- difference artefact dimensions, size, hash and selected-candidate binding when requested;
- warnings and timing evidence.

Pixel similarity cannot prove deliberate Bézier placement, compound-path quality, future editability or brand fidelity. Production auto-approval therefore remains unavailable.

Detailed contracts:

- [`docs/QUALITY-EVIDENCE.md`](docs/QUALITY-EVIDENCE.md) explains source, reconstruction, topology, render, selection and approval evidence.
- [`docs/INPUT-SAFETY.md`](docs/INPUT-SAFETY.md) explains the one-static-image policy and pre-decode rejection rules.
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) defines runtime boundaries and the path toward durable workers.

## Repository layout

```text
apps/web                  Next.js studio UI and authenticated API
packages/vector-core      shared job, SVG safety, geometry and topology contracts
packages/raster-engine    guarded decoding, analysis, tracing, comparison and difference evidence
packages/cli              JSON-first local and agent automation surface
scripts                   dependency-free release and topology contract gates
docs                      architecture, CLI, API, quality, input safety and hub-integration records
```

## Deployment boundary

The EVAVO website hub integration remains a signed federated candidate. This repository does not mark itself client-released until its deployment, authentication, runtime limits and live smoke evidence are verified.

The current API is a bounded synchronous surface, not a durable queue. Persistent jobs, resumability, object storage, worker retries and signed hub handoff belong in the next deployment phase.

## Philosophy

Preserve source intent. Reconstruct deliberate geometry. Minimise unnecessary anchors. Keep outputs editable. Record material decisions. Reject unsafe or misleading results instead of silently producing something different.
