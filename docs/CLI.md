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

## Discover the input policy

Before selecting files, people and agents can inspect the exact static-input contract:

```powershell
pnpm vector:input-policy
```

The JSON response declares:

- policy mode `one-static-image-per-trace`;
- accepted static PNG, ordinary JPEG, static WebP, single-frame GIF, BMP and single-page classic TIFF classes;
- pre-decode rejection of multi-frame APNG, animated GIF, animated WebP, JPEG MPO, multi-page TIFF and BigTIFF;
- the default 25 MiB encoded-input and 40 million decoded-pixel limits;
- rejection code `RASTER_MULTI_IMAGE_UNSUPPORTED`.

This command performs no file access and is safe for capability discovery by ChatGPT, Claude, workers and scripts.

## Inspect a raster before tracing

```powershell
pnpm vector:raster:inspect -- .\fixtures\mark.png
```

The report includes the active input policy, detected format and dimensions, SHA-256 source hash, sampled palette complexity, dominant colours, alpha coverage, tonal range, edge density, a suggested trace profile and review warnings.

Animated and multi-page inputs are rejected before native decoding rather than silently flattening to a first frame or page.

## Trace a raster into SVG

```powershell
pnpm vector:trace -- `
  .\fixtures\mark.png `
  --out .\outputs\mark.vector.svg `
  --profile auto `
  --candidate-mode adaptive `
  --max-colours 16 `
  --preserve-palette `
  --diff-out .\outputs\mark.vector.difference.png `
  --difference-max-dimension 512 `
  --title "Brand mark"
```

Supported profiles are `auto`, `logo`, `icon`, `line-art`, `illustration` and `photo`. Use `--simplify-palette` instead of `--preserve-palette` when a smaller interpreted palette is appropriate. Use `--no-optimise` only for diagnostic comparison.

### Candidate policy

`--candidate-mode adaptive` is the professional default. It creates bounded base, fidelity and economy candidates when the source size permits, measures each completed candidate and selects the lowest geometry cost that remains inside the visual tolerance of the best measured result.

Use `--candidate-mode single` when minimum runtime and one base configuration are more important than adaptive comparison.

Adaptive work is capped by decoded source size:

- up to 4,000,000 pixels: at most three candidates;
- 4,000,001 to 12,000,000 pixels: at most two candidates;
- larger sources: one candidate only.

Photo-profile work uses fewer candidates because high-colour reconstruction is already expensive. Failed alternatives are recorded without discarding a valid base result.

### Visual comparison evidence

Every completed candidate is rasterised at up to three bounded scales: 64, 256 and 1024 pixels on the longest edge, capped by the source size.

The evidence includes:

- alpha-aware visual mean absolute error;
- black- and white-composite error;
- premultiplied RGB and alpha error;
- root-mean-square visual error;
- mismatch fraction;
- aspect-ratio drift;
- exact `excellent`, `good` and `review` thresholds.

The selected result also records all candidate scores, eligible candidate IDs, exact tolerances and the complete visual and geometry cost model.

## Difference PNG artefacts

Add `--diff-out <path>` to request a separate audited white-to-red PNG heatmap for the selected candidate.

```powershell
pnpm vector:trace -- `
  .\fixtures\mark.png `
  --out .\outputs\mark.svg `
  --diff-out .\outputs\mark.difference.png
```

The default longest-edge limit is 512 pixels. Override it with an integer from 32 to 1024:

```powershell
--difference-max-dimension 768
```

`--difference-max-dimension` is rejected unless `--diff-out` is also present. The CLI also rejects:

- source and SVG output collisions;
- source and difference-output collisions;
- SVG and difference-output collisions;
- a requested difference path when the engine did not return PNG bytes.

The heatmap evidence includes dimensions, bytes, SHA-256, selected candidate ID, source sampling method, colour map and display amplification. White indicates measured agreement. Red indicates visual difference. The display amplification makes subtle mismatches visible and is not a quality score.

## Inspect and optimise existing SVG

```powershell
pnpm vector:inspect -- .\fixtures\logo.svg
pnpm vector:optimise -- .\fixtures\logo.svg --out .\outputs\logo.optimised.svg
```

SVG inspection reports:

- scripts, active content and external references;
- duplicate IDs and unresolved local references;
- paths, path-data bytes and path commands;
- estimated anchors, subpaths, straight segments and curve segments;
- duplicate path data;
- open and closed subpaths;
- compound and even-odd paths;
- remaining text, use instances, style blocks, clips, masks, transforms and primitive shapes.

Duplicate IDs and unresolved local references make the document invalid. Other editability findings remain visible for review instead of being silently rewritten.

## Machine-readable manifest

```powershell
pnpm vector:manifest
```

The manifest declares contract version `1.4`, discovery commands, input policy, supported operational commands, input limits, candidate budgets, render scales, difference-image bounds, topology safety and approval policy. Agents should inspect this command rather than assuming a feature is available.

## Exit codes

- `0`: command completed and every declared output was produced.
- `1`: invocation, file-system or unexpected runtime failure.
- `2`: governed rejection, unsafe SVG, invalid option, path collision, tracing rejection, render-comparison failure or missing requested artefact.

A trace can exit successfully while still reporting `renderComparison: review-required`. This is intentional: execution and evidence completed, but professional approval has not been granted.

Expected governed errors include `RASTER_MULTI_IMAGE_UNSUPPORTED` for animated or multi-page containers and stable SVG safety codes in the inspection response.

## Guardrails

Raster input is rejected before native decoding when it is empty, larger than 25 MiB, unsupported, structurally malformed, animated, multi-page or declares more than 40 million decoded pixels. Decoded output must match the guarded dimensions and contain one complete RGBA buffer.

Generated SVG is passed through the native safe optimiser and then through Vector Studio's independent SVG safety and topology inspection. Scripts, `foreignObject`, inline event handlers, `javascript:` links, external raster references, external style URLs, duplicate IDs and unresolved local references are prohibited.

System fonts are disabled during SVG rendering because traced assets should not depend on machine-specific font discovery.

## Approval boundary

Multi-scale visual evidence, adaptive candidate selection, topology diagnostics and difference PNG generation are operational. Production auto-approval remains intentionally unavailable. A strong pixel match cannot prove anchor placement, compound paths, negative space, layering, brand geometry or future editability. Every trace therefore reports `productionApproval: review-required`.
