import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { canonicalHostedJobJson } from "@evavo/job-control";
import { VectorWorkerProtocolError } from "./errors.js";
import {
  VECTOR_OBJECT_TRANSACTION_CONTENT_TYPE,
  VECTOR_OBJECT_TRANSACTION_MAX_MANIFEST_BYTES,
  decodeVectorObjectTransaction,
  encodeVectorObjectTransaction,
  type VectorObjectTransferManifest,
} from "./object-transfer.js";

const HEADER_BYTES = 12;
const ENCODER = new TextEncoder();
const DECODER = new TextDecoder();

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function replaceManifest(
  body: Uint8Array,
  manifestSource: string,
): Uint8Array {
  const previousLength = new DataView(
    body.buffer,
    body.byteOffset,
    body.byteLength,
  ).getUint32(8, false);
  const payload = body.subarray(HEADER_BYTES + previousLength);
  const manifest = ENCODER.encode(manifestSource);
  const replaced = new Uint8Array(HEADER_BYTES + manifest.byteLength + payload.byteLength);
  replaced.set(body.subarray(0, 8), 0);
  new DataView(replaced.buffer).setUint32(8, manifest.byteLength, false);
  replaced.set(manifest, HEADER_BYTES);
  replaced.set(payload, HEADER_BYTES + manifest.byteLength);
  return replaced;
}

function manifestFrom(body: Uint8Array): VectorObjectTransferManifest {
  const length = new DataView(
    body.buffer,
    body.byteOffset,
    body.byteLength,
  ).getUint32(8, false);
  return JSON.parse(
    DECODER.decode(body.subarray(HEADER_BYTES, HEADER_BYTES + length)),
  ) as VectorObjectTransferManifest;
}

function expectCode(code: string) {
  return (error: unknown) =>
    error instanceof VectorWorkerProtocolError && error.code === code;
}

test("encodes deterministic ordered multi-object transactions and decodes exact bytes", () => {
  const source = Object.freeze([
    Object.freeze({
      objectKey: "workspace/source/mark.svg",
      mimeType: "image/svg+xml",
      bytes: ENCODER.encode("<svg viewBox=\"0 0 10 10\"></svg>"),
    }),
    Object.freeze({
      objectKey: "workspace/source/plan.json",
      mimeType: "application/json",
      bytes: ENCODER.encode('{"version":"1.0"}\n'),
    }),
  ]);

  const first = encodeVectorObjectTransaction(source);
  const second = encodeVectorObjectTransaction(source);

  assert.equal(first.contentType, VECTOR_OBJECT_TRANSACTION_CONTENT_TYPE);
  assert.equal(first.transactionId, first.bodySha256);
  assert.equal(first.bodySha256, sha256(first.body));
  assert.deepEqual(first.body, second.body);
  assert.deepEqual(first.manifest, second.manifest);
  assert.equal(DECODER.decode(first.body.subarray(0, 8)), "EVAVOOB1");
  assert.equal(first.manifest.objects.length, 2);
  assert.deepEqual(
    first.manifest.objects.map((item) => item.objectKey),
    ["workspace/source/mark.svg", "workspace/source/plan.json"],
  );

  const decoded = decodeVectorObjectTransaction(first.body);
  assert.equal(decoded.transactionId, first.transactionId);
  assert.equal(decoded.bodySha256, first.bodySha256);
  assert.deepEqual(decoded.manifest, first.manifest);
  assert.equal(decoded.writes.length, 2);
  assert.deepEqual(decoded.writes[0]?.bytes, source[0]?.bytes);
  assert.deepEqual(decoded.writes[1]?.bytes, source[1]?.bytes);
  assert.notEqual(decoded.writes[0]?.bytes, source[0]?.bytes);
});

test("rejects invalid keys, duplicate keys, empty bodies and malformed MIME types before encoding", () => {
  assert.throws(
    () => encodeVectorObjectTransaction([{
      objectKey: "../escape.svg",
      mimeType: "image/svg+xml",
      bytes: new Uint8Array([1]),
    }]),
    expectCode("VECTOR_WORKER_OBJECT_TRANSACTION_INVALID"),
  );
  assert.throws(
    () => encodeVectorObjectTransaction([
      {
        objectKey: "same.svg",
        mimeType: "image/svg+xml",
        bytes: new Uint8Array([1]),
      },
      {
        objectKey: "same.svg",
        mimeType: "image/svg+xml",
        bytes: new Uint8Array([2]),
      },
    ]),
    expectCode("VECTOR_WORKER_OBJECT_TRANSACTION_INVALID"),
  );
  assert.throws(
    () => encodeVectorObjectTransaction([{
      objectKey: "empty.svg",
      mimeType: "image/svg+xml",
      bytes: new Uint8Array(),
    }]),
    expectCode("VECTOR_WORKER_OBJECT_TRANSACTION_INVALID"),
  );
  assert.throws(
    () => encodeVectorObjectTransaction([{
      objectKey: "mark.svg",
      mimeType: "image/svg+xml\r\nx-injected: true",
      bytes: new Uint8Array([1]),
    }]),
    expectCode("VECTOR_WORKER_OBJECT_TRANSACTION_INVALID"),
  );
});

test("rejects payload tampering with the object identity in the failure evidence", () => {
  const encoded = encodeVectorObjectTransaction([{
    objectKey: "workspace/output/mark.svg",
    mimeType: "image/svg+xml",
    bytes: ENCODER.encode("<svg></svg>"),
  }]);
  const tampered = new Uint8Array(encoded.body);
  tampered[tampered.length - 1] = (tampered[tampered.length - 1] ?? 0) ^ 0xff;

  assert.throws(
    () => decodeVectorObjectTransaction(tampered),
    (error: unknown) => {
      assert.ok(error instanceof VectorWorkerProtocolError);
      assert.equal(error.code, "VECTOR_WORKER_OBJECT_HASH_MISMATCH");
      assert.equal(error.details?.objectKey, "workspace/output/mark.svg");
      assert.match(String(error.details?.expectedSha256), /^[a-f0-9]{64}$/);
      assert.match(String(error.details?.actualSha256), /^[a-f0-9]{64}$/);
      return true;
    },
  );
});

test("rejects non-canonical manifests and declared payload totals that do not match entries", () => {
  const encoded = encodeVectorObjectTransaction([{
    objectKey: "workspace/source/mark.svg",
    mimeType: "image/svg+xml",
    bytes: ENCODER.encode("<svg></svg>"),
  }]);
  const manifest = manifestFrom(encoded.body);
  const pretty = JSON.stringify(manifest, null, 2);
  assert.notEqual(pretty, canonicalHostedJobJson(manifest));
  assert.throws(
    () => decodeVectorObjectTransaction(replaceManifest(encoded.body, pretty)),
    expectCode("VECTOR_WORKER_OBJECT_TRANSACTION_INVALID"),
  );

  const inconsistent = {
    ...manifest,
    payloadBytes: manifest.payloadBytes + 1,
  };
  assert.throws(
    () => decodeVectorObjectTransaction(
      replaceManifest(encoded.body, canonicalHostedJobJson(inconsistent)),
    ),
    expectCode("VECTOR_WORKER_OBJECT_TRANSACTION_INVALID"),
  );
});

test("rejects invalid signatures, oversized manifest declarations and trailing bytes", () => {
  const encoded = encodeVectorObjectTransaction([{
    objectKey: "workspace/source/mark.svg",
    mimeType: "image/svg+xml",
    bytes: ENCODER.encode("<svg></svg>"),
  }]);

  const invalidMagic = new Uint8Array(encoded.body);
  invalidMagic[0] = 0;
  assert.throws(
    () => decodeVectorObjectTransaction(invalidMagic),
    expectCode("VECTOR_WORKER_OBJECT_TRANSACTION_INVALID"),
  );

  const oversizedManifest = new Uint8Array(encoded.body);
  new DataView(oversizedManifest.buffer).setUint32(
    8,
    VECTOR_OBJECT_TRANSACTION_MAX_MANIFEST_BYTES + 1,
    false,
  );
  assert.throws(
    () => decodeVectorObjectTransaction(oversizedManifest),
    expectCode("VECTOR_WORKER_OBJECT_TRANSACTION_TOO_LARGE"),
  );

  const trailing = new Uint8Array(encoded.body.byteLength + 1);
  trailing.set(encoded.body, 0);
  trailing[trailing.length - 1] = 1;
  assert.throws(
    () => decodeVectorObjectTransaction(trailing),
    expectCode("VECTOR_WORKER_OBJECT_TRANSACTION_INVALID"),
  );
});
