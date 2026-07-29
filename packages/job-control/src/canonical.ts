import { createHash } from "node:crypto";
import { HostedJobError } from "./errors.js";

const MAX_DEPTH = 16;
const MAX_ARRAY_ITEMS = 10_000;

function plainRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null
    ? value as Record<string, unknown>
    : null;
}

function canonicalValue(value: unknown, depth: number): unknown {
  if (depth > MAX_DEPTH) {
    throw new HostedJobError(
      "HOSTED_JOB_REQUEST_INVALID",
      `Hosted job JSON cannot exceed ${MAX_DEPTH} levels.`,
      { status: 422 },
    );
  }
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new HostedJobError(
        "HOSTED_JOB_REQUEST_INVALID",
        "Hosted job JSON numbers must be finite.",
        { status: 422 },
      );
    }
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_ARRAY_ITEMS) {
      throw new HostedJobError(
        "HOSTED_JOB_REQUEST_INVALID",
        `Hosted job arrays cannot exceed ${MAX_ARRAY_ITEMS} items.`,
        { status: 422 },
      );
    }
    return value.map((item) => canonicalValue(item, depth + 1));
  }
  const source = plainRecord(value);
  if (!source) {
    throw new HostedJobError(
      "HOSTED_JOB_REQUEST_INVALID",
      "Hosted job payloads must contain JSON-compatible plain objects only.",
      { status: 422 },
    );
  }
  return Object.fromEntries(
    Object.keys(source)
      .sort()
      .map((key) => [key, canonicalValue(source[key], depth + 1)]),
  );
}

export function canonicalHostedJobJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value, 0));
}

export function hostedJobSha256(value: unknown): string {
  return createHash("sha256")
    .update(canonicalHostedJobJson(value), "utf8")
    .digest("hex");
}

export function hostedJobIdempotencyDigest(
  workspaceId: string,
  idempotencyKey: string,
): string {
  return createHash("sha256")
    .update(workspaceId, "utf8")
    .update("\0", "utf8")
    .update(idempotencyKey, "utf8")
    .digest("hex");
}
