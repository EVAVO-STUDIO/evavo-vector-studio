#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import {
  SVG_PRINT_PREFLIGHT_CONTRACT_VERSION,
  SvgPrintPreflightError,
  preflightSvgForPrint,
  type SvgPrintPreflightOptions,
  type SvgPrintProfile,
} from "@evavo/vector-core";

const VERSION = "0.4.0";
const PROFILES = new Set<SvgPrintProfile>([
  "commercial",
  "large-format",
  "cut-vinyl",
  "screen-print",
]);
const VALUE_OPTIONS = new Set([
  "--profile",
  "--trim-width-mm",
  "--trim-height-mm",
  "--bleed-mm",
  "--dimension-tolerance-mm",
  "--minimum-stroke-pt",
  "--maximum-process-colours",
]);
const FLAG_OPTIONS = new Set([
  "--allow-text",
  "--allow-embedded-raster",
  "--allow-transparency",
]);

type JsonRecord = Readonly<Record<string, unknown>>;

function print(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function fail(value: JsonRecord, code = 2): never {
  process.stderr.write(`${JSON.stringify(value, null, 2)}\n`);
  process.exit(code);
}

function usage(): string {
  return [
    "EVAVO Vector Studio print preflight",
    "",
    "Usage:",
    "  evavo-vector-print preflight <input.svg>",
    "    [--profile commercial|large-format|cut-vinyl|screen-print]",
    "    [--trim-width-mm number --trim-height-mm number --bleed-mm number]",
    "    [--dimension-tolerance-mm number] [--minimum-stroke-pt number]",
    "    [--maximum-process-colours number]",
    "    [--allow-text] [--allow-embedded-raster] [--allow-transparency]",
    "  evavo-vector-print capabilities",
    "  evavo-vector-print --version",
    "",
    "Preflight is deterministic, read-only and never represents production approval.",
  ].join("\n");
}

function option(args: readonly string[], name: string): string | null {
  const index = args.indexOf(name);
  if (index < 0) return null;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    fail({ error: "VECTOR_PRINT_OPTION_VALUE_REQUIRED", option: name });
  }
  return value;
}

function numberOption(args: readonly string[], name: string): number | undefined {
  const raw = option(args, name);
  if (raw === null) return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    fail({ error: "VECTOR_PRINT_OPTION_INVALID", option: name, value: raw });
  }
  return value;
}

function validateOptionShape(args: readonly string[]): void {
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (!argument.startsWith("--")) continue;
    if (FLAG_OPTIONS.has(argument)) continue;
    if (VALUE_OPTIONS.has(argument)) {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) {
        fail({ error: "VECTOR_PRINT_OPTION_VALUE_REQUIRED", option: argument });
      }
      index += 1;
      continue;
    }
    fail({ error: "VECTOR_PRINT_OPTION_UNKNOWN", option: argument });
  }
}

function preflightOptions(args: readonly string[]): SvgPrintPreflightOptions {
  validateOptionShape(args);
  const rawProfile = option(args, "--profile") ?? "commercial";
  if (!PROFILES.has(rawProfile as SvgPrintProfile)) {
    fail({
      error: "VECTOR_PRINT_OPTION_INVALID",
      option: "--profile",
      value: rawProfile,
      allowed: [...PROFILES],
    });
  }
  return Object.freeze({
    profile: rawProfile as SvgPrintProfile,
    trimWidthMm: numberOption(args, "--trim-width-mm"),
    trimHeightMm: numberOption(args, "--trim-height-mm"),
    bleedMm: numberOption(args, "--bleed-mm"),
    dimensionToleranceMm: numberOption(args, "--dimension-tolerance-mm"),
    minimumStrokePt: numberOption(args, "--minimum-stroke-pt"),
    maximumProcessColours: numberOption(args, "--maximum-process-colours"),
    allowText: args.includes("--allow-text"),
    allowEmbeddedRaster: args.includes("--allow-embedded-raster"),
    allowTransparency: args.includes("--allow-transparency"),
  });
}

function capabilities(): JsonRecord {
  return Object.freeze({
    command: "capabilities",
    version: VERSION,
    contractVersion: SVG_PRINT_PREFLIGHT_CONTRACT_VERSION,
    deterministic: true,
    readOnly: true,
    profiles: Object.freeze({
      commercial: "physical-size, trim, bleed, text, raster, transparency, colour and line-weight review",
      "large-format": "large-canvas print review with explicit scale and raster-resolution warnings",
      "cut-vinyl": "direct path geometry with complex paint, live text and fine-line rejection",
      "screen-print": "bounded process-colour, direct geometry and complex-paint rejection",
    }),
    options: Object.freeze({
      trimAndBleed: true,
      dimensionTolerance: true,
      minimumStroke: true,
      maximumProcessColours: true,
      explicitTextOverride: true,
      explicitRasterOverride: true,
      explicitTransparencyOverride: true,
    }),
    checks: Object.freeze([
      "physical-dimensions",
      "viewbox-scale",
      "aspect-ratio",
      "trim-and-bleed",
      "live-text",
      "embedded-raster",
      "raster-resolution-unverified",
      "gradients",
      "filters",
      "transparency",
      "blend-modes",
      "patterns",
      "masks",
      "clip-paths",
      "contextual-paint",
      "process-colour-count",
      "minimum-line-weight",
      "transformed-strokes",
      "colour-space-review",
    ]),
    approval: "review-required",
  });
}

async function runPreflight(input: string, args: readonly string[]): Promise<void> {
  const sourcePath = resolve(input);
  if (extname(sourcePath).toLowerCase() !== ".svg") {
    fail({
      error: "VECTOR_PRINT_INPUT_EXTENSION_INVALID",
      sourcePath,
      expectedExtension: ".svg",
    });
  }
  const source = await readFile(sourcePath, "utf8");
  const result = preflightSvgForPrint(source, preflightOptions(args));
  print({
    command: "print:preflight",
    sourcePath,
    ...result,
  });
  if (!result.passed) process.exitCode = 2;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];
  if (command === "--version" || command === "-v") {
    print({ name: "evavo-vector-print", version: VERSION });
    return;
  }
  if (command === "capabilities") {
    print(capabilities());
    return;
  }
  if (command === "preflight") {
    const input = args[1];
    if (!input || input.startsWith("--")) {
      fail({ error: "VECTOR_PRINT_INPUT_REQUIRED", usage: usage() });
    }
    await runPreflight(input, args.slice(2));
    return;
  }
  fail({ error: "VECTOR_PRINT_COMMAND_INVALID", command: command ?? null, usage: usage() });
}

main().catch((error) => {
  if (error instanceof SvgPrintPreflightError) {
    fail({ error: error.code, message: error.message, details: error.details });
  }
  fail({
    error: "VECTOR_PRINT_FAILED",
    message: error instanceof Error ? error.message : String(error),
  });
});
