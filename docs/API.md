# EVAVO Vector Studio API

## Runtime boundary

`POST /api/v1/trace` performs bounded raster inspection, one or more bounded SVG candidates, structural validation, multi-scale visual comparison and candidate selection synchronously. It is intended for interactive use, CLI wrappers and agent tool calls that can wait for the response. It is not presented as a durable queue: persistence, resumability and long-running workers belong in a later worker service.

Production requests require `Authorization: Bearer <VECTOR_API_TOKEN>`. When `NODE_ENV=production` and `VECTOR_API_TOKEN` is absent, the endpoint returns `503` rather than opening an unauthenticated native-processing surface. Local development remains usable without a token.

## Request

Send `multipart/form-data` with:

| Field | Required | Values |
| --- | --- | --- |
| `file` | yes | PNG, JPEG, WebP, GIF, BMP or classic TIFF |
| `profile` | no | `auto`, `logo`, `icon`, `line-art`, `illustration`, `photo` |
| `candidateMode` | no | `adaptive` or `single`, default `adaptive` |
| `maxColours` | no | integer from 1 to 256; a reconstruction target, not a hard palette guarantee |
| `preservePalette` | no | `true` or `false`, default `true` |
| `optimise` | no | `true` or `false`, default `true` |
| `title` | no | SVG accessibility title, maximum 200 characters |
| `format` | no | `json` or `svg`, default `json` |

The encoded file limit is 25 MiB. The header-declared and decoded canvas must remain at or below 40 million pixels.

Adaptive candidate execution is additionally bounded by decoded source size:

- at most three candidates through 4,000,000 pixels;
- at most two candidates through 12,000,000 pixels;
- one candidate above 12,000,000 pixels.

The base candidate is mandatory. Alternative fidelity or economy candidates may fail without discarding a valid base result; their failure is retained in evidence.

## PowerShell example

```powershell
$Headers = @{ Authorization = "Bearer $env:VECTOR_API_TOKEN" }
$Form = @{
    file = Get-Item ".\fixtures\mark.png"
    profile = "logo"
    candidateMode = "adaptive"
    maxColours = "16"
    preservePalette = "true"
    optimise = "true"
    title = "Brand mark"
    format = "json"
}

Invoke-RestMethod `
    -Method Post `
    -Uri "http://localhost:3000/api/v1/trace" `
    -Headers $Headers `
    -Form $Form
```

Windows PowerShell 5.1 does not provide the same `-Form` behaviour as modern PowerShell. Use `curl.exe` for a portable local call:

```powershell
curl.exe -X POST "http://localhost:3000/api/v1/trace" `
  -H "Authorization: Bearer $env:VECTOR_API_TOKEN" `
  -F "file=@fixtures\mark.png" `
  -F "profile=logo" `
  -F "candidateMode=adaptive" `
  -F "format=svg" `
  --output "outputs\mark.svg"
```

## JSON response

A successful JSON response contains:

- a unique job ID and `complete` execution status;
- the selected SVG string;
- detected source type, dimensions and SHA-256 evidence;
- sampled palette, alpha, tonal and edge analysis;
- requested and resolved trace profiles;
- the exact reconstruction settings used by each candidate;
- SVG paths, commands, estimated anchors, groups, gradients and byte counts;
- per-scale and aggregate visual comparison evidence for each completed candidate;
- candidate failures, if any;
- selected and best-visual candidate IDs;
- eligible candidate IDs, selection reason, pixel budgets, tolerances and complete cost weights;
- warnings and quality-gate state.

The visual comparison rasterises every completed candidate at up to 64, 256 and 1024 pixels on the longest edge, capped by the source size. It compares premultiplied RGB, alpha, black compositing and white compositing. The result includes visual mean absolute error, root-mean-square visual error, mismatch fraction and aspect-ratio drift. The response also includes the exact `excellent` and `good` thresholds used to classify the evidence.

Adaptive selection is visual-first. When all candidates require review, the best visual result wins. Otherwise, candidates must match the best quality class and remain within the declared visual-cost, mismatch-fraction and aspect-ratio tolerances. From those eligible candidates, the engine selects the lowest geometry cost. Geometry cost is calculated from estimated anchors, path count, command count and output bytes. The complete formula weights are returned in `evidence.selection.costModel`.

`status: complete` means synchronous execution, comparison and selection finished. It does not mean the artwork is professionally approved. `productionApproval` remains `review-required` because pixel similarity cannot prove deliberate path topology, anchor economy, negative-space construction, layer quality or brand fidelity.

## Direct SVG response

When `format=svg`, the response body is the selected SVG. Evidence that fits safely into headers is retained:

- `X-Vector-Job-Id`
- `X-Vector-Review-Required: true`
- `X-Vector-Render-Quality`
- `X-Vector-Visual-Mae`
- `X-Vector-Mismatch-Fraction`
- `X-Vector-Selected-Candidate`
- `X-Vector-Candidate-Count`

Use `format=json` when the complete evidence record is required.

## Error contract

Expected rejections return a stable `error` code and appropriate HTTP status. Examples include `RASTER_INPUT_TOO_LARGE`, `RASTER_FORMAT_UNSUPPORTED`, `RASTER_HEADER_INVALID`, `RASTER_PIXEL_LIMIT_EXCEEDED`, `RASTER_OPTIONS_INVALID`, `RASTER_DECODE_FAILED`, `RASTER_OUTPUT_INVALID` and `RASTER_RENDER_COMPARISON_FAILED`.

Responses use `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`.
