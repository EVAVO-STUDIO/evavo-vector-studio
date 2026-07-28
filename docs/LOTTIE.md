# EVAVO Vector Studio Lottie Contract

Vector Studio Lottie v1 converts one governed path-based SVG and one validated motion-v1 plan into deterministic Lottie JSON.

The objective is not broad best-effort conversion. The exporter accepts a deliberately bounded subset, preserves source paint order, records evidence, and rejects source semantics it cannot represent faithfully.

## Current availability

Implemented in `@evavo/lottie-engine` and the `evavo-vector` CLI:

- static SVG path geometry converted to Lottie bezier paths;
- absolute and relative `M`, `L`, `H`, `V`, `C`, `S`, `Q`, `T`, `A`, and `Z` commands;
- quadratic and elliptical-arc conversion to cubic bezier segments;
- compound subpaths, nonzero fill, and even-odd fill;
- solid fill and solid stroke presentation;
- layer-transform animation for opacity, translation, uniform scale, and rotation;
- validated easing and frame-based keyframes;
- deterministic JSON, SHA-256 evidence, and independent structural inspection;
- static layers for source paths outside motion targets;
- atomic new-file-only CLI output and optional evidence JSON;
- explicit source-subset, motion-subset, compatibility, and approval boundaries.

Not yet available:

- Lottie HTTP API or MCP tools;
- browser Lottie authoring or player preview;
- independent player-render comparison;
- dotLottie packaging;
- gradients, images, text, masks, filters, expressions, precompositions, path morphing, or motion paths;
- repeated, reversed, or alternating playback encoded into the exported composition.

These features are not silently approximated.

## CLI workflow

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

The result contains:

- parsed animation data;
- deterministic formatted JSON;
- independent structural inspection;
- source, motion, subset, output, compatibility, and approval evidence.

## SVG source requirements

The source must pass the existing governed SVG inspection and include an integer `viewBox` width and height from 1 to 8192.

Lottie v1 accepts only:

- `svg`, `g`, metadata elements, and `path` geometry;
- solid hex, `rgb()`, `rgba()`, and the small documented portable named-colour set;
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

`inspectLottie` checks:

- contract metadata;
- canvas, frame-rate, and time-range bounds;
- shape-layer-only output;
- layer time ranges;
- group transforms placed last;
- static path geometry and bezier-array cardinality;
- fill, stroke, and transform properties;
- ascending animated keyframes and easing arrays;
- absence of expressions, assets, image layers, text layers, and precompositions;
- presence of path geometry and at least one animated property.

Structural validity is necessary but not sufficient for renderer compatibility.

## Evidence and compatibility boundary

Each export records:

- source bytes, SHA-256, viewBox, and governed SVG inspection;
- normalized motion plan and animated target count;
- static layer count;
- output bytes, SHA-256, dimensions, frame rate, duration, layers, and path count;
- exact supported and unsupported feature subset;
- structural inspection state;
- independent player-render validation state;
- dotLottie availability state;
- warnings and approval state.

The current compatibility evidence deliberately reports:

```text
structuralInspection: passed
playerRenderValidation: not-yet-performed
dotLottiePackaging: not-yet-available
approval: review-required
```

Lottie JSON cannot embed the animated SVG `prefers-reduced-motion` media rule. Delivery surfaces must provide pause controls or an intentional static alternative.

## Approval boundary

A generated file remains `review-required` even when structural inspection passes.

Human review must assess:

- source-versus-player visual equivalence;
- fill rules, stroke rendering, and paint order;
- transform origins and layer movement;
- timing and easing character;
- player and platform compatibility;
- accessibility and reduced-motion delivery;
- logo, illustration, and brand fidelity.

Production availability will not be claimed until independent player-render evidence is implemented and retained.
