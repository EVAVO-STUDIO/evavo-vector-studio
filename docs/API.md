# EVAVO Vector Studio API

Vector Studio exposes three bounded synchronous production endpoints:

- `POST /api/v1/trace` for static raster reconstruction;
- `POST /api/v1/motion/svg` for validated animated SVG creation;
- `POST /api/v1/motion/lottie` for governed path-based Lottie JSON export.

They are intended for interactive use and agent calls that can wait for the response. They are not durable queues: persistence, resumability, object storage, retries and long-running workers belong in a later worker service.

Production requests require `Authorization: Bearer <VECTOR_API_TOKEN>`. When `NODE_ENV=production` and `VECTOR_API_TOKEN` is absent, an endpoint returns `503` rather than exposing an unauthenticated processing surface. Local development remains usable without a token.

All responses use `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`.

# Raster trace API

## Runtime boundary

`POST /api/v1/trace` performs bounded raster inspection, one or more bounded SVG candidates, structural and topology validation, multi-scale visual comparison, candidate selection and optional difference-image generation synchronously.

Native work is protected by per-instance timeout and concurrency limits.

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

## Trace PowerShell example

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

## Trace JSON response

A successful JSON response contains the selected SVG, source analysis, candidate settings and failures, topology and editability evidence, multi-scale render metrics, selection evidence and optional difference PNG.

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

The response declares motion contract version `1.0`, request fields, byte limits, supported properties, reduced-motion requirements, authentication and approval policy. It also points to the separately governed Lottie endpoint without presenting player validation or dotLottie as available.

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

## Motion examples

Wrapper JSON with an inline plan:

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

Direct animated SVG from a plan file:

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

Structural inspection is available. Independent player-render comparison is not performed, and dotLottie remains unavailable.

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

Application limits:

- SVG input: 5 MiB;
- motion plan: 256 KiB;
- parsed request fields: bounded by SVG, plan and 1 MiB multipart allowance;
- generated Lottie JSON: 20 MiB;
- tracks: 1 to 64;
- keyframes per track: 2 to 100.

The initial source subset supports path geometry, compound subpaths, solid fill, solid stroke, nonzero fill and even-odd fill. It rejects unflattened transforms, group opacity, gradients, text, images, masks, filters, expressions, precompositions and dashed strokes.

The motion subset supports exactly one normal cycle, `forwards` or `both` fill mode, opacity, translation, uniform scale and rotation.

## Lottie wrapper JSON example

```powershell
$Headers = @{ Authorization = "Bearer $env:VECTOR_API_TOKEN" }
$Motion = Get-Content ".\fixtures\motion\gentle-entrance.motion.json" -Raw
$Form = @{
    file = Get-Item ".\fixtures\motion\gentle-entrance.source.svg"
    motion = $Motion
    frameRate = "60"
    precision = "4"
    name = "Gentle entrance"
    format = "json"
}
$result = Invoke-RestMethod `
    -Method Post `
    -Uri "http://localhost:3000/api/v1/motion/lottie" `
    -Headers $Headers `
    -Form $Form
$result.lottie.data | Set-Content ".\outputs\gentle-entrance.lottie.json" -Encoding UTF8
```

The wrapper contains:

- unique job ID and `complete` status;
- `review-required` approval;
- source descriptor and SHA-256;
- motion source descriptor and normalized plan;
- exact serialized Lottie JSON in `lottie.data` with `encoding: utf8-json`;
- structural inspection;
- source, motion, subset, compatibility and output evidence.

The SHA-256 and byte count in evidence apply to the exact `lottie.data` string.

## Browser Motion Director consumer

The browser Motion Director uses wrapper JSON mode so it can verify evidence before creating a player preview or download.

Before loading the returned animation, it verifies:

- source byte count and SHA-256 against the selected SVG;
- exact `lottie.data` byte count and SHA-256;
- contract metadata and review-required state;
- dimensions, frame rate, out point, layer count and path count;
- empty assets and absence of expressions, image layers, text layers and precompositions;
- normalized target order and motion-plan consistency;
- `structuralInspection: passed`;
- `playerRenderValidation: not-yet-performed`;
- `dotLottiePackaging: not-yet-available`.

Only verified JSON is passed to the client-only official LottieFiles player. Reduced-motion preference disables autoplay and looping. The player preview is a delivery-context check, not independent source-to-player validation.

The browser exposes separate Lottie JSON and evidence downloads and marks a result stale when the source, plan, frame rate or precision changes.

## Direct Lottie response

Request `format=lottie` for the exact file body:

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

The response uses `Content-Type: video/lottie+json` and includes:

- `X-Vector-Job-Id`;
- `X-Vector-Lottie-Contract: 1.0`;
- `X-Vector-Review-Required: true`;
- `X-Vector-Source-Sha256`;
- `X-Vector-Output-Sha256`;
- `X-Vector-Lottie-Structural-Inspection: passed`;
- `X-Vector-Lottie-Player-Validation: not-performed`;
- `X-Vector-DotLottie: unavailable`;
- `X-Vector-Lottie-Layer-Count`;
- `X-Vector-Lottie-Path-Count`.

## Lottie error contract

Expected rejections include:

- `LOTTIE_REQUEST_MEDIA_TYPE_UNSUPPORTED`;
- `LOTTIE_REQUEST_TOO_LARGE`;
- `LOTTIE_REQUEST_FIELD_UNSUPPORTED`;
- `LOTTIE_REQUEST_FIELD_DUPLICATE`;
- `LOTTIE_MULTIPART_INVALID`;
- `LOTTIE_SVG_FILE_REQUIRED`;
- `LOTTIE_SVG_INPUT_EMPTY`;
- `LOTTIE_SVG_INPUT_TOO_LARGE`;
- `LOTTIE_FORMAT_INVALID`;
- `LOTTIE_OPTIONS_INVALID`;
- `LOTTIE_SOURCE_INVALID`;
- `LOTTIE_SOURCE_UNSUPPORTED`;
- `LOTTIE_TARGET_MISSING`;
- `LOTTIE_TARGET_DUPLICATE`;
- `LOTTIE_TARGET_OVERLAP`;
- `LOTTIE_PATH_INVALID`;
- `LOTTIE_STYLE_UNSUPPORTED`;
- `LOTTIE_MOTION_UNSUPPORTED`;
- `LOTTIE_OUTPUT_INVALID`;
- `LOTTIE_OUTPUT_TOO_LARGE`;
- `LOTTIE_REQUEST_ABORTED`.

`LOTTIE_OPTIONS_INVALID` is a request error. Source, target, path, style and motion incompatibilities are unprocessable inputs. `LOTTIE_OUTPUT_INVALID` is an internal failure because generated JSON failed its own structural inspector.

# Shared approval boundary

A successful API response means the requested synchronous processing completed. It does not grant production approval.

Human review remains mandatory for tracing geometry, topology, negative space, logo fidelity, motion timing, easing, transform origins, reduced-motion delivery, Lottie paint order, player fidelity and final platform compatibility.
