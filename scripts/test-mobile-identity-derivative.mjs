#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  compileMobileIdentityDerivative,
  validateDerivativeReceipt,
} from './mobile-identity-derivative.mjs';

const approval = {
  schema: 'evavo.mobile-identity-raster-approval.v1',
  approved: true,
  sourceType: 'raster-provider-generation',
  providerFamily: 'gpt-image',
  candidateSha256: 'a'.repeat(64),
  contextSha256: 'b'.repeat(64),
  promptSha256: 'c'.repeat(64),
  generationReceiptId: 'godmode-raster-generation-001',
  review: {
    smallScale: true,
    circleMask: true,
    squircleMask: true,
    androidAdaptiveMask: true,
    noTextOrWordmark: true,
    nonGenericIdentity: true,
    strongSilhouette: true,
  },
};

const request = {
  approval,
  sourceRaster: 'artifacts/mobile-identity/GODMODE-approved-1024.png',
  sourceRasterSha256: approval.candidateSha256,
  targets: {
    androidAdaptiveForeground: 'apps/mobile/android/app/src/main/res/drawable/ic_launcher_foreground.xml',
    androidMonochrome: 'apps/mobile/android/app/src/main/res/drawable/ic_launcher_monochrome.xml',
    androidNotification: 'apps/mobile/android/app/src/main/res/drawable/ic_notification_glasses.xml',
  },
};

const plan = compileMobileIdentityDerivative(request);
assert.equal(plan.schema, 'evavo.vector-mobile-identity-derivative.v1');
assert.equal(plan.status, 'derivative-only');
assert.equal(plan.creativeMaster.ownedBy, 'Art Studio');
assert.equal(plan.creativeMaster.vectorStudioMayReplaceCreativeMaster, false);
assert.equal(plan.creativeMaster.wordmarkMayBeIntroduced, false);
assert.equal(plan.creativeMaster.sourceRasterSha256, approval.candidateSha256);
assert.equal(plan.verification.renderDerivativeBackToRaster, true);
assert.equal(plan.verification.requireMeasuredEquivalence, true);
assert.equal(plan.authority.creativeApproval, false);
assert.equal(plan.authority.forcePush, false);
assert.match(plan.derivativePlanSha256, /^[a-f0-9]{64}$/u);

assert.throws(
  () => compileMobileIdentityDerivative({ ...request, sourceRasterSha256: 'd'.repeat(64) }),
  /digest must equal the approved Art Studio candidate digest/u,
);
assert.throws(
  () => compileMobileIdentityDerivative({ ...request, approval: { ...approval, sourceType: 'svg' } }),
  /approved provider-generated raster master/u,
);

const receipt = {
  schema: 'evavo.vector-mobile-identity-derivative-receipt.v1',
  sourceRasterSha256: approval.candidateSha256,
  derivativePlanSha256: plan.derivativePlanSha256,
  measuredEquivalence: true,
  silhouetteIoU: 0.96,
  perceptualDifference: 0.04,
  textIntroduced: false,
  wordmarkIntroduced: false,
  authority: {
    creativeApproval: false,
    deviceAuthority: false,
    forcePush: false,
  },
};
assert.equal(validateDerivativeReceipt(receipt, plan), true);
assert.throws(
  () => validateDerivativeReceipt({ ...receipt, measuredEquivalence: false }, plan),
  /did not pass measured equivalence/u,
);
assert.throws(
  () => validateDerivativeReceipt({ ...receipt, wordmarkIntroduced: true }, plan),
  /forbidden text or wordmark/u,
);

console.log('Mobile identity vector derivative contract passed.');
