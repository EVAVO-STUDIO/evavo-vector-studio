# EVAVO Vector Studio MCP Server

The MCP server exposes Vector Studio as a local stdio toolset for ChatGPT-compatible MCP hosts, Claude, editors and other agent runtimes. It uses the same raster, SVG, topology, difference-image and animated-SVG engines as the CLI.

MCP contract version `1.1` is a local, bounded execution surface. It is not a remote public endpoint, browser extension or durable job queue.

## Current tool contract

| Tool | Behaviour |
| --- | --- |
| `vector_capabilities` | Returns versions, allowed roots, input limits, runtime state, tracing and motion support, implemented outputs and approval policy. |
| `vector_input_policy` | Returns accepted static image classes and pre-decode rejection rules for animation and multi-page containers. |
| `vector_inspect_raster` | Inspects one existing static raster without creating an output. |
| `vector_trace_raster` | Creates one new SVG and, optionally, one new difference PNG through a single no-overwrite transaction. |
| `vector_inspect_svg` | Inspects SVG safety, geometry, topology and editability without modifying the file. |
| `vector_optimise_svg` | Writes a conservatively optimised SVG to a new path after governed safety validation. |
| `vector_validate_motion_plan` | Validates and normalizes one inline or file-based motion v1 plan and can optionally save the normalized plan to a new JSON file. |
| `vector_animate_svg` | Applies one validated inline or file-based motion plan to a governed static SVG and atomically creates a new animated SVG plus optional evidence JSON. |
| `vector_inspect_animated_svg` | Inspects EVAVO motion identity, animation rules, reduced-motion fallback and underlying SVG safety. |

Animated SVG authoring is available. Lottie and dotLottie export remain unavailable because no governed feature-subset, schema-validation and renderer-compatibility contract has been implemented yet.

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

Build the package first, then configure the host to launch Node with the compiled stdio entry point. Adapt the surrounding configuration keys to the MCP host being used.

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

The server uses the reviewed v1 TypeScript SDK line and `StdioServerTransport`, which is intended for local process-spawned MCP integrations.

## Recommended raster workflow

1. Call `vector_capabilities` once after connecting.
2. Call `vector_input_policy` before handling an unfamiliar raster container.
3. Call `vector_inspect_raster` when the source class or likely trace profile is uncertain.
4. Call `vector_trace_raster` with explicit new output paths.
5. Review the returned render, topology, editability, candidate and warning evidence.
6. Call `vector_inspect_svg` again after any external manual edit.

A typical trace call is:

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

## Recommended animated-SVG workflow

1. Inspect the static source with `vector_inspect_svg`.
2. Create a motion v1 plan inline or as a JSON file.
3. Call `vector_validate_motion_plan` before production when the plan was generated or edited externally.
4. Call `vector_animate_svg` with a new animated SVG path and, preferably, a new evidence JSON path.
5. Call `vector_inspect_animated_svg` on the committed output.
6. Review timing, easing, transform origins, reduced-motion behaviour and brand character.

### Inline motion plan

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
        "easing": {
          "cubicBezier": [0.2, 0.8, 0.2, 1]
        },
        "keyframes": [
          {
            "offset": 0,
            "opacity": 0,
            "translateY": 8
          },
          {
            "offset": 1,
            "opacity": 1,
            "translateY": 0
          }
        ]
      }
    ]
  }
}
```

### File-based motion plan

```json
{
  "inputPath": "C:\\EVAVO\\VectorAssets\\source\\mark.svg",
  "motionPath": "C:\\EVAVO\\VectorAssets\\plans\\mark.motion.json",
  "outputSvgPath": "C:\\EVAVO\\VectorAssets\\output\\mark.animated.svg",
  "evidenceOutputPath": "C:\\EVAVO\\VectorAssets\\output\\mark.motion.evidence.json"
}
```

Exactly one of `motionPlan` and `motionPath` is required. A plan file must be an existing allowed-root regular file. An inline plan remains inside the MCP request and is still validated by the same motion engine.

`vector_validate_motion_plan` accepts the same two input modes and an optional `normalizedOutputPath`. The normalized output is new-file-only and records all default playback and keyframe values explicitly.

## Evidence and model-context policy

`vector_trace_raster` supports two response sizes:

- `summary` is the default. It returns source evidence, selected settings, output geometry, aggregate render comparison, compact candidate results, topology inspection, warnings, timings and file receipts.
- `full` returns the complete retained engine evidence for every candidate.

Motion tools return normalized settings, inspections, hashes, warnings and output receipts. The animated SVG and optional evidence JSON are written to the requested paths.

No operational tool places full SVG markup or PNG bytes into model context. Outputs are represented by receipts containing path, MIME type, byte count and SHA-256. Evidence JSON created by `vector_animate_svg` also avoids embedding a duplicate SVG body.

## Transaction and overwrite policy

Related outputs are committed as one transaction:

1. Files are staged in their destination directories.
2. Each final path is created with no-overwrite semantics.
3. A conflict aborts the transaction.
4. Any final files already committed by that transaction are removed during rollback.

This applies to traced SVG plus difference PNG, animated SVG plus evidence JSON, and normalized motion plan output. The server never replaces an existing output. Choose a new revisioned file name when rerunning work.

## Runtime limits and cancellation

Raster inspection and tracing share the bounded native runtime guard:

```text
VECTOR_TRACE_TIMEOUT_MS          5000 to 180000, default 45000
VECTOR_TRACE_MAX_CONCURRENT      1 to 4, default 1
VECTOR_TRACE_RETRY_AFTER_SECONDS 1 to 60, default 5
```

At capacity, a tool returns the stable `RASTER_RUNTIME_BUSY` failure with retry information. A deadline returns `VECTOR_MCP_RUNTIME_TIMEOUT`.

MCP request cancellation is forwarded into native raster decoding, tracing and rendering. Pure motion operations also check cancellation before validation, source processing and output commit.

## Motion v1 limits

The MCP motion tools intentionally expose the same bounded motion v1 subset as the CLI:

- opacity;
- translate X and Y;
- uniform scale;
- rotation;
- timing, delay, direction, fill, iterations and easing;
- source, first-frame or last-frame reduced-motion fallback.

They reject unknown plan properties, no-op tracks, duplicate or missing target IDs, existing animation systems and transform animation on targets with an existing base transform.

Path morphing, colour and gradient animation, filters, physics, timeline editing and Lottie export are not silently approximated.

## Approval boundary

A successful call means processing, validation and requested file commits completed. It does not grant production approval.

Human review remains mandatory for:

- Bézier placement and anchor economy;
- compound paths and negative space;
- topology, winding and layer intent;
- logo and brand fidelity;
- motion timing, easing and transform origins;
- reduced-motion experience;
- accessibility and final delivery context.

The MCP server reports `human-review-required` instead of converting pixel similarity or deterministic animation into an unsupported approval claim.
