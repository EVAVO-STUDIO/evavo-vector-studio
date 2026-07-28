# EVAVO Vector Studio MCP Server

The MCP server exposes Vector Studio as a local stdio toolset for ChatGPT-compatible MCP hosts, Claude, editors and other agent runtimes. It uses the same raster, SVG, topology, difference-image, animated-SVG, Lottie and dotLottie engines as the CLI and HTTP surfaces.

MCP contract version `1.3` is a local, bounded execution surface. It is not a remote public endpoint, browser extension or durable job queue.

## Current tool contract

| Tool | Behaviour |
| --- | --- |
| `vector_capabilities` | Returns versions, allowed roots, limits, runtime state, output availability and approval policy. |
| `vector_input_policy` | Returns accepted static-image classes and pre-decode rejection rules for animation and multi-page containers. |
| `vector_inspect_raster` | Inspects one existing static raster without creating output. |
| `vector_trace_raster` | Creates one new SVG and, optionally, one new difference PNG through a single no-overwrite transaction. |
| `vector_inspect_svg` | Inspects SVG safety, geometry, topology and editability without modifying the file. |
| `vector_optimise_svg` | Writes a conservatively optimised SVG to a new path after governed safety validation. |
| `vector_validate_motion_plan` | Validates and normalizes one inline or file-based motion-v1 plan and can save the normalized plan to a new JSON file. |
| `vector_animate_svg` | Applies one validated motion plan to a governed static SVG and atomically creates a new animated SVG plus optional evidence JSON. |
| `vector_inspect_animated_svg` | Inspects EVAVO motion identity, animation rules, reduced-motion fallback and underlying SVG safety. |
| `vector_export_lottie` | Creates governed path-based Lottie JSON plus optional evidence JSON and returns receipts rather than the generated body. |
| `vector_inspect_lottie` | Inspects existing Lottie JSON for the governed shape-layer, property, keyframe, asset and expression subset. |
| `vector_package_dotlottie` | Packages one allowed-root Lottie JSON file into a deterministic new `.lottie` archive plus optional evidence JSON. |
| `vector_inspect_dotlottie` | Inspects ZIP safety, manifest-v2 semantics, deterministic metadata and embedded governed Lottie structure. |

Animated SVG, governed Lottie JSON and deterministic dotLottie v2 packaging are available. Independent source-to-player render validation and browser archive-load validation remain unavailable and are reported as such.

## Build and run

```powershell
Set-Location C:\GitRepos\evavo-vector-studio
git pull origin main
corepack enable
pnpm install
pnpm vector:mcp
```

The server communicates over stdin and stdout. Diagnostic startup or shutdown failures are written to stderr so they cannot corrupt MCP protocol framing.

## Allowed filesystem roots

Every input and output must remain within a canonical allowed root. Configure roots with `VECTOR_MCP_ALLOWED_ROOTS`.

On Windows, separate multiple roots with a semicolon:

```powershell
$env:VECTOR_MCP_ALLOWED_ROOTS = "C:\GitRepos\evavo-vector-studio;C:\EVAVO\VectorAssets"
pnpm vector:mcp
```

When the variable is absent, the server working directory is the only allowed root.

The policy:

- resolves roots and existing inputs through `realpath`;
- rejects missing inputs and non-file inputs;
- rejects paths outside every root, including ordinary symlink escapes;
- accepts new nested output paths only beneath an allowed root;
- rejects existing output paths;
- rejects input/output and output/output collisions;
- uses new-files-only output semantics.

This is a local filesystem safety boundary, not an operating-system sandbox. Do not run the server in a hostile account that can continuously replace directories while a tool call is committing files.

## Generic MCP host configuration

Build the package first, then configure the host to launch Node with the compiled stdio entry point.

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

The server uses the reviewed v1 TypeScript SDK line and `StdioServerTransport`, which is appropriate for local process-spawned MCP integrations.

## Recommended raster workflow

1. Call `vector_capabilities` once after connecting.
2. Call `vector_input_policy` before handling an unfamiliar raster container.
3. Call `vector_inspect_raster` when the source class or likely trace profile is uncertain.
4. Call `vector_trace_raster` with explicit new output paths.
5. Review render, topology, editability, candidate and warning evidence.
6. Call `vector_inspect_svg` again after any external manual edit.

```json
{
  "inputPath": "C:\\EVAVO\\VectorAssets\\source\\mark.png",
  "outputSvgPath": "C:\\EVAVO\\VectorAssets\\output\\mark.vector.svg",
  "differenceOutputPath": "C:\\EVAVO\\VectorAssets\\output\\mark.vector.difference.png",
  "profile": "auto",
  "candidateMode": "adaptive",
  "maxColours": 16,
  "preservePalette": true,
  "optimise": true,
  "differenceMaxDimension": 512,
  "evidenceLevel": "summary",
  "title": "Brand mark"
}
```

`summary` is the default evidence size. `full` returns the complete retained candidate evidence.

## Recommended animated-SVG workflow

1. Inspect the static source with `vector_inspect_svg`.
2. Create a motion-v1 plan inline or as an allowed-root JSON file.
3. Call `vector_validate_motion_plan` before production when the plan was generated or edited externally.
4. Call `vector_animate_svg` with a new animated SVG path and, preferably, a new evidence JSON path.
5. Call `vector_inspect_animated_svg` on the committed output.
6. Review timing, easing, transform origins, reduced-motion behaviour and brand character.

```json
{
  "inputPath": "C:\\EVAVO\\VectorAssets\\source\\mark.svg",
  "outputSvgPath": "C:\\EVAVO\\VectorAssets\\output\\mark.animated.svg",
  "evidenceOutputPath": "C:\\EVAVO\\VectorAssets\\output\\mark.motion.evidence.json",
  "motionPlan": {
    "version": "1.0",
    "name": "Gentle entrance",
    "durationMs": 900,
    "reducedMotion": "last-frame",
    "tracks": [
      {
        "targetId": "mark",
        "keyframes": [
          { "offset": 0, "opacity": 0, "translateY": 8 },
          { "offset": 1, "opacity": 1, "translateY": 0 }
        ]
      }
    ]
  }
}
```

Exactly one of `motionPlan` and `motionPath` is required. `vector_validate_motion_plan` accepts the same input modes plus optional `normalizedOutputPath`.

## Recommended Lottie workflow

Lottie export consumes the same motion-v1 plan, but only when the SVG and playback settings remain inside the smaller governed Lottie subset.

1. Inspect the source SVG.
2. Validate the motion plan.
3. Call `vector_export_lottie` with a new `.json` output path and optional evidence path.
4. Call `vector_inspect_lottie` on the committed output.
5. Review the retained compatibility boundary and test the file in intended players before publication.

```json
{
  "inputPath": "C:\\EVAVO\\VectorAssets\\source\\mark.svg",
  "motionPath": "C:\\EVAVO\\VectorAssets\\plans\\mark.motion.json",
  "outputLottiePath": "C:\\EVAVO\\VectorAssets\\output\\mark.lottie.json",
  "evidenceOutputPath": "C:\\EVAVO\\VectorAssets\\output\\mark.lottie.evidence.json",
  "frameRate": 60,
  "precision": 4,
  "name": "Gentle entrance"
}
```

Lottie MCP limits:

```text
SVG source          5 MiB
Motion plan         256 KiB
Lottie input/output 20 MiB
Frame rate          1 to 120
Precision           0 to 6
```

The Lottie JSON export evidence deliberately retains:

```text
structuralInspection: passed
playerRenderValidation: not-yet-performed
dotLottiePackaging: not-yet-available
approval: review-required
```

The `dotLottiePackaging` field belongs to the Lottie JSON result contract. Archive packaging is a separate operation with separate evidence.

## Recommended dotLottie workflow

1. Produce or inspect governed Lottie JSON.
2. Call `vector_package_dotlottie` with a new `.lottie` path and optional evidence path.
3. Call `vector_inspect_dotlottie` on the committed archive.
4. Review archive findings and test the archive in intended players and platform SDKs.

```json
{
  "inputPath": "C:\\EVAVO\\VectorAssets\\output\\mark.lottie.json",
  "outputPath": "C:\\EVAVO\\VectorAssets\\output\\mark.lottie",
  "evidenceOutputPath": "C:\\EVAVO\\VectorAssets\\output\\mark.dotlottie.evidence.json",
  "animationId": "mark-intro"
}
```

The dotLottie MCP contract is deliberately receipt-only:

```text
Lottie JSON input             20 MiB
Generated or inspected archive 25 MiB
Manifest version               2
Generated archive entries      2
Archive bytes in model context false
Embedded JSON in model context false
```

`vector_package_dotlottie` returns manifest, structural inspection, compatibility evidence and file receipts. It never returns ZIP bytes or the embedded generated Lottie JSON. `vector_inspect_dotlottie` returns findings, counts and SHA-256 without modifying the archive.

Current archive compatibility evidence remains:

```text
archiveInspection: passed
embeddedLottieInspection: passed
playerRenderValidation: not-yet-performed
browserArchiveLoadValidation: not-yet-performed
approval: review-required
```

## Evidence and model-context policy

Raster, motion, Lottie and dotLottie tools return settings, inspections, hashes, warnings, compatibility state and file receipts.

No operational tool places full SVG markup, PNG bytes, generated Lottie JSON, generated dotLottie archive bytes or embedded animation JSON into model context. Outputs are represented by receipts containing path, MIME type, byte count and SHA-256. Evidence files avoid embedding duplicate output bodies.

## Transaction and overwrite policy

Related outputs are committed as one transaction:

1. Files are staged in their destination directories.
2. Each final path is created with no-overwrite semantics.
3. A conflict aborts the transaction.
4. Any final files already committed by that transaction are removed during rollback.

This applies to traced SVG plus difference PNG, animated SVG plus evidence JSON, normalized motion-plan output, Lottie JSON plus evidence JSON, and dotLottie archive plus evidence JSON. The server never replaces an existing output. Choose a new revisioned file name when rerunning work.

## Runtime limits and cancellation

Raster inspection and tracing share the bounded native runtime guard:

```text
VECTOR_TRACE_TIMEOUT_MS          5000 to 180000, default 45000
VECTOR_TRACE_MAX_CONCURRENT      1 to 4, default 1
VECTOR_TRACE_RETRY_AFTER_SECONDS 1 to 60, default 5
```

At capacity, a tool returns the stable `RASTER_RUNTIME_BUSY` failure with retry information. A deadline returns `VECTOR_MCP_RUNTIME_TIMEOUT`.

MCP request cancellation is forwarded into native raster work. Pure motion, Lottie and dotLottie operations check cancellation before validation, processing and output commit.

## Governed feature boundaries

Animated SVG supports opacity, X/Y translation, uniform scale, rotation, timing, delay, direction, fill, iterations and easing, plus source, first-frame or last-frame reduced-motion fallback.

Lottie v1 supports path-based SVG geometry, solid fill and stroke, opacity, translation, uniform scale and rotation for one normal playback cycle. It rejects gradients, text, images, masks, filters, expressions, precompositions, repeated or reversed playback, path morphing and motion paths instead of silently approximating them.

dotLottie v1 packages exactly one governed animation into manifest-v2 ZIP entries `manifest.json` and `a/<animation-id>.json`. It rejects traversal, duplicate names, ZIP64, encryption, unsupported entries and oversized declared content.

Structural validity does not establish player equivalence. Independent player-render validation and browser archive-load validation remain unavailable.

## Approval boundary

A successful call means processing, validation and requested file commits completed. It does not grant production approval.

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

The MCP server reports `human-review-required`, `review-required` or `structural-repair-required` instead of converting deterministic output into an unsupported approval claim.
