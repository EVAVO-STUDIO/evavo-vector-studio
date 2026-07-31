# EVAVO Vector Studio Vercel deployment

Vector Studio is designed to run as a protected standalone Next.js application at `vector.evavo.com.au`. Source readiness and a passing local build do not prove that a Vercel project, production domain, private signing authorities, replay store, or browser launch flow are operational.

## Live platform audit

The connected EVAVO Vercel team was inspected on 31 July 2026.

```text
Team                    EVAVO's projects
Expected project        evavo-vector-studio
Project found           no
Production domain       not provisioned
Deployment evidence     unavailable
Client release          withheld
```

No `evavo-vector-studio` Vercel project exists in the connected team. The repository must therefore remain a `federated-candidate`, and the hub must not issue a Vector Studio launch token.

## Provisioning credential preflight

The read-only workflow:

```text
.github/workflows/vector-vercel-provisioning-preflight.yml
```

checks deployment readiness without creating a project, writing environment variables, assigning a domain, or deploying code. It verifies only:

- required GitHub Actions secret names are populated;
- minimum secret lengths and URL form;
- the hub handoff, Vector session, machine API, and worker-control authorities are distinct;
- `VERCEL_TOKEN` can read the expected EVAVO team;
- whether `evavo-vector-studio` already exists;
- no secret value is written to the report or logs.

The preflight run against commit `3b6f3604c9abfcfaebb6d2507f5d709b128c7e8b` found all seven required repository secrets absent:

```text
VERCEL_TOKEN
EVAVO_CLIENT_APP_LAUNCH_SECRET
EVAVO_VECTOR_PRIVATE_SIGNING_SECRET
UPSTASH_REDIS_REST_URL
UPSTASH_REDIS_REST_TOKEN
VECTOR_API_TOKEN
VECTOR_WORKER_API_TOKEN
```

That run performed no Vercel mutation and recorded no sensitive values. Project provisioning must remain blocked until the credentials are added through GitHub repository or environment secrets and the preflight passes. Reusing one secret for multiple authorities is not permitted.

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

- `plan` validates all seven credentials, reads the EVAVO Vercel team, inspects the expected project and domain, and writes a bounded receipt without mutation;
- `apply` creates or safely reconciles the project, upserts the production environment, and assigns `vector.evavo.com.au`.

Both modes require an exact current `main` commit. Apply additionally requires the protected `vector-studio-production` GitHub environment, a complete exact-commit source proof, and the literal confirmation:

```text
provision-evavo-vector-studio
```

The transaction is idempotent. An existing project is reused only when its GitHub link belongs to `EVAVO-STUDIO/evavo-vector-studio`; a same-name project linked elsewhere fails closed. Build settings are reconciled to the committed monorepo contract, environment values are upserted only for production, the four signing/API authorities must remain distinct, and receipts contain only key names and bounded state.

This provisioner does not deploy. Exact production deployment, deployment readiness polling, live private-response proof, durable replay proof, and one-time owner/client launch evidence remain separate governed transactions. A newly assigned but unverified domain leaves apply incomplete rather than claiming release readiness. Client release remains withheld throughout.

## Governed exact production deployment

The separate manual workflow:

```text
.github/workflows/vector-vercel-production-deployment.yml
```

also has `plan` and `apply` modes. Both require an exact current `main` commit and refuse to use a moved branch head. Apply additionally requires the protected `vector-studio-production` environment and the literal confirmation:

```text
deploy-evavo-vector-studio
```

Before deployment, the workflow performs a no-mutation project plan with all seven separated credentials and creates a complete exact-source proof. The deployer then creates or reuses only a production deployment associated with the requested 40-character Git SHA. It polls bounded Vercel state until the deployment is `READY`, fails closed on `ERROR`, `CANCELED` or `BLOCKED`, proves the exact commit again from deployment metadata, and requires `vector.evavo.com.au` as the production alias.

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

Create the future project with:

```text
Repository          EVAVO-STUDIO/evavo-vector-studio
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
