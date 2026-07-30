# EVAVO Vector Studio private response security

Vector Studio is a protected standalone application, not a public marketing site. Every application response is therefore covered by a small middleware boundary that adds browser and crawler protections without performing authentication itself.

Authentication remains in the reviewed server-only hub session and API authorization modules. The middleware does not read credentials, verify tokens, choose a workspace, authorize a mutation, or replace any route-level access check.

## Response headers

The private response contract adds:

```text
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Resource-Policy: same-origin
Origin-Agent-Cluster: ?1
Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()
Referrer-Policy: no-referrer
Strict-Transport-Security: max-age=63072000; includeSubDomains
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
X-Robots-Tag: noindex, nofollow, noarchive, nosnippet, noimageindex
X-Vector-Private-Response-Contract: 1.0
```

API responses also receive:

```text
Cache-Control: no-store, max-age=0
Vary: authorization, cookie, origin
```

Individual routes may add more specific headers. They must not weaken these defaults.

## Scope

The middleware excludes immutable Next.js static assets, image optimization, the favicon, app icon, and web manifest. Pages, launch handling, health, trace, motion, Lottie, dotLottie, job, worker, and object-transfer routes remain covered.

The boundary prevents:

- search indexing and cached snippets;
- clickjacking through third-party frames;
- referrer leakage from a short-lived launch URL;
- unrequested browser access to camera, microphone, geolocation, payment, USB, or browsing-topic capabilities;
- MIME sniffing;
- cross-origin window and resource sharing by default.

## Authentication separation

The middleware deliberately does not authenticate. It contains no:

- `VECTOR_API_TOKEN`;
- `VECTOR_WORKER_API_TOKEN`;
- hub launch signing secret;
- Vector Studio private signing secret;
- Upstash credential;
- cookie parsing;
- bearer parsing.

The `/launch` route verifies and consumes the short-lived EVAVO hub token. Server components verify the app-private workspace session. Browser mutations require exact same-origin evidence. Machine and worker routes retain their separate bearer authorities.

## Live private-response proof

Source assertions alone do not prove that Vercel returned the governed headers. The bounded verifier:

```text
node scripts/verify-live-private-response.mjs \
  --commit <exact-deployed-main-sha> \
  --out artifacts/deployment-proof/<sha>.private-response.json
```

probes the public access page, unauthenticated workspace redirects, health, trace capabilities, and the worker-control boundary at `https://vector.evavo.com.au`. It requires the complete private-response contract, the three `Vary` authorities, API `no-store`, same-origin redirects, and no unexpected workspace-session cookie.

The verifier accepts only the canonical HTTPS origin, follows no redirects, requests identity encoding, records no response bodies or secret values, writes a bounded new-file-only JSON proof, and fails when any required live header is absent. The public deployment-proof workflow publishes success only when exact source proof, live private-response proof, and the existing public runtime proof all pass for the requested commit.

## Content security policy

A global Content-Security-Policy is not added blindly because Next.js runtime scripts, Blob-backed SVG/Lottie previews, and future provider-direct private uploads need a reviewed nonce and source inventory. A CSP must be introduced as a separate measured change with browser smoke evidence; weakening it with broad `unsafe-*` allowances would not improve the security posture.

## Release boundary

These headers are source-level controls, not deployment evidence. Live proof must confirm the production host returns them and that the launch flow does not leak a token through referrers or redirects.

The client release remains withheld until the exact deployed commit, private environment, durable replay, one-time owner/client launch, hosted transfer limits, and live browser behavior are independently verified and reviewed.
