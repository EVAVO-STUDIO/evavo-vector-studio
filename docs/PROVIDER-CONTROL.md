# Provider control for Vector Studio

## Decision

EVAVO Vector Studio is a protected standalone runtime. It requires its own Vercel project named `evavo-vector-studio`, linked to `EVAVO-STUDIO/evavo-vector-studio`, with `apps/web` as the Vercel root directory and `vector.evavo.com.au` as the canonical production domain.

It must not be deployed inside the `next-website` Vercel project. The EVAVO Hub remains the central catalogue, assignment, release-policy and signed-launch authority; Vector Studio remains a separately deployed private application.

## Authoritative mutation path

The repository-local provisioner is the sole authoritative Vercel mutation implementation:

```text
scripts/provision-vector-studio-vercel.mjs
```

It already governs:

- EVAVO team and project identity;
- GitHub repository linkage;
- `apps/web` root-directory configuration;
- monorepo install and Turbo build commands;
- idempotent project creation or safe settings reconciliation;
- production environment-variable upserts;
- authority separation;
- durable Upstash replay configuration;
- `vector.evavo.com.au` domain attachment;
- bounded, secret-free receipts;
- explicit `plan` and protected `apply` modes;
- no production deployment inside the provisioning transaction.

Exact production deployment and live release proof remain a separate governed transaction.

## Required production authorities

The apply transaction requires these values to exist in the protected execution environment:

```text
VERCEL_TOKEN
EVAVO_CLIENT_APP_LAUNCH_SECRET
EVAVO_VECTOR_PRIVATE_SIGNING_SECRET
UPSTASH_REDIS_REST_URL
UPSTASH_REDIS_REST_TOKEN
VECTOR_API_TOKEN
VECTOR_WORKER_API_TOKEN
```

Secret values must never be committed, printed, placed in receipts or copied into issue text. The four signing and API authorities must remain distinct.

## Tooling boundary

`EVAVO-STUDIO/evavo-github-mcp` remains a read-only evidence adapter. It must not become a universal privileged mutation gateway. GitHub and Vercel writes belong in narrowly scoped, repository-owned workflows and scripts with exact-project allowlists, explicit confirmation, protected environments, bounded output and auditable receipts.

This avoids creating one broad credential with unrestricted authority over every EVAVO repository and deployment.

## Connected-agent limitations

A connected agent may be able to inspect GitHub and Vercel while still lacking one or more mutation capabilities, including:

- creating a Vercel project through the connected Vercel tool;
- writing Vercel production environment variables;
- attaching domains;
- creating or changing GitHub Actions secrets and protected-environment secrets.

Read access must not be represented as write access. When connected mutation coverage is unavailable, the governed repository workflow remains the fallback. Missing authority is an external execution blocker, not a reason to invent credentials, deploy a stale checkout or use another Vercel project.

## Release sequence

1. Produce a green exact-head source proof.
2. Run the read-only provisioning plan.
3. Run protected provisioning apply for the same exact `main` commit.
4. Confirm project, Git link, environment keys and domain state.
5. Run the separate exact-commit production deployment transaction.
6. Verify private headers, readiness and capabilities on the live host.
7. Prove one-time owner and assigned-client launches and replay rejection.
8. Promote Vector Studio in the Hub only after every live proof passes.

Source readiness, project existence and client release are separate states and must remain separately reported.
