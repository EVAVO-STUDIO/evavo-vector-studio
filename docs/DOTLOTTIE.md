# EVAVO Vector Studio dotLottie Contract

Vector Studio dotLottie v1 packages one governed Lottie JSON animation into one deterministic dotLottie v2 archive.

The objective is not general archive passthrough. The package writer and inspector implement a deliberately small, auditable subset with fixed archive metadata, strict paths, bounded decompression and explicit compatibility evidence.

## Current availability

Implemented now:

- deterministic dotLottie v2 ZIP creation;
- DEFLATE compression for every entry;
- fixed entry order and fixed `1980-01-01 00:00:00` ZIP timestamps;
- one `manifest.json` entry and one `a/<animation-id>.json` animation entry;
- portable animation IDs and canonical embedded Lottie JSON;
- governed embedded-Lottie structural inspection;
- central-directory and local-header validation;
- duplicate, traversal, absolute-path and backslash rejection;
- ZIP64, encryption, multi-disk, entry-extra and entry-comment rejection;
- compressed and uncompressed size limits checked before decompression;
- deterministic archive SHA-256 evidence;
- atomic new-file-only CLI packaging and inspection;
- authenticated HTTP packaging with direct archive or bounded base64 delivery;
- receipt-only MCP packaging and inspection under canonical allowed roots;
- browser archive generation through the Motion Director;
- browser verification of archive bytes, ZIP signature, SHA-256, manifest identity and retained server inspection;
- verified `ArrayBuffer` loading through `@lottiefiles/dotlottie-react`;
- browser `load` and `loadError` lifecycle evidence.

Not yet available:

- themes;
- state machines;
- packaged images, fonts or audio;
- multiple animations in one archive;
- independent source-to-player render comparison;
- cross-player pixel-equivalence evidence.

Unsupported features are rejected rather than silently discarded.

## Archive layout

The governed package contains exactly two entries:

```text
manifest.json
a/<animation-id>.json
```

The manifest is dotLottie v2:

```json
{
  "version": "2",
  "generator": "EVAVO Vector Studio 0.4.0",
  "initial": {
    "animation": "main-animation"
  },
  "animations": [
    {
      "id": "main-animation"
    }
  ]
}
```

The package MIME type is:

```text
application/zip+dotlottie
```

The file extension is `.lottie`.

## CLI workflow

Package governed Lottie JSON:

```powershell
pnpm vector:dotlottie:package -- `
  .\outputs\gentle-entrance.lottie.json `
  --out .\outputs\gentle-entrance.lottie `
  --animation-id gentle-entrance `
  --evidence-out .\outputs\gentle-entrance.dotlottie.evidence.json
```

Inspect an existing archive:

```powershell
pnpm vector:dotlottie:inspect -- `
  .\outputs\gentle-entrance.lottie
```

Discover the machine-readable contract:

```powershell
pnpm vector:dotlottie:capabilities
```

The installed binary is `evavo-dotlottie` and exposes:

```text
evavo-dotlottie package <input.json>
evavo-dotlottie inspect <input.lottie>
evavo-dotlottie capabilities
```

`package` accepts:

| Option | Purpose |
| --- | --- |
| `--out` | New `.lottie` output path. Defaults beside the input. |
| `--animation-id` | Portable 1 to 64 character ID. Defaults to `main-animation`. |
| `--evidence-out` | Optional new JSON evidence path committed atomically with the archive. |

Existing output paths are never replaced. Source, archive and evidence paths must be distinct.

## HTTP API workflow

The authenticated packaging endpoint is:

```http
GET  /api/v1/motion/dotlottie
POST /api/v1/motion/dotlottie
```

It accepts one governed path-based SVG and exactly one inline `motion` plan or uploaded `motionFile`. Optional fields are `frameRate`, `precision`, `name`, `animationId` and `format`.

Use `format=dotlottie` for direct binary delivery:

```powershell
curl.exe -X POST "http://localhost:3000/api/v1/motion/dotlottie" `
  -H "Authorization: Bearer $env:VECTOR_API_TOKEN" `
  -F "file=@fixtures\motion\gentle-entrance.source.svg;type=image/svg+xml" `
  -F "motionFile=@fixtures\motion\gentle-entrance.motion.json;type=application/json" `
  -F "animationId=gentle-entrance" `
  -F "format=dotlottie" `
  --output "outputs\gentle-entrance.lottie"
```

Direct responses use `application/zip+dotlottie` and retain compact contract, manifest, hash, entry-count, inspection and compatibility headers.

`format=json` returns the archive as bounded base64 together with the generated Lottie inspection, manifest, archive inspection and evidence. Base64 wrapper transport is capped at 8 MiB; direct archives may use the full 25 MiB application limit.

The endpoint performs strict multipart validation, production bearer-token enforcement, fatal UTF-8 decoding, governed Lottie generation, deterministic archive packaging, archive inspection and exact source/intermediate/archive SHA-256 evidence.

## MCP workflow

MCP contract `1.3` exposes:

- `vector_package_dotlottie`;
- `vector_inspect_dotlottie`.

Package an existing governed Lottie JSON file:

```json
{
  "inputPath": "C:\\EVAVO\\VectorAssets\\output\\mark.lottie.json",
  "outputPath": "C:\\EVAVO\\VectorAssets\\output\\mark.lottie",
  "evidenceOutputPath": "C:\\EVAVO\\VectorAssets\\output\\mark.dotlottie.evidence.json",
  "animationId": "mark-intro"
}
```

Inspect the committed archive:

```json
{
  "inputPath": "C:\\EVAVO\\VectorAssets\\output\\mark.lottie"
}
```

Both tools use canonical allowed-root, new-files-only and atomic transaction policies. `vector_package_dotlottie` returns manifest, inspection, compatibility state and SHA-256 file receipts, but never returns archive bytes or embedded generated Lottie JSON in model context.

## Browser Motion Director workflow

The browser Motion Director uses the same selected SVG and normalized motion plan as animated SVG and Lottie JSON production.

The archive workflow:

1. posts the exact SVG and normalized plan to `/api/v1/motion/dotlottie` in bounded JSON mode;
2. decodes the returned base64 archive;
3. verifies decoded byte count and the ZIP local-file signature;
4. verifies archive SHA-256 against retained output evidence;
5. verifies source and intermediate Lottie identities;
6. verifies manifest version `2`, initial animation ID, sole animation descriptor and exact entry order;
7. checks server archive inspection and embedded-Lottie inspection;
8. creates a `.lottie` download only after verification;
9. passes only verified archive `ArrayBuffer` data to `@lottiefiles/dotlottie-react`;
10. records the official player `load` or `loadError` event;
11. creates a separate browser evidence download without embedding archive bytes.

When the player emits `load`, the local browser evidence records:

```text
browserArchiveLoadValidation: passed
```

A successful browser archive-load validation proves that the selected player accepted the exact verified archive in that browser session. It does not establish source-to-player render equivalence, pixel fidelity, paint-order fidelity, timing fidelity, cross-player compatibility or artistic approval.

Reduced-motion preference disables autoplay and looping. Delivery surfaces still need an intentional static alternative or pause controls because a `.lottie` archive cannot embed the animated-SVG `prefers-reduced-motion` media rule.

## Deterministic archive policy

For identical input JSON and options, package bytes and SHA-256 are identical.

The writer fixes:

- manifest formatting;
- animation JSON canonicalization;
- entry order;
- compression method and level;
- operating-system field;
- file attributes;
- ZIP timestamps;
- archive and entry comments to absent;
- entry extras to absent.

The writer does not include current time, random identifiers, machine paths or host metadata.

## Inspector boundary

`inspectDotLottie` validates the archive before accepting embedded JSON. It checks:

- ZIP local-header signature and end-of-central-directory location;
- single-disk and non-ZIP64 structure;
- central-directory range and entry count;
- UTF-8 safe relative paths and duplicate names;
- encryption and DEFLATE compression;
- central/local header agreement;
- local-entry and central-directory overlap;
- declared compressed and uncompressed sizes;
- deterministic timestamps;
- exact governed entry set;
- manifest JSON and known fields;
- manifest version `2` and initial animation resolution;
- sole animation descriptor and matching `a/<id>.json` entry;
- embedded UTF-8 JSON and governed Lottie structural inspection.

A structurally invalid archive returns findings and `structural-repair-required`. It is not presented as usable output.

## Limits

```text
Lottie JSON input or embedded animation 20 MiB
Generated or inspected archive          25 MiB
Base64 API wrapper archive               8 MiB
Total declared uncompressed content     24 MiB
Manifest                                64 KiB
ZIP entries                             16 maximum
Governed generated entries              exactly 2
```

The inspector rejects oversized declared content before decompression. These application limits do not override lower host, filesystem or deployment limits.

## Evidence

Each package records:

- source and canonical embedded Lottie JSON bytes and SHA-256;
- source Lottie structural inspection;
- exact manifest;
- archive MIME type, extension, bytes and SHA-256;
- entry count, entry order and compressed/uncompressed totals;
- deterministic ZIP policy;
- archive and embedded-Lottie inspection state;
- player-render and browser archive-load validation state;
- warnings and approval state.

Core, CLI, API and MCP package evidence begins with:

```text
archiveInspection: passed
embeddedLottieInspection: passed
playerRenderValidation: not-yet-performed
browserArchiveLoadValidation: not-yet-performed
approval: review-required
```

The browser may later record `browserArchiveLoadValidation: passed` after exact archive verification and an official-player `load` event. This browser-local event does not change `playerRenderValidation`.

## Approval boundary

A deterministic archive can be structurally correct and successfully loaded while the animation is visually wrong or incompatible with another target player.

Human review must assess source-to-player visual equivalence, paint order, fill rules, stroke rendering, transform origins, timing, easing, reduced-motion delivery, platform compatibility and brand fidelity.

Production approval remains unavailable until independent player-render evidence is implemented and retained.
