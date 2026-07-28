# EVAVO Vector Studio Motion Contract

Vector Studio motion v1 creates deterministic, script-free CSS animation inside an already governed SVG. It is the first bounded motion-authoring layer and is intentionally narrower than a general animation application.

The objective is editable, inspectable motion with explicit timing and accessibility behaviour. A generated file is still review-required.

## Current availability

Implemented now:

- motion plan validation;
- ID-targeted opacity animation;
- ID-targeted translation, uniform scale and rotation;
- timing, delay, iteration, direction and fill-mode controls;
- easing presets and cubic Bézier easing;
- deterministic CSS `@keyframes` generation;
- required `prefers-reduced-motion` fallback;
- source and output SHA-256 evidence;
- animated SVG inspection;
- CLI creation and optional JSON evidence output;
- authenticated motion authoring through the HTTP API;
- API inline and uploaded plan files with JSON or direct animated SVG responses;
- MCP inline and file-based plan validation;
- MCP animated SVG creation with atomic output receipts;
- MCP animated SVG inspection without returning SVG markup into model context.

Not implemented in motion v1:

- path-data morphing;
- motion paths;
- colour, gradient, stroke, filter or mask animation;
- separate X and Y scale;
- spring or physics simulation;
- timeline editing in the web workspace;
- Lottie export;
- dotLottie packaging.

These are not silently approximated.

## Source requirements

The source must be a governed SVG that passes Vector Studio safety and topology inspection.

Every motion track references exactly one existing SVG element by `id`. Duplicate or missing IDs are rejected.

The v1 transform system rejects a target that already has a `transform` attribute or inline CSS transform. CSS keyframes would replace that base transform rather than safely compose with it. Wrap the target in a new identified group or revise the static SVG before authoring motion.

Sources containing existing SMIL animation, CSS `@keyframes`, CSS animation declarations or EVAVO motion metadata are rejected. Motion plans are applied to clean static revisions instead of stacking animation systems unpredictably.

## Motion plan schema

The machine-readable schema is:

```text
schemas/motion-v1.schema.json
```

A complete example is:

```text
fixtures/motion/gentle-entrance.motion.json
```

The runtime validator is authoritative for rules that JSON Schema cannot express cleanly across an array:

- keyframe offsets must begin at `0` and end at `1`;
- offsets must be strictly increasing;
- a track must actually change opacity or transform values;
- each target ID may appear in only one track;
- every target must resolve to exactly one SVG element;
- unknown properties are rejected rather than ignored.

The optional root `$schema` annotation is accepted for editor integration. Other unknown properties are rejected.

## Supported plan fields

### Playback

| Field | Range or values | Default |
| --- | --- | --- |
| `version` | `1.0` | required |
| `name` | 1 to 120 characters | required |
| `durationMs` | 16 to 3,600,000 | required |
| `delayMs` | 0 to 600,000 | `0` |
| `iterations` | 1 to 10,000 or `infinite` | `1` |
| `direction` | `normal`, `reverse`, `alternate`, `alternate-reverse` | `normal` |
| `fillMode` | `none`, `forwards`, `backwards`, `both` | `both` |
| `reducedMotion` | `source`, `first-frame`, `last-frame` | `source` |

### Track

Each track supports:

- `targetId`;
- `transformBox`: `fill-box` or `view-box`;
- `originXPercent` and `originYPercent`;
- easing preset or four-value `cubicBezier`;
- 2 to 100 keyframes.

A plan supports 1 to 64 tracks.

### Keyframe

Each keyframe has an `offset` from `0` to `1` and may define:

- `opacity` from `0` to `1`;
- `translateX` and `translateY` in CSS pixels;
- uniform `scale`;
- `rotateDeg` in degrees.

Omitted values normalize to opacity `1`, translation `0`, scale `1` and rotation `0`.

## Reduced-motion behaviour

Every generated file includes a `prefers-reduced-motion: reduce` rule. The plan chooses one strategy:

- `source`: disable animation and preserve the original static SVG state;
- `first-frame`: disable animation and apply the first normalized keyframe;
- `last-frame`: disable animation and apply the final normalized keyframe.

The fallback is mandatory and is checked by CLI `motion:inspect`, the HTTP endpoint and MCP `vector_inspect_animated_svg`.

## CLI workflow

Validate and normalize a plan:

```powershell
pnpm vector:motion:validate -- `
  .\fixtures\motion\gentle-entrance.motion.json
```

Create an animated SVG and a separate evidence record:

```powershell
pnpm vector:animate-svg -- `
  .\fixtures\motion\gentle-entrance.source.svg `
  --motion .\fixtures\motion\gentle-entrance.motion.json `
  --out .\outputs\gentle-entrance.animated.svg `
  --evidence-out .\outputs\gentle-entrance.motion.evidence.json
```

Inspect an animated SVG:

```powershell
pnpm vector:motion:inspect -- `
  .\outputs\gentle-entrance.animated.svg
```

Output commands use atomic new-file-only transactions. Existing destinations and path collisions are rejected. When both SVG and evidence are requested, either both commit or the transaction rolls back.

## HTTP API workflow

The authenticated endpoint is:

```http
POST /api/v1/motion/svg
```

It accepts `multipart/form-data` with:

- required `file`: one governed static SVG;
- exactly one inline plan in `motion` or uploaded JSON plan in `motionFile`;
- optional `format`: `json` or `svg`, default `json`.

The application limits one SVG to 5 MiB and one motion plan to 256 KiB. The same runtime validation used by CLI and MCP remains authoritative.

### JSON response from an inline plan

```powershell
$Headers = @{ Authorization = "Bearer $env:VECTOR_API_TOKEN" }
$Motion = Get-Content ".\fixtures\motion\gentle-entrance.motion.json" -Raw
$Form = @{
    file = Get-Item ".\fixtures\motion\gentle-entrance.source.svg"
    motion = $Motion
    format = "json"
}

$result = Invoke-RestMethod `
    -Method Post `
    -Uri "http://localhost:3000/api/v1/motion/svg" `
    -Headers $Headers `
    -Form $Form
```

The JSON result includes the normalized plan, animated SVG, inspection, source/output hashes, deterministic motion identity and review evidence.

### Direct animated SVG from an uploaded plan

```powershell
curl.exe -X POST "http://localhost:3000/api/v1/motion/svg" `
  -H "Authorization: Bearer $env:VECTOR_API_TOKEN" `
  -F "file=@fixtures\motion\gentle-entrance.source.svg;type=image/svg+xml" `
  -F "motionFile=@fixtures\motion\gentle-entrance.motion.json;type=application/json" `
  -F "format=svg" `
  --output "outputs\gentle-entrance.animated.svg"
```

The direct animated SVG response includes compact headers for job ID, motion contract, motion identity, source/output hashes, reduced-motion presence and review state.

The API is synchronous and does not persist outputs. Callers save the returned SVG and evidence deliberately. See [`API.md`](API.md) for the complete request, response and error contract.

## MCP workflow

MCP contract `1.1` exposes three motion tools:

- `vector_validate_motion_plan`;
- `vector_animate_svg`;
- `vector_inspect_animated_svg`.

A motion plan may be provided inline or by `motionPath`. Exactly one source is required.

### Validate an inline plan

```json
{
  "motionPlan": {
    "version": "1.0",
    "name": "Gentle entrance",
    "durationMs": 900,
    "reducedMotion": "last-frame",
    "tracks": [
      {
        "targetId": "mark",
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
  },
  "normalizedOutputPath": "C:\\EVAVO\\VectorAssets\\plans\\mark.motion.normalized.json"
}
```

`normalizedOutputPath` is optional. When present, the MCP server writes a new canonical JSON plan and returns a path, MIME, byte-count and SHA-256 receipt.

### Create animated SVG from a plan file

```json
{
  "inputPath": "C:\\EVAVO\\VectorAssets\\source\\mark.svg",
  "motionPath": "C:\\EVAVO\\VectorAssets\\plans\\mark.motion.json",
  "outputSvgPath": "C:\\EVAVO\\VectorAssets\\output\\mark.animated.svg",
  "evidenceOutputPath": "C:\\EVAVO\\VectorAssets\\output\\mark.motion.evidence.json"
}
```

The animated SVG and optional evidence JSON are committed atomically with new-file-only semantics. Existing destinations and path collisions are rejected.

The tool response contains inspections, evidence and file receipts. It does not contain the generated SVG markup. The evidence JSON also avoids embedding a duplicate SVG body.

See [`MCP.md`](MCP.md) for allowed-root configuration and the complete agent contract.

## Generated output

The engine injects:

- `data-evavo-motion-contract="1.0"` on the SVG root;
- a deterministic motion ID derived from the source and normalized plan;
- one internal `<style>` element;
- one animation rule and one keyframe rule per target;
- one reduced-motion rule per target.

The source `<title>` and `<desc>` remain ahead of the injected style element. The engine adds no scripts and no external references.

## Evidence

The result records:

- source bytes, SHA-256 and governed SVG inspection;
- normalized playback settings;
- target IDs, track count and keyframe count;
- output bytes and SHA-256;
- deterministic style and motion IDs;
- script-free and reduced-motion safety assertions;
- warnings and approval state.

Optional CLI and MCP evidence files do not embed a second copy of the SVG. The API JSON response intentionally includes the SVG because an HTTP client requested the generated body.

## Approval boundary

`review-required` remains mandatory. Deterministic and structurally valid motion can still be poorly directed.

Human review must assess:

- visual rhythm and pacing;
- transform origins;
- overshoot and easing character;
- interaction with existing CSS presentation;
- brand and illustration character;
- reduced-motion experience;
- browser and delivery-context compatibility.

Lottie remains unavailable until a separate renderer-compatibility, schema-validation and feature-subset contract is implemented.
