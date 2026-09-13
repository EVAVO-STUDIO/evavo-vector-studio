# CI and provider budget

Vector Studio keeps evidence strong without running the same dependency installation, tests and production build in several workflows for one commit.

## Permanent automatic gates

The repository keeps exactly:

```text
one full automatic quality gate
one dependency-free automatic governance gate
```

`Vector Studio quality` remains the universal `main`, pull-request and merge-queue gate. It owns the frozen dependency graph, all established source contracts, lint, strict TypeScript, executable tests and the complete production build.

`Vector Studio source governance` is path-scoped and dependency-free. It owns workflow trigger policy, repository hygiene, test/build isolation, runtime-readiness source agreement and clean-tree proof. It does not install packages, compile the application or call a provider.

## Operator-dispatched deep proofs

These workflows retain their complete specialist evidence but run only through `workflow_dispatch`:

```text
Vector Studio capability discovery
Vector Studio print preflight
Vector Studio runtime readiness
EVAVO hub integration contract
HTTP Worker contract
Vector Studio source release proof
```

They remain available when an operator needs separately named capability, print, readiness, Hub, worker or source-proof receipts. Ordinary source pushes rely on the universal quality gate plus the cheap governance gate rather than repeating package installation and builds.

The manual boundary does not weaken release policy. A production release can require the relevant specialist workflow to be dispatched against the exact approved commit before promotion.

## Provider mutation

Provisioning, production deployment and public-runtime proof remain explicit operator transactions. Their workflows require exact commit input and retain the protected production boundary.

Automatic governance performs no provider mutation. It cannot:

```text
configure Vercel
write environment values
attach vector.evavo.com.au
create a deployment
generate a launch token
promote the Hub registry
approve client release
```

Client release remains withheld until the governed provider, live launch, replay and central human-promotion evidence is complete.

## Retired write authority

The obsolete write-enabled recovery workflow must remain absent:

```text
.github/workflows/repair-pnpm-lockfile-once.yml
```

That workflow could commit to `main` and cancel Actions. The package-manager bootstrap defect it addressed is already permanently corrected by the exact Corepack and frozen-install boundaries.

## Provider compatibility marker

The tracked file:

```text
.github/vector-vercel-preflight.trigger
```

is retained only as an inert compatibility marker for the mature Vercel deployment contract. Provider preflight is manual-only through `workflow_dispatch`, and changing the marker performs no automatic dispatch. The budget guard verifies both the marker text and the absence of any push, pull-request or scheduled provider-preflight trigger.

## Enforcement

```text
node scripts/check-ci-budget-contract.mjs
```

The dependency-free contract verifies the two automatic gates, manual specialist proofs, manual provider transactions, absence of retired write authority, the inert compatibility marker, least-privilege governance permissions and the continuing no-mutation and no-release posture.
