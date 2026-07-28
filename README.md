# EVAVO Vector Studio

EVAVO Vector Studio is a governed raster-to-vector production workspace. It is being built to turn logos, icons, line art, illustrations and selected photographic sources into editable SVG assets through inspectable geometry and evidence, rather than treating one-click tracing as proof of quality.

## Operational now

- guarded PNG, JPEG, WebP, GIF, BMP and classic TIFF preflight;
- 25 MiB encoded-input and 40 million decoded-pixel limits;
- native RGBA decoding and spline-based raster tracing;
- source SHA-256, alpha, palette, tonal, entropy and edge analysis;
- automatic or explicit logo, icon, line-art, illustration and photo profiles;
- bounded base, fidelity and economy candidate generation;
- adaptive visual-first selection with explicit pixel budgets, tolerances and cost weights;
- single-candidate mode for minimum-runtime deterministic execution;
- safe multipass SVG optimisation;
- independent SVG active-content, external-reference, embedded-raster and structure inspection;
- path-command, subpath, curve, straight-segment and estimated-anchor evidence;
- alpha-aware source-versus-SVG rendering at up to 64, 256 and 1024 pixels;
- visual MAE, RMS error, alpha error, black/white composite error, mismatch fraction and aspect-ratio evidence;
- responsive browser workspace with local source preview, tracing controls, candidate review, safe output preview and SVG download;
- authenticated multipart API for synchronous bounded execution;
- JSON-first CLI suitable for people, ChatGPT, Claude and workers;
- path-count, anchor-count, output-size, visual-match and review warnings;
- tests for format, decompression-bomb, SVG security, geometry accounting, alpha-aware comparison and candidate-selection boundaries;
- GitHub Actions quality workflow.

Animated SVG and Lottie production remain planned capabilities. They are shown as planned in the interface and are not claimed as implemented.

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

## CLI

```powershell
# Inspect a raster without creating output
pnpm vector:raster:inspect -- .\fixtures\mark.png

# Create, compare and select a governed SVG with JSON evidence
pnpm vector:trace -- `
  .\fixtures\mark.png `
  --out .\outputs\mark.vector.svg `
  --profile auto `
  --candidate-mode adaptive `
  --max-colours 16 `
  --title "Brand mark"

# Inspect or conservatively optimise an existing SVG
pnpm vector:inspect -- .\fixtures\mark.svg
pnpm vector:optimise -- .\fixtures\mark.svg --out .\outputs\mark.optimised.svg

# Print the machine-readable automation contract
pnpm vector:manifest
```

See [`docs/CLI.md`](docs/CLI.md) for candidate policy, visual evidence, geometry evidence and exit codes.

## API

`POST /api/v1/trace` accepts `multipart/form-data` and returns either JSON evidence plus the selected SVG or a direct SVG download. Production access is closed unless `VECTOR_API_TOKEN` is configured and supplied as a bearer token.

See [`docs/API.md`](docs/API.md) for the complete adaptive execution contract and PowerShell examples.

## Repository layout

```text
apps/web                  Next.js studio UI and API
packages/vector-core      shared job, pipeline, SVG safety and geometry contracts
packages/raster-engine    guarded decoding, analysis, candidate tracing, comparison and selection
packages/cli              JSON-first local and agent automation surface
docs                      architecture, CLI, API and hub-integration records
```

The EVAVO website hub integration remains a signed federated candidate. This repository does not mark itself client-released until deployment, authentication and live smoke evidence exist.

## Quality boundary

A structurally valid SVG can still be a poor reconstruction. Vector Studio therefore rasterises every completed candidate at multiple bounded scales and compares it against the decoded source using alpha-aware black and white compositing. The engine is visual-first: when every candidate is weak, the best visual result wins. When candidates meet the same quality class, the engine may choose a more editable result only when it remains inside the declared visual tolerances.

The selected evidence includes the full visual and geometry formulas, estimated anchors, paths, commands, bytes, every completed or failed candidate and the exact reason for selection. These measurements remain evidence, not an unexplained quality score.

Visual similarity still cannot prove deliberate Bézier placement, compound-path quality, negative-space construction, editability or brand fidelity. Production approval remains human review-gated even when the measured comparison is `excellent`.

The next quality milestones are difference-image artefacts, topology and winding validation, stronger curve-economy diagnostics, synthetic visual regression fixtures, governed repair passes and then the animated SVG and Lottie authoring layers.

## Philosophy

Preserve source intent. Reconstruct deliberate geometry. Minimise unnecessary anchors. Keep outputs editable. Record every material decision. Reject unsafe or misleading results instead of silently producing something different.
