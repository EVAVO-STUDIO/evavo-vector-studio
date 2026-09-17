# Vector Studio runtime readiness

Vector Studio exposes a public non-sensitive runtime posture document at:

```text
GET /api/v1/readiness
```

The endpoint is designed for the EVAVO Hub, operators and explicit deployment tooling. It reports whether the deployed runtime has the minimum production configuration needed for the private interactive workspace and whether the optional durable automation plane is configured.

It never returns secret values, credential digests, filesystem paths, workspace identity, generated assets, job records or object keys.

## Interactive readiness

`interactive.ready` is true only when the service is the canonical Vercel production runtime, `VECTOR_PUBLIC_ORIGIN` equals `https://vector.evavo.com.au`, the hub/session/API/worker authorities meet the governed minimum shape and remain distinct, and replay mode is `upstash` with a valid HTTPS endpoint and bounded token shape.

A successful configuration projection is not live launch proof. It does not verify DNS, deployed Git SHA, first-use token redemption, replay rejection or authenticated workspace rendering.

## Automation readiness

`automation.ready` is stricter. It requires interactive readiness plus persistent hosted job records, persistent object transfer and worker control.

The current repository provides local or self-hosted file adapters. Those adapters are deliberately not represented as persistent on the Vercel runtime. The endpoint therefore keeps automation blocked until a real persistent production storage and worker topology exists.

It continues to report:

```text
providerQueueDelivery: false
managedRemoteExecution: false
distributedAutoscaling: false
```

## Release boundary

The readiness document always retains:

```text
clientReleaseEligible: false
sourceProofRequired: true
publicRuntimeProofRequired: true
ownerLaunchProofRequired: true
clientLaunchProofRequired: true
replayRejectionProofRequired: true
centralHumanPromotionRequired: true
sensitiveValuesIncluded: false
```

Only governed live release proof plus central human review can promote Vector Studio. Runtime configuration alone cannot change the client allowlist or create an external Hub launch action.

## Provider-free validation

`pnpm readiness:check`, `pnpm hygiene:check`, `pnpm test-build-isolation:check`, the lockfile checks, workspace typecheck/build and the full `pnpm check` chain are repository-local authority. The retired `.github/workflows/readiness-contract.yml` wrapper must remain absent.

Readiness validation is read-only. It cannot provision Vercel, mutate domains, add credentials, promote the client allowlist or generate a signed launch. Vercel provider effects require their own explicit governed commands and receipts; workflow success does not grant that authority.

Related source contracts: [`REPOSITORY-HYGIENE.md`](REPOSITORY-HYGIENE.md) and [`TEST-BUILD-ISOLATION.md`](TEST-BUILD-ISOLATION.md).
