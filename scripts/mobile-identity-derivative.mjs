#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export const MOBILE_IDENTITY_DERIVATIVE_SCHEMA = 'evavo.vector-mobile-identity-derivative.v1';
export const RASTER_APPROVAL_SCHEMA = 'evavo.mobile-identity-raster-approval.v1';

const FORBIDDEN_SOURCE_TYPES = new Set([
  'svg',
  'wordmark',
  'lettermark',
  'hand-authored-vector',
  'vector-concept',
]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function object(value, label) {
  assert(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`);
  return value;
}

function text(value, label, maximum = 1000) {
  assert(typeof value === 'string' && value.trim().length > 0 && value.length <= maximum, `${label} must be non-empty text`);
  return value.trim();
}

function sha256(value) {
  return crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}

function hashObject(value) {
  return sha256(JSON.stringify(canonical(value)));
}

function sha(value, label) {
  assert(typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value), `${label} must be SHA-256`);
  return value;
}

function safeRelative(value, label) {
  const candidate = text(value, label, 500).replaceAll('\\', '/');
  assert(!path.posix.isAbsolute(candidate) && !candidate.split('/').includes('..'), `${label} must be repository-relative`);
  return candidate;
}

export function validateRasterApproval(approvalInput) {
  const approval = object(approvalInput, 'approval');
  assert(approval.schema === RASTER_APPROVAL_SCHEMA, 'unexpected raster approval schema');
  assert(approval.approved === true, 'raster candidate is not approved');
  assert(approval.sourceType === 'raster-provider-generation', 'Vector Studio requires an approved provider-generated raster master');
  assert(!FORBIDDEN_SOURCE_TYPES.has(String(approval.sourceType)), 'forbidden vector-first mobile identity source');
  sha(approval.candidateSha256, 'candidateSha256');
  sha(approval.contextSha256, 'contextSha256');
  sha(approval.promptSha256, 'promptSha256');
  assert(typeof approval.generationReceiptId === 'string' && approval.generationReceiptId.length > 0, 'generationReceiptId is required');
  const review = object(approval.review, 'approval.review');
  for (const key of ['smallScale', 'circleMask', 'squircleMask', 'androidAdaptiveMask', 'noTextOrWordmark', 'nonGenericIdentity', 'strongSilhouette']) {
    assert(review[key] === true, `approval.review.${key} must be true`);
  }
  return approval;
}

export function compileMobileIdentityDerivative(input) {
  const request = object(input, 'request');
  const approval = validateRasterApproval(request.approval);
  const sourceRaster = safeRelative(request.sourceRaster, 'sourceRaster');
  const sourceRasterSha256 = sha(request.sourceRasterSha256, 'sourceRasterSha256');
  assert(sourceRasterSha256 === approval.candidateSha256, 'source raster digest must equal the approved Art Studio candidate digest');
  const targets = object(request.targets, 'targets');

  const compiled = {
    schema: MOBILE_IDENTITY_DERIVATIVE_SCHEMA,
    status: 'derivative-only',
    creativeMaster: {
      ownedBy: 'Art Studio',
      type: 'approved-raster-provider-generation',
      sourceRaster,
      sourceRasterSha256,
      generationReceiptId: approval.generationReceiptId,
      vectorStudioMayReplaceCreativeMaster: false,
      wordmarkMayBeIntroduced: false,
      textMayBeIntroduced: false,
    },
    operations: [
      {
        id: 'android-adaptive-foreground',
        kind: 'trace-and-simplify',
        target: safeRelative(targets.androidAdaptiveForeground, 'targets.androidAdaptiveForeground'),
        preserveSilhouette: true,
        preserveNegativeSpace: true,
        preserveAccentGeometry: true,
      },
      ...(targets.androidMonochrome ? [{
        id: 'android-monochrome',
        kind: 'derive-monochrome',
        target: safeRelative(targets.androidMonochrome, 'targets.androidMonochrome'),
        preserveSilhouette: true,
      }] : []),
      ...(targets.androidNotification ? [{
        id: 'android-notification',
        kind: 'derive-notification-glyph',
        target: safeRelative(targets.androidNotification, 'targets.androidNotification'),
        preserveSilhouette: true,
        singleColour: true,
      }] : []),
    ],
    verification: {
      renderDerivativeBackToRaster: true,
      compareAgainstApprovedRaster: true,
      requireMeasuredEquivalence: true,
      minimumSilhouetteIoU: Number(request.minimumSilhouetteIoU ?? 0.92),
      maximumPerceptualDifference: Number(request.maximumPerceptualDifference ?? 0.08),
      testPixels: [16, 24, 32, 48, 64, 128],
      masks: ['circle', 'squircle', 'android-adaptive'],
      rejectText: true,
      rejectWordmark: true,
    },
    authority: {
      creativeApproval: false,
      deviceAuthority: false,
      protocolAuthority: false,
      targetRepositoryMutation: false,
      forcePush: false,
    },
  };
  assert(compiled.verification.minimumSilhouetteIoU >= 0.8 && compiled.verification.minimumSilhouetteIoU <= 1, 'minimumSilhouetteIoU must be 0.8..1');
  assert(compiled.verification.maximumPerceptualDifference >= 0 && compiled.verification.maximumPerceptualDifference <= 0.2, 'maximumPerceptualDifference must be 0..0.2');
  return Object.freeze({ ...compiled, derivativePlanSha256: hashObject(compiled) });
}

export function validateDerivativeReceipt(receiptInput, planInput) {
  const receipt = object(receiptInput, 'receipt');
  const plan = object(planInput, 'plan');
  assert(receipt.schema === 'evavo.vector-mobile-identity-derivative-receipt.v1', 'unexpected derivative receipt schema');
  assert(receipt.sourceRasterSha256 === plan.creativeMaster.sourceRasterSha256, 'derivative receipt source raster drifted');
  assert(receipt.derivativePlanSha256 === plan.derivativePlanSha256, 'derivative receipt plan drifted');
  assert(receipt.measuredEquivalence === true, 'vector derivative did not pass measured equivalence');
  assert(Number(receipt.silhouetteIoU) >= plan.verification.minimumSilhouetteIoU, 'silhouette equivalence is below threshold');
  assert(Number(receipt.perceptualDifference) <= plan.verification.maximumPerceptualDifference, 'perceptual difference exceeds threshold');
  assert(receipt.textIntroduced === false && receipt.wordmarkIntroduced === false, 'vector derivative introduced forbidden text or wordmark');
  const authority = object(receipt.authority, 'receipt.authority');
  assert(authority.creativeApproval === false && authority.deviceAuthority === false && authority.forcePush === false, 'derivative receipt authority boundary is invalid');
  return true;
}

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

async function writeCreateOnly(file, value) {
  const target = path.resolve(file);
  await fs.mkdir(path.dirname(target), { recursive: true });
  const handle = await fs.open(target, 'wx');
  try { await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`); } finally { await handle.close(); }
}

async function main(argv = process.argv.slice(2)) {
  const [command, ...rest] = argv;
  const values = new Map();
  for (let index = 0; index < rest.length; index += 2) {
    assert(rest[index]?.startsWith('--') && rest[index + 1] && !rest[index + 1].startsWith('--'), 'arguments must be --name value pairs');
    values.set(rest[index], rest[index + 1]);
  }
  if (command === 'compile') {
    const request = await readJson(values.get('--request'));
    const plan = compileMobileIdentityDerivative(request);
    await writeCreateOnly(values.get('--output'), plan);
    return { status: 'ok', output: path.resolve(values.get('--output')), derivativePlanSha256: plan.derivativePlanSha256 };
  }
  if (command === 'validate-receipt') {
    const receipt = await readJson(values.get('--receipt'));
    const plan = await readJson(values.get('--plan'));
    validateDerivativeReceipt(receipt, plan);
    return { status: 'ok', measuredEquivalence: true, sourceRasterSha256: receipt.sourceRasterSha256 };
  }
  throw new Error('command must be compile or validate-receipt');
}

const direct = process.argv[1] ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;
if (direct) {
  main().then((result) => process.stdout.write(`${JSON.stringify(result)}\n`)).catch((error) => {
    process.stderr.write(`${JSON.stringify({ status: 'failed', error: error instanceof Error ? error.message : String(error) })}\n`);
    process.exitCode = 2;
  });
}
