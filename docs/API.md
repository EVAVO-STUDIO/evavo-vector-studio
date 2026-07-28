# EVAVO Vector Studio API

Vector Studio exposes four bounded synchronous production endpoints:

- `POST /api/v1/trace` for static raster reconstruction;
- `POST /api/v1/motion/svg` for validated animated SVG creation;
- `POST /api/v1/motion/lottie` for governed path-based Lottie JSON export;
- `POST /api/v1/motion/dotlottie` for deterministic dotLottie v2 packaging.

They are intended for interactive work and agent calls that can wait for a response. They are not durable queues. Persistence, resumability, object storage, retries and long-running workers belong in a separate worker service.

Production requests require `Authorization: Bearer <VECTOR_API_TOKEN>`. When `NODE_ENV=production` and `VECTOR_API_TOKEN` is absent, an endpoint returns `503` instead of exposing an unauthenticated processing surface. Local development remains usable without a token.

All responses use `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`.

# Raster trace API

## Service discovery

```http
GET /api/v1/trace
GET /api/v1/input-policy
```

The trace response declares contract version `1.4`, profiles, candidate modes, input limits, adaptive budgets, runtime state and difference-artefact bounds. The policy endpoint returns the shared `one-static-image-per-trace` policy and rejection code `RASTER_MULTI_IMAGE_UNSUPPORTED`.

## Trace request

Send `multipart/form-data` with:

| Field | Required | Values |
| --- | --- | --- |
| `file` | yes | one static PNG, ordinary JPEG, static WebP, single-frame GIF, BMP or single-page classic TIFF |
| `profile` | no | `auto`, `logo`, `icon`, `line-art`, `illustration`, `photo` |
| `candidateMode` | no | `adaptive` or `single`, default `adaptive` |
| `maxColours` | no | integer from 1 to 256 |
| `preservePalette` | no | `true` or `false`, default `true` |
| `optimise` | no | `true` or `false`, default `true` |
| `title` | no | SVG accessibility title, maximum 200 characters |
| `includeDifference` | no | `true` or `false`, default `false` |
| `differenceMaxDimension` | no | integer from 32 to 1024; requires `includeDifference=true`, default 512 |
| `format` | no | `json` or `svg`, default `json` |

`includeDifference=true` requires `format=json`. A direct SVG response cannot carry a second PNG file and its evidence, so the API rejects that combination rather than discarding the requested artefact.

The encoded file limit is 25 MiB. Header-declared and decoded canvases must remain at or below 40 million pixels. Animated APNG, GIF and WebP, JPEG MPO, multi-page TIFF and BigTIFF are not flattened.

Adaptive execution permits at most three candidates through 4,000,000 pixels, two through 12,000,000 pixels, and one above 12,000,000 pixels.

```powershell
curl.exe -X POST "http://localhost:3000/api/v1/trace" `
  -H "Authorization: Bearer $env:VECTOR_API_TOKEN" `
  -F "file=@fixtures\mark.png" `
  -F "profile=logo" `
  -F "candidateMode=adaptive" `
  -F "includeDifference=true" `
  -F "differenceMaxDimension=512" `
  -F "format=json" `
  --output "outputs\mark.trace.json"
```

A successful JSON response contains the selected SVG, source analysis, candidate settings and failures, topology and editability evidence, multi-scale render metrics, selection evidence and an optional difference PNG.

The difference response shape includes exact bytes and metadata:

```json
{
  "evidence": {
    "differenceArtifact": {
      "kind": "visual-difference-heatmap",
      "mimeType": "image/png",
      "width": 512,
      "height": 320,
      "bytes": 12345,
      "sha256": "...",
      "selectedCandidateId": "base"
    }
  },
  "artifacts": {
    "difference": {
      "encoding": "base64",
      "data": "iVBORw0KGgo..."
    }
  }
}
```

The web client validates base64 transport, byte count, PNG signature, IHDR dimensions, selected-candidate binding and SHA-256 before display.

When `format=svg`, the body is the selected SVG. Compact headers include `X-Vector-Job-Id`, `X-Vector-Review-Required`, `X-Vector-Render-Quality`, `X-Vector-Visual-Mae`, `X-Vector-Mismatch-Fraction`, `X-Vector-Selected-Candidate`, `X-Vector-Candidate-Count`, `X-Vector-Runtime-Timeout-Ms` and `X-Vector-Runtime-Max-Concurrent`.

Expected trace errors include `RASTER_INPUT_TOO_LARGE`, `RASTER_FORMAT_UNSUPPORTED`, `RASTER_HEADER_INVALID`, `RASTER_PIXEL_LIMIT_EXCEEDED`, `RASTER_MULTI_IMAGE_UNSUPPORTED`, `RASTER_OPTIONS_INVALID`, `RASTER_DECODE_FAILED`, `RASTER_OUTPUT_INVALID`, `RASTER_RENDER_COMPARISON_FAILED`, `RASTER_DIFFERENCE_ARTIFACT_FAILED`, `RASTER_RUNTIME_BUSY` and `RASTER_RUNTIME_TIMEOUT`.

# Animated SVG API

## Motion service discovery

```http
GET /api/v1/motion/svg
```

The response declares motion contract version `1.0`, request fields, byte limits, supported properties, reduced-motion requirements, authentication and approval policy. It points to the separately governed Lottie endpoint without claiming player-render validation.

## Motion request

`POST /api/v1/motion/svg` requires `multipart/form-data`.

| Field | Required | Values |
| --- | --- | --- |
| `file` | yes | one governed static SVG |
| `motion` | one of two | inline motion v1 JSON string |
| `motionFile` | one of two | uploaded motion v1 JSON file |
| `format` | no | `json` or `svg`, default `json` |

Exactly one of `motion` and `motionFile` is required. The SVG limit is 5 MiB and the plan limit is 256 KiB. A plan supports 1 to 64 tracks and 2 to 100 keyframes per track.

The endpoint rejects unknown or duplicate multipart fields, malformed multipart bodies, unknown motion properties, duplicate targets, missing IDs, no-op tracks, pre-existing animation and unsafe base transforms.

```powershell
curl.exe -X POST "http://localhost:3000/api/v1/motion/svg" `
  -H "Authorization: Bearer $env:VECTOR_API_TOKEN" `
  -F "file=@fixtures\motion\gentle-entrance.source.svg;type=image/svg+xml" `
  -F "motionFile=@fixtures\motion\gentle-entrance.motion.json;type=application/json" `
  -F "format=svg" `
  --output "outputs\gentle-entrance.animated.svg"
```

The JSON result includes the normalized plan, animated SVG, inspection, source and output hashes, deterministic motion identity, reduced-motion evidence and review state.

Direct SVG headers include `X-Vector-Job-Id`, `X-Vector-Motion-Contract`, `X-Vector-Motion-Id`, `X-Vector-Review-Required`, `X-Vector-Source-Sha256`, `X-Vector-Output-Sha256` and `X-Vector-Reduced-Motion`.

Expected motion errors include `MOTION_REQUEST_MEDIA_TYPE_UNSUPPORTED`, `MOTION_REQUEST_TOO_LARGE`, `MOTION_REQUEST_FIELD_UNSUPPORTED`, `MOTION_REQUEST_FIELD_DUPLICATE`, `MOTION_MULTIPART_INVALID`, `MOTION_SVG_FILE_REQUIRED`, `MOTION_SVG_INPUT_EMPTY`, `MOTION_SVG_INPUT_TOO_LARGE`, `MOTION_FORMAT_INVALID`, `MOTION_SPEC_INVALID`, `MOTION_SOURCE_INVALID`, `MOTION_SOURCE_ALREADY_ANIMATED`, `MOTION_TARGET_MISSING`, `MOTION_TARGET_DUPLICATE`, `MOTION_TARGET_BASE_TRANSFORM_UNSUPPORTED`, `MOTION_OUTPUT_INVALID` and `MOTION_REQUEST_ABORTED`.

# Lottie JSON API

## Lottie service discovery

```http
GET /api/v1/motion/lottie
```

The response declares Lottie contract version `1.0`, strict request fields, frame-rate and precision bounds, input and output limits, accepted and rejected source semantics, the supported motion subset and compatibility non-claims.

Structural inspection is available. Independent player-render comparison is not performed. Deterministic dotLottie packaging is available through the separate `/api/v1/motion/dotlottie` endpoint rather than being embedded into this JSON response.

## Lottie request

`POST /api/v1/motion/lottie` requires `multipart/form-data`.

| Field | Required | Values |
| --- | --- | --- |
| `file` | yes | one governed path-based static SVG |
| `motion` | one of two | inline motion v1 JSON string |
| `motionFile` | one of two | uploaded motion v1 JSON file |
| `format` | no | `json` or `lottie`, default `json` |
| `frameRate` | no | integer from 1 to 120, default 60 |
| `precision` | no | integer from 0 to 6, default 4 |
| `name` | no | composition name, 1 to 120 characters |

Exactly one of `motion` and `motionFile` is required. Unknown and duplicate fields are rejected.

Application limits are 5 MiB for SVG input, 256 KiB for a motion plan, 20 MiB for generated Lottie JSON, 64 tracks and 100 keyframes per track.

The initial source subset supports path geometry, compound subpaths, solid fill, solid stroke, nonzero fill and even-odd fill. It rejects unflattened transforms, group opacity, gradients, text, images, masks, filters, expressions, precompositions and dashed strokes.

The motion subset supports exactly one normal cycle, `forwards` or `both` fill mode, opacity, translation, uniform scale and rotation.

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

Wrapper JSON contains the exact serialized Lottie JSON in `lottie.data` with `encoding: utf8-json`, normalized plan, structural inspection and source, motion, subset, compatibility and output evidence. The SHA-256 and byte count apply to the exact `lottie.data` string.

## Browser Motion Director consumer

The browser Motion Director uses wrapper JSON mode so it can verify evidence before creating a player preview or download.

It verifies source and output byte counts and SHA-256, contract metadata, dimensions, frame rate, out point, layer and path counts, empty assets, expression and layer restrictions, target order, `structuralInspection: passed` and `playerRenderValidation: not-yet-performed`.

Only verified JSON is passed to the client-only official LottieFiles player. Reduced-motion preference disables autoplay and looping. The player preview is a delivery-context check, not independent source-to-player validation.

Direct Lottie responses use `Content-Type: video/lottie+json` and include `X-Vector-Job-Id`, `X-Vector-Lottie-Contract`, `X-Vector-Review-Required`, `X-Vector-Source-Sha256`, `X-Vector-Output-Sha256`, `X-Vector-Lottie-Structural-Inspection`, `X-Vector-Lottie-Player-Validation`, `X-Vector-DotLottie`, `X-Vector-Lottie-Layer-Count` and `X-Vector-Lottie-Path-Count`.

Expected Lottie errors include `LOTTIE_REQUEST_MEDIA_TYPE_UNSUPPORTED`, `LOTTIE_REQUEST_TOO_LARGE`, `LOTTIE_REQUEST_FIELD_UNSUPPORTED`, `LOTTIE_REQUEST_FIELD_DUPLICATE`, `LOTTIE_MULTIPART_INVALID`, `LOTTIE_SVG_FILE_REQUIRED`, `LOTTIE_SVG_INPUT_EMPTY`, `LOTTIE_SVG_INPUT_TOO_LARGE`, `LOTTIE_FORMAT_INVALID`, `LOTTIE_OPTIONS_INVALID`, `LOTTIE_SOURCE_INVALID`, `LOTTIE_SOURCE_UNSUPPORTED`, `LOTTIE_TARGET_MISSING`, `LOTTIE_TARGET_DUPLICATE`, `LOTTIE_TARGET_OVERLAP`, `LOTTIE_PATH_INVALID`, `LOTTIE_STYLE_UNSUPPORTED`, `LOTTIE_MOTION_UNSUPPORTED`, `LOTTIE_OUTPUT_INVALID`, `LOTTIE_OUTPUT_TOO_LARGE` and `LOTTIE_REQUEST_ABORTED`.

# dotLottie API

## dotLottie service discovery

```http
GET /api/v1/motion/dotlottie
```

The response declares Lottie contract version `1.0`, dotLottie contract version `1.0`, manifest version `2`, strict fields, bounded source and plan sizes, archive limits and separate compatibility states.

## dotLottie request

`POST /api/v1/motion/dotlottie` requires `multipart/form-data`.

| Field | Required | Values |
| --- | --- | --- |
| `file` | yes | one governed path-based static SVG |
| `motion` | one of two | inline motion v1 JSON string |
| `motionFile` | one of two | uploaded motion v1 JSON file |
| `format` | no | `json` or `dotlottie`, default `json` |
| `frameRate` | no | integer from 1 to 120, default 60 |
| `precision` | no | integer from 0 to 6, default 4 |
| `name` | no | composition name, 1 to 120 characters |
| `animationId` | no | portable 1 to 64 character archive animation ID |

The endpoint generates governed Lottie JSON, packages it into a deterministic dotLottie v2 archive, inspects both the embedded animation and ZIP structure, and keeps player and browser archive-load validation as explicit non-claims.

Application limits:

- SVG input: 5 MiB;
- motion plan: 256 KiB;
- generated archive: 25 MiB;
- wrapper base64 archive: 8 MiB;
- tracks: 1 to 64;
- keyframes per track: 2 to 100.

Use direct archive delivery for production files:

```powershell
curl.exe -X POST "http://localhost:3000/api/v1/motion/dotlottie" `
  -H "Authorization: Bearer $env:VECTOR_API_TOKEN" `
  -F "file=@fixtures\motion\gentle-entrance.source.svg;type=image/svg+xml" `
  -F "motionFile=@fixtures\motion\gentle-entrance.motion.json;type=application/json" `
  -F "animationId=gentle-entrance" `
  -F "frameRate=60" `
  -F "precision=4" `
  -F "format=dotlottie" `
  --output "outputs\gentle-entrance.lottie"
```

The direct response uses `Content-Type: application/zip+dotlottie` and includes:

- `X-Vector-Job-Id`;
- `X-Vector-Lottie-Contract: 1.0`;
- `X-Vector-DotLottie-Contract: 1.0`;
- `X-Vector-DotLottie-Manifest-Version: 2`;
- `X-Vector-Review-Required: true`;
- `X-Vector-Source-Sha256`;
- `X-Vector-Lottie-Sha256`;
- `X-Vector-Output-Sha256`;
- `X-Vector-DotLottie-Entry-Count`;
- `X-Vector-DotLottie-Archive-Inspection: passed`;
- `X-Vector-DotLottie-Embedded-Lottie-Inspection: passed`;
- `X-Vector-Player-Render-Validation: not-performed`;
- `X-Vector-Browser-Archive-Load-Validation: not-performed`.

Wrapper JSON returns the archive with `encoding: base64`, manifest, archive inspection, embedded-Lottie inspection and full evidence. Wrapper transport is limited to 8 MiB to avoid turning large ZIPs into much larger JSON payloads. Use `format=dotlottie` for a larger valid archive.

Expected dotLottie errors include `DOTLOTTIE_REQUEST_MEDIA_TYPE_UNSUPPORTED`, `DOTLOTTIE_REQUEST_TOO_LARGE`, `DOTLOTTIE_REQUEST_FIELD_UNSUPPORTED`, `DOTLOTTIE_REQUEST_FIELD_DUPLICATE`, `DOTLOTTIE_MULTIPART_INVALID`, `DOTLOTTIE_SVG_FILE_REQUIRED`, `DOTLOTTIE_SVG_INPUT_EMPTY`, `DOTLOTTIE_SVG_INPUT_TOO_LARGE`, `DOTLOTTIE_FORMAT_INVALID`, `DOTLOTTIE_BASE64_RESPONSE_TOO_LARGE`, `DOTLOTTIE_OPTIONS_INVALID`, `DOTLOTTIE_SOURCE_INVALID`, `DOTLOTTIE_ARCHIVE_INVALID`, `DOTLOTTIE_OUTPUT_INVALID`, `DOTLOTTIE_OUTPUT_TOO_LARGE` and `DOTLOTTIE_REQUEST_ABORTED`.

A successful response proves deterministic archive creation and structural inspection. It does not prove browser archive-load behaviour or source-to-player render equivalence.

# Shared approval boundary

A successful API response means the requested synchronous processing completed. It does not grant production approval.

Human review remains mandatory for tracing geometry, topology, negative space, logo fidelity, motion timing, easing, transform origins, reduced-motion delivery, Lottie paint order, archive compatibility, player fidelity and final platform compatibility.
