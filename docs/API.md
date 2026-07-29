# EVAVO Vector Studio API

Vector Studio exposes four bounded synchronous production endpoints plus separately configured hosted job and worker control planes:

- `POST /api/v1/trace` for static raster reconstruction;
- `POST /api/v1/motion/svg` for validated animated SVG creation;
- `POST /api/v1/motion/lottie` for governed path-based Lottie JSON export;
- `POST /api/v1/motion/dotlottie` for deterministic dotLottie v2 packaging;
- `GET` and `POST /api/v1/jobs` plus `GET` and `DELETE /api/v1/jobs/{jobId}` for hosted record discovery, idempotent creation, inspection and cancellation;
- `/api/v1/worker` routes for separately authenticated lease coordination.

The four production endpoints are interactive processing surfaces. Hosted job creation does not automatically schedule execution. Worker control coordinates job state only; object storage, queue delivery and distributed workers remain a separate deployment phase.

Production client requests require `Authorization: Bearer <VECTOR_API_TOKEN>`. Worker control requests require the separate `Authorization: Bearer <VECTOR_WORKER_API_TOKEN>` in every environment. Responses use `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`.

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

A successful JSON response contains selected SVG, source analysis, candidate evidence, topology, multi-scale render metrics and an optional difference PNG.

```json
{
  "artifacts": {
    "difference": {
      "encoding": "base64",
      "data": "iVBORw0KGgo..."
    }
  }
}
```

The web client validates base64 transport, byte count, PNG signature, dimensions, selected-candidate binding and SHA-256 before display.

Direct SVG headers include `X-Vector-Job-Id`, `X-Vector-Review-Required`, `X-Vector-Render-Quality`, `X-Vector-Selected-Candidate` and runtime limits.

Expected trace errors include `RASTER_INPUT_TOO_LARGE`, `RASTER_MULTI_IMAGE_UNSUPPORTED`, `RASTER_PIXEL_LIMIT_EXCEEDED`, `RASTER_RUNTIME_BUSY` and `RASTER_RUNTIME_TIMEOUT`.

# Animated SVG API

## Motion service discovery

```http
GET /api/v1/motion/svg
```

The response declares motion contract `1.0`, byte limits, reduced-motion requirements, authentication and approval policy. It points to the separately governed Lottie endpoint without claiming player-render validation.

## Motion request

`POST /api/v1/motion/svg` requires `multipart/form-data`.

| Field | Required | Values |
| --- | --- | --- |
| `file` | yes | one governed static SVG |
| `motion` | one of two | inline motion-v1 JSON string |
| `motionFile` | one of two | uploaded motion-v1 JSON file |
| `format` | no | `json` or `svg`, default `json` |

Exactly one of `motion` and `motionFile` is required. The SVG limit is 5 MiB and the plan limit is 256 KiB. A plan supports 1 to 64 tracks and 2 to 100 keyframes per track.

The endpoint rejects unknown fields, malformed multipart bodies, duplicate targets, missing IDs, no-op tracks, existing animation and unsafe transforms.

```powershell
curl.exe -X POST "http://localhost:3000/api/v1/motion/svg" `
  -H "Authorization: Bearer $env:VECTOR_API_TOKEN" `
  -F "file=@fixtures\motion\gentle-entrance.source.svg;type=image/svg+xml" `
  -F "motionFile=@fixtures\motion\gentle-entrance.motion.json;type=application/json" `
  -F "format=svg" `
  --output "outputs\gentle-entrance.animated.svg"
```

Direct SVG headers include `X-Vector-Job-Id`, `X-Vector-Motion-Contract`, `X-Vector-Motion-Id`, `X-Vector-Review-Required`, source/output SHA-256 and reduced-motion policy.

# Lottie JSON API

## Lottie service discovery

```http
GET /api/v1/motion/lottie
```

Structural inspection is available. Independent player-render comparison is not performed. Deterministic dotLottie packaging is available through the separate `# dotLottie API` endpoint.

## Lottie request

The browser Motion Director uses wrapper JSON mode for exact verification before opening the official player preview.

`POST /api/v1/motion/lottie` requires `multipart/form-data` with one governed SVG plus exactly one of `motion` and `motionFile`.

| Field | Required | Values |
| --- | --- | --- |
| `file` | yes | governed path-based static SVG |
| `motion` | one of two | inline motion-v1 JSON |
| `motionFile` | one of two | uploaded motion-v1 JSON |
| `format` | no | `json` or `lottie` |
| `frameRate` | no | 1 to 120 |
| `precision` | no | 0 to 6 |
| `name` | no | 1 to 120 characters |

Limits are 5 MiB for SVG, 256 KiB for motion and 20 MiB for generated Lottie JSON.

The supported subset is path geometry, solid fill/stroke, opacity, translation, uniform scale and rotation. Gradients, text, images, masks, filters, expressions and precompositions are rejected rather than approximated.

Direct responses use `Content-Type: video/lottie+json`. Evidence headers include `X-Vector-Lottie-Contract`, `X-Vector-Lottie-Structural-Inspection` and `X-Vector-Lottie-Player-Validation: not-performed`.

# dotLottie API

## dotLottie service discovery

```http
GET /api/v1/motion/dotlottie
```

`POST /api/v1/motion/dotlottie` accepts the same governed SVG and motion sources, then creates and inspects deterministic manifest-v2 packaging. Use `format=dotlottie` for direct archive delivery.

| Field | Required | Values |
| --- | --- | --- |
| `file` | yes | governed path-based static SVG |
| `motion` | one of two | inline motion-v1 JSON |
| `motionFile` | one of two | uploaded motion-v1 JSON |
| `format` | no | `json` or `dotlottie` |
| `frameRate` | no | 1 to 120 |
| `precision` | no | 0 to 6 |
| `animationId` | no | portable 1 to 64 character ID |

Limits are 5 MiB for SVG, 256 KiB for motion, 25 MiB for generated archive and 8 MiB for wrapper base64 transport.

Direct archive delivery uses `Content-Type: application/zip+dotlottie`. Evidence headers include `X-Vector-DotLottie-Contract`, manifest version, source/Lottie/output SHA-256, archive inspection and browser archive-load validation state.

The browser archive-load validation may later pass after exact byte verification and a player `load` event. Independent source-to-player render validation remains separate.

# Hosted job record API

## Service discovery

```http
GET /api/v1/jobs
```

The response reports hosted job contract `1.0`, supported operations, record-store availability and `remoteExecutionAvailable: false`.

## Create a record

```http
POST /api/v1/jobs
Authorization: Bearer <VECTOR_API_TOKEN>
Content-Type: application/json
```

The request requires `workspaceId`, `idempotencyKey`, `operation` and a bounded JSON `payload`. Optional `priority` is 0 to 9 and `maxAttempts` is 1 to 10. Raw source or generated asset bodies do not belong in the record.

```json
{
  "workspaceId": "evavo-studio",
  "idempotencyKey": "primary-mark:trace:revision-01",
  "operation": "trace-raster",
  "priority": 7,
  "maxAttempts": 3,
  "payload": {
    "source": {
      "objectKey": "workspace/primary-mark/source.png",
      "sha256": "replace-with-source-sha256"
    },
    "outputs": {
      "svgObjectKey": "workspace/primary-mark/revision-01.svg"
    }
  }
}
```

A new record returns `201`. An exact replay returns `200`. A changed request under the same workspace and key returns `HOSTED_JOB_IDEMPOTENCY_CONFLICT`.

Record creation retains:

```text
executionScheduled: false
remoteExecutionAvailable: false
```

## Inspect or cancel

```http
GET /api/v1/jobs/{jobId}
DELETE /api/v1/jobs/{jobId}
```

Queued work cancels immediately. Leased or running work becomes `cancel-requested` for cooperative acknowledgement.

The store fails closed with `HOSTED_JOB_STORE_NOT_CONFIGURED` until a safe adapter is configured. Production file mode additionally requires `VECTOR_JOB_FILE_STORE_PERSISTENT=true` and a genuinely persistent mounted volume.

# Worker control API

Worker control protocol `1.0` coordinates authenticated hosted-job leases. It requires the separate server-only `VECTOR_WORKER_API_TOKEN` in every environment.

```text
GET  /api/v1/worker
POST /api/v1/worker/lease
POST /api/v1/worker/jobs/{jobId}/start
POST /api/v1/worker/jobs/{jobId}/heartbeat
POST /api/v1/worker/jobs/{jobId}/complete
POST /api/v1/worker/jobs/{jobId}/fail
POST /api/v1/worker/jobs/{jobId}/acknowledge-cancellation
```

Requests use bounded `application/json`. Lease acquisition is the only response that returns the opaque `leaseToken`; all later records expose `tokenPresent: true` instead.

Completion accepts at least one output receipt and compact evidence. Generated raster, SVG, Lottie or archive bodies are never accepted as a substitute for object storage.

The control API reports:

```text
objectTransferAvailable: false
queueDeliveryAvailable: false
remoteExecutionAvailable: false
```

A worker must already have trusted access to the immutable source and output object store through another deployment mechanism. The control API validates receipt structure but does not independently verify remote object existence.

See [`WORKER-API.md`](WORKER-API.md).

# Shared approval boundary

A successful synchronous production response means requested processing completed. A successful hosted job or worker control response means only that the requested record transition completed. None grants production approval.

Human review remains mandatory for tracing geometry, topology, negative space, logo fidelity, motion timing, easing, transform origins, reduced-motion delivery, Lottie paint order, archive compatibility, player fidelity and final platform compatibility.
