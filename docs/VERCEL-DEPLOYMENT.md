# EVAVO Vector Studio Vercel deployment

Vector Studio is designed to run as a protected standalone Next.js application at `vector.evavo.com.au`. Source readiness and a passing local build do not prove that a Vercel project, production domain, private signing authorities, replay store, or browser launch flow are operational.

## Live platform audit

The connected EVAVO Vercel team was inspected on 30 July 2026.

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
pnpm hub:check
pnpm check
pnpm --filter @evavo/vector-web build
```

The dedicated Vercel workflow additionally proves:

```text
frozen workspace install
Vercel deployment contract
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
5. required production environment variables are configured without secret reuse;
6. durable replay succeeds once and rejects replay;
7. owner and client signed launches each pass exactly once;
8. wrong-host, wrong-app, expiry, and provider-failure tests fail closed;
9. hosted trace and motion requests remain inside transfer and duration limits;
10. larger objects use a verified private transport rather than function bodies;
11. no credential, local path, or generated body appears in hub responses;
12. human review remains required for every generated production asset.

Only after that evidence exists should the central registry move from `federated-candidate` to `federated` and include `vector-studio` in the client release allowlist.
