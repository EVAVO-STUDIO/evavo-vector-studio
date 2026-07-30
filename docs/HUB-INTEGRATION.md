# EVAVO Vector Studio hub integration

Vector Studio is an EVAVO-owned private application intended to open from `EVAVO-STUDIO/next-website` through a short-lived signed handoff. The repository implements the receiving boundary before asking the hub to mark the app released.

## Current promotion state

```text
Application key                 vector-studio
Recommended host                vector.evavo.com.au
Hub strategy                    federated-candidate
Public metadata                 available
Health endpoint                 available
Signed handoff verifier         available
App-private session contract    available
One-time replay adapters        memory test + Upstash REST
Central issuer fixture          available
Production deployment evidence  unavailable
Client release eligibility      false
Deployment release flag         clientReleaseEligible: false
```

The hub entry is deliberately staged. Metadata, source code and a passing local build do not prove that the production domain, environment, shared launch key, replay store or browser redemption flow are working.

## Public integration metadata

```text
apps/web/public/hub/evavo-vector-studio.card.json
apps/web/public/hub/evavo-vector-studio.hub-entry.json
apps/web/public/hub/evavo-vector-studio.deployment.json
apps/web/public/manifest.webmanifest
```

These files contain presentation and target-deployment information only. They never authorize a user or contain a credential.

## Credential authorities

Vector Studio uses separate server-only values:

```text
EVAVO_CLIENT_APP_LAUNCH_SECRET
EVAVO_VECTOR_PRIVATE_SIGNING_SECRET
```

`EVAVO_CLIENT_APP_LAUNCH_SECRET` verifies only the generic two-minute handoff created by the EVAVO hub.

`EVAVO_VECTOR_PRIVATE_SIGNING_SECRET` signs and verifies only the eight-hour Vector Studio workspace session.

Both values must contain 32 to 512 characters with no surrounding whitespace. Equal values fail closed. `PRIVATE_SESSION_SECRET`, worker tokens, ordinary API tokens and provider credentials are not accepted as substitutes.

## Generic hub handoff

The receiver accepts only:

```text
version          evavo-client-app-launch-v1
issuer           evavo-client-hub
audience         vector.evavo.com.au
targetHost       vector.evavo.com.au
applicationKey   vector-studio
applicationLabel EVAVO Vector Studio
lifetime         exactly 120 seconds
clock skew       15 seconds
```

The HMAC-SHA256 token also binds:

- subject and lowercase email;
- organisation ID and name;
- workspace UUID and name;
- issue and expiry times;
- a bounded cryptographic nonce.

Claims are strict. Unknown fields, noncanonical base64url, invalid identifiers, wrong host, wrong application, wrong label, invalid times, signature mismatch and token oversize fail closed.

## Central issuer compatibility fixture

The independent next-website compatibility fixture lives at:

```text
packages/hub-auth/fixtures/next-website-vector-studio-launch-v1.json
packages/hub-auth/src/next-website-compatibility.test.ts
```

It contains one explicitly test-only secret, the canonical JSON payload order used by `next-website`, the resulting HMAC token and the expected claims. The Vector Studio receiver does not create that token with its own helper. Its executable test instead:

1. decodes the retained central payload;
2. verifies the exact HMAC independently;
3. passes the exact token through `verifyVectorHubLaunchToken`;
4. compares every accepted claim with the central fixture;
5. verifies replay identity and bounded expiry evidence;
6. rejects production environment names and local paths from the fixture.

This catches claim-order, label, host, application, TTL and signature drift between the central issuer and the Vector Studio receiver. The fixture secret is not a deployment credential and must never be reused outside tests.

## One-time redemption

`GET /launch?token=...` performs one sequence:

```text
verify signed handoff
  -> prepare app-private session locally
  -> consume derived replay identity atomically
  -> set session cookie only after first-use confirmation
  -> redirect to /
```

The raw handoff is not retained. Replay storage receives only:

```text
evavo:vector:hub-launch:<sha256-derived-identity>
```

and a bounded expiry. Production forbids the memory replay adapter. The Upstash REST adapter submits one atomic Redis command:

```text
SET <derived-key> 1 EX <ttl> NX
```

`OK` means first use. A null result means the handoff was already consumed. Configuration, authentication, transport, timeout, response-size and response-shape failures remain temporary private-launch unavailability rather than failing open.

## Workspace session

A successful first redemption sets:

```text
__Host-evavo-vector-session
```

with:

```text
Secure
HttpOnly
SameSite=Lax
Path=/
Max-Age=28800
```

The session uses the domain-separated HMAC input:

```text
evavo-vector-session.<base64url-payload>
```

It retains the verified subject, email, organisation, workspace, application and session identity. The hub handoff key cannot forge this session because Vector Studio verifies it with the separate app-private key.

Local development may use an explicit non-production cookie name and in-memory replay storage. It is reported as `local-development`, never as a client session.

## Browser and API authorization

The normal `/` and `/motion` workspaces require a valid app-private session in production. `/access` is the public re-entry screen.

Interactive production APIs may accept either:

- the server-only `VECTOR_API_TOKEN`; or
- a valid Vector Studio workspace session with exact same-origin mutation evidence.

Worker-control, object-transfer and hosted administrative surfaces do not inherit browser-session authorization. They retain their dedicated tokens and fail-closed boundaries.

## Safe failure behaviour

Invalid, expired, malformed and incorrectly signed handoffs redirect to:

```text
/access?reason=invalid
```

A replayed handoff redirects to:

```text
/access?reason=used
```

A signing or replay-store outage redirects to:

```text
/access?reason=temporarily-unavailable
```

These outcomes do not clear an unrelated existing workspace session. Logout is explicit through `/api/auth/logout`.

## Required production environment

```dotenv
VECTOR_PUBLIC_ORIGIN=https://vector.evavo.com.au
EVAVO_CLIENT_APP_LAUNCH_SECRET=<shared hub handoff secret>
EVAVO_VECTOR_PRIVATE_SIGNING_SECRET=<Vector Studio only secret>
VECTOR_HUB_REPLAY_MODE=upstash
UPSTASH_REDIS_REST_URL=https://<database>.upstash.io
UPSTASH_REDIS_REST_TOKEN=<server-only standard token>
```

The app remains unavailable for signed launch when any required production setting is missing or unsafe.

## Promotion sequence

1. Keep `vector-studio` unreleased in the hub.
2. Deploy the current reviewed `main` commit.
3. Provision `vector.evavo.com.au` and enforce HTTPS.
4. Configure distinct handoff and app-private signing keys.
5. Configure durable replay storage.
6. Verify `/api/health` without exposing secrets.
7. Run owner and client one-time launch smoke tests.
8. Verify replay rejection and temporary-provider failure behaviour.
9. Run trace, motion, Lottie, dotLottie and worker smoke tests.
10. Record the verified commit and evidence.
11. Promote the hub registry strategy from `federated-candidate` to `federated`.
12. Add the application to the central client release allow-list only after every gate passes.

## Verification

```powershell
pnpm hub:check
pnpm --filter @evavo/hub-auth test
pnpm check
pnpm --filter @evavo/vector-web build
```

The contract and executable fixtures prove central-token compatibility, token shape, signature validation, key separation, exact TTL, session issuance, session expiry, one-success replay behaviour and safe provider failure. They do not prove deployed credentials, DNS, Vercel configuration, Upstash connectivity or live browser redemption.
