import fs from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

const root = process.cwd();
const relativePath = "pnpm-lock.yaml";
const absolutePath = path.join(root, relativePath);
const errors = [];
let bytes;
try {
  bytes = fs.readFileSync(absolutePath);
} catch (error) {
  process.stderr.write(
    `${JSON.stringify(
      {
        check: "pnpm-lockfile-integrity",
        ok: false,
        errors: [
          `Missing or unreadable ${relativePath}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        ],
      },
      null,
      2,
    )}\n`,
  );
  process.exit(1);
}

let source;
try {
  source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
} catch {
  errors.push(`${relativePath} is not valid UTF-8.`);
  source = bytes.toString("utf8");
}

const byteOrderMarks = [];
for (
  let index = source.indexOf("\uFEFF");
  index >= 0;
  index = source.indexOf("\uFEFF", index + 1)
) {
  byteOrderMarks.push(index);
}
if (byteOrderMarks.some((index) => index !== 0)) {
  errors.push(
    `${relativePath} contains an embedded UTF-8 byte-order mark at character offsets ${byteOrderMarks
      .filter((index) => index !== 0)
      .join(", ")}.`,
  );
}
if (source.startsWith("\uFEFF")) source = source.slice(1);

const lines = source.split(/\r?\n/);
const documentMarkers = [];
const conflictMarkers = [];
const versionLines = [];
for (let index = 0; index < lines.length; index += 1) {
  const line = lines[index];
  const trimmed = line.trim();
  if (trimmed === "---" || trimmed === "...") {
    documentMarkers.push({ line: index + 1, marker: trimmed });
  }
  if (/^(?:<{7}|={7}|>{7})/.test(trimmed)) {
    conflictMarkers.push({ line: index + 1, marker: trimmed.slice(0, 7) });
  }
  if (/^lockfileVersion\s*:/.test(line)) {
    versionLines.push(index + 1);
  }
}
if (documentMarkers.length > 0) {
  errors.push(
    `${relativePath} contains YAML document markers: ${documentMarkers
      .map((item) => `${item.marker}@${item.line}`)
      .join(", ")}.`,
  );
}
if (conflictMarkers.length > 0) {
  errors.push(
    `${relativePath} contains unresolved conflict markers at lines ${conflictMarkers
      .map((item) => item.line)
      .join(", ")}.`,
  );
}
if (versionLines.length !== 1 || versionLines[0] !== 1) {
  errors.push(
    `${relativePath} must contain exactly one lockfileVersion declaration on line 1; found ${versionLines.join(", ") || "none"}.`,
  );
}

const prohibitedControls = [];
for (let index = 0; index < source.length; index += 1) {
  const code = source.charCodeAt(index);
  if (
    (code >= 0 && code <= 8) ||
    code === 11 ||
    code === 12 ||
    (code >= 14 && code <= 31) ||
    code === 127
  ) {
    prohibitedControls.push({ offset: index, code });
    if (prohibitedControls.length >= 20) break;
  }
}
if (prohibitedControls.length > 0) {
  errors.push(
    `${relativePath} contains prohibited control characters: ${prohibitedControls
      .map(
        (item) =>
          `U+${item.code.toString(16).padStart(4, "0").toUpperCase()}@${item.offset}`,
      )
      .join(", ")}.`,
  );
}

const evidence = Object.freeze({
  check: "pnpm-lockfile-integrity",
  ok: errors.length === 0,
  path: relativePath,
  bytes: bytes.byteLength,
  lines: lines.length,
  sha256: createHash("sha256").update(bytes).digest("hex"),
  utf8: true,
  byteOrderMarkCount: byteOrderMarks.length,
  documentMarkers,
  conflictMarkers,
  lockfileVersionLines: versionLines,
  prohibitedControlCharacterCount: prohibitedControls.length,
});

if (errors.length > 0) {
  process.stderr.write(`${JSON.stringify({ ...evidence, errors }, null, 2)}\n`);
  process.exit(1);
}
process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
