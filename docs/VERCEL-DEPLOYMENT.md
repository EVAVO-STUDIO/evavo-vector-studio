# EVAVO Vector Studio Vercel deployment

Vector Studio is a protected standalone Next.js application intended for `https://vector.evavo.com.au`. Source readiness, a passing local build, Vercel project configuration, a READY deployment and client release approval are separate facts. None grants another automatically.

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

Every provider transaction is bound to the **exact current `main` commit**. The local control plane verifies the branch is `main`, local HEAD equals the requested 40-character SHA, tracked and untracked source is clean, and `origin/main` read directly from the remote still equals that SHA. Consequential paths recheck the same boundary after source proof and provider effects.

The exact-main checker is read-only. It never fetches into the worktree, resets, checks out, switches, rebases, pushes or publishes.

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

The signing/API authorities must remain appropriately separated. Provider inspection can pass while `readyToApply` remains false when application authorities are absent, malformed or not separated. Receipts record missing/invalid key names and bounded state, never secret values.

## Read-only provider planning

```powershell
node scripts/run-vector-vercel-provisioning-local.mjs `
  --mode plan `
  --commit <exact-main-sha> `
  --evidence-root C:\Evidence\Vector\provision-plan
```

The underlying planner and receipt enforcer inspect the pinned project/domain, framework, Node version, root directory, install/build settings and source-control posture without mutation. Read-only planning **does not deploy**.

## Provider-only project settings

Provider-only project settings can be reconciled with `VERCEL_TOKEN` while application runtime secrets remain unavailable. The settings transaction requires exact-main proof plus full source proof and uses the governed confirmation:

```text
reconcile-evavo-vector-studio-project-settings
```

Canonical local entrypoint:

```powershell
node scripts/run-vector-vercel-settings-source.mjs `
  --commit <exact-main-sha> `
  --evidence-root C:\Evidence\Vector\settings
```

The order is provider access → source proof → settings-only reconciliation with exact-main checks around the consequential boundary. This lane has no application-secret authority and no production deployment authority.

## Full production configuration

Full production provisioning is a separate transaction and should be completed before production deployment. It requires provider access plus all valid separated application authorities, reconciles the pinned project, upserts production environment values and attaches/verifies `vector.evavo.com.au`.

```powershell
node scripts/run-vector-vercel-provisioning-local.mjs `
  --mode apply `
  --commit <exact-main-sha> `
  --evidence-root C:\Evidence\Vector\provision-apply
```

The underlying provisioner uses `provision-evavo-vector-studio`, is idempotent against the pinned project and fails closed on project identity/source-control conflicts. Its receipts distinguish `mutationAttempted` from `mutationPerformed`, never contain provider response bodies or credentials, and retain `deploymentPerformed: false`. Provisioning configures the runtime; it **does not deploy** application source.

## Exact production deployment

Production deployment is a separate provider effect. The canonical local entrypoint is:

```powershell
node scripts/run-vector-vercel-production-local.mjs `
  --mode plan `
  --commit <exact-main-sha> `
  --evidence-root C:\Evidence\Vector\production-plan
```

Apply only after full production provisioning is already proven ready:

```powershell
node scripts/run-vector-vercel-production-local.mjs `
  --mode apply `
  --commit <exact-main-sha> `
  --evidence-root C:\Evidence\Vector\production-apply
```

The evidence root must be outside the repository. Child receipts are create-only; rerunning against an existing receipt fails rather than overwriting evidence.

The local production lane performs:

1. exact-current-main proof;
2. provider-token admission;
3. complete source proof (`pnpm install --frozen-lockfile`, full `pnpm check`, production web build, clean-source recheck);
4. exact-main recheck;
5. read-only provider provisioning plan to prove the pinned project/configuration boundary without changing it;
6. exact production deployment plan or apply using `deploy-vector-studio-vercel.mjs`;
7. exact-main recheck after the provider deployment step;
8. on apply: live private-response proof;
9. source-bound public deployment proof;
10. source-bound live capability discovery;
11. fresh one-time owner launch and replay-rejection proof;
12. separate fresh one-time client launch and replay-rejection proof;
13. final exact-main recheck.

The production lane deliberately **does not replace full provisioning**. If the project/environment/domain were not configured correctly beforehand, the deployment or live proof fails closed instead of silently acquiring broader configuration authority.

The deployer uses the governed confirmation `deploy-evavo-vector-studio`, targets only production, binds source to the exact Git SHA and requires the canonical production alias. It fails closed on `ERROR`, `CANCELED` or `BLOCKED` deployment state.

If the free Vercel API deployment allowance is exhausted, the deployer reports `VERCEL_DEPLOY_API_QUOTA_EXHAUSTED`, bounded allowance/reset metadata and `mutationAttempted: true` / `mutationPerformed: false`. Retry only after the recorded reset rather than spending repeated provider requests.

## One-time owner and client launch evidence

The production lane creates owner and client launch tokens separately with `create-vector-live-launch-token.mjs`. Each token is stored only in a mode-0600 temporary evidence file, read into memory for the live verifier and deleted immediately after proof execution.

Only token/replay digests and bounded claim identifiers survive. **Raw token bodies**, cookies, signing secrets, API tokens and provider tokens must never appear in receipts, command arguments, source control or URLs.

A successful owner/client receiver proof still does not prove that `next-website` issued the launch from a real authenticated Hub session. Cross-application issuance/assignment evidence remains separate.

## Runtime and transport boundaries

Vercel Functions impose a 4.5 MB body ceiling. Vector Studio keeps deliberate headroom:

```text
Provider body ceiling                  4,500,000 bytes
Maximum synchronous request            4,000,000 bytes
Maximum browser multipart source       3,250,000 bytes
Maximum synchronous response           4,000,000 bytes
Maximum base64 binary before wrapper   2,750,000 bytes
```

The local engine supports larger sources through CLI, MCP, durable local batches and the self-hosted HTTP worker. Provider-direct private storage remains unavailable until separately implemented and verified, and public capability discovery must continue to report that non-claim truthfully.

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

These checks validate repository-local source and receipt contracts. They do not require workflow/job/status topology.

## Promotion evidence

**Client release remains withheld** until source, provider and live evidence is bound to the same reviewed commit, including project/root/toolchain identity, HTTPS domain, exact source proof, application authority separation, durable replay, truthful capability non-claims, owner/client launch evidence, transport ceilings and human review.

Only after that evidence exists should the central registry move Vector Studio from `federated-candidate` to `federated` and include it in a client release allowlist. Workflow success, deployment state, provider configuration or runtime readiness alone cannot perform that promotion.
