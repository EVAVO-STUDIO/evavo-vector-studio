# EVAVO Vector Studio MCP Server

The MCP server exposes Vector Studio as a local stdio toolset for ChatGPT-compatible MCP hosts, Claude, editors and other agent runtimes. It uses the same raster engine, SVG inspection, candidate selection, topology evidence and difference-image system as the CLI and API.

It is deliberately a local, bounded execution surface. It is not a remote public endpoint or a durable job queue.

## Current tool contract

| Tool | Behaviour |
| --- | --- |
| `vector_capabilities` | Returns versions, allowed roots, input limits, supported profiles, runtime state, implemented outputs and approval policy. |
| `vector_input_policy` | Returns accepted static image classes and pre-decode rejection rules for animation and multi-page containers. |
| `vector_inspect_raster` | Inspects one existing static raster without creating an output. |
| `vector_trace_raster` | Creates one new SVG and, optionally, one new difference PNG through a single no-overwrite transaction. |
| `vector_inspect_svg` | Inspects SVG safety, geometry, topology and editability without modifying the file. |
| `vector_optimise_svg` | Writes a conservatively optimised SVG to a new path after governed safety validation. |

Animated SVG and Lottie authoring are not exposed because those engines are not implemented yet.

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

## Recommended agent workflow

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

## Evidence levels

`vector_trace_raster` supports two response sizes:

- `summary` is the default. It returns source evidence, selected settings, output geometry, aggregate render comparison, compact candidate results, topology inspection, warnings, timings and file receipts.
- `full` returns the complete retained engine evidence for every candidate.

Neither mode places full SVG markup or PNG bytes into model context. Outputs are written to the requested paths and represented by receipts containing path, MIME type, byte count and SHA-256.

## Transaction and overwrite policy

Trace output is committed as one transaction:

1. SVG and optional PNG are staged in their destination directories.
2. Each final path is created with no-overwrite semantics.
3. A conflict aborts the transaction.
4. Any final files already committed by that transaction are removed during rollback.

The server never replaces an existing output. Choose a new revisioned file name when rerunning work.

## Runtime limits

Raster inspection and tracing share the existing bounded runtime guard:

```text
VECTOR_TRACE_TIMEOUT_MS          5000 to 180000, default 45000
VECTOR_TRACE_MAX_CONCURRENT      1 to 4, default 1
VECTOR_TRACE_RETRY_AFTER_SECONDS 1 to 60, default 5
```

At capacity, a tool returns the stable `RASTER_RUNTIME_BUSY` failure with retry information. A deadline returns `VECTOR_MCP_RUNTIME_TIMEOUT`. MCP request cancellation is forwarded into native decoding, tracing and rendering.

## Approval boundary

A successful call means processing, validation and requested file commits completed. It does not grant production approval.

Human review remains mandatory for:

- Bézier placement and anchor economy;
- compound paths and negative space;
- topology, winding and layer intent;
- logo and brand fidelity;
- animation readiness;
- accessibility and final delivery context.

The MCP server reports `human-review-required` instead of converting a pixel-similarity result into an unsupported approval claim.
