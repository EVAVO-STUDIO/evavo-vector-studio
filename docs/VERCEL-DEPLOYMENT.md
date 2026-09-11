# EVAVO Vector Studio Vercel deployment

Vector Studio is a protected standalone Next.js application intended for `https://vector.evavo.com.au`. Source readiness, a passing local build, Vercel project existence and a READY deployment are separate facts. None of them alone grants client release.

GitHub Actions is not Vector Studio validation, deployment, release or publication authority. The canonical control plane is repository-local code plus bounded provider/runtime receipts. Development Studio remains repository publication authority. Vercel is an explicit deployment-effect provider only.

## Governed project identity

```text
Repository              EVAVO-STUDIO/evavo-vector-studio
Project ID              prj_Nb5IcrF5Fd0xhwDoUfZPJYmwSo6L
Project name            evavo-vector-studio
Root directory          apps/web
Framework               Next.js
Node.js                  22.x
Install command         cd ../.. && pnpm install --frozen-lockfile
Build command           cd ../.. && pnpm exec turbo run build --filter=@evavo/vector-web
Production domain       vector.evavo.com.au
Canonical origin        https://vector.evavo.com.au
```

The project may be **API-managed** with no Git integration. If a Git link exists, it must point to the governed EVAVO repository. Automatic Git deployment creation remains disabled at rest; exact production deployments are explicit repository-owned provider transactions.

## Exact current main

Every mutating provider transaction is bound to the **exact current `main` commit**. The local control plane verifies:

- branch is `main`;
- local HEAD equals the requested 40-character SHA;
- tracked and untracked source is clean;
- `origin/main`, read directly from the remote, still equals that SHA before consequential provider effects;
- source remains unchanged after the bounded transaction.

The exact-main checker is read-only. It never fetches into the working tree, resets, checks out, rebases, pushes or publishes.

## Provider access and application authorities

Provider access requires only `VERCEL_TOKEN`.

Application authorities remain a separate full-apply gate:

```text
EVAVO_CLIENT_APP_LAUNCH_SECRET
EVAVO_VECTOR_PRIVATE_SIGNING_SECRET
UPSTASH_REDIS_REST_URL
UPSTASH_REDIS_REST_TOKEN
VECTOR_API_TOKEN
VECTOR_WORKER_API_TOKEN
```

The four signing/API authorities must remain distinct. Provider inspection can pass while `readyToApply` remains false when application authorities are absent or invalid. Receipts record missing/invalid **key names only**, never secret values.

## Read-only provider planning

Use the local provisioning planner and canonical receipt enforcer. It reads the pinned project/domain, framework, Node version, root directory, install/build settings and source-control posture without mutation.

```powershell
node scripts/run-vector-vercel-provisioning-local.mjs `
  --mode plan `
  --commit <exact-main-sha> `
  --evidence-root C:\Evidence\Vector\provision-plan
```

The underlying `plan-vector-studio-vercel-provisioning.mjs` and `enforce-vercel-provider-inspection-receipt.mjs` retain bounded responses, provider-only credential admission and secret-free evidence. Read-only planning **does not deploy**.

## Provider-only project settings

Framework, Node.js, root directory, install/build commands and feedback controls can be reconciled without application runtime secrets. The settings transaction uses only `VERCEL_TOKEN`, a full exact-source proof and the internal confirmation:

```text
reconcile-evavo-vector-studio-project-settings
```

Canonical local entrypoint:

```powershell
node scripts/run-vector-vercel-settings-source.mjs `
  --commit <exact-main-sha> `
  --evidence-root C:\Evidence\Vector\settings
```

The orchestrator enforces the order:

```text
exact-main
provider-access
source-proof
settings-reconciliation
exact-main recheck
```

It has no application-secret authority and no production deployment authority.

## Full production configuration

Full Vercel provisioning is a separate local transaction. It requires provider access plus all valid separated application authorities, reconciles the pinned project, upserts the production environment and attaches/verifies `vector.evavo.com.au`.

```powershell
node scripts/run-vector-vercel-provisioning-local.mjs `
  --mode apply `
  --commit <exact-main-sha> `
  --evidence-root C:\Evidence\Vector\provision-apply
```

The underlying provisioner uses the governed confirmation `provision-evavo-vector-studio`. It is idempotent against the pinned project and fails closed on project identity/source-control conflicts. Its receipts distinguish `mutationAttempted` from `mutationPerformed`, never contain provider response bodies or credentials, and always retain `deploymentPerformed: false`. Provisioning configures the runtime; it **does not deploy** the application.

## Exact production deployment

Production deployment is the final provider effect and is now orchestrated locally:

```powershell
node scripts/run-vector-vercel-production.mjs `
  --mode plan `
  --commit <exact-main-sha> `
  --evidence-root C:\Evidence\Vector\production-plan
```

Apply only after the exact reviewed source and required authorities are ready:

```powershell
node scripts/run-vector-vercel-production.mjs `
  --mode apply `
  --commit <exact-main-sha> `
  --evidence-root C:\Evidence\Vector\production-apply
```

The evidence root must be outside the repository and must not already exist. The apply lane performs, in order:

1. exact-current-main proof;
2. complete source proof (`pnpm install --frozen-lockfile`, full `pnpm check`, production web build, clean source recheck);
3. bounded provider inspection and canonical receipt enforcement;
4. exact production deployment plan;
5. full pinned-project/environment/domain reconciliation;
6. another exact-main recheck;
7. exact-SHA Vercel production deployment and READY/alias/commit proof;
8. live private-response proof;
9. source-bound public deployment proof;
10. source-bound live capability discovery;
11. fresh one-time owner launch and replay-rejection proof;
12. separate fresh one-time client launch and replay-rejection proof;
13. final exact-main recheck and create-only bounded receipt.

The deployer uses the literal internal confirmation `deploy-evavo-vector-studio`, targets only production, uses the pinned Vercel project and records exact Git SHA/source metadata. It fails closed on `ERROR`, `CANCELED` or `BLOCKED` deployment state and requires the canonical production alias.

If the free Vercel API deployment allowance is exhausted, the deployer reports `VERCEL_DEPLOY_API_QUOTA_EXHAUSTED`, bounded allowance/reset metadata and `mutationAttempted: true` / `mutationPerformed: false`. Operators should retry after the recorded reset rather than burn repeated provider calls.

## One-time owner and client launch evidence

The release lane creates owner and client launch tokens separately with `create-vector-live-launch-token.mjs`. Each token is written only to a mode-0600 temporary evidence file, read into memory for the live verifier, never placed in command arguments, and deleted immediately after proof execution.

The final evidence retains only token/replay digests and bounded claim identifiers. Raw token bodies, cookies, signing secrets, API tokens and provider tokens must never appear in receipts, stdout summaries, command arguments, source control or URLs.

A successful owner/client receiver proof still does not prove the central `next-website` UI issued the launch from a real authenticated Hub session. That cross-application issuance/assignment proof remains separate.

## Runtime and transport boundaries

Vercel Functions enforce a 4.5 MB request/response body ceiling. Vector Studio intentionally keeps headroom:

```text
Provider body ceiling                  4,500,000 bytes
Maximum synchronous request            4,000,000 bytes
Maximum browser multipart source       3,250,000 bytes
Maximum synchronous response           4,000,000 bytes
Maximum base64 binary before wrapper   2,750,000 bytes
```

The local engine still accepts larger sources through CLI, MCP, durable local batches and the self-hosted HTTP worker. Provider-direct private storage remains unavailable until separately implemented and verified; the service must continue to report that non-claim truthfully.

## Source verification

```powershell
pnpm vercel:check
pnpm vercel-provision:check
pnpm vercel-settings-source:check
pnpm vercel-provision-plan:check
pnpm vercel-plan:check
pnpm vercel-bootstrap-retirement:check
pnpm vercel-deploy:check
pnpm readiness:check
pnpm check
```

These checks validate repository-local code and receipts. They do not require workflow/job/status topology.

## Promotion evidence

**Client release remains withheld** until all governed source/provider/live evidence is bound to the same reviewed commit, including exact project/root/toolchain, HTTPS domain, source proof, application authority separation, durable replay, capability non-claims, owner/client launch evidence, transport ceilings and human review.

Only after that evidence exists should the central registry move Vector Studio from `federated-candidate` to `federated` and include it in a client release allowlist. Workflow success, deployment state, provider configuration or runtime readiness alone cannot perform that promotion.
