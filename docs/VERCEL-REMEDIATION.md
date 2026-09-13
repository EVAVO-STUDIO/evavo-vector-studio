# Vector Studio provider remediation contract

Vector Studio owns the canonical provider-remediation sequence for the standalone Vercel project. The contract is:

```text
ops/provider/vector-studio-provider-remediation-v1.json
```

It defines the provider identity, project targets, monotonic state model, ordered action vocabulary, authority classes and required release proofs. It is a source contract, not a live provider receipt and not an instruction to mutate Vercel automatically.

## Canonical boundary

```text
Repository:       EVAVO-STUDIO/evavo-vector-studio
Branch policy:    exact current main
Vercel project:   evavo-vector-studio
Project ID:       prj_Nb5IcrF5Fd0xhwDoUfZPJYmwSo6L
Team ID:          team_ckKLAnG3MGJK0mMpIVpjbogl
Root directory:   apps/web
Framework:        nextjs
Node.js:          22.x
Canonical domain: vector.evavo.com.au
```

The contract derives these values from `ops/provider/vector-studio-vercel-project-v1.json`. A Hub or provider receipt may report observed state, but it must not redefine the canonical targets or action ordering.

## Ordered transaction

The governed sequence is:

1. `CONFIRM_SOURCE_CONTROL_BOUNDARY`
2. `SET_ROOT_DIRECTORY`
3. `SET_FRAMEWORK`
4. `SET_NODE_VERSION`
5. `SET_INSTALL_COMMAND`
6. `SET_BUILD_COMMAND`
7. `CONFIGURE_RUNTIME_AUTHORITIES`
8. `ATTACH_CANONICAL_DOMAIN`
9. `DEPLOY_EXACT_SOURCE`
10. `VERIFY_LIVE_RUNTIME`
11. `RUN_SIGNED_LAUNCH_PROOFS`
12. `PROMOTE_FROM_CENTRAL_HUB`

The domain is attached and verified before the exact production deployment proof. Provider configuration, deployment, runtime verification, signed-launch evidence and central promotion remain separate authority classes.

## Mutation and evidence

The source contract performs no provider call and contains no provider credential or runtime secret value. It records whether each action requires mutation and the only authority class allowed to satisfy it:

- `provider-read`
- `protected-provider-apply`
- `protected-production-deploy`
- `read-only-verification`
- `human-approved-proof`
- `central-human-promotion`

A checked-in plan or Hub projection may mark an action complete only from evidence produced by the matching authority. Source presence, provider configuration or a successful build cannot substitute for exact deployment, live runtime verification, one-time owner launch, assigned-client launch, replay rejection or central human promotion.

## Release remains withheld

The contract requires all of the following before release:

- provider configuration proof;
- canonical-domain proof;
- exact production-deployment proof;
- bounded live readiness and capability proof;
- one-time owner launch proof;
- one-time assigned-client launch proof;
- replay-rejection proof;
- explicit central human promotion.

`clientReleaseEligible` and `automaticPromotionAllowed` remain `false`. The contract does not deploy, attach a domain, create credentials, mint a launch token, assign a client or promote Vector Studio.
