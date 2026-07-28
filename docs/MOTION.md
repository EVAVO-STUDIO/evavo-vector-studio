# EVAVO Vector Studio Motion Contract

Vector Studio motion v1 creates deterministic, script-free CSS animation inside an already governed SVG. The same validated plan can also drive governed path-based Lottie JSON and deterministic dotLottie v2 packaging when the source and playback settings remain inside the smaller Lottie subset.

The objective is editable, inspectable motion with explicit timing and accessibility behaviour. Every output remains review-required.

## Current availability

Implemented now:

- motion-plan validation and normalization;
- ID-targeted opacity, translation, uniform scale and rotation;
- timing, delay, iteration, direction and fill-mode controls;
- easing presets and cubic Bézier easing;
- deterministic CSS `@keyframes` generation;
- required `prefers-reduced-motion` fallback for animated SVG;
- source and output SHA-256 evidence;
- animated SVG inspection;
- browser Motion Director at `/motion`;
- CLI animated SVG creation and optional JSON evidence;
- motion authoring through the HTTP API;
- API inline plan and uploaded plan-file support with JSON or direct animated SVG responses;
- MCP inline and file-based plan validation, creation and inspection;
- governed Lottie JSON through core, CLI, API, MCP and browser review;
- deterministic dotLottie packaging through core, CLI, API, MCP and browser review;
- browser Lottie player preview for verified JSON and verified `.lottie` archive bytes;
- browser archive-load validation from official-player `load` and `loadError` events.

Not implemented:

- path-data morphing or motion paths;
- colour, gradient, stroke, filter or mask animation;
- separate X and Y scale;
- spring or physics simulation;
- graphical Bézier handles or a drag-to-scrub timeline;
- independent source-to-player render comparison.

These features are not silently approximated.

## Source requirements

The source must be a governed SVG that passes Vector Studio safety and topology inspection.

Every motion track references exactly one existing SVG element by `id`. Duplicate or missing IDs are rejected.

The v1 transform system rejects a target that already has a `transform` attribute or inline CSS transform. CSS keyframes would replace that base transform rather than safely compose with it. Wrap the target in a new identified group or revise the static SVG before authoring motion.

Sources containing existing SMIL animation, CSS `@keyframes`, CSS animation declarations or EVAVO motion metadata are rejected. Motion plans are applied to clean static revisions rather than stacking animation systems unpredictably.

## Motion plan schema

The machine-readable schema is:

```text
schemas/motion-v1.schema.json
```

A complete fixture is:

```text
fixtures/motion/gentle-entrance.motion.json
```

The runtime validator remains authoritative for rules that JSON Schema cannot express cleanly across an array:

- offsets begin at `0` and end at `1`;
- offsets are strictly increasing;
- a track changes opacity or transform values;
- each target ID appears in only one track;
- every target resolves exactly once;
- unknown properties are rejected.

The optional root `$schema` annotation is accepted for editor integration. Other unknown properties are rejected.

A normalized plan remains valid motion-v1 input. It does not serialize renderer-only fields, so it can be saved, reloaded and reused by the browser, API, CLI, MCP, animated SVG, Lottie JSON and dotLottie packaging without contract drift.

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

Every generated animated SVG includes a `prefers-reduced-motion: reduce` rule. The plan chooses:

- `source`: disable animation and preserve the original state;
- `first-frame`: disable animation and apply the first normalized keyframe;
- `last-frame`: disable animation and apply the final normalized keyframe.

The reduced-motion fallback is mandatory and checked by the browser Motion Director, CLI `motion:inspect`, the HTTP endpoint and MCP `vector_inspect_animated_svg`.

Lottie JSON and dotLottie cannot embed this CSS media-query fallback. Their delivery surfaces must provide pause controls, autoplay restraint and an intentional static alternative. The browser Motion Director disables autoplay and looping when reduced motion is preferred.

## Browser Motion Director

Open:

```text
http://localhost:3000/motion
```

The browser Motion Director screens malformed or unsafe SVG locally, discovers portable target IDs, flags base transforms, supports presets and multi-track keyframes, and sends normalized JSON to `POST /api/v1/motion/svg`.

Before display it verifies source/output SHA-256, motion identity, style identity, target order, reduced-motion fallback and script-free evidence.

The editor uses Blob-backed `<img>` previews rather than injecting returned SVG markup. It supports replay and downloads for animated SVG, normalized plan and evidence, and marks shown results stale when the plan changes.

The same browser workspace can:

- export and verify Lottie JSON through `/api/v1/motion/lottie`;
- load verified JSON in the official browser Lottie player preview;
- package deterministic dotLottie through `/api/v1/motion/dotlottie`;
- verify base64 archive bytes, ZIP signature, SHA-256, manifest and archive inspection;
- pass only verified archive `ArrayBuffer` data to the official player;
- record browser archive-load validation from `load` or `loadError`;
- download `.lottie` and separate evidence files.

Independent player-render validation remains unavailable. Player loading is a delivery-context result, not source-to-player visual equivalence.

## CLI workflow

Validate and normalize a plan:

```powershell
pnpm vector:motion:validate -- `
  .\fixtures\motion\gentle-entrance.motion.json
```

Create animated SVG and evidence:

```powershell
pnpm vector:animate-svg -- `
  .\fixtures\motion\gentle-entrance.source.svg `
  --motion .\fixtures\motion\gentle-entrance.motion.json `
  --out .\outputs\gentle-entrance.animated.svg `
  --evidence-out .\outputs\gentle-entrance.motion.evidence.json
```

Inspect animated SVG:

```powershell
pnpm vector:motion:inspect -- `
  .\outputs\gentle-entrance.animated.svg
```

Output commands use atomic new-file-only transactions. Existing destinations and path collisions are rejected. When SVG and evidence are requested, either both commit or the transaction rolls back.

## Animated SVG HTTP API

The endpoint is:

```http
POST /api/v1/motion/svg
```

It accepts one governed SVG and exactly one inline plan in `motion` or uploaded plan in `motionFile`. `format=json` returns the normalized plan, animated SVG and evidence. `format=svg` returns a direct animated SVG with compact identity, SHA-256, reduced-motion and review headers.

The SVG limit is 5 MiB and plan limit is 256 KiB. Unknown or duplicate fields, malformed requests, invalid motion, missing targets and unsafe base transforms are rejected.

The JSON result includes the normalized plan, animated SVG, inspection, source/output hashes, deterministic motion identity and review evidence.

## Governed Lottie JSON derivation

A motion-v1 plan can drive Lottie JSON only inside the initial subset:

- exactly one iteration;
- normal direction;
- `forwards` or `both` fill mode;
- opacity, translation, uniform scale and rotation only;
- path-based SVG source with flattened transforms and supported solid paint.

Lottie JSON export is available through the core package, CLI, HTTP API, MCP and browser Motion Director.

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

It accepts the same inline or uploaded plan plus optional `frameRate`, `precision`, `name` and `format`.

## dotLottie packaging

Deterministic dotLottie packaging is available through core, CLI, API, MCP and the browser Motion Director.

```powershell
pnpm vector:dotlottie:package -- `
  .\outputs\gentle-entrance.lottie.json `
  --out .\outputs\gentle-entrance.lottie `
  --animation-id gentle-entrance
```

The direct packaging API is:

```http
POST /api/v1/motion/dotlottie
```

MCP contract `1.3` exposes `vector_package_dotlottie` and `vector_inspect_dotlottie` with receipt-only allowed-root output.

Browser archive-load validation is available after the browser verifies the exact archive response and the official player emits `load`. It remains distinct from independent source-to-player rendering.

## MCP workflow

MCP contract `1.3` exposes motion tools:

- `vector_validate_motion_plan`;
- `vector_animate_svg`;
- `vector_inspect_animated_svg`.

It also exposes Lottie JSON and dotLottie tools through the same allowed-root, new-file-only and atomic transaction policies. Generated bodies remain outside model context and are represented by file receipts.

## Generated animated SVG output

The engine injects:

- `data-evavo-motion-contract="1.0"` on the SVG root;
- a deterministic motion ID;
- one internal `<style>` element;
- one animation and keyframe rule per target;
- one reduced-motion rule per target.

The source `<title>` and `<desc>` remain ahead of injected style. The engine adds no scripts and no external references.

## Evidence and approval

Animated SVG evidence records source bytes and SHA-256, normalized playback, target/keyframe counts, output hash, deterministic identities, script-free and reduced-motion assertions, warnings and approval.

Lottie evidence records source/output hashes, normalized motion, layer/path counts, structural inspection, `playerRenderValidation: not-yet-performed`, warnings and approval.

dotLottie evidence records source/intermediate/archive hashes, manifest, entry order, archive and embedded-Lottie inspection, browser archive-load state and `playerRenderValidation: not-yet-performed`.

`review-required` remains mandatory. Human review must assess visual rhythm, transform origins, easing, brand character, reduced-motion delivery, Lottie source-versus-player fidelity, archive compatibility and final platform behaviour.
