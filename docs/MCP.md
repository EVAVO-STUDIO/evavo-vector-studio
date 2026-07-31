# EVAVO Vector Studio MCP Server

The EVAVO Vector Studio MCP server exposes governed raster, SVG, motion, Lottie, dotLottie and durable batch production through local stdio tools for ChatGPT-compatible MCP hosts, Claude, editors and other agent runtimes.

MCP contract version `1.5` is a bounded local execution surface. It can retain resumable batch state between separate calls, but it is not a remote public endpoint, browser extension or hosted background queue.

The v1.5 addition is a shared delivery-intent contract. Raster tracing and existing-SVG packaging can now request an editable master, web compact, motion ready or print safe output without changing the underlying reconstruction and approval boundaries.

## Current tool contract

| Tool | Behaviour |
| --- | --- |
| `vector_capabilities` | Returns versions, tools, allowed roots, limits, delivery profiles, output availability and approval policy. |
| `vector_input_policy` | Returns accepted static-image classes and pre-decode rejection rules. |
| `vector_inspect_raster` | Inspects one existing static raster without creating output. |
| `vector_trace_raster` | Creates one new governed SVG and, optionally, one new difference PNG. |
| `vector_inspect_svg` | Inspects SVG safety, geometry, topology and editability. |
| `vector_optimise_svg` | Packages an existing SVG to a new editable, web, motion or print path. |
| `vector_validate_motion_plan` | Validates and normalises one inline or file-based motion-v1 plan. |
| `vector_animate_svg` | Creates one governed animated SVG plus optional evidence JSON. |
| `vector_inspect_animated_svg` | Inspects motion identity, keyframes, target rules and reduced-motion fallback. |
| `vector_export_lottie` | Creates governed Lottie JSON plus optional evidence and returns file receipts. |
| `vector_inspect_lottie` | Inspects an existing Lottie JSON document against the governed subset. |
| `vector_package_dotlottie` | Packages one governed Lottie JSON file into a deterministic `.lottie` archive. |
| `vector_inspect_dotlottie` | Inspects ZIP safety, manifest-v2 semantics and embedded Lottie structure. |
| `vector_run_batch` | Runs or resumes one bounded batch-v1 manifest with persistent local state and paginated receipts. |
| `vector_inspect_batch` | Reads retained batch progress, failures, receipts, lock state and recent events without executing work. |

Every production result remains review-required. Structural success, archive loading, stable IDs and deterministic output do not establish artistic approval or independent source-to-player equivalence.

## Build and run

```powershell
Set-Location C:\GitRepos\evavo-vector-studio
git pull origin main
corepack enable
pnpm install --frozen-lockfile
pnpm vector:mcp
```

The server communicates through stdin and stdout. Diagnostic startup and shutdown failures go to stderr so MCP protocol framing is not corrupted.

## Allowed filesystem roots

Every input, manifest, state root and output must stay inside a canonical allowed root. Configure roots with `VECTOR_MCP_ALLOWED_ROOTS`.

On Windows, separate roots with a semicolon:

```powershell
$env:VECTOR_MCP_ALLOWED_ROOTS = "C:\EVAVO\VectorAssets;C:\GitRepos\evavo-vector-studio"
pnpm vector:mcp
```

When the variable is absent, the server working directory is the only allowed root.

The policy:

- resolves configured roots and existing inputs through `realpath`;
- rejects missing inputs and non-file inputs;
- rejects lexical and ordinary symlink escapes;
- accepts new nested output paths only beneath an allowed root;
- rejects existing output paths for new-file operations;
- rejects input/output and output/output collisions;
- commits related outputs atomically;
- returns paths only after byte count and SHA-256 receipts exist.

This is a local filesystem boundary, not an operating-system sandbox against a hostile account continuously replacing directories during a call.

## Generic MCP host configuration

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

The server uses the reviewed v1 TypeScript SDK line and `StdioServerTransport` for local process-spawned integrations.

## Delivery profiles

The `deliveryProfile` field accepts:

```text
editable  editable master with deterministic collision-safe stable path IDs
web       web compact packaging with responsive root dimensions when viewBox is valid
motion    motion ready packaging with stable animation-target IDs
print     print safe packaging that preserves explicit root dimensions
```

`editable` is the default. A custom `stableIdPrefix` may be supplied only for `editable` or `motion`. It must begin with a letter or underscore, contain only letters, numbers, underscores, periods or hyphens, and be at most 48 characters.

The packaging layer records stable IDs, metadata removal, paint normalisation, root-dimension policy and applied passes. It uses safety rollback when a rewrite would introduce an unresolved local reference or another governed SVG failure.

The canonical profile details are in [`DELIVERY-PROFILES.md`](./DELIVERY-PROFILES.md).

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

`summary` is the default compact evidence mode. `full` includes complete retained candidate evidence. Neither mode places the generated SVG or PNG bytes in model context.

## Existing-SVG packaging

```json
{
  "inputPath": "C:\\EVAVO\\VectorAssets\\source\\mark.svg",
  "outputPath": "C:\\EVAVO\\VectorAssets\\output\\mark.web.svg",
  "deliveryProfile": "web"
}
```

The tool returns a file receipt, input/output byte evidence, delivery passes and the complete governed SVG inspection. Existing outputs are rejected.

## Animated SVG workflow

1. Start with an inspected static SVG. A `motion` delivery profile is recommended when traced path targets will be animated.
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

## Lottie JSON workflow

The Lottie tools use the same motion-v1 plan but require the smaller governed Lottie source and playback subset.

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
SVG source          5 MiB
Motion plan         256 KiB
Lottie input/output 20 MiB
Frame rate          1 to 120
Precision           0 to 6
```

The tool returns file receipts and inspection evidence. It never places generated Lottie JSON in model context.

Compatibility remains:

```text
structuralInspection: passed
playerRenderValidation: not-yet-performed
approval: review-required
```

## dotLottie workflow

```json
{
  "inputPath": "C:\\EVAVO\\VectorAssets\\output\\mark.lottie.json",
  "outputPath": "C:\\EVAVO\\VectorAssets\\output\\mark.lottie",
  "evidenceOutputPath": "C:\\EVAVO\\VectorAssets\\output\\mark.dotlottie.evidence.json",
  "animationId": "mark-intro"
}
```

The archive contract is receipt-only:

```text
Lottie JSON input              20 MiB
Generated or inspected archive 25 MiB
Manifest version                2
Generated archive entries       2
Archive bytes in model context  false
Embedded JSON in model context  false
```

`vector_package_dotlottie` never returns generated dotLottie archive bytes or embedded generated JSON. It returns manifest, inspection, compatibility and file receipts.

## Durable batch workflow

Use durable batches when several operations must retain progress across separate agent calls.

1. Create a strict batch-v1 manifest beneath an allowed root.
2. Call `vector_run_batch` with the manifest and optional root.
3. Use `itemOffset` and `itemLimit` to request a paginated item page.
4. Call `vector_inspect_batch` in later turns to read state without executing work.
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

The MCP batch boundary is:

```text
MCP manifest limit           100 items
Local CLI manifest limit     1,000 items
Item page size               1 to 100
Recent event count           0 to 100
Persistent state             true
Resumable on a later call    true
Request cancellation         forwarded
Generated bodies in context  false
Hosted background queue      false
```

The current call is synchronous. The MCP process must stay alive while it runs. State persists after cancellation or process exit, but work does not continue in the background. A later invocation can inspect or resume it.

Completed items are reused only when the input revision and every retained output receipt still verify. Existing production outputs are never silently replaced.

## Evidence and model-context policy

Raster, SVG, motion, Lottie, dotLottie and durable batch tools return settings, inspections, hashes, warnings, compatibility states, paginated job state and file receipts.

No operational tool places full SVG markup, PNG bytes, generated Lottie JSON, generated dotLottie archive bytes or embedded animation JSON into model context. Evidence files avoid embedding duplicate generated bodies.

## Transactions, cancellation and limits

Related outputs are committed together with new-file-only semantics. A conflict aborts the transaction and already committed members of that transaction are removed during rollback.

Raster inspection and tracing share the native runtime guard:

```text
VECTOR_TRACE_TIMEOUT_MS          5000 to 180000, default 45000
VECTOR_TRACE_MAX_CONCURRENT      1 to 4, default 1
VECTOR_TRACE_RETRY_AFTER_SECONDS 1 to 60, default 5
```

Request cancellation is forwarded to native raster work and durable batch execution. Motion, Lottie and dotLottie operations check cancellation before validation, processing and commit. Retained batch state remains inspectable after cancellation.

## Governed feature boundaries

Alpha-aware raster analysis ignores hidden RGB beneath fully transparent pixels, weights partial alpha, records visible bounds and rejects sources without visible content.

Animated SVG supports opacity, X/Y translation, uniform scale, rotation, timing, delay, direction, fill, iterations, easing and explicit reduced-motion fallback.

Lottie v1 supports path-based SVG geometry, solid fill and stroke, opacity, translation, uniform scale and rotation for one normal playback cycle. Unsupported gradients, text, images, masks, filters, expressions, precompositions, repeated playback, path morphing and motion paths are rejected.

dotLottie v1 packages exactly one governed animation as `manifest.json` plus `a/<animation-id>.json`. Traversal, duplicate names, ZIP64, encryption, unsupported entries and oversized declared content are rejected.

Durable batch v1 supports tracing, SVG optimisation, animated SVG, Lottie JSON and dotLottie packaging. It is persistent and resumable but remains local and single-process.

## Approval boundary

A successful call means the requested validation, processing and file commits completed. It does not grant production approval.

Human review remains mandatory for:

- Bézier placement and anchor economy;
- compound paths and negative space;
- topology, winding and layer intent;
- logo and brand fidelity;
- motion timing, easing and transform origins;
- reduced-motion experience;
- Lottie paint order and player compatibility;
- archive and manifest compatibility;
- accessibility and final delivery context.

The server reports `human-review-required`, `review-required`, `processing-or-repair-required` or `structural-repair-required` instead of converting deterministic completion into an unsupported approval claim.
