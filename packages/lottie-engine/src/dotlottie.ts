import { createHash } from "node:crypto";
import { TextDecoder } from "node:util";
import { strToU8, unzipSync, zipSync } from "fflate";
import { LottieEngineError } from "./errors.js";
import { inspectLottie } from "./inspection.js";
import type { LottieInspection } from "./types.js";

export const DOTLOTTIE_CONTRACT_VERSION = "1.0" as const;
export const DOTLOTTIE_MANIFEST_VERSION = "2" as const;
export const DOTLOTTIE_MIME_TYPE = "application/zip+dotlottie" as const;
export const DOTLOTTIE_EXTENSION = ".lottie" as const;
export const MAX_DOTLOTTIE_LOTTIE_BYTES = 20 * 1024 * 1024;
export const MAX_DOTLOTTIE_ARCHIVE_BYTES = 25 * 1024 * 1024;
export const MAX_DOTLOTTIE_TOTAL_UNCOMPRESSED_BYTES = 24 * 1024 * 1024;
export const MAX_DOTLOTTIE_MANIFEST_BYTES = 64 * 1024;
export const MAX_DOTLOTTIE_ENTRY_COUNT = 16;

const FIXED_ZIP_DATE = new Date(1980, 0, 1, 0, 0, 0);
const FIXED_DOS_DATE = 33;
const FIXED_DOS_TIME = 0;
const SAFE_ANIMATION_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const ZIP64_SENTINEL_16 = 0xffff;
const ZIP64_SENTINEL_32 = 0xffffffff;
const STRICT_UTF8 = new TextDecoder("utf-8", { fatal: true });

export type DotLottieFindingSeverity = "error" | "warning" | "info";

export type DotLottieFinding = Readonly<{
  code: string;
  severity: DotLottieFindingSeverity;
  message: string;
  entryName?: string;
}>;

export type DotLottieManifest = Readonly<{
  version: "2";
  generator: string;
  initial: Readonly<{ animation: string }>;
  animations: readonly Readonly<{ id: string }>[];
}>;

export type DotLottieArchiveEntryInspection = Readonly<{
  name: string;
  compression: "deflate" | "store";
  compressedBytes: number;
  uncompressedBytes: number;
  crc32: number;
  deterministicTimestamp: boolean;
}>;

export type DotLottieInspection = Readonly<{
  valid: boolean;
  contractVersion: "1.0";
  manifestVersion: string | null;
  generator: string | null;
  initialAnimationId: string | null;
  animationIds: readonly string[];
  archiveBytes: number;
  archiveSha256: string;
  entryCount: number;
  totalCompressedBytes: number;
  totalUncompressedBytes: number;
  entries: readonly DotLottieArchiveEntryInspection[];
  embeddedLottie: LottieInspection | null;
  findings: readonly DotLottieFinding[];
}>;

export type DotLottiePackageOptions = Readonly<{
  animationId?: string;
}>;

export type DotLottieEvidence = Readonly<{
  contractVersion: "1.0";
  generator: Readonly<{
    name: "@evavo/lottie-engine";
    version: "0.4.0";
  }>;
  source: Readonly<{
    mimeType: "video/lottie+json";
    bytes: number;
    sha256: string;
    embeddedBytes: number;
    embeddedSha256: string;
    inspection: LottieInspection;
  }>;
  manifest: DotLottieManifest;
  output: Readonly<{
    mimeType: "application/zip+dotlottie";
    extension: ".lottie";
    bytes: number;
    sha256: string;
    entryCount: number;
    totalCompressedBytes: number;
    totalUncompressedBytes: number;
    entryOrder: readonly ["manifest.json", string];
  }>;
  archive: Readonly<{
    format: "zip";
    compression: "deflate";
    manifestVersion: "2";
    deterministic: true;
    fixedTimestamp: "1980-01-01 00:00:00";
    themes: false;
    stateMachines: false;
    images: false;
    fonts: false;
    audio: false;
  }>;
  compatibility: Readonly<{
    archiveInspection: "passed";
    embeddedLottieInspection: "passed";
    playerRenderValidation: "not-yet-performed";
    browserArchiveLoadValidation: "not-yet-performed";
  }>;
  approval: "review-required";
  warnings: readonly DotLottieFinding[];
}>;

export type DotLottiePackageResult = Readonly<{
  bytes: Uint8Array;
  manifest: DotLottieManifest;
  inspection: DotLottieInspection;
  evidence: DotLottieEvidence;
}>;

type CentralDirectoryEntry = Readonly<{
  name: string;
  flags: number;
  compressionMethod: number;
  modifiedTime: number;
  modifiedDate: number;
  crc32: number;
  compressedBytes: number;
  uncompressedBytes: number;
  localHeaderOffset: number;
  dataOffset: number;
  dataEnd: number;
}>;

class DotLottieArchiveParseError extends Error {
  readonly details: Readonly<Record<string, unknown>>;

  constructor(message: string, details: Readonly<Record<string, unknown>> = {}) {
    super(message);
    this.name = "DotLottieArchiveParseError";
    this.details = details;
  }
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function finding(
  code: string,
  severity: DotLottieFindingSeverity,
  message: string,
  entryName?: string,
): DotLottieFinding {
  return Object.freeze({
    code,
    severity,
    message,
    ...(entryName ? { entryName } : {}),
  });
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function assertKnownKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  path: string,
): void {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw new DotLottieArchiveParseError(
      `${path} contains fields outside the governed dotLottie v2 subset.`,
      { path, unknownKeys: Object.freeze(unknown) },
    );
  }
}

function readUint16(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 2 > bytes.byteLength) {
    throw new DotLottieArchiveParseError("The ZIP archive ended while reading a 16-bit field.", { offset });
  }
  return bytes[offset]! | (bytes[offset + 1]! << 8);
}

function readUint32(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 4 > bytes.byteLength) {
    throw new DotLottieArchiveParseError("The ZIP archive ended while reading a 32-bit field.", { offset });
  }
  return (
    bytes[offset]! |
    (bytes[offset + 1]! << 8) |
    (bytes[offset + 2]! << 16) |
    (bytes[offset + 3]! << 24)
  ) >>> 0;
}

function decodeUtf8(bytes: Uint8Array, label: string): string {
  try {
    return STRICT_UTF8.decode(bytes);
  } catch (error) {
    throw new DotLottieArchiveParseError(`${label} is not valid UTF-8.`, {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
}

function findEndOfCentralDirectory(bytes: Uint8Array): number {
  if (bytes.byteLength < 22) {
    throw new DotLottieArchiveParseError("The dotLottie file is too small to contain a ZIP end record.");
  }
  const earliest = Math.max(0, bytes.byteLength - 22 - 0xffff);
  for (let offset = bytes.byteLength - 22; offset >= earliest; offset -= 1) {
    if (readUint32(bytes, offset) === END_OF_CENTRAL_DIRECTORY_SIGNATURE) return offset;
  }
  throw new DotLottieArchiveParseError("The ZIP end-of-central-directory record is missing.");
}

function safeEntryName(name: string): void {
  if (
    !name ||
    name.includes("\0") ||
    name.includes("\\") ||
    name.startsWith("/") ||
    /^[A-Za-z]:/.test(name) ||
    name.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    throw new DotLottieArchiveParseError("The ZIP contains an unsafe entry path.", { name });
  }
}

function parseCentralDirectory(bytes: Uint8Array): readonly CentralDirectoryEntry[] {
  if (bytes.byteLength > MAX_DOTLOTTIE_ARCHIVE_BYTES) {
    throw new DotLottieArchiveParseError("The dotLottie archive exceeds the configured byte limit.", {
      bytes: bytes.byteLength,
      maxBytes: MAX_DOTLOTTIE_ARCHIVE_BYTES,
    });
  }
  if (readUint32(bytes, 0) !== LOCAL_FILE_HEADER_SIGNATURE) {
    throw new DotLottieArchiveParseError("The dotLottie archive does not begin with a ZIP local-file header.");
  }

  const endOffset = findEndOfCentralDirectory(bytes);
  const diskNumber = readUint16(bytes, endOffset + 4);
  const centralDisk = readUint16(bytes, endOffset + 6);
  const entriesOnDisk = readUint16(bytes, endOffset + 8);
  const entryCount = readUint16(bytes, endOffset + 10);
  const centralBytes = readUint32(bytes, endOffset + 12);
  const centralOffset = readUint32(bytes, endOffset + 16);
  const commentBytes = readUint16(bytes, endOffset + 20);

  if (endOffset + 22 + commentBytes !== bytes.byteLength) {
    throw new DotLottieArchiveParseError("Trailing bytes or a malformed ZIP comment follow the end record.", {
      endOffset,
      commentBytes,
      archiveBytes: bytes.byteLength,
    });
  }
  if (diskNumber !== 0 || centralDisk !== 0 || entriesOnDisk !== entryCount) {
    throw new DotLottieArchiveParseError("Multi-disk ZIP archives are not supported by dotLottie v1 packaging.", {
      diskNumber,
      centralDisk,
      entriesOnDisk,
      entryCount,
    });
  }
  if (
    entryCount === ZIP64_SENTINEL_16 ||
    centralBytes === ZIP64_SENTINEL_32 ||
    centralOffset === ZIP64_SENTINEL_32
  ) {
    throw new DotLottieArchiveParseError("ZIP64 archives are outside the bounded dotLottie v1 package contract.");
  }
  if (entryCount < 1 || entryCount > MAX_DOTLOTTIE_ENTRY_COUNT) {
    throw new DotLottieArchiveParseError("The dotLottie archive has an unsupported entry count.", {
      entryCount,
      maximum: MAX_DOTLOTTIE_ENTRY_COUNT,
    });
  }
  if (centralOffset + centralBytes !== endOffset) {
    throw new DotLottieArchiveParseError("The ZIP central directory does not end at the end record.", {
      centralOffset,
      centralBytes,
      endOffset,
    });
  }

  const entries: CentralDirectoryEntry[] = [];
  const names = new Set<string>();
  let cursor = centralOffset;
  let totalUncompressedBytes = 0;

  for (let index = 0; index < entryCount; index += 1) {
    if (readUint32(bytes, cursor) !== CENTRAL_DIRECTORY_SIGNATURE) {
      throw new DotLottieArchiveParseError("A ZIP central-directory entry is missing its signature.", {
        index,
        cursor,
      });
    }
    const flags = readUint16(bytes, cursor + 8);
    const compressionMethod = readUint16(bytes, cursor + 10);
    const modifiedTime = readUint16(bytes, cursor + 12);
    const modifiedDate = readUint16(bytes, cursor + 14);
    const crc32 = readUint32(bytes, cursor + 16);
    const compressedBytes = readUint32(bytes, cursor + 20);
    const uncompressedBytes = readUint32(bytes, cursor + 24);
    const nameBytes = readUint16(bytes, cursor + 28);
    const extraBytes = readUint16(bytes, cursor + 30);
    const entryCommentBytes = readUint16(bytes, cursor + 32);
    const diskStart = readUint16(bytes, cursor + 34);
    const localHeaderOffset = readUint32(bytes, cursor + 42);
    const entryEnd = cursor + 46 + nameBytes + extraBytes + entryCommentBytes;

    if (entryEnd > centralOffset + centralBytes) {
      throw new DotLottieArchiveParseError("A ZIP central-directory entry exceeds the declared directory size.", {
        index,
      });
    }
    const name = decodeUtf8(bytes.subarray(cursor + 46, cursor + 46 + nameBytes), "A ZIP entry name");
    safeEntryName(name);
    if (names.has(name)) {
      throw new DotLottieArchiveParseError("Duplicate ZIP entry names are not permitted.", { name });
    }
    names.add(name);
    if ((flags & 0x1) !== 0) {
      throw new DotLottieArchiveParseError("Encrypted ZIP entries are not permitted.", { name });
    }
    if (compressionMethod !== 0 && compressionMethod !== 8) {
      throw new DotLottieArchiveParseError("The ZIP uses an unsupported compression method.", {
        name,
        compressionMethod,
      });
    }
    if (extraBytes !== 0 || entryCommentBytes !== 0 || diskStart !== 0) {
      throw new DotLottieArchiveParseError("ZIP entry extras, comments and non-zero disk starts are not supported.", {
        name,
        extraBytes,
        entryCommentBytes,
        diskStart,
      });
    }
    if (localHeaderOffset === ZIP64_SENTINEL_32 || localHeaderOffset + 30 > centralOffset) {
      throw new DotLottieArchiveParseError("A ZIP local-file header offset is invalid.", {
        name,
        localHeaderOffset,
      });
    }
    if (readUint32(bytes, localHeaderOffset) !== LOCAL_FILE_HEADER_SIGNATURE) {
      throw new DotLottieArchiveParseError("A ZIP local-file header is missing its signature.", {
        name,
        localHeaderOffset,
      });
    }
    const localFlags = readUint16(bytes, localHeaderOffset + 6);
    const localCompressionMethod = readUint16(bytes, localHeaderOffset + 8);
    const localNameBytes = readUint16(bytes, localHeaderOffset + 26);
    const localExtraBytes = readUint16(bytes, localHeaderOffset + 28);
    const localName = decodeUtf8(
      bytes.subarray(localHeaderOffset + 30, localHeaderOffset + 30 + localNameBytes),
      "A ZIP local entry name",
    );
    if (
      localFlags !== flags ||
      localCompressionMethod !== compressionMethod ||
      localName !== name ||
      localExtraBytes !== 0
    ) {
      throw new DotLottieArchiveParseError("A ZIP local-file header disagrees with its central-directory entry.", {
        name,
        localName,
        flags,
        localFlags,
        compressionMethod,
        localCompressionMethod,
        localExtraBytes,
      });
    }
    const dataOffset = localHeaderOffset + 30 + localNameBytes + localExtraBytes;
    const dataEnd = dataOffset + compressedBytes;
    if (dataEnd > centralOffset) {
      throw new DotLottieArchiveParseError("A compressed ZIP entry overlaps the central directory.", {
        name,
        dataOffset,
        dataEnd,
        centralOffset,
      });
    }

    totalUncompressedBytes += uncompressedBytes;
    if (uncompressedBytes > MAX_DOTLOTTIE_LOTTIE_BYTES || totalUncompressedBytes > MAX_DOTLOTTIE_TOTAL_UNCOMPRESSED_BYTES) {
      throw new DotLottieArchiveParseError("The ZIP declares uncompressed content beyond the configured limits.", {
        name,
        uncompressedBytes,
        totalUncompressedBytes,
        maximumEntryBytes: MAX_DOTLOTTIE_LOTTIE_BYTES,
        maximumTotalBytes: MAX_DOTLOTTIE_TOTAL_UNCOMPRESSED_BYTES,
      });
    }

    entries.push(Object.freeze({
      name,
      flags,
      compressionMethod,
      modifiedTime,
      modifiedDate,
      crc32,
      compressedBytes,
      uncompressedBytes,
      localHeaderOffset,
      dataOffset,
      dataEnd,
    }));
    cursor = entryEnd;
  }

  if (cursor !== centralOffset + centralBytes) {
    throw new DotLottieArchiveParseError("The ZIP central directory contains undeclared bytes.", {
      cursor,
      expectedEnd: centralOffset + centralBytes,
    });
  }

  const localRanges = [...entries]
    .sort((left, right) => left.localHeaderOffset - right.localHeaderOffset);
  for (let index = 1; index < localRanges.length; index += 1) {
    const previous = localRanges[index - 1]!;
    const current = localRanges[index]!;
    if (current.localHeaderOffset < previous.dataEnd) {
      throw new DotLottieArchiveParseError("ZIP local-file entries overlap one another.", {
        previous: previous.name,
        current: current.name,
      });
    }
  }

  return Object.freeze(entries);
}

function parseManifest(value: Uint8Array): DotLottieManifest {
  if (value.byteLength === 0 || value.byteLength > MAX_DOTLOTTIE_MANIFEST_BYTES) {
    throw new DotLottieArchiveParseError("manifest.json is empty or exceeds its configured byte limit.", {
      bytes: value.byteLength,
      maximum: MAX_DOTLOTTIE_MANIFEST_BYTES,
    });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(decodeUtf8(value, "manifest.json")) as unknown;
  } catch (error) {
    if (error instanceof DotLottieArchiveParseError) throw error;
    throw new DotLottieArchiveParseError("manifest.json is not valid JSON.", {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
  const manifest = record(parsed);
  if (!manifest) throw new DotLottieArchiveParseError("manifest.json must contain an object.");
  assertKnownKeys(manifest, new Set(["version", "generator", "initial", "animations"]), "manifest");
  if (manifest.version !== DOTLOTTIE_MANIFEST_VERSION) {
    throw new DotLottieArchiveParseError("manifest.version must be 2.", { version: manifest.version });
  }
  if (typeof manifest.generator !== "string" || !manifest.generator.trim() || manifest.generator.length > 200) {
    throw new DotLottieArchiveParseError("manifest.generator must contain 1 to 200 characters.");
  }
  const initial = record(manifest.initial);
  if (!initial) throw new DotLottieArchiveParseError("manifest.initial must contain an object.");
  assertKnownKeys(initial, new Set(["animation"]), "manifest.initial");
  if (typeof initial.animation !== "string" || !SAFE_ANIMATION_ID.test(initial.animation)) {
    throw new DotLottieArchiveParseError("manifest.initial.animation is not a portable animation identifier.", {
      animation: initial.animation,
    });
  }
  if (!Array.isArray(manifest.animations) || manifest.animations.length !== 1) {
    throw new DotLottieArchiveParseError("The governed dotLottie v1 subset requires exactly one animation descriptor.", {
      animationCount: Array.isArray(manifest.animations) ? manifest.animations.length : null,
    });
  }
  const descriptor = record(manifest.animations[0]);
  if (!descriptor) throw new DotLottieArchiveParseError("manifest.animations[0] must be an object.");
  assertKnownKeys(descriptor, new Set(["id"]), "manifest.animations[0]");
  if (typeof descriptor.id !== "string" || !SAFE_ANIMATION_ID.test(descriptor.id)) {
    throw new DotLottieArchiveParseError("manifest.animations[0].id is not a portable animation identifier.", {
      id: descriptor.id,
    });
  }
  if (descriptor.id !== initial.animation) {
    throw new DotLottieArchiveParseError("The initial animation does not match the sole animation descriptor.", {
      initialAnimation: initial.animation,
      animationId: descriptor.id,
    });
  }
  return Object.freeze({
    version: DOTLOTTIE_MANIFEST_VERSION,
    generator: manifest.generator.trim(),
    initial: Object.freeze({ animation: initial.animation }),
    animations: Object.freeze([Object.freeze({ id: descriptor.id })]),
  });
}

function invalidInspection(
  bytes: Uint8Array,
  findings: readonly DotLottieFinding[],
  entries: readonly DotLottieArchiveEntryInspection[] = [],
): DotLottieInspection {
  return Object.freeze({
    valid: false,
    contractVersion: DOTLOTTIE_CONTRACT_VERSION,
    manifestVersion: null,
    generator: null,
    initialAnimationId: null,
    animationIds: Object.freeze([]),
    archiveBytes: bytes.byteLength,
    archiveSha256: sha256(bytes),
    entryCount: entries.length,
    totalCompressedBytes: entries.reduce((total, entry) => total + entry.compressedBytes, 0),
    totalUncompressedBytes: entries.reduce((total, entry) => total + entry.uncompressedBytes, 0),
    entries: Object.freeze([...entries]),
    embeddedLottie: null,
    findings: Object.freeze([...findings]),
  });
}

export function inspectDotLottie(bytes: Uint8Array): DotLottieInspection {
  const findings: DotLottieFinding[] = [];
  let centralEntries: readonly CentralDirectoryEntry[];
  try {
    centralEntries = parseCentralDirectory(bytes);
  } catch (error) {
    const details = error instanceof DotLottieArchiveParseError ? error.details : {};
    findings.push(finding(
      "DOTLOTTIE_ARCHIVE_INVALID",
      "error",
      error instanceof Error ? error.message : String(error),
      typeof details.name === "string" ? details.name : undefined,
    ));
    return invalidInspection(bytes, findings);
  }

  const entries: readonly DotLottieArchiveEntryInspection[] = Object.freeze(
    centralEntries.map((entry) => Object.freeze({
      name: entry.name,
      compression: entry.compressionMethod === 8 ? "deflate" as const : "store" as const,
      compressedBytes: entry.compressedBytes,
      uncompressedBytes: entry.uncompressedBytes,
      crc32: entry.crc32,
      deterministicTimestamp: entry.modifiedDate === FIXED_DOS_DATE && entry.modifiedTime === FIXED_DOS_TIME,
    })),
  );

  if (centralEntries.some((entry) => entry.compressionMethod !== 8)) {
    findings.push(finding(
      "DOTLOTTIE_COMPRESSION_INVALID",
      "error",
      "Every governed dotLottie entry must use DEFLATE compression.",
    ));
  }
  if (entries.some((entry) => !entry.deterministicTimestamp)) {
    findings.push(finding(
      "DOTLOTTIE_TIMESTAMP_NONDETERMINISTIC",
      "warning",
      "One or more ZIP entries do not use the deterministic 1980-01-01 00:00:00 timestamp.",
    ));
  }
  if (centralEntries.length !== 2 || !centralEntries.some((entry) => entry.name === "manifest.json")) {
    findings.push(finding(
      "DOTLOTTIE_ENTRY_SET_UNSUPPORTED",
      "error",
      "The governed dotLottie v1 subset requires exactly manifest.json and one a/<id>.json animation entry.",
    ));
  }

  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch (error) {
    findings.push(finding(
      "DOTLOTTIE_DECOMPRESSION_FAILED",
      "error",
      `The dotLottie ZIP could not be decompressed: ${error instanceof Error ? error.message : String(error)}`,
    ));
    return invalidInspection(bytes, findings, entries);
  }

  for (const entry of centralEntries) {
    const content = files[entry.name];
    if (!content || content.byteLength !== entry.uncompressedBytes) {
      findings.push(finding(
        "DOTLOTTIE_ENTRY_SIZE_MISMATCH",
        "error",
        "A decompressed entry does not match its central-directory byte count.",
        entry.name,
      ));
    }
  }

  const manifestBytes = files["manifest.json"];
  if (!manifestBytes) {
    findings.push(finding("DOTLOTTIE_MANIFEST_MISSING", "error", "manifest.json is missing."));
    return invalidInspection(bytes, findings, entries);
  }

  let manifest: DotLottieManifest;
  try {
    manifest = parseManifest(manifestBytes);
  } catch (error) {
    findings.push(finding(
      "DOTLOTTIE_MANIFEST_INVALID",
      "error",
      error instanceof Error ? error.message : String(error),
      "manifest.json",
    ));
    return invalidInspection(bytes, findings, entries);
  }

  const animationId = manifest.initial.animation;
  const animationPath = `a/${animationId}.json`;
  const expectedNames = new Set(["manifest.json", animationPath]);
  for (const name of Object.keys(files)) {
    if (!expectedNames.has(name)) {
      findings.push(finding(
        "DOTLOTTIE_ENTRY_UNSUPPORTED",
        "error",
        "The archive contains an entry outside the governed single-animation subset.",
        name,
      ));
    }
  }
  const animationBytes = files[animationPath];
  if (!animationBytes) {
    findings.push(finding(
      "DOTLOTTIE_ANIMATION_MISSING",
      "error",
      "The initial animation JSON is missing from the a/ directory.",
      animationPath,
    ));
    return Object.freeze({
      ...invalidInspection(bytes, findings, entries),
      manifestVersion: manifest.version,
      generator: manifest.generator,
      initialAnimationId: animationId,
      animationIds: Object.freeze([animationId]),
    });
  }
  if (animationBytes.byteLength > MAX_DOTLOTTIE_LOTTIE_BYTES) {
    findings.push(finding(
      "DOTLOTTIE_ANIMATION_TOO_LARGE",
      "error",
      "The embedded Lottie JSON exceeds the configured byte limit.",
      animationPath,
    ));
  }

  let animationSource = "";
  try {
    animationSource = decodeUtf8(animationBytes, animationPath);
  } catch (error) {
    findings.push(finding(
      "DOTLOTTIE_ANIMATION_UTF8_INVALID",
      "error",
      error instanceof Error ? error.message : String(error),
      animationPath,
    ));
  }
  const embeddedLottie = animationSource ? inspectLottie(animationSource) : null;
  if (embeddedLottie && !embeddedLottie.valid) {
    findings.push(finding(
      "DOTLOTTIE_EMBEDDED_LOTTIE_INVALID",
      "error",
      "The embedded animation fails the governed Lottie structural inspection.",
      animationPath,
    ));
  }
  if (embeddedLottie?.valid) {
    findings.push(finding(
      "DOTLOTTIE_PLAYER_RENDER_VALIDATION_REQUIRED",
      "warning",
      "Archive and embedded Lottie structure pass, but independent player-render validation has not been performed.",
    ));
  }

  return Object.freeze({
    valid: !findings.some((item) => item.severity === "error"),
    contractVersion: DOTLOTTIE_CONTRACT_VERSION,
    manifestVersion: manifest.version,
    generator: manifest.generator,
    initialAnimationId: animationId,
    animationIds: Object.freeze([animationId]),
    archiveBytes: bytes.byteLength,
    archiveSha256: sha256(bytes),
    entryCount: entries.length,
    totalCompressedBytes: entries.reduce((total, entry) => total + entry.compressedBytes, 0),
    totalUncompressedBytes: entries.reduce((total, entry) => total + entry.uncompressedBytes, 0),
    entries,
    embeddedLottie,
    findings: Object.freeze(findings),
  });
}

export function createDotLottiePackage(
  lottieJson: string,
  options: DotLottiePackageOptions = {},
): DotLottiePackageResult {
  const inputBytes = byteLength(lottieJson);
  if (inputBytes < 2 || inputBytes > MAX_DOTLOTTIE_LOTTIE_BYTES) {
    throw new LottieEngineError(
      "DOTLOTTIE_SOURCE_INVALID",
      "Lottie JSON input is empty or exceeds the configured package limit.",
      { inputBytes, maximum: MAX_DOTLOTTIE_LOTTIE_BYTES },
    );
  }

  let document: unknown;
  try {
    document = JSON.parse(lottieJson) as unknown;
  } catch (error) {
    throw new LottieEngineError(
      "DOTLOTTIE_SOURCE_INVALID",
      "Lottie JSON input is not valid JSON.",
      { cause: error instanceof Error ? error.message : String(error) },
    );
  }
  const sourceInspection = inspectLottie(document);
  if (!sourceInspection.valid) {
    throw new LottieEngineError(
      "DOTLOTTIE_SOURCE_INVALID",
      "dotLottie packaging requires Lottie JSON that passes governed structural inspection.",
      { findings: sourceInspection.findings },
    );
  }

  const animationId = options.animationId?.trim() || "main-animation";
  if (!SAFE_ANIMATION_ID.test(animationId)) {
    throw new LottieEngineError(
      "DOTLOTTIE_OPTIONS_INVALID",
      "animationId must contain 1 to 64 ASCII letters, digits, underscores or hyphens and begin with a letter or digit.",
      { animationId },
    );
  }

  const embeddedJson = `${JSON.stringify(document)}\n`;
  const embeddedBytes = strToU8(embeddedJson);
  if (embeddedBytes.byteLength > MAX_DOTLOTTIE_LOTTIE_BYTES) {
    throw new LottieEngineError(
      "DOTLOTTIE_OUTPUT_TOO_LARGE",
      "The canonical embedded Lottie JSON exceeds the configured package limit.",
      { bytes: embeddedBytes.byteLength, maximum: MAX_DOTLOTTIE_LOTTIE_BYTES },
    );
  }

  const manifest: DotLottieManifest = Object.freeze({
    version: DOTLOTTIE_MANIFEST_VERSION,
    generator: "EVAVO Vector Studio 0.4.0",
    initial: Object.freeze({ animation: animationId }),
    animations: Object.freeze([Object.freeze({ id: animationId })]),
  });
  const manifestJson = `${JSON.stringify(manifest, null, 2)}\n`;
  const animationPath = `a/${animationId}.json`;
  const fileOptions = Object.freeze({
    level: 9 as const,
    mtime: FIXED_ZIP_DATE,
    os: 3 as const,
    attrs: 0o644 << 16,
  });

  let archive: Uint8Array;
  try {
    archive = zipSync({
      "manifest.json": [strToU8(manifestJson), fileOptions],
      [animationPath]: [embeddedBytes, fileOptions],
    }, {
      level: 9,
      mtime: FIXED_ZIP_DATE,
    });
  } catch (error) {
    throw new LottieEngineError(
      "DOTLOTTIE_OUTPUT_INVALID",
      "The deterministic dotLottie ZIP could not be created.",
      { cause: error instanceof Error ? error.message : String(error) },
    );
  }
  if (archive.byteLength > MAX_DOTLOTTIE_ARCHIVE_BYTES) {
    throw new LottieEngineError(
      "DOTLOTTIE_OUTPUT_TOO_LARGE",
      "The generated dotLottie archive exceeds the configured byte limit.",
      { bytes: archive.byteLength, maximum: MAX_DOTLOTTIE_ARCHIVE_BYTES },
    );
  }

  const ownedArchive = Uint8Array.from(archive);
  const inspection = inspectDotLottie(ownedArchive);
  if (!inspection.valid || !inspection.embeddedLottie?.valid) {
    throw new LottieEngineError(
      "DOTLOTTIE_OUTPUT_INVALID",
      "The generated dotLottie archive failed its governed package inspection.",
      { findings: inspection.findings },
    );
  }

  const warnings: DotLottieFinding[] = [
    finding(
      "DOTLOTTIE_PLAYER_RENDER_VALIDATION_REQUIRED",
      "warning",
      "The archive and embedded animation are structurally valid, but player-render equivalence remains unverified.",
    ),
    finding(
      "DOTLOTTIE_REDUCED_MOTION_NOT_EMBEDDED",
      "warning",
      "dotLottie packaging does not embed the animated-SVG prefers-reduced-motion fallback; delivery surfaces need pause controls or a static alternative.",
    ),
  ];

  return Object.freeze({
    bytes: ownedArchive,
    manifest,
    inspection,
    evidence: Object.freeze({
      contractVersion: DOTLOTTIE_CONTRACT_VERSION,
      generator: Object.freeze({ name: "@evavo/lottie-engine", version: "0.4.0" }),
      source: Object.freeze({
        mimeType: "video/lottie+json",
        bytes: inputBytes,
        sha256: sha256(lottieJson),
        embeddedBytes: embeddedBytes.byteLength,
        embeddedSha256: sha256(embeddedBytes),
        inspection: sourceInspection,
      }),
      manifest,
      output: Object.freeze({
        mimeType: DOTLOTTIE_MIME_TYPE,
        extension: DOTLOTTIE_EXTENSION,
        bytes: ownedArchive.byteLength,
        sha256: sha256(ownedArchive),
        entryCount: inspection.entryCount,
        totalCompressedBytes: inspection.totalCompressedBytes,
        totalUncompressedBytes: inspection.totalUncompressedBytes,
        entryOrder: Object.freeze(["manifest.json", animationPath] as const),
      }),
      archive: Object.freeze({
        format: "zip",
        compression: "deflate",
        manifestVersion: DOTLOTTIE_MANIFEST_VERSION,
        deterministic: true,
        fixedTimestamp: "1980-01-01 00:00:00",
        themes: false,
        stateMachines: false,
        images: false,
        fonts: false,
        audio: false,
      }),
      compatibility: Object.freeze({
        archiveInspection: "passed",
        embeddedLottieInspection: "passed",
        playerRenderValidation: "not-yet-performed",
        browserArchiveLoadValidation: "not-yet-performed",
      }),
      approval: "review-required",
      warnings: Object.freeze(warnings),
    }),
  });
}
