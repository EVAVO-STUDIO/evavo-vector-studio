# EVAVO Vector Studio release proof

Vector Studio promotion requires two independent evidence packages bound to the same reviewed Git commit:

1. a **source proof** created from a clean checkout after a frozen install, the complete repository check, and the private web production build;
2. a **live deployment proof** created against `https://vector.evavo.com.au` after deployment.

Neither proof promotes or deploys the application automatically. Development Studio remains repository publication authority. Vercel remains an explicit deployment-effect provider. Human review must confirm the exact commit, environment, security posture, live results and generated-asset review boundary before central release state changes.

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

It refuses a dirty checkout and writes a create-only file:

```text
artifacts/source-proof/<commit>.json
```

The proof records command names, durations, Node and pnpm versions, the exact Git SHA and pass state. It does not record logs, environment variables, provider tokens, generated assets or other sensitive values.

### Bounded validation cleanup

The full validation chain may create three repository-visible generated paths:

```text
.turbo
apps/web/next-env.d.ts
apps/web/tsconfig.tsbuildinfo
```

After validation succeeds, the generator removes exactly those three paths and repeats the complete Git status check with untracked files included. It does not run `git clean`, `git reset`, `git restore` or `git checkout`, and it never recursively deletes the repository root. Any other tracked or untracked mutation remains present and fails the proof with `SOURCE_PROOF_REPOSITORY_DIRTY`.

### Reproducible local toolchain

The repository `.nvmrc` remains the Node authority (`22.16.0`) and source proof requires pnpm `10.14.0`. The proof contract validates those identities directly. GitHub Actions, hosted runner identity, workflow artifacts and action-version pinning are not release authority.

## Public live deployment proof

After the production project and domain exist, run:

```powershell
$env:VECTOR_DEPLOYMENT_SOURCE_PROOF = "C:\Evidence\source-proof.json"
pnpm release:live-proof -- --commit <40-character-sha>
```

The verifier checks the bounded `/api/health` contract, public `/access` posture, unauthenticated workspace redirection, trace/animated-SVG/Lottie/dotLottie capability discovery, Vercel hosting profile/body limits and the continuing absence of provider-direct private-storage claims.

It writes a create-only proof:

```text
artifacts/deployment-proof/<commit>.json
```

Responses are read under explicit byte and timeout limits. Evidence retains only status, selected safe headers, duration, byte count, SHA-256, safe same-origin redirect paths, cookie names and bounded booleans/numbers. Response bodies are not copied into the proof.

## Signed launch and replay proof

A complete release proof also requires a fresh two-minute hub launch token. Supply it only through the process environment:

```powershell
$env:VECTOR_DEPLOYMENT_SOURCE_PROOF = "C:\Evidence\source-proof.json"
$env:VECTOR_DEPLOYMENT_PROOF_LAUNCH_TOKEN = "<fresh one-time handoff>"
pnpm release:live-proof -- --commit <40-character-sha> --require-launch
Remove-Item Env:VECTOR_DEPLOYMENT_PROOF_LAUNCH_TOKEN
```

The token never appears in command arguments. The verifier redeems the handoff once, confirms the app-private cookie name, requires replay rejection, opens the private root and Motion Director using only the in-memory session cookie, records only safe result metadata and scans the serialized proof to ensure token/cookie values were not written.

Raw launch tokens, cookie values, hub signing secrets, private signing secrets, Upstash tokens, API tokens and worker tokens must never enter proof files, command arguments, URLs, source control or diagnostic logs.

## Provider-free evidence custody

Source and live proofs are ordinary bounded JSON files. Store or hand them off through the governed EVAVO evidence/storage path when durable custody is required. A GitHub workflow run, artifact URL, artifact digest or commit status is not required and does not grant validation, deployment, release or publication authority.

The historical `source-release-proof.yml` and `public-deployment-proof.yml` wrappers are retired and must remain absent.

## Decision rules

`clientReleaseEligible` may be true in a proof only when the source proof matches the exact deployment commit, public runtime/capability checks pass, first-use signed launch passes, replay rejection passes, private surfaces render with the issued session and no sensitive value is recorded.

Even then, source promotion still requires human review through the governed EVAVO publication path. The reviewer must also confirm DNS, Vercel project identity, environment separation, Upstash replay behavior, worker posture, asset-review requirements and the exact deployed commit before central release state changes.
