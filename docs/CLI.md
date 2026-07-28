# EVAVO Vector Studio CLI

The CLI is designed for bounded local use by people, ChatGPT, Claude and other automation clients. Operational commands print JSON to stdout, write errors to stderr and never overwrite the source file by default.

## Setup

```powershell
Set-Location C:\GitRepos\evavo-vector-studio
git pull origin main
corepack enable
pnpm install
pnpm check
```

## Inspect a raster before tracing

```powershell
pnpm vector:raster:inspect -- .\fixtures\mark.png
```

The report includes the detected format and dimensions, SHA-256 source hash, sampled palette complexity, dominant colours, alpha coverage, tonal range, edge density, a suggested trace profile and review warnings.

## Trace a raster into SVG

```powershell
pnpm vector:trace -- `
  .\fixtures\mark.png `
  --out .\outputs\mark.vector.svg `
  --profile auto `
  --max-colours 16 `
  --preserve-palette `
  --title "Brand mark"
```

Supported profiles are `auto`, `logo`, `icon`, `line-art`, `illustration` and `photo`. Use `--simplify-palette` instead of `--preserve-palette` when a smaller interpreted palette is appropriate. Use `--no-optimise` only for diagnostic comparison.

Every successful trace now rasterises the SVG at up to three bounded scales: 64, 256 and 1024 pixels on the longest edge, capped by the source size. The JSON evidence includes alpha-aware visual mean absolute error, black- and white-composite error, alpha error, root-mean-square error, mismatch fraction and aspect-ratio drift for each scale and in aggregate.

## Inspect and optimise existing SVG

```powershell
pnpm vector:inspect -- .\fixtures\logo.svg
pnpm vector:optimise -- .\fixtures\logo.svg --out .\outputs\logo.optimised.svg
pnpm vector:manifest
```

## Exit codes

- `0`: command completed and its declared output was produced.
- `1`: invocation, file-system or unexpected runtime failure.
- `2`: governed input rejection, unsafe SVG, invalid option, tracing rejection or render-comparison failure.

A trace can exit successfully while still reporting `renderComparison: review-required`. This is intentional: the SVG was produced and measured, but the evidence did not meet the bounded `good` threshold or still requires artistic judgement.

## Guardrails

Raster input is rejected before native decoding when it is empty, larger than 25 MiB, unsupported, structurally malformed or declares more than 40 million decoded pixels. PNG, JPEG, WebP, GIF, BMP and classic TIFF headers are inspected. Decoded output must match the guarded dimensions and contain one complete RGBA buffer.

Generated SVG is passed through the native safe optimiser and then through Vector Studio's independent SVG safety inspection. Scripts and `foreignObject` remain prohibited. The CLI records output bytes, paths, groups, gradients, profile settings, timings, comparison thresholds and warnings.

The render comparison uses transparent RGBA pixels and checks both black and white compositing so hidden RGB values in transparent areas do not create false mismatches. System fonts are disabled during rendering because traced assets should not depend on machine-specific font discovery.

## Approval boundary

Multi-scale visual evidence is operational, but production auto-approval remains intentionally unavailable. A strong pixel match cannot prove that anchor placement, compound paths, negative space, layering, brand geometry or future editability are professionally correct. Every trace therefore reports `productionApproval: review-required`, even when the render comparison passes.
