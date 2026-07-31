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

Protected production endpoints retain their existing session or bearer authentication. Capability discovery does not grant access to tracing, motion, jobs, worker control or object transfer.

## Discoverable interfaces

The document identifies the current paths and commands for:

- browser trace workspace and Motion Director;
- raster, animated SVG, Lottie and dotLottie HTTP APIs;
- hosted job control, worker control and worker-object transfer;
- single-file CLI, durable batch CLI, local worker and HTTP worker;
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

## Validation

The dependency-free contract is:

```powershell
pnpm capabilities-api:check
```

The focused GitHub workflow runs the contract, exact dependency installation, Vector web typecheck and production build whenever capability route, contract, documentation or source capability packages change.

The full repository quality chain also includes `capabilities-api:check` before dependency-backed lint, typecheck, tests and build.
