# EVAVO Vector Studio

EVAVO Vector Studio is a governed raster-to-vector production workspace. It is being built to turn logos, icons, line art, illustrations and selected photographic sources into editable SVG assets through inspectable geometry and evidence, rather than treating one-click tracing as proof of quality.

## Operational now

- guarded PNG, JPEG, WebP, GIF, BMP and classic TIFF preflight;
- 25 MiB encoded-input and 40 million decoded-pixel limits;
- native RGBA decoding and spline-based raster tracing;
- source SHA-256, alpha, palette, tonal, entropy and edge analysis;
- automatic or explicit logo, icon, line-art, illustration and photo profiles;
- safe multipass SVG optimisation;
- independent SVG script, `foreignObject`, embedded-raster and structure inspection;
- alpha-aware source-versus-SVG rendering at up to 64, 256 and 1024 pixels;
- visual MAE, RMS error, alpha error, black/white composite error, mismatch fraction and aspect-ratio evidence;
- responsive browser workspace with local source preview, trace controls, evidence, safe output preview and SVG download;
- authenticated multipart API for synchronous bounded execution;
- JSON-first CLI suitable for people, ChatGPT, Claude and workers;
- path-count, output-size, visual-match and review warnings;
- tests for format, decompression-bomb and alpha-aware comparison boundaries;
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

# Create a governed SVG and JSON evidence
pnpm vector:trace -- `
  .\fixtures\mark.png `
  --out .\outputs\mark.vector.svg `
  --profile auto `
  --max-colours 16 `
  --title "Brand mark"

# Inspect or conservatively optimise an existing SVG
pnpm vector:inspect -- .\fixtures\mark.svg
pnpm vector:optimise -- .\fixtures\mark.svg --out .\outputs\mark.optimised.svg

# Print the machine-readable automation contract
pnpm vector:manifest
```

See [`docs/CLI.md`](docs/CLI.md) for options, visual evidence and exit codes.

## API

`POST /api/v1/trace` accepts `multipart/form-data` and returns either JSON evidence plus SVG or a direct SVG download. Production access is closed unless `VECTOR_API_TOKEN` is configured and supplied as a bearer token.

See [`docs/API.md`](docs/API.md) for the complete contract and PowerShell examples.

## Repository layout

```text
apps/web                  Next.js studio UI and API
packages/vector-core      shared job, pipeline and SVG safety contracts
packages/raster-engine    guarded decoding, analysis, tracing and render comparison
packages/cli              JSON-first local and agent automation surface
docs                      architecture, CLI, API and hub-integration records
```

The EVAVO website hub integration remains a signed federated candidate. This repository does not mark itself client-released until deployment, authentication and live smoke evidence exist.

## Quality boundary

A structurally valid SVG can still be a poor reconstruction. Vector Studio therefore rasterises every generated SVG at multiple bounded scales and compares it against the decoded source using alpha-aware black and white compositing. The full metrics and thresholds are included in the evidence instead of being collapsed into an unexplained score.

Visual similarity still cannot prove deliberate Bézier placement, compound-path quality, negative-space construction, editability or brand fidelity. Production approval remains human review-gated even when the measured comparison is `excellent`.

The next quality milestone is governed multi-candidate tracing that chooses the best measured balance of visual fidelity and geometric economy, followed by topology and anchor-economy analysis, difference-image artefacts and visual regression fixtures.

## Philosophy

Preserve source intent. Reconstruct deliberate geometry. Minimise unnecessary anchors. Keep outputs editable. Record every material decision. Reject unsafe or misleading results instead of silently producing something different.
