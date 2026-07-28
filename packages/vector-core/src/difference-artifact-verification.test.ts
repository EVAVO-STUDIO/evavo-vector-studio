import assert from "node:assert/strict";
import test from "node:test";
import {
  DifferenceArtifactVerificationError,
  verifyDifferenceArtifactPayload,
  type DifferenceArtifactPayload,
} from "./difference-artifact-verification.js";

const PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP4DwQACfsD/Wj6HMwAAAAASUVORK5CYII=";
const PNG_SHA256 = "36c907715b80d7cdad0e196256966a3353b771387aefb1116d8769dacc81b675";

function payload(overrides: Partial<DifferenceArtifactPayload> = {}): DifferenceArtifactPayload {
  return {
    encoding: "base64",
    mimeType: "image/png",
    width: 1,
    height: 1,
    bytes: 68,
    sha256: PNG_SHA256,
    selectedCandidateId: "base",
    data: PNG_BASE64,
    ...overrides,
  };
}

function verificationCode(code: DifferenceArtifactVerificationError["code"]): (error: unknown) => boolean {
  return (error: unknown) => error instanceof DifferenceArtifactVerificationError && error.code === code;
}

test("verifies a base64 PNG against dimensions, bytes, candidate and SHA-256", async () => {
  const verified = await verifyDifferenceArtifactPayload(payload(), "base");
  assert.equal(verified.bytes.byteLength, 68);
  assert.equal(verified.width, 1);
  assert.equal(verified.height, 1);
  assert.equal(verified.sha256, PNG_SHA256);
  assert.equal(verified.selectedCandidateId, "base");
});

test("rejects a difference artefact for another candidate", async () => {
  await assert.rejects(
    () => verifyDifferenceArtifactPayload(payload(), "economy"),
    verificationCode("DIFFERENCE_CANDIDATE_MISMATCH"),
  );
});

test("rejects an incorrect byte count", async () => {
  await assert.rejects(
    () => verifyDifferenceArtifactPayload(payload({ bytes: 67 }), "base"),
    verificationCode("DIFFERENCE_BYTE_COUNT_MISMATCH"),
  );
});

test("rejects dimensions that do not match the PNG IHDR", async () => {
  await assert.rejects(
    () => verifyDifferenceArtifactPayload(payload({ width: 2 }), "base"),
    verificationCode("DIFFERENCE_DIMENSIONS_MISMATCH"),
  );
});

test("rejects an incorrect SHA-256", async () => {
  await assert.rejects(
    () => verifyDifferenceArtifactPayload(payload({ sha256: "0".repeat(64) }), "base"),
    verificationCode("DIFFERENCE_SHA256_INVALID"),
  );
});

test("rejects a non-PNG stream even when its declared byte count matches", async () => {
  const bytes = Uint8Array.from(globalThis.atob(PNG_BASE64), (character) => character.charCodeAt(0));
  bytes[0] = 0;
  const data = globalThis.btoa(String.fromCharCode(...bytes));
  await assert.rejects(
    () => verifyDifferenceArtifactPayload(payload({ data }), "base"),
    verificationCode("DIFFERENCE_PNG_INVALID"),
  );
});
