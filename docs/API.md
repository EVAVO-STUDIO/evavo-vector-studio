# EVAVO Vector Studio API

Vector Studio currently exposes two bounded synchronous production endpoints:

- `POST /api/v1/trace` for static raster reconstruction;
- `POST /api/v1/motion/svg` for validated animated SVG creation.

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
```

The response declares contract version `1.4`, profiles, candidate modes, input limits, adaptive budgets, runtime state and difference-artefact bounds.

The static raster container policy has a separate dependency-free discovery endpoint:

```http
GET /api/v1/input-policy
```

It returns the shared `one-static-image-per-trace` policy, accepted static classes, pre-decode rejected container classes, application limits and rejection code `RASTER_MULTI_IMAGE_UNSUPPORTED`.

## Trace request

Send `multipart/form-data` with:

| Field | Required | Values |
| --- | --- | --- |
| `file` | yes | one static PNG, ordinary JPEG, static WebP, single-frame GIF, BMP or single-page classic TIFF |
| `profile` | no | `auto`, `logo`, `icon`, `line-art`, `illustration`, `photo` |
| `candidateMode` | no | `adaptive` or `single`, default `adaptive` |
| `maxColours` | no | integer from 1 to 256; a reconstruction target, not a hard palette guarantee |
| `preservePalette` | no | `true` or `false`, default `true` |
| `optimise` | no | `true` or `false`, default `true` |
| `title` | no | SVG accessibility title; the engine bounds it to 200 characters |
| `includeDifference` | no | `true` or `false`, default `false` |
| `differenceMaxDimension` | no | integer from 32 to 1024; requires `includeDifference=true`, default 512 |
| `format` | no | `json` or `svg`, default `json` |

`includeDifference=true` requires `format=json`. A direct SVG response cannot safely carry a second PNG file and its evidence, so the API rejects that combination rather than silently discarding the requested artefact.

The application-level encoded file limit is 25 MiB. Header-declared and decoded canvases must remain at or below 40 million pixels. A hosting provider may impose a smaller request-body or execution limit; deployment readiness must verify the actual target platform rather than assuming the application limit overrides it.

Animated APNG, GIF and WebP, JPEG MPO, multi-page TIFF and BigTIFF are not flattened. Known multi-image containers are rejected before native decoding because choosing the first frame or page would discard source intent.

## Adaptive execution limits

Adaptive candidate execution is bounded by decoded source size:

- at most three candidates through 4,000,000 pixels;
- at most two candidates through 12,000,000 pixels;
- one candidate above 12,000,000 pixels.

The base candidate is mandatory. Alternative fidelity or economy candidates may fail without discarding a valid base result; their failure is retained in evidence.

## Trace PowerShell example

```powershell
$Headers = @{ Authorization = "Bearer $env:VECTOR_API_TOKEN" }
$Form = @{
    file = Get-Item ".\fixtures\mark.png"
    profile = "logo"
    candidateMode = "adaptive"
    maxColours = "16"
    preservePalette = "true"
    optimise = "true"
    includeDifference = "true"
    differenceMaxDimension = "512"
    title = "Brand mark"
    format = "json"
}

$result = Invoke-RestMethod `
    -Method Post `
    -Uri "http://localhost:3000/api/v1/trace" `
    -Headers $Headers `
    -Form $Form

$result.svg | Set-Content -Path ".\outputs\mark.svg" -Encoding UTF8
[IO.File]::WriteAllBytes(
    ".\outputs\mark.difference.png",
    [Convert]::FromBase64String($result.artifacts.difference.data)
)
```

Windows PowerShell 5.1 does not provide the same `-Form` behaviour as modern PowerShell. Use `curl.exe` for a portable multipart request:

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

A successful JSON response contains:

- a unique job ID and `complete` execution status;
- the selected SVG string;
- detected source type, dimensions and SHA-256 evidence;
- sampled palette, alpha, tonal and edge analysis;
- requested and resolved trace profiles;
- exact reconstruction settings used by each candidate;
- SVG paths, commands, estimated anchors, groups, gradients and byte counts;
- topology counts for IDs, references, open/closed subpaths, compound paths, text, instances, styles, clips, masks and transforms;
- structural findings such as duplicate IDs, unresolved references, unoutlined text and duplicate path data;
- per-scale and aggregate visual comparison evidence for each completed candidate;
- candidate failures, if any;
- selected and best-visual candidate IDs;
- eligible candidate IDs, selection reason, pixel budgets, tolerances and complete cost weights;
- optional difference artefact metadata and base64 PNG data;
- warnings and quality-gate state.

Duplicate IDs and unresolved local references make the generated SVG invalid and reject the candidate. Other topology and editability findings remain explicit for review.

The difference response shape is:

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
      "requestedMaxDimension": 512,
      "displayAmplification": 4,
      "colourMap": "white-to-red",
      "sourceSampling": "bilinear",
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

The object in `artifacts.difference` repeats the audited metadata so consumers can validate the bytes without guessing which candidate or settings produced them.

The web client uses the shared `@evavo/vector-core` verifier before display. It checks base64 transport, decoded bytes, PNG signature, IHDR dimensions, selected-candidate binding and SHA-256. Other clients should apply the same checks rather than trusting metadata without validating the bytes.

## Visual evidence and selection

Every completed candidate is rasterised at up to 64, 256 and 1024 pixels on the longest edge, capped by source size. The comparison evaluates premultiplied RGB, alpha, black compositing and white compositing. It records visual mean absolute error, root-mean-square visual error, mismatch fraction and aspect-ratio drift, plus exact classification thresholds.

Adaptive selection is visual-first. When all candidates require review, the best visual result wins. Otherwise, candidates must match the best quality class and remain inside declared visual-cost, mismatch-fraction and aspect-ratio tolerances. From those eligible candidates, the engine selects the lowest geometry cost.

The optional heatmap is produced only for the selected candidate. White represents measured agreement; red represents visual difference. A declared `4×` display amplification makes small errors visible. The heatmap is evidence, not approval.

`status: complete` means synchronous execution, comparison, selection and any requested artefact generation finished. It does not mean the artwork is professionally approved. `productionApproval` remains `review-required` because pixel similarity cannot prove deliberate path topology, anchor economy, negative-space construction, layer quality or brand fidelity.

## Direct traced SVG response

When `format=svg` and `includeDifference` is false, the response body is the selected SVG. Evidence that fits safely into headers is retained:

- `X-Vector-Job-Id`
- `X-Vector-Review-Required: true`
- `X-Vector-Render-Quality`
- `X-Vector-Visual-Mae`
- `X-Vector-Mismatch-Fraction`
- `X-Vector-Selected-Candidate`
- `X-Vector-Candidate-Count`
- `X-Vector-Runtime-Timeout-Ms`
- `X-Vector-Runtime-Max-Concurrent`

Use `format=json` whenever the complete inspection, topology, candidate evidence or difference PNG is required.

## Trace error contract

Expected rejections include:

- `RASTER_INPUT_TOO_LARGE`
- `RASTER_FORMAT_UNSUPPORTED`
- `RASTER_HEADER_INVALID`
- `RASTER_PIXEL_LIMIT_EXCEEDED`
- `RASTER_MULTI_IMAGE_UNSUPPORTED`
- `RASTER_OPTIONS_INVALID`
- `RASTER_DECODE_FAILED`
- `RASTER_OUTPUT_INVALID`
- `RASTER_RENDER_COMPARISON_FAILED`
- `RASTER_DIFFERENCE_ARTIFACT_FAILED`
- `RASTER_RUNTIME_BUSY`
- `RASTER_RUNTIME_TIMEOUT`

# Animated SVG API

## Motion service discovery

```http
GET /api/v1/motion/svg
```

The response declares motion contract version `1.0`, supported properties, request fields, byte limits, track and keyframe limits, reduced-motion requirements, authentication and approval policy.

Lottie remains unavailable. The endpoint does not convert unsupported motion into a Lottie approximation.

## Motion request

`POST /api/v1/motion/svg` requires `multipart/form-data`.

| Field | Required | Values |
| --- | --- | --- |
| `file` | yes | one governed static SVG |
| `motion` | one of two | inline motion v1 JSON string |
| `motionFile` | one of two | uploaded motion v1 JSON file |
| `format` | no | `json` or `svg`, default `json` |

Exactly one of `motion` and `motionFile` is required. Sending both or neither returns `MOTION_SPEC_INVALID`.

Application limits:

- SVG input: 5 MiB;
- motion plan: 256 KiB;
- tracks: 1 to 64;
- keyframes per track: 2 to 100.

The endpoint validates the same motion v1 rules as CLI and MCP: unknown properties, duplicate targets, missing IDs, no-op tracks, pre-existing animation and unsafe base transforms are rejected.

The source remains static input. The endpoint adds deterministic internal CSS animation, no script and no external reference. Every generated SVG includes a `prefers-reduced-motion` fallback.

## Motion PowerShell example with inline plan

Modern PowerShell:

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

$result.svg | Set-Content ".\outputs\gentle-entrance.animated.svg" -Encoding UTF8
$result.evidence | ConvertTo-Json -Depth 20 | Set-Content ".\outputs\gentle-entrance.motion.evidence.json" -Encoding UTF8
```

Windows PowerShell 5.1 with a plan file:

```powershell
curl.exe -X POST "http://localhost:3000/api/v1/motion/svg" `
  -H "Authorization: Bearer $env:VECTOR_API_TOKEN" `
  -F "file=@fixtures\motion\gentle-entrance.source.svg;type=image/svg+xml" `
  -F "motionFile=@fixtures\motion\gentle-entrance.motion.json;type=application/json" `
  -F "format=svg" `
  --output "outputs\gentle-entrance.animated.svg"
```

## Motion JSON response

With `format=json`, the response contains:

- unique job ID and `complete` status;
- `review-required` approval;
- source file name, declared type, bytes and SHA-256;
- plan source mode, optional uploaded plan name, declared type and bytes;
- normalized motion plan with defaults made explicit;
- animated SVG string;
- governed motion and source SVG inspection;
- source/output hashes, motion identity and style identity;
- playback settings, target IDs, track and keyframe counts;
- script-free, external-reference-free and reduced-motion assertions;
- warnings and review state.

The API returns the SVG body because an HTTP client explicitly requested a response payload. The local MCP tool follows a different context policy and returns file receipts instead of SVG markup.

## Direct animated SVG response

With `format=svg`, the response body is the generated animated SVG. Headers retain compact evidence:

- `X-Vector-Job-Id`
- `X-Vector-Motion-Contract: 1.0`
- `X-Vector-Motion-Id`
- `X-Vector-Review-Required: true`
- `X-Vector-Source-Sha256`
- `X-Vector-Output-Sha256`
- `X-Vector-Reduced-Motion: true`

Use JSON when normalized plan and complete evidence are required. Use direct animated SVG when the caller only needs the file plus compact headers.

## Motion error contract

Expected rejections include:

- `MOTION_REQUEST_MEDIA_TYPE_UNSUPPORTED`
- `MOTION_REQUEST_TOO_LARGE`
- `MOTION_SVG_FILE_REQUIRED`
- `MOTION_SVG_INPUT_EMPTY`
- `MOTION_SVG_INPUT_TOO_LARGE`
- `MOTION_FORMAT_INVALID`
- `MOTION_SPEC_INVALID`
- `MOTION_SOURCE_INVALID`
- `MOTION_SOURCE_ALREADY_ANIMATED`
- `MOTION_TARGET_MISSING`
- `MOTION_TARGET_DUPLICATE`
- `MOTION_TARGET_BASE_TRANSFORM_UNSUPPORTED`
- `MOTION_OUTPUT_INVALID`
- `MOTION_REQUEST_ABORTED`

`MOTION_SPEC_INVALID` is a request error. Source and target incompatibilities are reviewable unprocessable inputs. `MOTION_OUTPUT_INVALID` is treated as an internal generation failure because a deterministic output failed its own governed inspection.

# Shared approval boundary

A successful API response means the requested synchronous processing completed. It does not grant production approval.

Human review remains mandatory for tracing geometry, topology, negative space, logo fidelity, motion timing, easing, transform origins, reduced-motion experience and final delivery compatibility.
