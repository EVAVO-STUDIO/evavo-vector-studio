import assert from "node:assert/strict";
import test from "node:test";
import { BatchEngineError } from "./errors.js";
import {
  batchManifestSha256,
  canonicalBatchManifest,
  validateBatchManifest,
} from "./manifest.js";

test("canonicalizes equivalent manifests and produces stable SHA-256", () => {
  const first = validateBatchManifest({
    version: "1.0",
    id: "brand-assets-01",
    name: "Brand assets",
    failureMode: "continue",
    items: [
      {
        id: "primary-mark",
        operation: "copy-text",
        spec: {
          outputPath: "output/mark.svg",
          options: { z: 2, a: 1 },
          inputPath: "source/mark.svg",
        },
      },
    ],
  });
  const second = validateBatchManifest({
    name: "Brand assets",
    items: [
      {
        operation: "copy-text",
        spec: {
          inputPath: "source/mark.svg",
          options: { a: 1, z: 2 },
          outputPath: "output/mark.svg",
        },
        id: "primary-mark",
      },
    ],
    failureMode: "continue",
    id: "brand-assets-01",
    version: "1.0",
  });

  assert.equal(canonicalBatchManifest(first), canonicalBatchManifest(second));
  assert.equal(batchManifestSha256(first), batchManifestSha256(second));
  assert.match(batchManifestSha256(first), /^[a-f0-9]{64}$/);
  assert.match(canonicalBatchManifest(first), /"inputPath":"source\/mark\.svg"/);
});

test("rejects unknown fields, duplicate IDs and unsafe operation names", () => {
  assert.throws(
    () => validateBatchManifest({
      version: "1.0",
      id: "job-01",
      name: "Job",
      failureMode: "continue",
      unexpected: true,
      items: [{ id: "item-01", operation: "copy-text", spec: {} }],
    }),
    (error: unknown) =>
      error instanceof BatchEngineError &&
      error.code === "BATCH_MANIFEST_INVALID",
  );

  assert.throws(
    () => validateBatchManifest({
      version: "1.0",
      id: "job-01",
      name: "Job",
      failureMode: "continue",
      items: [
        { id: "item-01", operation: "copy-text", spec: {} },
        { id: "item-01", operation: "copy-text", spec: {} },
      ],
    }),
    (error: unknown) =>
      error instanceof BatchEngineError &&
      error.code === "BATCH_MANIFEST_INVALID" &&
      error.details?.duplicateId === "item-01",
  );

  assert.throws(
    () => validateBatchManifest({
      version: "1.0",
      id: "job-01",
      name: "Job",
      failureMode: "continue",
      items: [{ id: "item-01", operation: "../unsafe", spec: {} }],
    }),
    (error: unknown) =>
      error instanceof BatchEngineError &&
      error.code === "BATCH_MANIFEST_INVALID",
  );
});

test("rejects empty and oversized item collections", () => {
  assert.throws(
    () => validateBatchManifest({
      version: "1.0",
      id: "job-01",
      name: "Job",
      failureMode: "continue",
      items: [],
    }),
    (error: unknown) =>
      error instanceof BatchEngineError &&
      error.code === "BATCH_MANIFEST_INVALID",
  );

  const items = Array.from({ length: 1_001 }, (_, index) => ({
    id: `item-${index}`,
    operation: "copy-text",
    spec: {},
  }));
  assert.throws(
    () => validateBatchManifest({
      version: "1.0",
      id: "job-01",
      name: "Job",
      failureMode: "continue",
      items,
    }),
    (error: unknown) =>
      error instanceof BatchEngineError &&
      error.code === "BATCH_MANIFEST_INVALID",
  );
});
