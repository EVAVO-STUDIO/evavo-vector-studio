# EVAVO Vector Studio MCP server

EVAVO Vector Studio exposes governed raster, SVG, print, motion, Lottie, dotLottie and durable-batch production through a local stdio MCP server for ChatGPT-compatible hosts, Claude, editors and other agent runtimes.

The current public contract is:

```text
MCP contract 1.6
tools 16
transport stdio
execution local and bounded
production approval false
```

Contract `1.6` adds read-only SVG print preflight while retaining the `1.5` delivery-profile contract. It is not a browser extension, public HTTP endpoint, remote managed worker or hosted background queue.

## Tool contract

| Tool | Behaviour |
| --- | --- |
| `vector_capabilities` | Returns the current tool, root, limit, delivery, print, animation, batch and approval contract. |
| `vector_input_policy` | Returns accepted static-image classes and pre-decode rejection rules. |
| `vector_inspect_raster` | Inspects one existing static raster without creating output. |
| `vector_trace_raster` | Creates one new governed SVG and optionally one new difference PNG. |
| `vector_inspect_svg` | Inspects SVG safety, geometry, topology and editability. |
| `vector_optimise_svg` | Packages an existing SVG to a new editable, web, motion or print path. |
| `vector_preflight_svg_print` | Runs commercial, large-format, cut-vinyl or screen-print preflight on one existing SVG. Writes no file. |
| `vector_validate_motion_plan` | Validates and normalises one inline or file-based motion-v1 plan. |
| `vector_animate_svg` | Creates one governed animated SVG plus optional evidence JSON. |
| `vector_inspect_animated_svg` | Inspects motion identity, keyframes, targets and reduced-motion fallback. |
| `vector_export_lottie` | Creates governed Lottie JSON plus optional evidence and returns file receipts. |
| `vector_inspect_lottie` | Inspects an existing Lottie JSON document against the governed subset. |
| `vector_package_dotlottie` | Packages governed Lottie JSON into a deterministic `.lottie` archive. |
| `vector_inspect_dotlottie` | Inspects archive safety, manifest-v2 semantics and embedded Lottie structure. |
| `vector_run_batch` | Runs or resumes a bounded batch-v1 manifest with persistent local state and paginated receipts. |
| `vector_inspect_batch` | Reads retained batch progress, failures, receipts, locks and recent events without executing work. |

Every result remains review-required. Deterministic execution, structural validity, stable IDs, print checks or archive loading do not establish artistic, colour, accessibility, player or physical-production approval.

## Build and run

```powershell
Set-Location C:\GitRepos\evavo-vector-studio
git pull origin main
corepack enable
pnpm install --frozen-lockfile
pnpm vector:mcp
```

The server communicates through stdin and stdout. Startup, shutdown and fatal diagnostics go to stderr so JSON-RPC framing is not corrupted.

## Allowed filesystem roots

Every input, manifest, state root and output must stay inside a canonical allowed root. Configure roots with `VECTOR_MCP_ALLOWED_ROOTS`.

On Windows, separate roots with a semicolon:

```powershell
$env:VECTOR_MCP_ALLOWED_ROOTS = "C:\EVAVO\VectorAssets;C:\GitRepos\evavo-vector-studio"
pnpm vector:mcp
```

When the variable is absent, the server working directory is the only allowed root.

The path policy:

- resolves configured roots and existing inputs through `realpath`;
- rejects missing inputs and non-file inputs;
- rejects lexical and ordinary symlink escapes;
- accepts new nested output paths only beneath an allowed root;
- rejects existing output paths for new-file operations;
- rejects input/output and output/output collisions;
- commits related outputs atomically;
- returns paths only after byte-count and SHA-256 receipts exist.

Print preflight is different from output operations: it resolves one existing SVG within an allowed root, returns evidence and writes no file.

This is a local filesystem boundary, not an operating-system sandbox against a hostile account continuously replacing directories during a call.

## Generic host configuration

Build the package, then configure the host to launch the compiled stdio entry point:

```json
{
  "mcpServers": {
    "evavo-vector-studio": {
      "command": "node",
      "args": [
        "C:\\GitRepos\\evavo-vector-studio\\packages\\mcp\\dist\\index.js"
      ],
      "env": {
        "VECTOR_MCP_ALLOWED_ROOTS": "C:\\EVAVO\\VectorAssets;C:\\GitRepos\\evavo-vector-studio",
        "VECTOR_TRACE_TIMEOUT_MS": "45000",
        "VECTOR_TRACE_MAX_CONCURRENT": "1",
        "VECTOR_TRACE_RETRY_AFTER_SECONDS": "5"
      }
    }
  }
}
```

The server uses the reviewed TypeScript SDK and `StdioServerTransport` for local process-spawned integrations.

## Delivery profiles

Tracing and SVG packaging accept:

```text
editable  editable master with deterministic collision-safe stable path IDs
web       compact web packaging with responsive root dimensions when viewBox is valid
motion    motion-ready packaging with stable animation-target IDs
print     conservative print-safe packaging that preserves explicit root dimensions
```

`editable` is the default. A custom `stableIdPrefix` may be supplied only for `editable` or `motion`. It must begin with a letter or underscore, use only letters, numbers, underscores, periods or hyphens, and be at most 48 characters.

The packaging layer records stable IDs, metadata removal, paint normalisation, root-dimension policy and applied passes. It rolls back a transform if it would introduce an unresolved local reference or another governed SVG failure.

See [`DELIVERY-PROFILES.md`](./DELIVERY-PROFILES.md).

## Raster workflow

1. Call `vector_capabilities` after connecting.
2. Call `vector_input_policy` before handling an unfamiliar raster container.
3. Inspect uncertain sources with `vector_inspect_raster`.
4. Call `vector_trace_raster` with explicit new output paths and a delivery intent.
5. Review alpha-aware source, render, candidate, topology, editability and packaging evidence.
6. Reinspect an SVG after any external manual edit.

```json
{
  "inputPath": "C:\\EVAVO\\VectorAssets\\source\\mark.png",
  "outputSvgPath": "C:\\EVAVO\\VectorAssets\\output\\mark.editable.svg",
  "differenceOutputPath": "C:\\EVAVO\\VectorAssets\\output\\mark.difference.png",
  "profile": "auto",
  "candidateMode": "adaptive",
  "deliveryProfile": "editable",
  "stableIdPrefix": "mark-shape",
  "maxColours": 16,
  "preservePalette": true,
  "optimise": true,
  "differenceMaxDimension": 512,
  "evidenceLevel": "summary",
  "title": "Brand mark"
}
```

`summary` is the default compact evidence mode. `full` includes retained candidate evidence. Neither mode places generated SVG or PNG bytes in model context.

## Existing-SVG packaging

```json
{
  "inputPath": "C:\\EVAVO\\VectorAssets\\source\\mark.svg",
  "outputPath": "C:\\EVAVO\\VectorAssets\\output\\mark.web.svg",
  "deliveryProfile": "web"
}
```

The tool returns a file receipt, byte evidence, delivery passes and complete governed SVG inspection. Existing outputs are rejected.

## Print preflight

`vector_preflight_svg_print` runs the same deterministic `print-preflight-v1` engine used by the CLI and authenticated HTTP API.

```json
{
  "inputPath": "C:\\EVAVO\\VectorAssets\\source\\brochure.svg",
  "profile": "commercial",
  "trimWidthMm": 210,
  "trimHeightMm": 297,
  "bleedMm": 3,
  "dimensionToleranceMm": 0.25,
  "minimumStrokePt": 0.25,
  "maximumProcessColours": 8,
  "allowText": false,
  "allowEmbeddedRaster": false,
  "allowTransparency": false
}
```

Profiles:

```text
commercial
large-format
cut-vinyl
screen-print
```

The tool checks physical dimensions, `viewBox` scale, aspect ratio, trim and bleed, live text, embedded raster content, gradients, filters, masks, clip paths, patterns, transparency, blend modes, process-colour tokens and line weight.

The MCP boundary is deliberately receipt-only:

```text
maximum SVG input             5 MiB
allowed-root enforcement      true
request cancellation          true
output file written           false
SVG markup in model context   false
CMYK or spot proof available  false
production approval           false
approval                      review-required
```

It does not perform ICC conversion, spot-colour library matching, trapping, overprint, ink-limit, RIP, cutter-compensation, screen-separation or physical-proof approval.

See [`PRINT-PREFLIGHT.md`](./PRINT-PREFLIGHT.md).

## Animated SVG workflow

1. Start with an inspected static SVG. A `motion` delivery profile is recommended when traced targets will be animated.
2. Create a motion-v1 plan inline or in an allowed-root JSON file.
3. Validate externally generated plans.
4. Create a new animated SVG and evidence file.
5. Inspect the committed output.
6. Review timing, easing, origins and reduced-motion behaviour.

```json
{
  "inputPath": "C:\\EVAVO\\VectorAssets\\source\\mark.motion.svg",
  "outputSvgPath": "C:\\EVAVO\\VectorAssets\\output\\mark.animated.svg",
  "evidenceOutputPath": "C:\\EVAVO\\VectorAssets\\output\\mark.motion.evidence.json",
  "motionPlan": {
    "version": "1.0",
    "name": "Gentle entrance",
    "durationMs": 900,
    "reducedMotion": "last-frame",
    "tracks": [
      {
        "targetId": "motion-shape-0001",
        "keyframes": [
          { "offset": 0, "opacity": 0, "translateY": 8 },
          { "offset": 1, "opacity": 1, "translateY": 0 }
        ]
      }
    ]
  }
}
```

Exactly one of `motionPlan` and `motionPath` is required.

## Lottie JSON

The Lottie tools use the same motion-v1 plan but enforce the smaller governed source and playback subset.

```json
{
  "inputPath": "C:\\EVAVO\\VectorAssets\\source\\mark.motion.svg",
  "motionPath": "C:\\EVAVO\\VectorAssets\\plans\\mark.motion.json",
  "outputLottiePath": "C:\\EVAVO\\VectorAssets\\output\\mark.lottie.json",
  "evidenceOutputPath": "C:\\EVAVO\\VectorAssets\\output\\mark.lottie.evidence.json",
  "frameRate": 60,
  "precision": 4,
  "name": "Gentle entrance"
}
```

Limits:

```text
SVG source           5 MiB
motion plan          256 KiB
Lottie input/output  20 MiB
frame rate           1 to 120
precision            0 to 6
```

The tool returns receipts and inspection evidence. It never places generated Lottie JSON in model context.

```text
structuralInspection: passed
playerRenderValidation: not-yet-performed
approval: review-required
```

## dotLottie

```json
{
  "inputPath": "C:\\EVAVO\\VectorAssets\\output\\mark.lottie.json",
  "outputPath": "C:\\EVAVO\\VectorAssets\\output\\mark.lottie",
  "evidenceOutputPath": "C:\\EVAVO\\VectorAssets\\output\\mark.dotlottie.evidence.json",
  "animationId": "mark-intro"
}
```

```text
Lottie JSON input               20 MiB
generated or inspected archive  25 MiB
manifest version                2
generated archive entries       2
archive bytes in model context  false
embedded JSON in model context  false
```

`vector_package_dotlottie` returns manifest, inspection, compatibility and file receipts, not archive bytes or embedded generated JSON.

## Durable batches

Use durable batches when several operations must retain progress across separate agent calls.

1. Create a strict batch-v1 manifest beneath an allowed root.
2. Call `vector_run_batch` with the manifest and optional root.
3. Page items using `itemOffset` and `itemLimit`.
4. Use `vector_inspect_batch` to read state without executing work.
5. Call `vector_run_batch` again to resume retained pending, interrupted or corrected failed work.

```json
{
  "manifestPath": "C:\\EVAVO\\VectorAssets\\batches\\brand-assets.batch.json",
  "rootPath": "C:\\EVAVO\\VectorAssets",
  "itemOffset": 0,
  "itemLimit": 25,
  "eventLimit": 25
}
```

```text
MCP manifest limit            100 items
local CLI manifest limit      1,000 items
item page size                1 to 100
recent event count            0 to 100
persistent state              true
resumable on a later call     true
request cancellation          forwarded
generated bodies in context   false
hosted background queue       false
```

The current call is synchronous. State persists after cancellation or process exit, but work does not continue in the background. A later invocation can inspect or resume it.

Completed items are reused only when the input revision and every retained output receipt still verify. Existing production outputs are never silently replaced.

## Evidence and model-context policy

Raster, SVG, print, motion, Lottie, dotLottie and batch tools return settings, inspections, hashes, warnings, compatibility states, paginated state and receipts.

No operational tool places full SVG markup, PNG bytes, generated Lottie JSON, generated dotLottie archive bytes or embedded animation JSON into model context. Evidence files avoid embedding duplicate generated bodies.

## Transactions, cancellation and limits

Related output files are committed together with new-file-only semantics. A conflict aborts the transaction and already committed members are removed during rollback.

Raster inspection and tracing share the native runtime guard:

```text
VECTOR_TRACE_TIMEOUT_MS          5000 to 180000, default 45000
VECTOR_TRACE_MAX_CONCURRENT      1 to 4, default 1
VECTOR_TRACE_RETRY_AFTER_SECONDS 1 to 60, default 5
```

Request cancellation is forwarded to native raster work, print preflight and durable-batch execution. Motion, Lottie and dotLottie operations check cancellation before validation, processing and commit.

## Approval boundary

A successful call means the requested validation, processing or file transaction completed. It does not grant production approval.

Human review remains mandatory for:

- Bézier placement and anchor economy;
- compound paths and negative space;
- topology, winding and layer intent;
- logo and brand fidelity;
- physical dimensions, line weight, process colours and final print specification;
- CMYK, spot colours, trapping, overprint and physical proof;
- motion timing, easing and transform origins;
- reduced-motion experience;
- Lottie paint order and player compatibility;
- archive and manifest compatibility;
- accessibility and final delivery context.

The server reports `human-review-required`, `review-required`, `processing-or-repair-required` or `structural-repair-required` instead of converting deterministic completion into unsupported approval.
