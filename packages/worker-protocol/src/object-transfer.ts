import { createHash } from "node:crypto";
import { TextDecoder } from "node:util";
import { canonicalHostedJobJson } from "@evavo/job-control";
import { VectorWorkerProtocolError } from "./errors.js";

export const VECTOR_OBJECT_TRANSFER_CONTRACT_VERSION = "1.0" as const;
export const VECTOR_OBJECT_TRANSACTION_CONTENT_TYPE =
  "application/vnd.evavo.vector-object-transaction" as const;
export const VECTOR_OBJECT_MAX_BYTES = 32 * 1024 * 1024;
export const VECTOR_OBJECT_TRANSACTION_MAX_BYTES = 64 * 1024 * 1024;
export const VECTOR_OBJECT_TRANSACTION_MAX_ITEMS = 16;
export const VECTOR_OBJECT_TRANSACTION_MAX_MANIFEST_BYTES = 64 * 1024;

const TRANSACTION_MAGIC_TEXT = "EVAVOOB1";
const TRANSACTION_MAGIC = new TextEncoder().encode(TRANSACTION_MAGIC_TEXT);
const TRANSACTION_HEADER_BYTES = TRANSACTION_MAGIC.byteLength + 4;
const UTF8 = new TextEncoder();
const STRICT_UTF8 = new TextDecoder("utf-8", { fatal: true });
const SHA256 = /^[a-f0-9]{64}$/;
const OBJECT_KEY = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,1023}$/;

export type VectorObjectTransferWrite = Readonly<{
  objectKey: string;
  mimeType: string;
  bytes: Uint8Array;
}>;

export type VectorObjectTransferManifestItem = Readonly<{
  objectKey: string;
  mimeType: string;
  bytes: number;
  sha256: string;
}>;

export type VectorObjectTransferManifest = Readonly<{
  contractVersion: typeof VECTOR_OBJECT_TRANSFER_CONTRACT_VERSION;
  encoding: "ordered-concatenated-payload";
  payloadBytes: number;
  objects: readonly VectorObjectTransferManifestItem[];
}>;

export type EncodedVectorObjectTransaction = Readonly<{
  contentType: typeof VECTOR_OBJECT_TRANSACTION_CONTENT_TYPE;
  transactionId: string;
  bodySha256: string;
  body: Uint8Array;
  manifest: VectorObjectTransferManifest;
}>;

export type DecodedVectorObjectTransaction = Readonly<{
  transactionId: string;
  bodySha256: string;
  manifest: VectorObjectTransferManifest;
  writes: readonly VectorObjectTransferWrite[];
}>;

function error(
  code:
    | "VECTOR_WORKER_OBJECT_TRANSACTION_INVALID"
    | "VECTOR_WORKER_OBJECT_TRANSACTION_TOO_LARGE"
    | "VECTOR_WORKER_OBJECT_HASH_MISMATCH",
  message: string,
  details: Readonly<Record<string, unknown>> = {},
): never {
  throw new VectorWorkerProtocolError(code, message, {
    status: code === "VECTOR_WORKER_OBJECT_TRANSACTION_TOO_LARGE" ? 413 : 422,
    details,
  });
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function strictKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
): void {
  const allowedSet = new Set(allowed);
  const unknownFields = Object.keys(value)
    .filter((field) => !allowedSet.has(field))
    .sort();
  if (unknownFields.length > 0) {
    error(
      "VECTOR_WORKER_OBJECT_TRANSACTION_INVALID",
      `${label} contains unsupported fields.`,
      { label, unknownFields },
    );
  }
}

function validateObjectKey(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    !OBJECT_KEY.test(value) ||
    value.startsWith("/") ||
    value.includes("\\") ||
    value.includes("\0")
  ) {
    error(
      "VECTOR_WORKER_OBJECT_TRANSACTION_INVALID",
      `${label} must be a portable relative slash-separated object key.`,
      { label, value },
    );
  }
  const segments = value.split("/");
  if (
    segments.some((segment) =>
      !segment || segment === "." || segment === ".."
    )
  ) {
    error(
      "VECTOR_WORKER_OBJECT_TRANSACTION_INVALID",
      `${label} cannot contain empty, dot or parent segments.`,
      { label, value },
    );
  }
  return value;
}

function validateMimeType(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 160 ||
    value.trim() !== value ||
    value.includes("\0") ||
    value.includes("\r") ||
    value.includes("\n")
  ) {
    error(
      "VECTOR_WORKER_OBJECT_TRANSACTION_INVALID",
      `${label} must contain a bounded MIME type without control characters.`,
      { label },
    );
  }
  return value;
}

function validateByteCount(value: unknown, label: string): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > VECTOR_OBJECT_MAX_BYTES
  ) {
    error(
      value !== null && typeof value === "number" && value > VECTOR_OBJECT_MAX_BYTES
        ? "VECTOR_WORKER_OBJECT_TRANSACTION_TOO_LARGE"
        : "VECTOR_WORKER_OBJECT_TRANSACTION_INVALID",
      `${label} must be an integer from 1 to ${VECTOR_OBJECT_MAX_BYTES}.`,
      { label, value, maximum: VECTOR_OBJECT_MAX_BYTES },
    );
  }
  return value;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256")
    .update(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength))
    .digest("hex");
}

function copyBytes(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(bytes);
}

function validateWrites(
  writes: readonly VectorObjectTransferWrite[],
): Readonly<{
  writes: readonly VectorObjectTransferWrite[];
  manifestItems: readonly VectorObjectTransferManifestItem[];
  payloadBytes: number;
}> {
  if (
    !Array.isArray(writes) ||
    writes.length < 1 ||
    writes.length > VECTOR_OBJECT_TRANSACTION_MAX_ITEMS
  ) {
    error(
      "VECTOR_WORKER_OBJECT_TRANSACTION_INVALID",
      `Object transactions must contain 1 to ${VECTOR_OBJECT_TRANSACTION_MAX_ITEMS} objects.`,
      { count: Array.isArray(writes) ? writes.length : null },
    );
  }

  const keys = new Set<string>();
  const normalized: VectorObjectTransferWrite[] = [];
  const manifestItems: VectorObjectTransferManifestItem[] = [];
  let payloadBytes = 0;
  for (const [index, write] of writes.entries()) {
    if (!write || typeof write !== "object") {
      error(
        "VECTOR_WORKER_OBJECT_TRANSACTION_INVALID",
        "Every object transaction item must be an object.",
        { index },
      );
    }
    const objectKey = validateObjectKey(write.objectKey, `objects[${index}].objectKey`);
    if (keys.has(objectKey)) {
      error(
        "VECTOR_WORKER_OBJECT_TRANSACTION_INVALID",
        "Object transaction keys must be unique.",
        { index, objectKey },
      );
    }
    keys.add(objectKey);
    const mimeType = validateMimeType(write.mimeType, `objects[${index}].mimeType`);
    if (!(write.bytes instanceof Uint8Array)) {
      error(
        "VECTOR_WORKER_OBJECT_TRANSACTION_INVALID",
        "Every object transaction item must contain Uint8Array bytes.",
        { index, objectKey },
      );
    }
    const byteCount = validateByteCount(
      write.bytes.byteLength,
      `objects[${index}].bytes`,
    );
    payloadBytes += byteCount;
    if (payloadBytes > VECTOR_OBJECT_TRANSACTION_MAX_BYTES) {
      error(
        "VECTOR_WORKER_OBJECT_TRANSACTION_TOO_LARGE",
        "The concatenated object payload exceeds the transaction byte limit.",
        {
          payloadBytes,
          maximum: VECTOR_OBJECT_TRANSACTION_MAX_BYTES,
        },
      );
    }
    const bytes = copyBytes(write.bytes);
    const digest = sha256(bytes);
    normalized.push(Object.freeze({ objectKey, mimeType, bytes }));
    manifestItems.push(Object.freeze({
      objectKey,
      mimeType,
      bytes: byteCount,
      sha256: digest,
    }));
  }

  return Object.freeze({
    writes: Object.freeze(normalized),
    manifestItems: Object.freeze(manifestItems),
    payloadBytes,
  });
}

function createManifest(
  objects: readonly VectorObjectTransferManifestItem[],
  payloadBytes: number,
): VectorObjectTransferManifest {
  return Object.freeze({
    contractVersion: VECTOR_OBJECT_TRANSFER_CONTRACT_VERSION,
    encoding: "ordered-concatenated-payload" as const,
    payloadBytes,
    objects,
  });
}

export function encodeVectorObjectTransaction(
  input: readonly VectorObjectTransferWrite[],
): EncodedVectorObjectTransaction {
  const prepared = validateWrites(input);
  const manifest = createManifest(
    prepared.manifestItems,
    prepared.payloadBytes,
  );
  const manifestSource = canonicalHostedJobJson(manifest);
  const manifestBytes = UTF8.encode(manifestSource);
  if (manifestBytes.byteLength > VECTOR_OBJECT_TRANSACTION_MAX_MANIFEST_BYTES) {
    error(
      "VECTOR_WORKER_OBJECT_TRANSACTION_TOO_LARGE",
      "The object transaction manifest exceeds its byte limit.",
      {
        bytes: manifestBytes.byteLength,
        maximum: VECTOR_OBJECT_TRANSACTION_MAX_MANIFEST_BYTES,
      },
    );
  }
  const bodyBytes =
    TRANSACTION_HEADER_BYTES + manifestBytes.byteLength + prepared.payloadBytes;
  if (bodyBytes > VECTOR_OBJECT_TRANSACTION_MAX_BYTES) {
    error(
      "VECTOR_WORKER_OBJECT_TRANSACTION_TOO_LARGE",
      "The encoded object transaction exceeds the total body limit.",
      { bodyBytes, maximum: VECTOR_OBJECT_TRANSACTION_MAX_BYTES },
    );
  }

  const body = new Uint8Array(bodyBytes);
  body.set(TRANSACTION_MAGIC, 0);
  new DataView(body.buffer).setUint32(
    TRANSACTION_MAGIC.byteLength,
    manifestBytes.byteLength,
    false,
  );
  body.set(manifestBytes, TRANSACTION_HEADER_BYTES);
  let offset = TRANSACTION_HEADER_BYTES + manifestBytes.byteLength;
  for (const write of prepared.writes) {
    body.set(write.bytes, offset);
    offset += write.bytes.byteLength;
  }
  const bodySha256 = sha256(body);
  return Object.freeze({
    contentType: VECTOR_OBJECT_TRANSACTION_CONTENT_TYPE,
    transactionId: bodySha256,
    bodySha256,
    body,
    manifest,
  });
}

function parseManifest(source: string): VectorObjectTransferManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source) as unknown;
  } catch (cause) {
    error(
      "VECTOR_WORKER_OBJECT_TRANSACTION_INVALID",
      "The object transaction manifest is not valid JSON.",
      { cause: cause instanceof Error ? cause.message : String(cause) },
    );
  }
  const value = record(parsed);
  if (!value) {
    error(
      "VECTOR_WORKER_OBJECT_TRANSACTION_INVALID",
      "The object transaction manifest must be a JSON object.",
    );
  }
  strictKeys(
    value,
    ["contractVersion", "encoding", "payloadBytes", "objects"],
    "manifest",
  );
  if (value.contractVersion !== VECTOR_OBJECT_TRANSFER_CONTRACT_VERSION) {
    error(
      "VECTOR_WORKER_OBJECT_TRANSACTION_INVALID",
      "The object transaction uses an unsupported contract version.",
      { contractVersion: value.contractVersion },
    );
  }
  if (value.encoding !== "ordered-concatenated-payload") {
    error(
      "VECTOR_WORKER_OBJECT_TRANSACTION_INVALID",
      "The object transaction uses an unsupported payload encoding.",
      { encoding: value.encoding },
    );
  }
  if (
    typeof value.payloadBytes !== "number" ||
    !Number.isSafeInteger(value.payloadBytes) ||
    value.payloadBytes < 1 ||
    value.payloadBytes > VECTOR_OBJECT_TRANSACTION_MAX_BYTES
  ) {
    error(
      "VECTOR_WORKER_OBJECT_TRANSACTION_INVALID",
      "manifest.payloadBytes is invalid.",
      { payloadBytes: value.payloadBytes },
    );
  }
  if (
    !Array.isArray(value.objects) ||
    value.objects.length < 1 ||
    value.objects.length > VECTOR_OBJECT_TRANSACTION_MAX_ITEMS
  ) {
    error(
      "VECTOR_WORKER_OBJECT_TRANSACTION_INVALID",
      `manifest.objects must contain 1 to ${VECTOR_OBJECT_TRANSACTION_MAX_ITEMS} items.`,
      { count: Array.isArray(value.objects) ? value.objects.length : null },
    );
  }

  const keys = new Set<string>();
  const objects: VectorObjectTransferManifestItem[] = [];
  let payloadBytes = 0;
  for (const [index, item] of value.objects.entries()) {
    const object = record(item);
    if (!object) {
      error(
        "VECTOR_WORKER_OBJECT_TRANSACTION_INVALID",
        "Every manifest object item must be an object.",
        { index },
      );
    }
    strictKeys(
      object,
      ["objectKey", "mimeType", "bytes", "sha256"],
      `manifest.objects[${index}]`,
    );
    const objectKey = validateObjectKey(
      object.objectKey,
      `manifest.objects[${index}].objectKey`,
    );
    if (keys.has(objectKey)) {
      error(
        "VECTOR_WORKER_OBJECT_TRANSACTION_INVALID",
        "Manifest object keys must be unique.",
        { index, objectKey },
      );
    }
    keys.add(objectKey);
    const mimeType = validateMimeType(
      object.mimeType,
      `manifest.objects[${index}].mimeType`,
    );
    const byteCount = validateByteCount(
      object.bytes,
      `manifest.objects[${index}].bytes`,
    );
    if (typeof object.sha256 !== "string" || !SHA256.test(object.sha256)) {
      error(
        "VECTOR_WORKER_OBJECT_TRANSACTION_INVALID",
        "Manifest object SHA-256 values must be lowercase hexadecimal.",
        { index, objectKey, sha256: object.sha256 },
      );
    }
    payloadBytes += byteCount;
    objects.push(Object.freeze({
      objectKey,
      mimeType,
      bytes: byteCount,
      sha256: object.sha256,
    }));
  }
  if (payloadBytes !== value.payloadBytes) {
    error(
      "VECTOR_WORKER_OBJECT_TRANSACTION_INVALID",
      "The manifest payload byte total does not match its object entries.",
      { declared: value.payloadBytes, calculated: payloadBytes },
    );
  }

  const manifest = createManifest(Object.freeze(objects), payloadBytes);
  if (canonicalHostedJobJson(manifest) !== source) {
    error(
      "VECTOR_WORKER_OBJECT_TRANSACTION_INVALID",
      "The object transaction manifest must use canonical JSON encoding.",
    );
  }
  return manifest;
}

export function decodeVectorObjectTransaction(
  input: Uint8Array,
): DecodedVectorObjectTransaction {
  if (!(input instanceof Uint8Array)) {
    error(
      "VECTOR_WORKER_OBJECT_TRANSACTION_INVALID",
      "The object transaction body must be a Uint8Array.",
    );
  }
  if (input.byteLength > VECTOR_OBJECT_TRANSACTION_MAX_BYTES) {
    error(
      "VECTOR_WORKER_OBJECT_TRANSACTION_TOO_LARGE",
      "The object transaction body exceeds the configured limit.",
      { bytes: input.byteLength, maximum: VECTOR_OBJECT_TRANSACTION_MAX_BYTES },
    );
  }
  if (input.byteLength < TRANSACTION_HEADER_BYTES + 2) {
    error(
      "VECTOR_WORKER_OBJECT_TRANSACTION_INVALID",
      "The object transaction body is too short.",
      { bytes: input.byteLength },
    );
  }
  for (let index = 0; index < TRANSACTION_MAGIC.byteLength; index += 1) {
    if (input[index] !== TRANSACTION_MAGIC[index]) {
      error(
        "VECTOR_WORKER_OBJECT_TRANSACTION_INVALID",
        "The object transaction magic signature is invalid.",
      );
    }
  }
  const view = new DataView(
    input.buffer,
    input.byteOffset,
    input.byteLength,
  );
  const manifestLength = view.getUint32(TRANSACTION_MAGIC.byteLength, false);
  if (
    manifestLength < 2 ||
    manifestLength > VECTOR_OBJECT_TRANSACTION_MAX_MANIFEST_BYTES ||
    TRANSACTION_HEADER_BYTES + manifestLength >= input.byteLength
  ) {
    error(
      manifestLength > VECTOR_OBJECT_TRANSACTION_MAX_MANIFEST_BYTES
        ? "VECTOR_WORKER_OBJECT_TRANSACTION_TOO_LARGE"
        : "VECTOR_WORKER_OBJECT_TRANSACTION_INVALID",
      "The object transaction manifest length is invalid.",
      {
        manifestLength,
        maximum: VECTOR_OBJECT_TRANSACTION_MAX_MANIFEST_BYTES,
        bodyBytes: input.byteLength,
      },
    );
  }
  let manifestSource: string;
  try {
    manifestSource = STRICT_UTF8.decode(
      input.subarray(
        TRANSACTION_HEADER_BYTES,
        TRANSACTION_HEADER_BYTES + manifestLength,
      ),
    );
  } catch (cause) {
    error(
      "VECTOR_WORKER_OBJECT_TRANSACTION_INVALID",
      "The object transaction manifest is not valid UTF-8.",
      { cause: cause instanceof Error ? cause.message : String(cause) },
    );
  }
  const manifest = parseManifest(manifestSource);
  const payloadOffset = TRANSACTION_HEADER_BYTES + manifestLength;
  const expectedBodyBytes = payloadOffset + manifest.payloadBytes;
  if (expectedBodyBytes !== input.byteLength) {
    error(
      "VECTOR_WORKER_OBJECT_TRANSACTION_INVALID",
      "The object transaction body length does not match the manifest.",
      { expectedBodyBytes, actualBodyBytes: input.byteLength },
    );
  }

  const writes: VectorObjectTransferWrite[] = [];
  let offset = payloadOffset;
  for (const [index, item] of manifest.objects.entries()) {
    const bytes = copyBytes(input.subarray(offset, offset + item.bytes));
    const actualSha256 = sha256(bytes);
    if (actualSha256 !== item.sha256) {
      error(
        "VECTOR_WORKER_OBJECT_HASH_MISMATCH",
        "An object transaction payload does not match its declared SHA-256.",
        {
          index,
          objectKey: item.objectKey,
          expectedSha256: item.sha256,
          actualSha256,
        },
      );
    }
    writes.push(Object.freeze({
      objectKey: item.objectKey,
      mimeType: item.mimeType,
      bytes,
    }));
    offset += item.bytes;
  }

  const bodySha256 = sha256(input);
  return Object.freeze({
    transactionId: bodySha256,
    bodySha256,
    manifest,
    writes: Object.freeze(writes),
  });
}
