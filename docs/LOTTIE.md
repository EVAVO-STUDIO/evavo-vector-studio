# EVAVO Vector Studio Lottie Contract

Vector Studio Lottie v1 converts one governed path-based SVG and one validated motion-v1 plan into deterministic Lottie JSON.

The objective is not broad best-effort conversion. The exporter accepts a deliberately bounded subset, preserves source paint order, records evidence and rejects source semantics it cannot represent faithfully.

## Current availability

Implemented in `@evavo/lottie-engine`, the `evavo-vector` CLI, authenticated HTTP APIs, MCP contract `1.3` and the browser Motion Director:

- static SVG path geometry converted to Lottie Bézier paths;
- absolute and relative `M`, `L`, `H`, `V`, `C`, `S`, `Q`, `T`, `A` and `Z` commands;
- quadratic and elliptical-arc conversion to cubic Bézier segments;
- compound subpaths, nonzero fill and even-odd fill;
- solid fill and solid stroke presentation;
- opacity, translation, uniform scale and rotation layer animation;
- validated easing and frame-based keyframes;
- deterministic JSON, SHA-256 evidence and structural inspection;
- static layers for source paths outside motion targets;
- atomic new-file-only CLI and MCP output with optional evidence JSON;
- HTTP wrapper evidence or direct `video/lottie+json` delivery;
- receipt-only MCP responses that keep generated bodies outside model context;
- browser verification of exact JSON bytes, source/output SHA-256, parsed metadata and structural evidence;
- browser Lottie player preview through `@lottiefiles/dotlottie-react` with reduced-motion autoplay suppression;
- deterministic dotLottie packaging through core, CLI, API, MCP and browser Motion Director;
- browser dotLottie archive-load validation after exact archive verification and an official-player `load` event.

Not yet available:

- independent source-to-player render comparison;
- cross-player pixel-equivalence testing;
- graphical Lottie timeline controls beyond the shared motion-plan editor;
- gradients, images, text, masks, filters, expressions, precompositions, path morphing or motion paths;
- repeated, reversed or alternating playback encoded into the exported composition.

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

Inspect Lottie JSON against the governed structural subset:

```powershell
pnpm vector:lottie:inspect -- `
  .\outputs\gentle-entrance.lottie.json
```

`--motion` is required. `--out` defaults to `<source>.lottie.json`. Frame rate must be 1 to 120 and precision must be 0 to 6.

The CLI rejects source, plan, output and evidence collisions. It never replaces an existing output. Lottie JSON and optional evidence commit as one transaction or roll back together.

## HTTP API workflow

The authenticated Lottie JSON endpoint is:

```http
GET  /api/v1/motion/lottie
POST /api/v1/motion/lottie
```

`POST` requires `multipart/form-data` with a governed static SVG and exactly one inline `motion` plan or uploaded `motionFile`. Optional fields are `format`, `frameRate`, `precision` and `name`.

`format=json` returns exact serialized JSON in `lottie.data`, normalized motion, structural inspection and complete evidence. `format=lottie` returns direct `video/lottie+json`.

The generated JSON body is capped at 20 MiB. The endpoint is synchronous and does not persist files.

The separate deterministic archive endpoint is:

```http
POST /api/v1/motion/dotlottie
```

It uses the same governed SVG and motion plan, creates Lottie JSON first, then packages and inspects a dotLottie v2 archive. Use `format=dotlottie` for direct binary output or `format=json` for bounded base64 plus archive evidence.

## MCP workflow

MCP contract `1.3` exposes Lottie JSON tools:

- `vector_export_lottie`;
- `vector_inspect_lottie`.

It also exposes archive tools:

- `vector_package_dotlottie`;
- `vector_inspect_dotlottie`.

All output tools use allowed-root, new-files-only and atomic transaction policies. Generated Lottie JSON and archive bytes remain outside model context and are represented by receipts containing path, MIME type, byte count and SHA-256.

## Browser Motion Director workflow

The browser Motion Director uses the same selected SVG and normalized motion plan for animated SVG, Lottie JSON and dotLottie delivery.

For Lottie JSON it:

1. checks the smaller playback subset;
2. posts the exact source and plan to `/api/v1/motion/lottie`;
3. verifies source and output byte counts and SHA-256;
4. parses JSON and validates governed metadata, dimensions, frame rate, layers and assets;
5. checks structural inspection and unsupported feature counts;
6. passes only verified JSON to the client-only official player;
7. disables autoplay and looping when reduced motion is preferred;
8. exposes separate JSON and evidence downloads;
9. marks results stale when source, plan, frame rate or precision changes.

The browser Lottie player preview uses `@lottiefiles/dotlottie-react`. It is a delivery-context preview and not independent source-to-player validation.

For dotLottie the browser:

1. posts the exact source and plan to `/api/v1/motion/dotlottie` in bounded JSON mode;
2. decodes and verifies archive bytes, ZIP signature and SHA-256;
3. verifies manifest identity, entry order, archive inspection and embedded-Lottie inspection;
4. passes only verified archive `ArrayBuffer` data to the official player;
5. records `load` or `loadError` as browser archive-load evidence;
6. exposes separate `.lottie` and evidence downloads.

A successful browser dotLottie archive-load validation proves that this player accepted the exact verified archive in the current browser session. It does not establish pixel equivalence, paint fidelity, timing fidelity, cross-player compatibility or artistic approval.

## Programmatic workflow

```ts
import {
  createLottieFromSvgMotion,
  inspectLottie,
} from "@evavo/lottie-engine";

const result = createLottieFromSvgMotion(svgSource, motionPlan, {
  frameRate: 60,
  precision: 4,
  name: "Directed mark",
});

if (!result.inspection.valid) {
  throw new Error("Generated Lottie failed structural inspection.");
}

const independentInspection = inspectLottie(result.json);
```

## SVG source requirements

The source must pass governed SVG inspection and include an integer `viewBox` width and height from 1 to 8192.

Lottie v1 accepts:

- `svg`, `g`, metadata elements and `path` geometry;
- solid hex, `rgb()`, `rgba()` and the portable named-colour set;
- unitless or `px` stroke widths;
- butt, round and square caps;
- miter, round and bevel joins;
- nonzero or even-odd fill rules.

The exporter rejects:

- unflattened transforms;
- group opacity that changes overlap compositing;
- hidden nodes;
- gradients, patterns, masks, filters, clipping paths, markers and referenced content;
- text, images, `use` and primitive shapes not converted to paths;
- dashed strokes;
- external references or active content;
- overlapping motion targets.

## Paint order and shape grouping

Lottie shape arrays use reverse stack order, while fill and stroke shapes apply to preceding path shapes in the same group. Vector Studio therefore:

1. preserves source SVG path order as evidence;
2. writes later source paths first in each Lottie layer;
3. writes path geometry before stroke and fill styles;
4. keeps the group transform as the final shape item;
5. writes later source render units first in the top-level layer array.

This is deliberate format translation, not arbitrary reversal.

## Motion subset

Supported:

- exactly one playback cycle;
- normal direction;
- `forwards` or `both` fill mode;
- delay plus duration;
- opacity;
- X/Y translation;
- uniform scale;
- rotation;
- fill-box or view-box transform origins;
- easing presets and cubic Bézier easing.

Rejected:

- infinite or repeated iterations;
- reverse and alternating direction;
- `none` or `backwards` fill mode;
- unsupported source animation or transform composition.

## Structural inspection

`inspectLottie` checks contract metadata, canvas and timing bounds, shape-layer-only output, layer ranges, group-transform placement, static path geometry, fill/stroke/transform properties, ascending keyframes, easing arrays and the absence of expressions, assets, image layers, text layers and precompositions.

Structural validity is necessary but not sufficient for renderer compatibility.

## Evidence and compatibility boundary

Each JSON export records source bytes and SHA-256, viewBox, SVG inspection, normalized motion, layer and path counts, dimensions, frame rate, timing, subset support, structural inspection, warnings and approval.

The Lottie JSON result deliberately retains:

```text
structuralInspection: passed
playerRenderValidation: not-yet-performed
dotLottiePackaging: not-yet-available
approval: review-required
```

`dotLottiePackaging: not-yet-available` is retained in the Lottie JSON v1 result contract for backward compatibility. The separate dotLottie packaging engine, API, CLI, MCP and browser workflow are available and maintain their own archive evidence.

Lottie JSON cannot embed the animated-SVG `prefers-reduced-motion` rule. Delivery surfaces must provide pause controls or an intentional static alternative.

## Approval boundary

A generated file remains `review-required` even when structural inspection passes, JSON verifies, an archive loads and a browser player displays animation.

Human review must assess source-versus-player visual equivalence, fill and stroke rendering, paint order, transform origins, timing, easing, player compatibility, accessibility and brand fidelity.

Production availability will not be claimed until independent player-render evidence is implemented and retained.
