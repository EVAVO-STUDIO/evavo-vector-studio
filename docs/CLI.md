# EVAVO Vector Studio CLI

The CLI is designed for deterministic local use by people, ChatGPT, Claude and other automation clients.

## Commands

```powershell
pnpm install
pnpm build
pnpm vector:manifest
pnpm vector:inspect -- .\fixtures\logo.svg
pnpm vector:optimise -- .\fixtures\logo.svg --out .\outputs\logo.optimised.svg
```

Every operational command prints JSON to stdout. Errors are written to stderr.

## Exit codes

- `0`: completed successfully.
- `1`: invocation or file-system failure.
- `2`: the SVG was rejected by the governed safety profile.

## Current safety profile

The optimiser does not overwrite the source file by default. It rejects scripts and `foreignObject`, reports embedded raster images, preserves SVG geometry, removes comments and XML declarations, normalises whitespace, and emits byte-count evidence.

## Honest capability boundary

This first CLI slice inspects and optimises existing SVG files. Raster tracing is intentionally reported as unavailable in the manifest until the raster decoder, segmentation engine, contour reconstruction, curve fitting and render-comparison evidence pipeline are implemented and verified.
