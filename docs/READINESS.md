# Vector Studio runtime readiness

Vector Studio exposes a public non-sensitive runtime posture document at:

```text
GET /api/v1/readiness
```

The endpoint is designed for the EVAVO Hub, deployment workflows and operators. It reports whether the deployed runtime has the minimum production configuration needed for the private interactive workspace and whether the optional durable automation plane is configured.

It never returns secret values, credential digests, filesystem paths, workspace identity, generated assets, job records or object keys.

## Interactive readiness

`interactive.ready` is true only when all of these checks pass:

- the service is running as the canonical Vercel production runtime;
- `VECTOR_PUBLIC_ORIGIN` equals `https://vector.evavo.com.au`;
- the hub launch, private-session, API and worker authorities meet the governed minimum shape;
- those four authorities are distinct;
- replay mode is `upstash` with a valid HTTPS endpoint and bounded token shape.

A successful configuration projection is not a live launch proof. It does not verify DNS, the deployed Git SHA, first-use token redemption, replay rejection or authenticated workspace rendering.

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

Only the governed live release proof and central Hub review can promote Vector Studio. Runtime configuration alone cannot change the client allowlist or create an external Hub launch action.
