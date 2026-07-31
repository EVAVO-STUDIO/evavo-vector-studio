# Vector Studio diagnostic provisioning plan receipts

Project provisioning has a read-only plan phase before any Vercel project, environment or domain mutation. The plan must preserve evidence even when the seven required production authorities are missing or malformed.

## Canonical plan wrapper

Workflows invoke:

```powershell
node scripts/plan-vector-studio-vercel-provisioning.mjs \
  --commit <exact-current-main-sha> \
  --out <new-receipt-path>
```

The wrapper invokes `scripts/provision-vector-studio-vercel.mjs` only with `--mode plan`. It never invokes apply mode and never sets `VECTOR_VERCEL_APPLY_CONFIRM`.

When the canonical provisioner succeeds, its receipt remains authoritative. When it fails before writing a receipt, the wrapper creates a bounded new-file-only diagnostic receipt and exits non-zero.

## Credential readiness

The wrapper evaluates only the governed credential shape:

```text
VERCEL_TOKEN
EVAVO_CLIENT_APP_LAUNCH_SECRET
EVAVO_VECTOR_PRIVATE_SIGNING_SECRET
UPSTASH_REDIS_REST_URL
UPSTASH_REDIS_REST_TOKEN
VECTOR_API_TOKEN
VECTOR_WORKER_API_TOKEN
```

The receipt records missing or invalid key names, never values. It verifies minimum lengths, whitespace rejection, HTTPS URL form and separation of the four signing and API authorities.

When credentials prevent Vercel inspection, the receipt records:

```text
passed: false
readyToApply: false
plan.inspectionAvailable: false
plan.action: inspection-unavailable
diagnosticReceipt: true
mutationAttempted: false
mutationPerformed: false
```

The primary blocker is `VERCEL_PROVISION_CREDENTIALS_INVALID`. A child-process or provider failure after credential validation uses a bounded stable wrapper code without copying raw provider output into the receipt.

## Child-process boundary

The wrapper records only:

- child script and fixed `plan` mode;
- exit status and signal;
- bounded stdout and stderr byte counts;
- whether the canonical receipt was produced.

Raw child output is not embedded in a fallback receipt. Non-empty secret values are checked against the serialized receipt before commit.

A successful bounded child summary can be forwarded only when it contains no required credential value and remains under the child-output limit.

## Workflow behavior

Both the dedicated provisioning plan and the pre-deployment provisioning check use the canonical wrapper. The plan artifact step runs with:

```text
if: always()
if-no-files-found: error
include-hidden-files: true
```

A missing or invalid authority therefore yields a failed plan status plus an uploaded diagnostic receipt. It is not converted into a successful readiness claim.

Apply mode remains a separate protected-environment transaction and continues to call the provisioner directly with explicit confirmation.

## Executable validation

`pnpm vercel-plan:check` removes all seven credentials, launches the real provisioning wrapper with a temporary output path and verifies:

- the wrapper exits non-zero;
- a parseable receipt exists;
- all required key names appear in `credentialReadiness.missing`;
- the plan action is `inspection-unavailable`;
- `readyToApply` is false;
- no mutation was attempted or performed;
- no sensitive value was recorded;
- the command reports `diagnosticReceiptWritten: true`.

The same gate statically forbids apply confirmation, apply mode and mutation APIs from the wrapper.
