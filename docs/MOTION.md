# EVAVO Vector Studio Motion Contract

Vector Studio motion v1 creates deterministic, script-free CSS animation inside an already governed SVG. The same validated plan can drive governed path-based Lottie JSON when the plan and source stay inside the smaller Lottie compatibility subset.

The objective is editable, inspectable motion with explicit timing and accessibility behaviour. Every generated output remains review-required.

## Current availability

Implemented now:

- motion plan validation;
- ID-targeted opacity, translation, uniform scale and rotation;
- timing, delay, iteration, direction and fill-mode controls;
- easing presets and cubic Bézier easing;
- deterministic CSS `@keyframes` generation;
- required `prefers-reduced-motion` fallback for animated SVG;
- source and output SHA-256 evidence;
- animated SVG inspection;
- responsive browser Motion Director at `/motion`;
- CLI animated SVG creation and optional JSON evidence;
- authenticated animated-SVG and Lottie authoring through HTTP APIs;
- MCP inline and file-based plan validation, animated-SVG creation and inspection;
- governed Lottie JSON export and inspection through the core package, CLI, HTTP API and MCP;
- browser Lottie player preview after exact JSON, SHA-256 and structural evidence verification;
- reduced-motion-aware suppression of Lottie autoplay and looping;
- downloadable animated SVG, Lottie JSON, normalized motion plans and separate evidence records.

Not implemented:

- path-data morphing or motion paths;
- colour, gradient, stroke, filter or mask animation;
- separate X and Y scale;
- spring or physics simulation;
- graphical Bézier handles or a drag-to-scrub timeline;
- independent player-render validation against the source or a reference renderer;
- dotLottie packaging.

These features are not silently approximated.

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

A normalized plan remains valid motion-v1 input. It does not serialize renderer-only fields, so it can be saved, reloaded, sent through API or MCP, and reused by animated SVG or governed Lottie export without contract drift.

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

Every generated animated SVG includes a `prefers-reduced-motion: reduce` rule. The plan chooses one strategy:

- `source`: disable animation and preserve the original static SVG state;
- `first-frame`: disable animation and apply the first normalized keyframe;
- `last-frame`: disable animation and apply the final normalized keyframe.

The reduced-motion fallback is mandatory and is checked by the browser Motion Director, CLI `motion:inspect`, the HTTP endpoint and MCP `vector_inspect_animated_svg`.

Lottie JSON cannot embed this CSS media-query fallback. The browser Motion Director disables Lottie autoplay and looping when the browser prefers reduced motion. Other Lottie delivery surfaces must provide pause controls or an intentional static alternative.

## Browser Motion Director

Open:

```text
http://localhost:3000/motion
```

The browser Motion Director screens malformed or unsafe SVG locally, discovers portable target IDs, flags base transforms, supports presets and multi-track keyframes, and maintains one normalized motion plan for animated SVG and governed Lottie derivation.

For animated SVG it sends normalized JSON to `POST /api/v1/motion/svg` and verifies source/output SHA-256, motion identity, style identity, target order, reduced-motion fallback and script-free evidence before display. The editor uses Blob-backed `<img>` previews rather than injecting SVG markup.

For governed Lottie it:

1. checks the smaller playback subset before submitting;
2. sends the same source and exact normalized plan to `POST /api/v1/motion/lottie`;
3. verifies source and output byte counts and SHA-256;
4. parses the returned JSON and validates metadata, dimensions, frame rate, out point, layers and assets;
5. checks structural inspection and the absence of expressions, image layers, text layers and precompositions;
6. passes only verified JSON to the client-only official LottieFiles player;
7. disables autoplay and looping when reduced motion is preferred;
8. exposes separate Lottie JSON and evidence downloads;
9. marks the shown result stale when source, plan, frame rate or precision changes.

The browser Lottie player preview is a delivery-context check. It is not independent player-render validation and does not prove visual equivalence with the source or another player.

## CLI workflow

Validate and normalize a plan:

```powershell
pnpm vector:motion:validate -- `
  .\fixtures\motion\gentle-entrance.motion.json
```

Create an animated SVG and evidence:

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

Output commands use atomic new-file-only transactions. Existing destinations and path collisions are rejected. When both output and evidence are requested, either both commit or the transaction rolls back.

## Animated SVG HTTP API

The endpoint for motion authoring through the HTTP API is:

```http
POST /api/v1/motion/svg
```

It accepts one governed SVG and exactly one inline plan in `motion` or uploaded plan in `motionFile`. `format=json` returns the normalized plan, animated SVG and evidence. `format=svg` returns a direct animated SVG with compact identity, SHA-256, reduced-motion and review headers.

The SVG limit is 5 MiB and the plan limit is 256 KiB. Unknown or duplicate multipart fields, malformed requests, invalid motion, missing targets and unsafe base transforms are rejected.

The JSON result includes the normalized plan, animated SVG, inspection, source/output hashes, deterministic motion identity and review evidence.

## Governed Lottie JSON derivation

A motion-v1 plan can drive Lottie JSON only when it is inside the initial Lottie subset:

- exactly one iteration;
- normal direction;
- `forwards` or `both` fill mode;
- opacity, translation, uniform scale and rotation only;
- path-based SVG source with flattened transforms and supported solid paint.

CLI export:

```powershell
pnpm vector:lottie:export -- `
  .\fixtures\motion\gentle-entrance.source.svg `
  --motion .\fixtures\motion\gentle-entrance.motion.json `
  --out .\outputs\gentle-entrance.lottie.json `
  --evidence-out .\outputs\gentle-entrance.lottie.evidence.json
```

Lottie HTTP API is available at:

```http
POST /api/v1/motion/lottie
```

It accepts the same inline plan or uploaded plan file plus optional `frameRate`, `precision`, `name` and `format`. `format=json` returns exact serialized Lottie JSON and evidence; `format=lottie` returns direct `video/lottie+json` with compact headers.

Lottie JSON export is available through the core package, CLI, HTTP API, MCP and browser Motion Director. Independent player-render validation and dotLottie remain unavailable. Every export remains `review-required`.

See [`LOTTIE.md`](LOTTIE.md) for the smaller SVG subset, paint-order translation, structural inspector, browser player boundary and compatibility evidence.

## MCP workflow

MCP contract `1.2` exposes motion and Lottie tools:

- `vector_validate_motion_plan`;
- `vector_animate_svg`;
- `vector_inspect_animated_svg`;
- `vector_export_lottie`;
- `vector_inspect_lottie`.

A plan may be provided inline or by `motionPath`. Outputs use allowed-root, new-file-only and atomic transaction policies. Animated SVG, Lottie JSON and optional evidence files return path, MIME type, byte count and SHA-256 receipts rather than generated bodies in model context.

MCP Lottie preserves the same compatibility non-claims as CLI, API and browser:

```text
structuralInspection: passed
playerRenderValidation: not-yet-performed
dotLottiePackaging: not-yet-available
approval: review-required
```

## Generated animated SVG output

The engine injects:

- `data-evavo-motion-contract="1.0"` on the SVG root;
- a deterministic motion ID;
- one internal `<style>` element;
- one animation and keyframe rule per target;
- one reduced-motion rule per target.

The source `<title>` and `<desc>` remain ahead of the injected style. The engine adds no scripts and no external references.

## Evidence and approval

Animated SVG evidence records source bytes and SHA-256, normalized playback, target and keyframe counts, output hash, deterministic identities, script-free and reduced-motion assertions, warnings and approval.

Lottie evidence records source and output hashes, normalized motion, layer and path counts, exact supported subset, structural inspection, `playerRenderValidation: not-yet-performed`, `dotLottiePackaging: not-yet-available`, warnings and approval.

`review-required` remains mandatory. Human review must assess visual rhythm, transform origins, easing, brand character, reduced-motion delivery, Lottie source-versus-player fidelity and final platform compatibility.
