import assert from "node:assert/strict";
import test from "node:test";
import { VectorWorkerError } from "./errors.js";
import { validateVectorWorkerPayload } from "./payloads.js";

const source = Object.freeze({
  objectKey: "source/mark.svg",
  sha256: "a".repeat(64),
});

const outputs = Object.freeze({
  svgObjectKey: "output/mark.svg",
  evidenceObjectKey: "output/mark.evidence.json",
});

test("defaults trace and optimise worker payloads to editable delivery", () => {
  const trace = validateVectorWorkerPayload("trace-raster", {
    source,
    outputs,
  });
  assert.equal(trace.operation, "trace-raster");
  if (trace.operation !== "trace-raster") return;
  assert.equal(trace.value.options.deliveryProfile, "editable");
  assert.equal(trace.value.options.stableIdPrefix, undefined);

  const optimise = validateVectorWorkerPayload("optimise-svg", {
    source,
    outputs,
  });
  assert.equal(optimise.operation, "optimise-svg");
  if (optimise.operation !== "optimise-svg") return;
  assert.deepEqual(optimise.value.options, { deliveryProfile: "editable" });
});

test("accepts motion-ready delivery and a portable stable ID prefix", () => {
  const payload = validateVectorWorkerPayload("optimise-svg", {
    source,
    outputs,
    options: {
      deliveryProfile: "motion",
      stableIdPrefix: "worker-mark",
    },
  });
  assert.equal(payload.operation, "optimise-svg");
  if (payload.operation !== "optimise-svg") return;
  assert.deepEqual(payload.value.options, {
    deliveryProfile: "motion",
    stableIdPrefix: "worker-mark",
  });
});

test("rejects profile-specific stable ID misuse before execution", () => {
  assert.throws(
    () => validateVectorWorkerPayload("trace-raster", {
      source,
      outputs,
      options: {
        deliveryProfile: "web",
        stableIdPrefix: "ignored-prefix",
      },
    }),
    (error: unknown) =>
      error instanceof VectorWorkerError &&
      error.code === "VECTOR_WORKER_PAYLOAD_INVALID" &&
      /editable or motion delivery profiles/.test(error.message),
  );

  assert.throws(
    () => validateVectorWorkerPayload("optimise-svg", {
      source,
      outputs,
      options: {
        deliveryProfile: "motion",
        stableIdPrefix: "9-invalid",
      },
    }),
    (error: unknown) =>
      error instanceof VectorWorkerError &&
      error.code === "VECTOR_WORKER_PAYLOAD_INVALID" &&
      /begin with a letter or underscore/.test(error.message),
  );
});

test("rejects unsupported delivery profiles and unknown fields", () => {
  assert.throws(
    () => validateVectorWorkerPayload("optimise-svg", {
      source,
      outputs,
      options: { deliveryProfile: "email" },
    }),
    (error: unknown) =>
      error instanceof VectorWorkerError &&
      error.code === "VECTOR_WORKER_PAYLOAD_INVALID" &&
      /editable, web, motion or print/.test(error.message),
  );

  assert.throws(
    () => validateVectorWorkerPayload("optimise-svg", {
      source,
      outputs,
      options: { deliveryProfile: "editable", flatten: true },
    }),
    (error: unknown) =>
      error instanceof VectorWorkerError &&
      error.code === "VECTOR_WORKER_PAYLOAD_INVALID" &&
      /unsupported fields/.test(error.message),
  );
});
