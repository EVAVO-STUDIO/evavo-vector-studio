# Vector Studio diagnostic deployment plan receipts

The exact production deployment workflow has a read-only `plan` mode. Its purpose is not merely to return a successful API response when every prerequisite already exists. It must leave useful, bounded evidence when deployment is blocked.

## Diagnostic plan receipts

A plan invocation writes exactly one new-file-only JSON receipt to the requested output path. It never overwrites or appends to an existing receipt.

A ready plan reports:

```text
passed: true
readyToApply: true
blockers: []
diagnosticReceipt: false
mutationAttempted: false
mutationPerformed: false
```

A blocked plan exits non-zero after writing a diagnostic receipt. The receipt is still uploaded by the workflow and reports:

```text
passed: false
readyToApply: false
diagnosticReceipt: true
mutationAttempted: false
mutationPerformed: false
```

The workflow publishes a failed `deploy/vector-studio-production-plan` status when blocked. A preserved diagnostic receipt is evidence of a correctly failed plan, not production readiness.

## Inspection availability

When `VERCEL_TOKEN` is missing or malformed, or the bounded Vercel API inspection cannot complete, the receipt records:

```text
plan.inspectionAvailable: false
plan.action: inspection-unavailable
```

It also records an ordered `blockers` array and emits matching `blockerCodes` in the command diagnostic. The token value is never retained.

When inspection succeeds, the plan records only bounded project, domain and exact-commit deployment state. It can fail with one or more stable blocker codes, including:

```text
VERCEL_DEPLOY_PROJECT_MISSING
VERCEL_DEPLOY_PROJECT_NOT_READY
VERCEL_DEPLOY_DOMAIN_NOT_VERIFIED
```

Network, bounded-response, JSON and Vercel API failures retain their stable code, bounded message and safe details. Failure details are capped before they enter a receipt.

## Mutation truth

Plan mode is no mutation. Both fields remain false on every plan path:

```text
mutationAttempted
mutationPerformed
```

Apply mode tracks these fields separately. `mutationAttempted` becomes true immediately before the production deployment POST. `mutationPerformed` becomes true only after Vercel returns a valid deployment identifier.

This distinction matters when a later READY, exact-commit or production-alias proof fails. The terminal diagnostic must not claim that no mutation occurred after a deployment was actually created.

## Workflow behavior

The plan job runs the deployer with `continue-on-error: true`, then always uploads the receipt with:

```text
if-no-files-found: error
include-hidden-files: true
```

It then publishes the commit status and separately enforces the plan result. This ordering ensures a blocked plan remains failed while its receipt is still available for review.

The receipt cannot contain:

- `VERCEL_TOKEN`;
- bearer authorization material;
- signing or API authorities;
- generated asset bodies;
- local source files;
- unbounded provider responses.

## Executable contract

The permanent gate is:

```powershell
pnpm vercel-plan:check
```

It removes `VERCEL_TOKEN` from a child process, runs a real plan command against a temporary new output path and asserts that:

- the process exits non-zero;
- the receipt exists and parses;
- `readyToApply` is false;
- the action is `inspection-unavailable`;
- the first blocker is `VERCEL_DEPLOY_CREDENTIALS_INVALID`;
- no mutation was attempted or performed;
- no sensitive value was recorded;
- the command reports `diagnosticReceiptWritten: true`.

The same checker statically verifies new-file-only writing, blocker construction, mutation-attempt ordering and the workflow artifact/status sequence.
