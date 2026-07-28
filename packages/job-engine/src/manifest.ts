import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { BatchEngineError } from "./errors.js";
import {
  BATCH_CONTRACT_VERSION,
  MAX_BATCH_ITEMS,
  type BatchFailureMode,
  type BatchManifest,
  type BatchManifestItem,
} from "./types.js";

const PORTABLE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const OPERATION_ID = /^[a-z][a-z0-9:-]{0,63}$/;
const ROOT_KEYS = new Set([
  "$schema",
  "version",
  "id",
  "name",
  "failureMode",
  "items",
]);
const ITEM_KEYS = new Set(["id", "operation", "spec"]);

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function assertKnownKeys(
  source: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  label: string,
): void {
  const unknownKeys = Object.keys(source).filter((key) => !allowed.has(key));
  if (unknownKeys.length > 0) {
    throw new BatchEngineError(
      "BATCH_MANIFEST_INVALID",
      `${label} contains unsupported fields.`,
      { details: { label, unknownKeys } },
    );
  }
}

function requiredText(
  source: Record<string, unknown>,
  key: string,
  label: string,
  maximum: number,
): string {
  const value = source[key];
  if (typeof value !== "string" || value.trim().length === 0 || value.length > maximum) {
    throw new BatchEngineError(
      "BATCH_MANIFEST_INVALID",
      `${label}.${key} must contain 1 to ${maximum} characters.`,
      { details: { label, key, value } },
    );
  }
  return value.trim();
}

function validateItem(value: unknown, index: number): BatchManifestItem {
  const source = record(value);
  const label = `manifest.items[${index}]`;
  if (!source) {
    throw new BatchEngineError(
      "BATCH_MANIFEST_INVALID",
      `${label} must be an object.`,
      { details: { index } },
    );
  }
  assertKnownKeys(source, ITEM_KEYS, label);
  const id = requiredText(source, "id", label, 64);
  if (!PORTABLE_ID.test(id)) {
    throw new BatchEngineError(
      "BATCH_MANIFEST_INVALID",
      `${label}.id is not a portable batch item identifier.`,
      { details: { id, index } },
    );
  }
  const operation = requiredText(source, "operation", label, 64);
  if (!OPERATION_ID.test(operation)) {
    throw new BatchEngineError(
      "BATCH_MANIFEST_INVALID",
      `${label}.operation is not a supported operation identifier.`,
      { details: { operation, index } },
    );
  }
  const spec = record(source.spec);
  if (!spec) {
    throw new BatchEngineError(
      "BATCH_MANIFEST_INVALID",
      `${label}.spec must be an object.`,
      { details: { index } },
    );
  }
  return Object.freeze({
    id,
    operation,
    spec: Object.freeze({ ...spec }),
  });
}

export function validateBatchManifest(value: unknown): BatchManifest {
  const source = record(value);
  if (!source) {
    throw new BatchEngineError(
      "BATCH_MANIFEST_INVALID",
      "The batch manifest must contain an object.",
    );
  }
  assertKnownKeys(source, ROOT_KEYS, "manifest");
  if (
    source.$schema !== undefined &&
    (typeof source.$schema !== "string" || source.$schema.length > 500)
  ) {
    throw new BatchEngineError(
      "BATCH_MANIFEST_INVALID",
      "manifest.$schema must be a string of at most 500 characters.",
      { details: { schema: source.$schema } },
    );
  }
  if (source.version !== BATCH_CONTRACT_VERSION) {
    throw new BatchEngineError(
      "BATCH_MANIFEST_INVALID",
      `manifest.version must be ${BATCH_CONTRACT_VERSION}.`,
      { details: { version: source.version } },
    );
  }
  const id = requiredText(source, "id", "manifest", 64);
  if (!PORTABLE_ID.test(id)) {
    throw new BatchEngineError(
      "BATCH_MANIFEST_INVALID",
      "manifest.id is not a portable job identifier.",
      { details: { id } },
    );
  }
  const name = requiredText(source, "name", "manifest", 160);
  const failureMode = source.failureMode;
  if (failureMode !== "continue" && failureMode !== "fail-fast") {
    throw new BatchEngineError(
      "BATCH_MANIFEST_INVALID",
      "manifest.failureMode must be continue or fail-fast.",
      { details: { failureMode } },
    );
  }
  if (
    !Array.isArray(source.items) ||
    source.items.length < 1 ||
    source.items.length > MAX_BATCH_ITEMS
  ) {
    throw new BatchEngineError(
      "BATCH_MANIFEST_INVALID",
      `manifest.items must contain 1 to ${MAX_BATCH_ITEMS} items.`,
      {
        details: {
          itemCount: Array.isArray(source.items) ? source.items.length : null,
        },
      },
    );
  }
  const items = source.items.map(validateItem);
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.id)) {
      throw new BatchEngineError(
        "BATCH_MANIFEST_INVALID",
        "Batch item identifiers must be unique.",
        { details: { duplicateId: item.id } },
      );
    }
    seen.add(item.id);
  }
  return Object.freeze({
    version: BATCH_CONTRACT_VERSION,
    id,
    name,
    failureMode: failureMode as BatchFailureMode,
    items: Object.freeze(items),
  });
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  const source = record(value);
  if (!source) return value;
  return Object.fromEntries(
    Object.keys(source)
      .sort()
      .map((key) => [key, canonicalValue(source[key])]),
  );
}

export function canonicalBatchManifest(manifest: BatchManifest): string {
  return `${JSON.stringify(canonicalValue(manifest))}\n`;
}

export function batchManifestSha256(manifest: BatchManifest): string {
  return createHash("sha256")
    .update(canonicalBatchManifest(manifest), "utf8")
    .digest("hex");
}

export async function readBatchManifest(
  manifestPath: string,
): Promise<Readonly<{
  path: string;
  manifest: BatchManifest;
  sha256: string;
}>> {
  const resolvedPath = path.resolve(manifestPath);
  let source: string;
  try {
    source = await readFile(resolvedPath, "utf8");
  } catch (error) {
    throw new BatchEngineError(
      "BATCH_FILESYSTEM_FAILED",
      "The batch manifest could not be read.",
      {
        details: {
          manifestPath: resolvedPath,
          cause: error instanceof Error ? error.message : String(error),
        },
        cause: error,
      },
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(source) as unknown;
  } catch (error) {
    throw new BatchEngineError(
      "BATCH_MANIFEST_INVALID",
      "The batch manifest is not valid JSON.",
      {
        details: {
          manifestPath: resolvedPath,
          cause: error instanceof Error ? error.message : String(error),
        },
        cause: error,
      },
    );
  }
  const manifest = validateBatchManifest(value);
  return Object.freeze({
    path: resolvedPath,
    manifest,
    sha256: batchManifestSha256(manifest),
  });
}
