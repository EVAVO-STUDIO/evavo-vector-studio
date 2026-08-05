# Vector Studio Vercel project state v1

## Decision and identity

EVAVO Vector Studio is a protected standalone runtime. It uses its own Vercel project rather than being deployed inside the central `next-website` project.

```text
team:          EVAVO's projects
team id:       team_ckKLAnG3MGJK0mMpIVpjbogl
project:       evavo-vector-studio
project id:    prj_Nb5IcrF5Fd0xhwDoUfZPJYmwSo6L
source:        EVAVO-STUDIO/evavo-vector-studio
root:          apps/web
framework:     Next.js
Node.js:       22.x
production:    https://vector.evavo.com.au
```

The project has reached the permanent `project-created` boundary. Creation is not evidence that project settings, environment authorities, DNS, deployment or signed launch are complete.

## Monotonic state model

Provider state is reported through separate boundaries:

```text
source-ready
project-created
project-configured
domain-verified
production-deployed
owner-launch-proven
client-launch-proven
replay-rejection-proven
release-promoted
```

The current release policy remains `release-withheld`. `clientReleaseEligible` remains false until every live proof succeeds and the central Hub is deliberately promoted.

## Read-only provider verification

Run the verifier against the exact current `main` SHA:

```text
node scripts/verify-vector-studio-vercel-project-v1.mjs \
  --commit <40-character-main-sha> \
  --out .ci/vector-studio-vercel-project-v1.json
```

The verifier checks:

- the exact EVAVO team, project ID and project name;
- Next.js, `apps/web`, Node 22, frozen monorepo installation and the governed Turbo build command;
- the canonical `vector.evavo.com.au` domain and its verification state;
- only the names of the eight required production environment variables;
- whether the provider state is ready for the separate deployment and live-proof transaction.

The verifier performs bounded `GET` requests only. It uses a 30-second request timeout, a 1 MB response ceiling and a 128 KiB new-file-only receipt. The receipt is written with mode `0600`.

No secret values, raw provider responses, credentials, launch tokens, object keys or workspace identities are retained. The receipt explicitly records that no mutation was attempted or performed.

## Mutation and release authority

Provider mutation remains owned by the existing guarded repository scripts:

```text
scripts/provision-vector-studio-vercel.mjs
scripts/deploy-vector-studio-vercel-production.mjs
```

Provisioning, exact-commit deployment, owner launch, assigned-client launch, replay rejection and Hub promotion remain separate transactions. A green source check or a created Vercel project cannot bypass those boundaries.

The permanent machine-readable identity is:

```text
ops/provider/vector-studio-vercel-project-v1.json
```

The source contract is:

```text
scripts/check-vector-studio-vercel-project-v1.mjs
```
