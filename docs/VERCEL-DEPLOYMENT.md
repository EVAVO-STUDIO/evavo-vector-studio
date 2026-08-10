# EVAVO Vector Studio Vercel deployment

Vector Studio is designed to run as a protected standalone Next.js application at `vector.evavo.com.au`. Source readiness and a passing local build do not prove that a Vercel project, production domain, private signing authorities, replay store, or browser launch flow are operational.

## Live platform audit

The connected EVAVO Vercel team was inspected again on 6 August 2026.

```text
Team                    EVAVO's projects
Project                 evavo-vector-studio
Project ID              prj_Nb5IcrF5Fd0xhwDoUfZPJYmwSo6L
Minimum state           project-created
Framework               not yet configured
Root directory          not yet configured
Node.js                  24.x provider default; expected 22.x
Production domain       not attached
Production deployments  0
Client release          withheld
```

The standalone Vercel project now exists, but project existence is not deployment readiness. The next governed transaction must reconcile the framework, exact Node.js version, monorepo commands, production environment and domain before a separate exact-commit deployment is attempted.

## Provisioning provider preflight

The read-only workflow:

```text
.github/workflows/vector-vercel-provisioning-preflight.yml
```

runs the canonical provisioning plan and independently enforces its bounded provider-inspection receipt. It does not create a project, write environment variables, assign a domain, deploy code, or retain provider response bodies.

Provider access requires only `VERCEL_TOKEN`. With that single credential the plan can inspect:

- the exact pinned Vercel project identity;
- framework, Node.js, root-directory, install-command and build-command state;
- API-managed or exact matching GitHub source-control mode;
- production-domain attachment and verification state.

Application authorities remain a separate apply gate:

```text
EVAVO_CLIENT_APP_LAUNCH_SECRET
EVAVO_VECTOR_PRIVATE_SIGNING_SECRET
UPSTASH_REDIS_REST_URL
UPSTASH_REDIS_REST_TOKEN
VECTOR_API_TOKEN
VECTOR_WORKER_API_TOKEN
```

The preflight records only missing or invalid key names and bounded booleans. A provider inspection can pass while `readyToApply` remains false. In that state the receipt retains `VERCEL_PROVISION_APPLICATION_AUTHORITIES_INCOMPLETE`, project settings that still require reconciliation, and an unverified or absent domain without misreporting the provider inspection as unavailable.

The earlier preflight against commit `3b6f3604c9abfcfaebb6d2507f5d709b128c7e8b` found all seven values absent, including provider access, so provider inspection was unavailable. That run performed no Vercel mutation and recorded no sensitive values. Reusing one secret for multiple signing or API authorities remains prohibited.

The check can be rerun manually with `workflow_dispatch` or by updating:

```text
.github/vector-vercel-preflight.trigger
```

## Governed project provisioning

The manual workflow:

```text
.github/workflows/vector-vercel-project-provisioning.yml
```

has two explicit modes:

- `plan` requires only provider access, reads the exact EVAVO Vercel project and domain, writes a bounded canonical receipt without mutation, and reports application-authority gaps separately;
- `apply` requires provider access plus all six valid, separated application authorities, safely reconciles the project, upserts the production environment, and assigns `vector.evavo.com.au`.

Both modes require an exact current `main` commit. Apply additionally requires the protected `vector-studio-production` GitHub environment, a complete exact-commit source proof, and the literal confirmation:

```text
provision-evavo-vector-studio
```

The transaction is idempotent and is pinned to project ID `prj_Nb5IcrF5Fd0xhwDoUfZPJYmwSo6L`. If that project disappears or its identity changes, apply fails closed instead of creating an unreviewed replacement. The project may remain API-managed with no Git integration because exact production deployments are repository-owned transactions. If a Git link is present, it must belong to `EVAVO-STUDIO/evavo-vector-studio`; a conflicting link fails closed. Framework, Node.js 22.x and build settings are reconciled to the committed monorepo contract, environment values are upserted only for production, the four signing/API authorities must remain distinct, and receipts contain only key names and bounded state.

This provisioner does not deploy. Exact production deployment, deployment readiness polling, live private-response proof, durable replay proof, and one-time owner/client launch evidence remain separate governed transactions. After attachment, the provisioner calls Vercel’s project-domain verification endpoint. A domain that remains unverified leaves apply incomplete rather than claiming release readiness. Client release remains withheld throughout.

## Governed exact production deployment

The separate manual workflow:

```text
.github/workflows/vector-vercel-production-deployment.yml
```

also has `plan` and `apply` modes. Both require an exact current `main` commit and refuse to use a moved branch head. Apply additionally requires the protected `vector-studio-production` environment and the literal confirmation:

```text
deploy-evavo-vector-studio
```

Before deployment, the workflow performs a no-mutation project plan with all seven separated credentials and creates a complete exact-source proof. The deployer accepts the pinned project in API-managed mode or with an exact matching GitHub link, rejects conflicting source-control links, and requires Node.js 22.x plus the governed monorepo settings. It then creates or reuses only a production deployment associated with the requested 40-character Git SHA. Deployment metadata records the repository’s current public source visibility truthfully; the deployed application remains private through its signed-launch and app-session boundary. It polls bounded Vercel state until the deployment is `READY`, fails closed on `ERROR`, `CANCELED` or `BLOCKED`, proves the exact commit again from deployment metadata, and requires `vector.evavo.com.au` as the production alias.

After the alias is proven, the workflow runs the live private-response verifier and the public runtime verifier against the canonical HTTPS origin. It preserves bounded source, deployment, header and runtime receipts without storing secret values. A READY deployment alone is not release evidence if the commit, production alias, response headers or public capabilities are unproven.

The workflow then performs live capability discovery at:

```text
GET /api/v1/capabilities
```

That proof is source-proof bound to the exact frozen-installed, fully checked and production-built commit. It requires the deployed service version and capability contract, MCP version and tool count, delivery profiles, durable batch ceilings, worker operations, private response headers, and human-review approval boundary to match the checked source.

The live proof also verifies deployment non-claims. The deployed document must continue to report provider queue delivery, managed remote execution, distributed autoscaling and production auto-approval as unavailable. A stale host cannot gain promotion by overstating infrastructure that has not been deployed.

Only bounded headers, response byte count, SHA-256 and a compact capability summary enter the receipt. The response body is not retained, generated asset bodies are never requested, and no signing or API authority is supplied to the public discovery request.

The same apply transaction then creates a fresh one-time owner signed launch and a separate one-time client signed launch using the shared `evavo-client-app-launch-v1` receiver contract. Each token is masked before use, stored only in a mode-0600 temporary file, removed by a shell trap, accepted once by `/launch`, rejected on replay, and used to render both protected workspaces. Only token SHA-256 and bounded claim identifiers are retained; the token body is never uploaded.

These two profiles prove the deployed Vector Studio receiver, durable replay boundary and app-private session exchange. They do not by themselves prove that the central `next-website` owner and client UI issued the token from a real authenticated hub session. That final cross-application issuance and assignment proof remains separate. Client release remains withheld until it passes with the exact deployed commit.

## Project settings

The governed project is reconciled to:

```text
Repository          EVAVO-STUDIO/evavo-vector-studio
Project ID          prj_Nb5IcrF5Fd0xhwDoUfZPJYmwSo6L
Project name        evavo-vector-studio
Root directory      apps/web
Framework           Next.js
Install command     cd ../.. && pnpm install --frozen-lockfile
Build command       cd ../.. && pnpm exec turbo run build --filter=@evavo/vector-web
Production domain   vector.evavo.com.au
Node.js              22.x or a separately verified newer supported version
```

The committed `apps/web/vercel.json` carries the root-workspace install and filtered build contract. `pnpm-lock.yaml` is mandatory; a deployment must not replace the frozen install with an opportunistic dependency resolution.

## Synchronous transfer boundary

Vercel Functions enforce a 4.5 MB request and response body limit. Vector Studio keeps deliberate safety headroom:

```text
Provider body ceiling                 4,500,000 bytes
Maximum synchronous request           4,000,000 bytes
Maximum browser multipart source      3,250,000 bytes
Maximum synchronous response          4,000,000 bytes
Maximum base64 binary before wrapper   2,750,000 bytes
```

The raster engine itself still accepts sources up to 25 MiB in local CLI, MCP, batch, and self-hosted worker execution. The smaller hosted number is a transport limit, not a reduction in engine capability.

Synchronous hosted routes reject requests or responses that cannot fit safely. They return a stable non-retryable `413` response with the effective limits and recommended transports rather than allowing the platform to truncate or replace the response.

## Large-object workflow

Larger source files and output packages currently use:

- the local `evavo-vector` CLI;
- the local stdio MCP server;
- durable local batches;
- the self-hosted HTTP worker and its verified object-transfer protocol.

Provider-direct private storage is the intended browser route for larger objects, but it is not yet configured. Until that implementation is authenticated, workspace-scoped, immutable, receipt-backed, and independently smoke-tested, browser uploads remain inside the synchronous Vercel boundary.

## Required production environment

```dotenv
VECTOR_PUBLIC_ORIGIN=https://vector.evavo.com.au
EVAVO_CLIENT_APP_LAUNCH_SECRET=<dedicated hub handoff secret>
EVAVO_VECTOR_PRIVATE_SIGNING_SECRET=<different Vector Studio session secret>
VECTOR_HUB_REPLAY_MODE=upstash
UPSTASH_REDIS_REST_URL=https://<database>.upstash.io
UPSTASH_REDIS_REST_TOKEN=<server-only token>
VECTOR_API_TOKEN=<server-only machine API token>
VECTOR_WORKER_API_TOKEN=<separate worker-control token>
```

The two signing authorities must be distinct. Durable replay must use an atomic `SET ... EX ... NX` implementation. Worker and API tokens do not substitute for either browser signing authority.

## Verification

Source verification:

```powershell
pnpm vercel:check
pnpm vercel-provision:check
pnpm vercel-deploy:check
pnpm hub:check
pnpm check
pnpm --filter @evavo/vector-web build
```

The dedicated Vercel workflow additionally proves:

```text
frozen workspace install
Vercel deployment contract
Vercel project provisioning contract and self-test
exact production deployment contract and self-test
live owner/client token generator self-test
live capability discovery verifier self-test
private-response security contract
web TypeScript validation
Turbo dependency build and web production build
```

## Promotion evidence

Client release remains withheld until all of these are recorded against an exact reviewed commit:

1. the `evavo-vector-studio` Vercel project exists;
2. `apps/web` is the verified project root;
3. frozen install, full checks, and production build pass;
4. `vector.evavo.com.au` is assigned and HTTPS verified;
5. `/api/v1/capabilities` is source-proof bound and reports the governed capability and deployment non-claims;
6. required production environment variables are configured without secret reuse;
7. durable replay succeeds once and rejects replay;
8. central hub-issued owner and client signed launches each pass exactly once;
9. wrong-host, wrong-app, expiry, and provider-failure tests fail closed;
10. hosted trace and motion requests remain inside transfer and duration limits;
11. larger objects use a verified private transport rather than function bodies;
12. no credential, local path, discovery response body, or generated body appears in hub responses;
13. human review remains required for every generated production asset.

Only after that evidence exists should the central registry move from `federated-candidate` to `federated` and include `vector-studio` in the client release allowlist.
