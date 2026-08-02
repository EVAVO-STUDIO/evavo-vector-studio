# EVAVO Vector Studio release proof

Vector Studio promotion requires two independent evidence packages bound to the same reviewed Git commit:

1. a **source proof** created from a clean checkout after a frozen install, the complete repository check, and the private web production build;
2. a **live deployment proof** created against `https://vector.evavo.com.au` after deployment.

Neither proof promotes the application automatically. The central EVAVO hub remains the release authority, and a human reviewer must confirm the exact commit, environment, security posture, live results, and generated-asset review boundary before changing `federated-candidate` to `federated`.

## Source proof

Generate from a clean checkout:

```powershell
Set-Location C:\GitRepos\evavo-vector-studio
git pull --ff-only origin main
pnpm release:source-proof
```

The generator runs:

```text
pnpm install --frozen-lockfile
pnpm check
pnpm --filter @evavo/vector-web build
```

It refuses a dirty checkout and writes a new file only:

```text
artifacts/source-proof/<commit>.json
```

The proof records command names, durations, Node and pnpm versions, the exact Git SHA, and pass state. It does not record logs, environment variables, provider tokens, generated assets, or other sensitive values.

CI runs the same generator and uploads the result as a short-retention artifact. The artifact is evidence for the checked commit, not a mutable “latest” approval.

### Bounded validation cleanup

The full validation chain creates three repository-visible generated paths on a clean runner:

```text
.turbo
apps/web/next-env.d.ts
apps/web/tsconfig.tsbuildinfo
```

After every validation command passes, the generator removes exactly those three paths and then repeats the complete Git status check with untracked files included. It does not run `git clean`, `git reset`, `git restore`, or `git checkout`, and it never recursively deletes the repository root. Any other tracked or untracked mutation remains present and fails the proof with `SOURCE_PROOF_REPOSITORY_DIRTY`.

The source-proof JSON is written only after that bounded cleanup and clean-repository recheck succeed. The release-proof contract verifies the exact cleanup list, its execution order, the repository-root containment guard, and the continuing absence of broad cleanup commands.

### Reproducible proof toolchain

Both proof workflows bind Node.js to the repository `.nvmrc` value (`22.16.0`) and activate pnpm `10.14.0` through Corepack before any proof command runs. Package-manager caching is disabled, action implementations are pinned to reviewed commit SHAs, and `git diff --exit-code` verifies that toolchain activation did not mutate the checkout.

The release-proof contract rejects floating action tags, `pnpm/action-setup`, generic `node-version: 22`, and pnpm cache setup. A source proof or live deployment proof therefore cannot silently run under a newer Node minor release or a package-manager bootstrap that rewrites repository state.

## Public live deployment proof

After the production project and domain exist, run:

```powershell
$env:VECTOR_DEPLOYMENT_SOURCE_PROOF = "C:\Evidence\source-proof.json"
pnpm release:live-proof -- --commit <40-character-sha>
```

The public verifier checks:

- the bounded `/api/health` contract;
- the public `/access` page and noindex posture;
- unauthenticated workspace redirection;
- trace, animated SVG, Lottie, and dotLottie capability discovery;
- the Vercel hosting profile and body limits;
- the continuing absence of provider-direct private storage claims.

It writes:

```text
artifacts/deployment-proof/<commit>.json
```

Responses are read under explicit byte and timeout limits. Evidence retains only status, selected safe headers, duration, byte count, SHA-256, safe same-origin redirect paths, cookie names, and bounded booleans or numbers. Response bodies are never copied into the proof.

## Signed launch and replay proof

A complete release proof also requires a fresh two-minute hub launch token. Supply it only through the process environment:

```powershell
$env:VECTOR_DEPLOYMENT_SOURCE_PROOF = "C:\Evidence\source-proof.json"
$env:VECTOR_DEPLOYMENT_PROOF_LAUNCH_TOKEN = "<fresh one-time handoff>"
pnpm release:live-proof -- --commit <40-character-sha> --require-launch
Remove-Item Env:VECTOR_DEPLOYMENT_PROOF_LAUNCH_TOKEN
```

The token never appears in command arguments. The verifier:

1. redeems the handoff once;
2. confirms the app-private `__Host-evavo-vector-session` cookie name;
3. replays the same handoff and requires `/access?reason=used`;
4. opens `/` and `/motion` with the in-memory session cookie;
5. records only cookie names and safe results;
6. scans the serialized proof to ensure neither the token nor cookie value was written.

The raw token, cookie value, hub signing secret, private signing secret, Upstash token, API token, and worker token must never enter an artifact, workflow input, command argument, URL log, or commit.

## CI workflows

### Source release proof

`.github/workflows/source-release-proof.yml` runs only against reviewed source changes. It creates the exact source proof, uploads it with short retention, and publishes:

```text
release/vector-source-proof
```

### Public deployment proof

`.github/workflows/public-deployment-proof.yml` is manual and public-only. It verifies a deployed exact commit without a launch token and publishes:

```text
release/vector-public-runtime
```

The workflow deliberately reports signed launch as not performed. Signed launch proof must use a fresh short-lived token through a protected local or separately reviewed ephemeral execution path.

## Decision rules

`clientReleaseEligible` may be true in a proof only when:

- the source proof matches the exact deployment commit;
- all public runtime and capability checks pass;
- first-use signed launch passes;
- replay rejection passes;
- private root and Motion Director render with the issued session;
- no sensitive value is recorded.

Even then, the proof states that central source promotion still requires human review. The reviewer must also confirm DNS, Vercel project identity, environment separation, Upstash replay behavior, worker posture, asset-review requirements, and the exact deployed commit before changing the central release allowlist.
