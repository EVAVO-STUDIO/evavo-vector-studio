# Vector Studio provisioning plan receipts

Project provisioning has a read-only plan phase before any Vercel project, environment or domain mutation. The plan keeps provider inspection separate from the application authorities that are needed only when apply is requested.

## Canonical plan wrapper

Workflows invoke:

```powershell
node scripts/plan-vector-studio-vercel-provisioning.mjs \
  --commit <exact-current-main-sha> \
  --out <new-receipt-path>
```

The wrapper invokes `scripts/provision-vector-studio-vercel.mjs` only with `--mode plan`. It never invokes apply mode, never sets `VECTOR_VERCEL_APPLY_CONFIRM`, and does not mutate Vercel.

When the canonical provisioner can inspect Vercel, its receipt remains authoritative even when runtime authorities are incomplete. When provider access fails before a canonical receipt can be written, the wrapper creates a bounded new-file-only diagnostic receipt and exits non-zero.

## Provider access

Read-only inspection requires only:

```text
VERCEL_TOKEN
```

A valid provider token allows the plan to inspect the pinned project, project settings, source-control mode and production-domain state. A successful canonical provider inspection receipt records:

```text
passed: true
plan.inspectionAvailable: true
plan.action: inspection-complete
mutationPerformed: false
sensitiveValuesRecorded: false
```

Missing or malformed provider access records:

```text
passed: false
readyToApply: false
plan.inspectionAvailable: false
plan.action: inspection-unavailable
diagnosticReceipt: true
blocker: VERCEL_PROVISION_PROVIDER_ACCESS_INVALID
```

Provider inspection never treats an absent application secret as a reason to hide the actual Vercel project state.

## Application authorities

Apply requires these six application authorities in addition to provider access:

```text
EVAVO_CLIENT_APP_LAUNCH_SECRET
EVAVO_VECTOR_PRIVATE_SIGNING_SECRET
UPSTASH_REDIS_REST_URL
UPSTASH_REDIS_REST_TOKEN
VECTOR_API_TOKEN
VECTOR_WORKER_API_TOKEN
```

The receipt records missing or invalid key names, never values. It verifies minimum lengths, whitespace rejection, HTTPS URL form and separation of the four signing and API authorities.

A provider-only canonical receipt can therefore truthfully report:

```text
inspectionAvailable: true
passed: true
readyToApply: false
blocker: VERCEL_PROVISION_APPLICATION_AUTHORITIES_INCOMPLETE
```

That state means the provider has been inspected successfully, but project mutation and production configuration remain blocked. It is not a production-readiness or client-release claim.

## Provider inspection enforcement

The preflight workflow passes the canonical receipt to:

```powershell
node scripts/enforce-vercel-provider-inspection-receipt.mjs \
  --receipt <receipt-path> \
  --commit <exact-current-main-sha>
```

The enforcer independently requires:

- exact repository and commit binding;
- the pinned Vercel project ID and name;
- a completed read-only inspection;
- an API-managed or exact matching GitHub source-control boundary;
- bounded boolean project-setting and domain evidence;
- no deployment;
- no mutation;
- no sensitive values.

Project settings may still require reconciliation, the domain may still be unverified, and application authorities may still be incomplete. Those are retained as explicit state rather than being misreported as an inspection failure.

## Child-process boundary

The wrapper records only:

- child script and fixed `plan` mode;
- exit status and signal;
- bounded stdout and stderr byte counts;
- whether the canonical receipt was produced.

Raw child output is not embedded in a fallback receipt. Non-empty secret values are checked against the serialized receipt before commit.

A successful bounded child summary can be forwarded only when it contains no credential value and remains under the child-output limit.

## Workflow behavior

The dedicated provider preflight is manual-only through `workflow_dispatch`. A caller must provide the exact current `main` SHA, and the job is bound to the protected `vector-studio-production` environment before any provider credential can be read. The workflow has no `push`, `pull_request` or scheduled trigger.

The tracked `.github/vector-vercel-preflight.trigger` file is now an inert compatibility marker. Updating it performs no automatic dispatch. This separation keeps source validation in the normal quality and deployment-contract workflows while avoiding a guaranteed-failure provider job on ordinary source edits. It preserves GitHub Actions minutes without weakening the production gate: a manual run still fails truthfully, publishes the exact-commit provider status and preserves a bounded diagnostic receipt when provider access is absent or contradictory.

Both the manual preflight and the pre-deployment provisioning check use the canonical wrapper. Receipt artifacts use:

```text
if: always()
if-no-files-found: error
include-hidden-files: true
```

Provider inspection status is independent from apply readiness. Apply remains a separate protected-environment transaction and continues to call the provisioner directly with explicit confirmation and all six valid, separated application authorities.

## Executable validation

`pnpm vercel-provision-plan:check` runs two executable paths:

1. With provider access absent, the wrapper exits non-zero and writes a bounded diagnostic receipt with `inspectionAvailable: false`.
2. With only a mocked valid `VERCEL_TOKEN`, the real wrapper and provisioner produce a canonical provider inspection receipt with `inspectionAvailable: true`, `readyToApply: false`, and `VERCEL_PROVISION_APPLICATION_AUTHORITIES_INCOMPLETE`.

The second receipt is then verified by the real provider-inspection enforcer. Both paths assert new-file-only output, exact commit binding, no provider mutation and no sensitive values.

The separate `pnpm vercel-plan:check` command governs the later exact-production deployment plan and its project/domain blockers. Keeping these commands distinct prevents provider visibility, provisioning readiness and deployment readiness from being conflated.
