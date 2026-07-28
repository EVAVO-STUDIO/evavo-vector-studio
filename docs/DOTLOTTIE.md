# EVAVO Vector Studio dotLottie Contract

Vector Studio dotLottie v1 packages one governed Lottie JSON animation into one deterministic dotLottie v2 archive.

The objective is not general archive passthrough. The package writer and inspector implement a deliberately small, auditable subset with fixed archive metadata, strict paths, bounded decompression and explicit compatibility evidence.

## Current availability

Implemented now:

- deterministic dotLottie v2 ZIP creation;
- DEFLATE compression for every entry;
- fixed entry order;
- fixed `1980-01-01 00:00:00` ZIP timestamps;
- one `manifest.json` entry;
- one `a/<animation-id>.json` animation entry;
- portable animation IDs;
- canonical embedded Lottie JSON;
- governed embedded-Lottie structural inspection;
- central-directory and local-header validation;
- duplicate, traversal, absolute-path and backslash rejection;
- ZIP64, encryption, multi-disk, entry-extra and entry-comment rejection;
- compressed and uncompressed size limits;
- deterministic archive SHA-256 evidence;
- atomic new-file-only CLI package and optional evidence output;
- CLI structural inspection for existing `.lottie` files;
- authenticated HTTP packaging from the same governed SVG and motion plan used by Lottie JSON export;
- direct `.lottie` delivery and bounded base64 wrapper evidence.

Not yet available:

- dotLottie MCP tools;
- browser `.lottie` archive generation or browser archive-load validation;
- themes;
- state machines;
- packaged images, fonts or audio;
- multiple animations in one archive;
- independent player-render comparison.

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

The file extension is:

```text
.lottie
```

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

The installed binary is also available as:

```text
evavo-dotlottie
```

Commands:

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

The endpoint performs:

1. strict multipart field validation;
2. production bearer-token enforcement;
3. fatal UTF-8 decoding;
4. governed Lottie JSON generation;
5. deterministic dotLottie v2 packaging;
6. archive and embedded-Lottie inspection;
7. exact source, intermediate and archive SHA-256 evidence;
8. explicit player-render and browser archive-load non-claims.

## Deterministic archive policy

For identical input JSON and options, the package bytes and SHA-256 are identical.

The writer fixes:

- manifest formatting;
- animation JSON canonicalization;
- entry order;
- compression method and level;
- operating-system field;
- file attributes;
- ZIP timestamps;
- archive comments and entry comments to absent;
- entry extras to absent.

The writer does not include current time, random identifiers, machine paths or host metadata.

## Inspector boundary

`inspectDotLottie` validates the archive before accepting embedded JSON.

It checks:

- ZIP local-header signature;
- end-of-central-directory location;
- single-disk structure;
- non-ZIP64 bounds;
- central-directory byte range;
- entry count;
- UTF-8 file names;
- safe relative paths;
- duplicate names;
- encryption state;
- DEFLATE compression;
- central/local header agreement;
- local entry overlap;
- central-directory overlap;
- declared compressed and uncompressed sizes;
- deterministic timestamps;
- exact governed entry set;
- manifest JSON and known fields;
- manifest version `2`;
- initial animation resolution;
- sole animation descriptor;
- matching `a/<id>.json` entry;
- embedded UTF-8 JSON;
- governed Lottie structural inspection.

A structurally invalid archive returns findings and `structural-repair-required`. It is not presented as a usable package.

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

- source Lottie JSON bytes and SHA-256;
- canonical embedded JSON bytes and SHA-256;
- source Lottie structural inspection;
- exact manifest;
- archive MIME type and extension;
- archive bytes and SHA-256;
- entry count and entry order;
- compressed and uncompressed byte totals;
- ZIP format and compression;
- deterministic timestamp policy;
- unsupported packaged feature state;
- archive and embedded-Lottie inspection state;
- player-render validation state;
- browser archive-load validation state;
- warnings and approval state.

Current compatibility evidence remains:

```text
archiveInspection: passed
embeddedLottieInspection: passed
playerRenderValidation: not-yet-performed
browserArchiveLoadValidation: not-yet-performed
approval: review-required
```

## Accessibility and delivery

A `.lottie` archive cannot embed the animated-SVG `prefers-reduced-motion` media-query fallback. Delivery surfaces need pause controls, autoplay restraint and an intentional static alternative.

Packaging success does not establish playback support in every player. The package must still be tested in intended browsers, applications and platform SDKs.

## Approval boundary

A deterministic archive can be structurally correct while the animation is visually wrong or incompatible with a target player.

Human review must assess:

- source-to-player visual equivalence;
- paint order and fill rules;
- stroke rendering;
- transform origins;
- timing and easing;
- reduced-motion delivery;
- player and platform compatibility;
- logo, illustration and brand fidelity.

Production approval remains unavailable until independent player-render evidence is implemented and retained.
