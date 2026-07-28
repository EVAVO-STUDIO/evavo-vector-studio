# EVAVO Vector Studio Lottie Contract

Vector Studio Lottie v1 converts one governed path-based SVG and one validated motion-v1 plan into deterministic Lottie JSON.

The objective is not broad best-effort conversion. The exporter accepts a deliberately bounded subset, preserves source paint order, records evidence, and rejects source semantics it cannot represent faithfully.

## Current availability

Implemented in `@evavo/lottie-engine`, the `evavo-vector` CLI, the authenticated HTTP API, MCP contract 1.2 and the browser Motion Director:

- static SVG path geometry converted to Lottie bezier paths;
- absolute and relative `M`, `L`, `H`, `V`, `C`, `S`, `Q`, `T`, `A`, and `Z` commands;
- quadratic and elliptical-arc conversion to cubic bezier segments;
- compound subpaths, nonzero fill, and even-odd fill;
- solid fill and solid stroke presentation;
- layer-transform animation for opacity, translation, uniform scale, and rotation;
- validated easing and frame-based keyframes;
- deterministic JSON, SHA-256 evidence, and independent structural inspection;
- static layers for source paths outside motion targets;
- atomic new-file-only CLI and MCP output with optional evidence JSON;
- HTTP wrapper evidence or direct `video/lottie+json` delivery;
- receipt-only MCP responses that keep generated Lottie bodies out of model context;
- browser verification of exact JSON bytes, source/output SHA-256, parsed metadata and structural evidence;
- browser Lottie player preview through `@lottiefiles/dotlottie-react` with reduced-motion autoplay suppression;
- separate deterministic dotLottie packaging and inspection through `createDotLottiePackage`, `inspectDotLottie` and the `evavo-dotlottie` CLI;
- explicit source-subset, motion-subset, compatibility, and approval boundaries.

Not yet available:

- independent player-render comparison against the source or a reference renderer;
- dotLottie packaging through HTTP, MCP or browser surfaces;
- graphical Lottie timeline controls beyond the shared motion-plan editor;
- gradients, images, text, masks, filters, expressions, precompositions, path morphing, or motion paths;
- repeated, reversed, or alternating playback encoded into the exported composition.

These features are not silently approximated.

## Lottie JSON CLI workflow

Create governed Lottie JSON and a separate evidence record:

```powershell
pnpm vector:lottie:export -- `
  .\fixtures\motion\gentle-entrance.source.svg `
  --motion .\fixtures\motion\gentle-entrance.motion.json `
  --out .\outputs\gentle-entrance.lottie.json `
  --evidence-out .\outputs\gentle-entrance.lottie.evidence.json `
  --frame-rate 60 `
  --precision 4 `
  --name "Gentle entrance"
```

Inspect any Lottie JSON against the governed structural subset:

```powershell
pnpm vector:lottie:inspect -- `
  .\outputs\gentle-entrance.lottie.json
```

`--motion` is required. `--out` defaults to `<source>.lottie.json`. The frame rate must be an integer from 1 to 120 and precision must be an integer from 0 to 6.

The CLI rejects source, plan, output, and evidence path collisions. It never replaces an existing output. Lottie JSON and optional evidence commit as one transaction or roll back together. The evidence file does not contain a duplicate copy of the Lottie JSON body.

## Separate dotLottie packaging workflow

A governed Lottie JSON result can be packaged as a deterministic dotLottie v2 archive:

```powershell
pnpm vector:dotlottie:package -- `
  .\outputs\gentle-entrance.lottie.json `
  --out .\outputs\gentle-entrance.lottie `
  --animation-id gentle-entrance `
  --evidence-out .\outputs\gentle-entrance.dotlottie.evidence.json
```

Inspect the archive:

```powershell
pnpm vector:dotlottie:inspect -- `
  .\outputs\gentle-entrance.lottie
```

The package contains exactly:

```text
manifest.json
a/<animation-id>.json
```

Archive creation uses DEFLATE compression, fixed entry order, fixed ZIP timestamps and new-file-only atomic output. The strict inspector rejects traversal, duplicate entries, ZIP64, encryption, extra semantics and oversized declared content before accepting the embedded Lottie JSON.

See [`DOTLOTTIE.md`](DOTLOTTIE.md) for the complete manifest, archive, size, evidence and approval contract.

## HTTP API workflow

The authenticated endpoint is:

```http
GET  /api/v1/motion/lottie
POST /api/v1/motion/lottie
```

`POST` requires `multipart/form-data` with:

| Field | Required | Values |
| --- | --- | --- |
| `file` | yes | governed path-based static SVG, maximum 5 MiB |
| `motion` | one of two | inline motion-v1 JSON |
| `motionFile` | one of two | uploaded motion-v1 JSON, maximum 256 KiB |
| `format` | no | `json` or `lottie`, default `json` |
| `frameRate` | no | integer from 1 to 120, default 60 |
| `precision` | no | integer from 0 to 6, default 4 |
| `name` | no | composition name, 1 to 120 characters |

Exactly one plan source is required. Unknown or duplicate fields, malformed multipart data, invalid UTF-8, unsupported source semantics and unsupported motion are rejected.

Wrapper JSON returns exact serialized JSON in `lottie.data`, normalized plan, structural inspection and complete evidence. The SHA-256 and byte count apply to that exact string.

Direct output uses `format=lottie`:

```powershell
curl.exe -X POST "http://localhost:3000/api/v1/motion/lottie" `
  -H "Authorization: Bearer $env:VECTOR_API_TOKEN" `
  -F "file=@fixtures\motion\gentle-entrance.source.svg;type=image/svg+xml" `
  -F "motionFile=@fixtures\motion\gentle-entrance.motion.json;type=application/json" `
  -F "frameRate=60" `
  -F "precision=4" `
  -F "format=lottie" `
  --output "outputs\gentle-entrance.lottie.json"
```

The direct response uses `video/lottie+json` and retains job ID, contract, source/output SHA-256, structural-inspection state, layer and path counts, `player validation: not-performed`, operation-level `dotLottie: unavailable`, and review-required state in headers.

The `dotLottie: unavailable` header means that this Lottie JSON endpoint does not package an archive in the same response. Separate core and CLI dotLottie packaging is available.

The generated body is capped at 20 MiB. The endpoint is synchronous and does not persist files.

## MCP workflow

MCP contract 1.2 exposes:

- `vector_export_lottie`;
- `vector_inspect_lottie`.

The exporter accepts an inline `motionPlan` or an allowed-root `motionPath`, exactly one of which is required.

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

`vector_export_lottie` commits the Lottie JSON and optional evidence file atomically under new-files-only semantics. Its structured result contains file receipts, inspection, evidence and compatibility state, but not the generated animation body.

Inspect a committed file with:

```json
{
  "inputPath": "C:\\EVAVO\\VectorAssets\\output\\mark.lottie.json"
}
```

`vector_inspect_lottie` returns structural findings, counts, SHA-256 and either `human-review-required` or `structural-repair-required`.

The MCP Lottie limits are:

```text
SVG source          5 MiB
Motion plan         256 KiB
Lottie input/output 20 MiB
Frame rate          1 to 120
Precision           0 to 6
```

MCP dotLottie archive packaging remains a later surface. The available core and CLI archive package do not change the current MCP tool list.

## Browser Motion Director workflow

The browser Motion Director uses the same selected SVG and normalized motion plan as animated-SVG production.

The Lottie review panel:

1. checks that the plan uses one normal playback cycle and a supported fill mode;
2. posts the selected SVG and exact normalized plan to `/api/v1/motion/lottie` in JSON mode;
3. verifies the returned source bytes and SHA-256 against the selected SVG;
4. verifies the exact Lottie JSON bytes and SHA-256 against retained output evidence;
5. parses the JSON and checks governed metadata, dimensions, frame rate, out point, assets and layers;
6. checks structural inspection, path counts, layer counts and the absence of expressions, images, text and precompositions;
7. verifies that the normalized target order remains consistent across response fields;
8. creates separate Lottie JSON and evidence downloads;
9. marks a displayed result stale when the source, plan, frame rate or precision changes;
10. passes only verified JSON into the client-only official LottieFiles player.

The browser Lottie player preview uses `@lottiefiles/dotlottie-react`. It is loaded client-side and receives the exact verified JSON string through the `data` prop. When the browser prefers reduced motion, autoplay and looping are disabled.

This is a delivery-context preview and not independent source-to-player validation. A player that loads successfully can still differ in paint order, fill rules, stroke treatment, transform origins or timing from the source or another player.

The downloaded browser evidence records `playerRenderValidation: false` and `dotLottiePackaging: false`; the latter is scoped to the browser Lottie JSON operation. Browser archive generation and archive-load validation are not yet implemented.

## Programmatic workflow

```ts
import {
  createDotLottiePackage,
  createLottieFromSvgMotion,
  inspectDotLottie,
  inspectLottie,
} from "@evavo/lottie-engine";

const lottie = createLottieFromSvgMotion(svgSource, motionPlan, {
  frameRate: 60,
  precision: 4,
  name: "Directed mark",
});

if (!lottie.inspection.valid) {
  throw new Error("Generated Lottie failed structural inspection.");
}

const independentInspection = inspectLottie(lottie.json);
const packaged = createDotLottiePackage(lottie.json, {
  animationId: "directed-mark",
});
const archiveInspection = inspectDotLottie(packaged.bytes);
```

The Lottie result contains parsed animation data, deterministic formatted JSON, independent structural inspection, and source, motion, subset, output, compatibility, and approval evidence.

The dotLottie result contains deterministic archive bytes, exact manifest, archive inspection and source, embedded JSON, compression, compatibility and approval evidence.

## SVG source requirements

The source must pass the existing governed SVG inspection and include an integer `viewBox` width and height from 1 to 8192.

Lottie v1 accepts only:

- `svg`, `g`, metadata elements, and `path` geometry;
- solid hex, `rgb()`, `rgba()`, and the portable named-colour set;
- unitless or `px` stroke widths;
- butt, round, and square caps;
- miter, round, and bevel joins;
- nonzero or even-odd fill rules.

The exporter rejects:

- unflattened SVG transforms;
- group opacity that would change overlap compositing;
- hidden nodes;
- gradients, patterns, masks, filters, clipping paths, markers, and referenced content;
- text, images, `use`, and primitive shapes that have not been converted to paths;
- dashed strokes;
- external references or active content;
- overlapping motion targets where one target contains another.

This rejection policy prevents a technically valid Lottie file from representing materially different artwork.

## Paint order and shape grouping

Lottie shape arrays are painted in reverse stack order, while fill and stroke shapes apply to preceding path shapes in the same group. Vector Studio therefore:

1. preserves source SVG path order as evidence;
2. writes later source paths first in each Lottie layer;
3. writes path geometry before its stroke and fill styles;
4. keeps the group transform as the final shape item;
5. writes later source render units first in the top-level layer array.

This is deliberate format translation, not arbitrary reversal.

## Motion subset

The exporter consumes the same normalized motion-v1 plan used by animated SVG.

Supported:

- exactly one playback cycle;
- normal direction;
- `forwards` or `both` fill mode;
- delay plus duration;
- opacity;
- X and Y translation;
- uniform scale;
- rotation;
- fill-box or view-box transform origins;
- easing presets and cubic bezier easing.

Rejected:

- infinite or repeated iterations;
- reverse and alternating direction;
- `none` or `backwards` fill mode;
- unsupported source animation or transform composition.

A delay is encoded as a held initial keyframe. The composition out point is the exclusive frame boundary after delay plus one motion cycle.

## Structural inspection

`inspectLottie` checks contract metadata, canvas and timing, shape-layer-only output, group transforms, path cardinality, paint properties, keyframes, assets, expressions and unsupported layer types.

`inspectDotLottie` additionally checks ZIP structure, entry paths, duplicate names, compression, manifest v2, initial animation resolution, size limits and the embedded Lottie inspection.

Structural validity is necessary but not sufficient for renderer compatibility.

## Evidence and compatibility boundary

Lottie JSON export evidence deliberately reports operation-level archive state:

```text
structuralInspection: passed
playerRenderValidation: not-yet-performed
dotLottiePackaging: not-yet-available
approval: review-required
```

That means the JSON export operation did not produce a `.lottie` archive. Separate deterministic dotLottie core and CLI packaging is available and records its own evidence:

```text
archiveInspection: passed
embeddedLottieInspection: passed
playerRenderValidation: not-yet-performed
browserArchiveLoadValidation: not-yet-performed
approval: review-required
```

Lottie JSON and dotLottie archives cannot embed the animated SVG `prefers-reduced-motion` media rule. Delivery surfaces must provide pause controls or an intentional static alternative.

## Approval boundary

A generated JSON file or dotLottie archive remains `review-required` even when structural inspection passes and a browser player loads the JSON.

Human review must assess source-versus-player visual equivalence, fill and stroke rendering, paint order, transform origins, timing, easing, player compatibility, accessibility and brand fidelity.

Production availability will not be claimed until independent player-render evidence is implemented and retained.
