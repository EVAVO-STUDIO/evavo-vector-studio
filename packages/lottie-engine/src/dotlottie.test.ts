import assert from "node:assert/strict";
import test from "node:test";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import {
  createDotLottiePackage,
  inspectDotLottie,
  MAX_DOTLOTTIE_LOTTIE_BYTES,
} from "./dotlottie.js";
import { LottieEngineError } from "./errors.js";
import { createLottieFromSvgMotion } from "./generator.js";

const SOURCE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180">
  <title>Motion fixture mark</title>
  <path id="background" fill="#ffffff" d="M0 0h320v180H0z"/>
  <g id="mark">
    <path id="mark-body" fill="#111111" d="M64 36h192v108H64z"/>
    <path id="accent" fill="#ff244e" d="M96 70h128v40H96z"/>
  </g>
</svg>`;

const MOTION = {
  version: "1.0",
  name: "Gentle entrance",
  durationMs: 1200,
  delayMs: 100,
  iterations: 1,
  direction: "normal",
  fillMode: "both",
  reducedMotion: "last-frame",
  tracks: [
    {
      targetId: "mark",
      transformBox: "fill-box",
      originXPercent: 50,
      originYPercent: 50,
      easing: { cubicBezier: [0.2, 0.8, 0.2, 1] },
      keyframes: [
        { offset: 0, opacity: 0, translateY: 12, scale: 0.96 },
        { offset: 0.6, opacity: 1, translateY: -1, scale: 1.01 },
        { offset: 1, opacity: 1, translateY: 0, scale: 1 },
      ],
    },
  ],
} as const;

const FIXED_DATE = new Date(1980, 0, 1, 0, 0, 0);

function validLottieJson(): string {
  return createLottieFromSvgMotion(SOURCE, MOTION).json;
}

function packageZip(entries: Record<string, Uint8Array>): Uint8Array {
  const files: Record<string, [Uint8Array, { level: 9; mtime: Date }]> = {};
  for (const [name, bytes] of Object.entries(entries)) {
    files[name] = [bytes, { level: 9, mtime: FIXED_DATE }];
  }
  return zipSync(files, { level: 9, mtime: FIXED_DATE });
}

function writeAscii(target: Uint8Array, offset: number, value: string): void {
  const bytes = strToU8(value);
  target.set(bytes, offset);
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset]! |
    (bytes[offset + 1]! << 8) |
    (bytes[offset + 2]! << 16) |
    (bytes[offset + 3]! << 24)
  ) >>> 0;
}

function writeUint32(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
  bytes[offset + 2] = (value >>> 16) & 0xff;
  bytes[offset + 3] = (value >>> 24) & 0xff;
}

function signatureOffsets(bytes: Uint8Array, signature: number): readonly number[] {
  const offsets: number[] = [];
  for (let offset = 0; offset <= bytes.byteLength - 4; offset += 1) {
    if (readUint32(bytes, offset) === signature) offsets.push(offset);
  }
  return Object.freeze(offsets);
}

test("creates deterministic dotLottie v2 bytes with audited evidence", () => {
  const lottie = validLottieJson();
  const first = createDotLottiePackage(lottie);
  const second = createDotLottiePackage(lottie);

  assert.deepEqual(first.bytes, second.bytes);
  assert.equal(first.evidence.output.sha256, second.evidence.output.sha256);
  assert.equal(first.inspection.valid, true);
  assert.equal(first.inspection.contractVersion, "1.0");
  assert.equal(first.inspection.manifestVersion, "2");
  assert.equal(first.manifest.version, "2");
  assert.equal(first.manifest.initial.animation, "main-animation");
  assert.deepEqual(first.inspection.animationIds, ["main-animation"]);
  assert.deepEqual(first.evidence.output.entryOrder, [
    "manifest.json",
    "a/main-animation.json",
  ]);
  assert.equal(first.inspection.entryCount, 2);
  assert.ok(first.inspection.entries.every((entry) => entry.compression === "deflate"));
  assert.ok(first.inspection.entries.every((entry) => entry.deterministicTimestamp));
  assert.equal(first.inspection.embeddedLottie?.valid, true);
  assert.equal(first.evidence.archive.deterministic, true);
  assert.equal(first.evidence.archive.manifestVersion, "2");
  assert.equal(first.evidence.compatibility.archiveInspection, "passed");
  assert.equal(first.evidence.compatibility.embeddedLottieInspection, "passed");
  assert.equal(first.evidence.compatibility.playerRenderValidation, "not-yet-performed");
  assert.equal(first.evidence.compatibility.browserArchiveLoadValidation, "not-yet-performed");
  assert.equal(first.evidence.approval, "review-required");
  assert.match(first.evidence.output.sha256, /^[a-f0-9]{64}$/);

  const files = unzipSync(first.bytes);
  const manifest = JSON.parse(strFromU8(files["manifest.json"]!)) as {
    version?: string;
    initial?: { animation?: string };
  };
  assert.equal(manifest.version, "2");
  assert.equal(manifest.initial?.animation, "main-animation");
  assert.equal(
    JSON.parse(strFromU8(files["a/main-animation.json"]!)).meta.contractVersion,
    "1.0",
  );
});

test("supports a portable custom animation ID and rejects unsafe IDs", () => {
  const custom = createDotLottiePackage(validLottieJson(), { animationId: "mark_intro-01" });
  assert.equal(custom.manifest.initial.animation, "mark_intro-01");
  assert.deepEqual(custom.evidence.output.entryOrder, [
    "manifest.json",
    "a/mark_intro-01.json",
  ]);

  for (const animationId of ["", "../mark", "mark intro", "_mark", "a".repeat(65)]) {
    if (animationId === "") continue;
    assert.throws(
      () => createDotLottiePackage(validLottieJson(), { animationId }),
      (error: unknown) =>
        error instanceof LottieEngineError &&
        error.code === "DOTLOTTIE_OPTIONS_INVALID",
    );
  }
});

test("rejects traversal, unexpected entries and missing initial animation files", () => {
  const manifest = strToU8(`${JSON.stringify({
    version: "2",
    generator: "test",
    initial: { animation: "main" },
    animations: [{ id: "main" }],
  })}\n`);
  const lottie = strToU8(validLottieJson());

  const traversal = inspectDotLottie(packageZip({
    "manifest.json": manifest,
    "../main.json": lottie,
  }));
  assert.equal(traversal.valid, false);
  assert.ok(traversal.findings.some((finding) => finding.code === "DOTLOTTIE_ARCHIVE_INVALID"));

  const missing = inspectDotLottie(packageZip({
    "manifest.json": manifest,
    "a/other.json": lottie,
  }));
  assert.equal(missing.valid, false);
  assert.ok(missing.findings.some((finding) => finding.code === "DOTLOTTIE_ANIMATION_MISSING"));

  const extra = inspectDotLottie(packageZip({
    "manifest.json": manifest,
    "a/main.json": lottie,
    "themes/extra.json": strToU8("{}"),
  }));
  assert.equal(extra.valid, false);
  assert.ok(extra.findings.some((finding) => finding.code === "DOTLOTTIE_ENTRY_SET_UNSUPPORTED"));
  assert.ok(extra.findings.some((finding) => finding.code === "DOTLOTTIE_ENTRY_UNSUPPORTED"));
});

test("rejects duplicate entry names before decompression", () => {
  const valid = createDotLottiePackage(validLottieJson(), { animationId: "abcdef" });
  const duplicate = Uint8Array.from(valid.bytes);
  const central = signatureOffsets(duplicate, 0x02014b50);
  assert.equal(central.length, 2);
  const secondCentral = central[1]!;
  const secondLocal = readUint32(duplicate, secondCentral + 42);
  writeAscii(duplicate, secondCentral + 46, "manifest.json");
  writeAscii(duplicate, secondLocal + 30, "manifest.json");

  const inspection = inspectDotLottie(duplicate);
  assert.equal(inspection.valid, false);
  assert.ok(inspection.findings.some((finding) =>
    finding.code === "DOTLOTTIE_ARCHIVE_INVALID" &&
    /Duplicate ZIP entry names/.test(finding.message),
  ));
});

test("rejects oversized declared output before inflating it", () => {
  const valid = createDotLottiePackage(validLottieJson());
  const oversized = Uint8Array.from(valid.bytes);
  const central = signatureOffsets(oversized, 0x02014b50);
  assert.equal(central.length, 2);
  writeUint32(oversized, central[1]! + 24, MAX_DOTLOTTIE_LOTTIE_BYTES + 1);

  const inspection = inspectDotLottie(oversized);
  assert.equal(inspection.valid, false);
  assert.ok(inspection.findings.some((finding) =>
    finding.code === "DOTLOTTIE_ARCHIVE_INVALID" &&
    /uncompressed content beyond/.test(finding.message),
  ));
});

test("rejects invalid embedded Lottie JSON and unsupported manifest semantics", () => {
  const invalidLottie = inspectDotLottie(packageZip({
    "manifest.json": strToU8(`${JSON.stringify({
      version: "2",
      generator: "test",
      initial: { animation: "main" },
      animations: [{ id: "main" }],
    })}\n`),
    "a/main.json": strToU8("{}"),
  }));
  assert.equal(invalidLottie.valid, false);
  assert.ok(invalidLottie.findings.some((finding) => finding.code === "DOTLOTTIE_EMBEDDED_LOTTIE_INVALID"));

  const unsupportedManifest = inspectDotLottie(packageZip({
    "manifest.json": strToU8(`${JSON.stringify({
      version: "2",
      generator: "test",
      initial: { animation: "main" },
      animations: [{ id: "main" }],
      themes: [{ id: "dark" }],
    })}\n`),
    "a/main.json": strToU8(validLottieJson()),
  }));
  assert.equal(unsupportedManifest.valid, false);
  assert.ok(unsupportedManifest.findings.some((finding) => finding.code === "DOTLOTTIE_MANIFEST_INVALID"));
});
