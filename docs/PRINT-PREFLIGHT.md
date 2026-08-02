# Governed SVG print preflight

EVAVO Vector Studio performs deterministic, read-only SVG print preflight before a file is sent to a printer, sign shop, screen printer or vinyl cutter.

Preflight does not convert RGB artwork to CMYK, prove a spot-colour separation, inspect a printer RIP or approve a production run. Every result remains `review-required`.

## Interfaces

The same `print-preflight-v1` contract is available through:

```text
evavo-vector-print preflight <input.svg>
POST /api/v1/print/preflight
```

The CLI is suited to local files, automated build pipelines and large private workspaces. The authenticated API supports the private Vector browser session and `Bearer VECTOR_API_TOKEN` automation.

Capability discovery advertises both interfaces at:

```text
GET /api/v1/capabilities
```

## Profiles

```text
commercial
large-format
cut-vinyl
screen-print
```

`commercial` checks physical dimensions, trim, bleed, live text, embedded raster content, transparency, colour tokens and minimum line weights.

`large-format` keeps the same physical checks while emphasising explicit scale and the fact that embedded-raster effective resolution cannot be proven from SVG structure alone.

`cut-vinyl` expects direct vector geometry and rejects print effects that cannot be represented as clean cut paths.

`screen-print` applies a bounded process-colour count and rejects complex paint or transparency that requires separation review.

## Request fields

The API accepts strict `multipart/form-data` with one `file` field and these optional fields:

```text
profile
trimWidthMm
trimHeightMm
bleedMm
dimensionToleranceMm
minimumStrokePt
maximumProcessColours
allowText
allowEmbeddedRaster
allowTransparency
```

Unknown or duplicate fields fail closed. Trim width and height must be supplied together. Bleed requires both trim dimensions. Boolean overrides accept explicit true or false values only.

The API accepts up to 5 MiB of UTF-8 SVG source and keeps additional multipart headroom below the synchronous production transfer ceiling.

## Evidence

A result includes:

- source safety and topology inspection;
- physical canvas width and height in millimetres;
- explicit-unit and `viewBox` scale evidence;
- physical and `viewBox` aspect-ratio comparison;
- requested trim, bleed and tolerance evidence;
- live-text, embedded-raster, gradient, filter, mask, clip-path, pattern, transparency and blend-mode counts;
- measured and implicit stroke-width evidence;
- resolved process-colour tokens and unresolved paint-token counts;
- profile-specific findings with stable codes and severities.

The API also returns a bounded source SHA-256 and job identifier. It never returns generated artwork because preflight is read-only.

## Colour boundary

The preflight counts resolvable RGB, HSL and hexadecimal process-colour tokens. It deliberately reports:

```text
cmykOrSpotColourProofAvailable: false
```

A printer profile, ICC conversion, overprint intent, trapping, ink limit, rich-black recipe, spot-colour library or physical proof remains outside this structural SVG check.

## Approval boundary

A technically passing result means no configured preflight error was found. It does not mean:

- brand fidelity is approved;
- colours will match a physical proof;
- small text is readable at final viewing distance;
- cutting paths have correct tool compensation;
- screen separations, choke or spread are correct;
- the destination printer accepts the file.

The response always retains:

```text
productionApproval: false
approval: review-required
```

## Commands

```powershell
pnpm vector:print:capabilities
pnpm vector:print:preflight -- .\artwork.svg --profile commercial --trim-width-mm 210 --trim-height-mm 297 --bleed-mm 3
```

The API contract gate is:

```powershell
pnpm print-api:check
```

## Exact preflight CI runtime

The focused print workflow resolves Node.js from `.nvmrc`, asserts the exact `22.16.0` runtime, and activates pnpm `10.14.0` through Corepack. Package-manager caching is disabled and `git diff --exit-code` verifies that bootstrap did not change the checkout before the print contract, frozen install, executable tests, web typecheck or production build can run.

Toolchain, contract, dependency, core, CLI, MCP, aggregate test and web-build outcomes remain separately observable. A skipped downstream step is treated as a failed proof rather than a successful print release.

The full repository check, TypeScript, executable core and CLI tests, and production build remain mandatory before release.
