import assert from "node:assert/strict";
import test from "node:test";
import {
  VECTOR_BATCH_OPERATION_NAMES,
  createVectorBatchOperationRegistry,
} from "./index.js";

test("publishes one shared governed operation registry", () => {
  assert.deepEqual(VECTOR_BATCH_OPERATION_NAMES, [
    "trace-raster",
    "optimise-svg",
    "animate-svg",
    "export-lottie",
    "package-dotlottie",
  ]);
  const registry = createVectorBatchOperationRegistry();
  assert.deepEqual(Object.keys(registry), VECTOR_BATCH_OPERATION_NAMES);
  for (const operation of VECTOR_BATCH_OPERATION_NAMES) {
    assert.equal(typeof registry[operation]?.describe, "function");
    assert.equal(typeof registry[operation]?.execute, "function");
  }
});
