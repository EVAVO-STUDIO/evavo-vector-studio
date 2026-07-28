#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import {
  DOTLOTTIE_CONTRACT_VERSION,
  DOTLOTTIE_EXTENSION,
  DOTLOTTIE_MANIFEST_VERSION,
  DOTLOTTIE_MIME_TYPE,
  LottieEngineError,
  MAX_DOTLOTTIE_ARCHIVE_BYTES,
  MAX_DOTLOTTIE_ENTRY_COUNT,
  MAX_DOTLOTTIE_LOTTIE_BYTES,
  MAX_DOTLOTTIE_MANIFEST_BYTES,
  MAX_DOTLOTTIE_TOTAL_UNCOMPRESSED_BYTES,
  createDotLottiePackage,
  inspectDotLottie,
} from "@evavo/lottie-engine";
import {
  CliOutputTransactionError,
  commitNewOutputFiles,
  type CliOutputReceipt,
} from "./output-transaction.js";

const VERSION = "0.4.0";

type LabelledPath = Readonly<{ label: string; path: string }>;

function print(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function fail(value: unknown, code = 1): never {
  process.stderr.write(`${typeof value === "string" ? value : JSON.stringify(value, null, 2)}\n`);
  process.exit(code);
}

function usage(): string {
  return [
    "EVAVO dotLottie CLI",
    "",
    "Usage:",
    "  evavo-dotlottie package <input.lottie.json> [--out output.lottie]",
    "                     [--animation-id main-animation] [--evidence-out output.evidence.json]",
    "  evavo-dotlottie inspect <input.lottie>",
    "  evavo-dotlottie capabilities",
    "  evavo-dotlottie --version",
    "",
    "Packaging is deterministic, DEFLATE-compressed and new-file-only.",
  ].join("\n");
}

function option(args: readonly string[], name: string): string | null {
  const index = args.indexOf(name);
  if (index < 0) return null;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    fail({ error: "VECTOR_CLI_OPTION_VALUE_REQUIRED", option: name }, 2);
  }
  return value;
}

function pathKey(value: string): string {
  const resolved = resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function assertDistinctPaths(entries: readonly LabelledPath[]): void {
  const seen = new Map<string, LabelledPath>();
  for (const entry of entries) {
    const key = pathKey(entry.path);
    const previous = seen.get(key);
    if (previous) {
      fail({
        error: "VECTOR_OUTPUT_PATH_COLLISION",
        first: previous,
        second: entry,
      }, 2);
    }
    seen.set(key, entry);
  }
}

function assertExtension(value: string, extension: string, field: string): void {
  if (extname(value).toLowerCase() !== extension) {
    fail({
      error: "VECTOR_OUTPUT_EXTENSION_INVALID",
      field,
      value,
      expectedExtension: extension,
    }, 2);
  }
}

function receiptFor(
  receipts: readonly CliOutputReceipt[],
  expectedPath: string,
): CliOutputReceipt {
  const expected = pathKey(expectedPath);
  const receipt = receipts.find((item) => pathKey(item.path) === expected);
  if (!receipt) {
    fail({
      error: "VECTOR_OUTPUT_RECEIPT_MISSING",
      expectedPath,
      receiptPaths: receipts.map((item) => item.path),
    }, 2);
  }
  return receipt;
}

function defaultOutputPath(inputPath: string): string {
  const withoutKnownExtension = inputPath
    .replace(/\.lottie\.json$/i, "")
    .replace(/\.json$/i, "");
  return `${withoutKnownExtension}.lottie`;
}

function capabilities() {
  return {
    name: "evavo-dotlottie",
    version: VERSION,
    dotLottieContractVersion: DOTLOTTIE_CONTRACT_VERSION,
    manifestVersion: DOTLOTTIE_MANIFEST_VERSION,
    mimeType: DOTLOTTIE_MIME_TYPE,
    extension: DOTLOTTIE_EXTENSION,
    commands: ["package", "inspect", "capabilities"],
    packaging: {
      deterministic: true,
      format: "zip",
      compression: "deflate",
      fixedTimestamp: "1980-01-01 00:00:00",
      outputMode: "new-files-only",
      atomicEvidenceOutput: true,
      entryLayout: ["manifest.json", "a/<animation-id>.json"],
    },
    limits: {
      maxLottieJsonBytes: MAX_DOTLOTTIE_LOTTIE_BYTES,
      maxArchiveBytes: MAX_DOTLOTTIE_ARCHIVE_BYTES,
      maxTotalUncompressedBytes: MAX_DOTLOTTIE_TOTAL_UNCOMPRESSED_BYTES,
      maxManifestBytes: MAX_DOTLOTTIE_MANIFEST_BYTES,
      maxEntryCount: MAX_DOTLOTTIE_ENTRY_COUNT,
    },
    compatibility: {
      archiveInspection: true,
      embeddedLottieInspection: true,
      playerRenderValidation: false,
      browserArchiveLoadValidation: false,
    },
    approval: "human-review-required",
  };
}

async function packageFile(input: string, args: readonly string[]): Promise<void> {
  const inputPath = resolve(input);
  const outputPath = resolve(option(args, "--out") ?? defaultOutputPath(inputPath));
  const rawEvidencePath = option(args, "--evidence-out");
  const evidenceOutputPath = rawEvidencePath ? resolve(rawEvidencePath) : null;
  const animationId = option(args, "--animation-id") ?? undefined;

  assertExtension(inputPath, ".json", "input");
  assertExtension(outputPath, ".lottie", "--out");
  if (evidenceOutputPath) assertExtension(evidenceOutputPath, ".json", "--evidence-out");
  assertDistinctPaths([
    { label: "lottie-json-input", path: inputPath },
    { label: "dotlottie-output", path: outputPath },
    ...(evidenceOutputPath
      ? [{ label: "dotlottie-evidence-output", path: evidenceOutputPath }]
      : []),
  ]);

  const source = await readFile(inputPath, "utf8");
  const result = createDotLottiePackage(source, { animationId });
  const evidenceDocument = Object.freeze({
    command: "dotlottie:package",
    contractVersion: result.evidence.contractVersion,
    inputPath,
    outputPath,
    animationId: result.manifest.initial.animation,
    inspection: result.inspection,
    evidence: result.evidence,
  });
  const receipts = await commitNewOutputFiles([
    {
      path: outputPath,
      data: result.bytes,
      mimeType: DOTLOTTIE_MIME_TYPE,
    },
    ...(evidenceOutputPath
      ? [{
          path: evidenceOutputPath,
          data: `${JSON.stringify(evidenceDocument, null, 2)}\n`,
          mimeType: "application/json",
        }]
      : []),
  ]);

  print({
    command: "dotlottie:package",
    written: true,
    inputPath,
    outputs: {
      dotLottie: receiptFor(receipts, outputPath),
      evidence: evidenceOutputPath ? receiptFor(receipts, evidenceOutputPath) : null,
    },
    manifest: result.manifest,
    inspection: result.inspection,
    evidence: result.evidence,
  });
}

async function inspectFile(input: string): Promise<void> {
  const inputPath = resolve(input);
  assertExtension(inputPath, ".lottie", "input");
  const bytes = new Uint8Array(await readFile(inputPath));
  const inspection = inspectDotLottie(bytes);
  print({
    command: "dotlottie:inspect",
    inputPath,
    mimeType: DOTLOTTIE_MIME_TYPE,
    ...inspection,
    approval: inspection.valid
      ? "human-review-required"
      : "structural-repair-required",
  });
  if (!inspection.valid) process.exitCode = 2;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];
  if (!command || command === "help" || command === "--help") {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  if (command === "version" || command === "--version") {
    process.stdout.write(`${VERSION}\n`);
    return;
  }
  if (command === "capabilities" || command === "manifest") {
    print(capabilities());
    return;
  }
  const input = args[1];
  if (!input) fail(`Missing input path.\n\n${usage()}`, 2);
  const commandArgs = args.slice(2);
  if (command === "package" || command === "create") {
    return packageFile(input, commandArgs);
  }
  if (command === "inspect" || command === "validate") {
    return inspectFile(input);
  }
  fail(`Unknown command: ${command}\n\n${usage()}`, 2);
}

main().catch((error: unknown) => {
  if (error instanceof LottieEngineError) {
    fail({ error: error.code, message: error.message, details: error.details }, 2);
  }
  if (error instanceof CliOutputTransactionError) {
    fail({ error: error.code, message: error.message, details: error.details }, 2);
  }
  fail({
    error: "DOTLOTTIE_CLI_FAILED",
    message: error instanceof Error ? error.message : String(error),
  });
});
