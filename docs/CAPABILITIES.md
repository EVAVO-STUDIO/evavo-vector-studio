# Unified capability discovery

EVAVO Vector Studio exposes one non-sensitive capability document at:

```text
GET /api/v1/capabilities
```

The endpoint lets the EVAVO hub, agents, scripts and operators choose the correct production surface without probing protected routes or inferring support from source files.

## Response boundary

The response is public metadata because it contains no workspace identity, generated body, token, secret, object key, filesystem path or retained job data.

It uses:

```text
Cache-Control: no-store, max-age=0
X-Content-Type-Options: nosniff
Vary: authorization, cookie, origin
```

The document explicitly reports:

```text
generatedBodiesIncluded: false
sensitiveValuesIncluded: false
```

Protected production endpoints retain their existing session or bearer authentication. Capability discovery does not grant access to tracing, print preflight, motion, jobs, worker control or object transfer.

## Discoverable interfaces

The document identifies the current paths and commands for:

- browser trace workspace and Motion Director;
- raster, SVG print preflight, animated SVG, Lottie and dotLottie HTTP APIs;
- hosted job control, worker control and worker-object transfer;
- single-file CLI, print-preflight CLI, durable batch CLI, local worker and HTTP worker;
- MCP stdio transport and its public contract version.

Generated SVG, PNG, Lottie JSON and dotLottie archives remain outside discovery responses and agent model context.

## Raster and SVG metadata

Discovery reports:

- accepted static raster formats and rejected multi-image containers;
- encoded-byte and decoded-pixel limits;
- automatic and directed reconstruction profiles;
- adaptive and single candidate modes;
- alpha-aware source analysis and visible-content bounds;
- editable, web, motion and print delivery profiles;
- editable as the default delivery profile;
- stable ID support for editable and motion outputs;
- multi-scale alpha-aware render comparison;
- difference-artifact limits;
- safety rollback evidence.

The document describes support, not the result for a specific asset. Per-asset source, candidate, topology, geometry, render, delivery and warning evidence remains on the trace result.

## Print preflight metadata

The raster section separately advertises the read-only `print-preflight-v1` contract through:

```text
POST /api/v1/print/preflight
evavo-vector-print
```

Discovery reports the `commercial`, `large-format`, `cut-vinyl` and `screen-print` profiles plus physical-dimension, trim-and-bleed, minimum-line-weight and process-colour-token checks.

The capability contract deliberately reports:

```text
cmykOrSpotColourProofAvailable: false
productionApproval: false
approval: review-required
```

Print preflight can detect structural production risks, but it cannot prove ICC conversion, spot-colour libraries, trapping, overprint, RIP behaviour or a physical proof.

## Motion and animation metadata

Discovery reports the governed motion-v1 properties, reduced-motion requirement and existing-animation rejection.

It separately reports the Lottie shape-layer subset and deterministic dotLottie archive contract. Structural inspection and exact archive loading are not represented as independent player-render validation.

```text
playerRenderValidationAvailable: false
```

## Automation metadata

The durable batch section reports:

- local and MCP manifest limits;
- persistent state and resumability;
- append-only events;
- immutable manifest revisions;
- completed-output receipt re-verification;
- no-overwrite semantics;
- delivery-profile support.

The worker section reports:

- supported object-backed operations;
- immutable source SHA-256 verification;
- atomic multi-object transactions;
- delivery-profile support;
- generated bodies excluded from control responses.

## Deployment non-claims

The endpoint deliberately distinguishes implemented local or self-hosted execution from unavailable managed infrastructure.

It reports:

```text
providerQueueDelivery: false
managedRemoteExecution: false
distributedAutoscaling: false
signedHubLaunch: deployment-and-configuration-dependent
```

A configured hosted record store or worker object-transfer adapter does not imply queue delivery, managed workers or autoscaling.

## Approval boundary

Capability discovery never promotes machine completion to production approval.

```text
machineCompletionIsProductionApproval: false
productionAutoApprovalAvailable: false
state: human-review-required
```

Every asset still needs the review appropriate to its source, geometry, topology, brand, accessibility, motion, player, print or delivery context.

## Source agreement and dependency closure

The HTTP endpoint is intentionally a dependency-light runtime route. It imports only the workspace packages needed for live capability constants rather than loading durable job or MCP server implementations solely to expose static metadata.

The dependency-free contract checks that every `@evavo/*` workspace import is declared by the Vector web package. It compares the locally exposed batch contract version and maximum item count with the canonical job-engine source constants.

It also derives the canonical MCP tool inventory from direct server registrations and the Lottie, dotLottie and durable-batch tool-name contracts. The exposed MCP contract version, tool count and MCP batch ceiling must agree with those source files. Duplicate tool names, stale counts or stale limits fail before dependency installation, TypeScript or the production build.

The focused capability workflow watches `packages/mcp/**` as well as the route and other capability-bearing packages. An MCP capability change therefore cannot bypass the focused contract, frozen dependency installation, web typecheck and production build.

The separate print-preflight workflow watches the print core, CLI, authenticated API route, discovery metadata and print documentation. It runs the print contract, exact dependency installation, executable core and CLI tests, Vector web typecheck and the workspace-aware production build.

The service version in the capability response is checked against the root package version. The obsolete duplicate checker is required to remain absent so there is one canonical discovery contract.

## Workspace-first production build

The Vector web application consumes workspace packages whose runtime exports point to compiled `dist` entrypoints. A standalone `next build` after dependency installation is therefore not sufficient in a clean checkout, even when TypeScript can resolve source declarations.

The focused workflow runs:

```powershell
pnpm build:packages
pnpm --filter @evavo/vector-web typecheck
pnpm --filter @evavo/vector-web build
```

This builds the canonical workspace dependency graph before Webpack resolves the web application. The contract requires both the dependency-build step and its dedicated `api/vector-capabilities-dependencies` status, preventing a future workflow change from skipping compiled workspace entrypoints while still claiming a production build.

## Validation

The dependency-free contracts are:

```powershell
pnpm capabilities-api:check
pnpm print-api:check
```

The focused GitHub workflows run their contracts, exact dependency installation, required workspace builds, executable tests, Vector web typecheck and production build whenever their source capability surfaces change.

The full repository quality chain includes both contracts before dependency-backed lint, typecheck, tests and build.
