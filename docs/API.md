# EVAVO Vector Studio API

## Runtime boundary

`POST /api/v1/trace` performs one bounded raster inspection and SVG trace synchronously. It is intended for interactive use, CLI wrappers and agent tool calls that can wait for the response. It is not presented as a durable queue: retries, persistence, resumability and long-running workers belong in a later worker service.

Production requests require `Authorization: Bearer <VECTOR_API_TOKEN>`. When `NODE_ENV=production` and `VECTOR_API_TOKEN` is absent, the endpoint returns `503` rather than opening an unauthenticated native-processing surface. Local development remains usable without a token.

## Request

Send `multipart/form-data` with:

| Field | Required | Values |
| --- | --- | --- |
| `file` | yes | PNG, JPEG, WebP, GIF, BMP or classic TIFF |
| `profile` | no | `auto`, `logo`, `icon`, `line-art`, `illustration`, `photo` |
| `maxColours` | no | integer from 1 to 256; a reconstruction target, not a dishonest hard palette guarantee |
| `preservePalette` | no | `true` or `false`, default `true` |
| `optimise` | no | `true` or `false`, default `true` |
| `title` | no | SVG accessibility title, maximum 200 characters |
| `format` | no | `json` or `svg`, default `json` |

The encoded file limit is 25 MiB. The header-declared and decoded canvas must remain at or below 40 million pixels.

## PowerShell example

```powershell
$Headers = @{ Authorization = "Bearer $env:VECTOR_API_TOKEN" }
$Form = @{
    file = Get-Item ".\fixtures\mark.png"
    profile = "logo"
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
  -F "format=svg" `
  --output "outputs\mark.svg"
```

## JSON response

A successful JSON response contains:

- a unique job ID and `complete` execution status;
- the SVG string;
- detected source type, dimensions and SHA-256 evidence;
- sampled palette, alpha, tonal and edge analysis;
- requested and resolved trace profiles;
- the exact reconstruction settings used;
- SVG path, group, gradient and byte counts;
- warnings and quality-gate state.

`status: complete` means synchronous execution finished. It does not mean the artwork is visually approved. Until rasterised source-versus-output comparison is implemented, `approval` remains `review-required` and `productionApproval` remains `withheld-pending-render-comparison`.

## Error contract

Expected rejections return a stable `error` code and appropriate HTTP status. Examples include `RASTER_INPUT_TOO_LARGE`, `RASTER_FORMAT_UNSUPPORTED`, `RASTER_HEADER_INVALID`, `RASTER_PIXEL_LIMIT_EXCEEDED`, `RASTER_OPTIONS_INVALID`, `RASTER_DECODE_FAILED` and `RASTER_OUTPUT_INVALID`.

Responses use `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`. Direct SVG responses also include the job ID and a review-required header.
