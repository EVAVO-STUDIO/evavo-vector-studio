#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, extname, resolve } from "node:path";
import { inspectSvg, optimiseSvg } from "@evavo/vector-core";
import {
  DEFAULT_DIFFERENCE_MAX_DIMENSION,
  DEFAULT_MAX_INPUT_BYTES,
  DEFAULT_MAX_PIXELS,
  MAX_DIFFERENCE_DIMENSION,
  RASTER_INPUT_POLICY,
  RasterEngineError,
  inspectRaster,
  traceRaster,
  type RasterCandidateMode,
  type RasterTraceOptions,
  type RasterTraceProfileSelection,
} from "@evavo/raster-engine";

const VERSION = "0.4.0";
const TRACE_PROFILES = new Set<RasterTraceProfileSelection>(["auto", "logo", "icon", "line-art", "illustration", "photo"]);
const CANDIDATE_MODES = new Set<RasterCandidateMode>(["adaptive", "single"]);

type JsonRecord = Record<string, unknown>;

function print(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function fail(value: unknown, code = 1): never {
  process.stderr.write(`${typeof value === "string" ? value : JSON.stringify(value, null, 2)}\n`);
  process.exit(code);
}

function usage(): string {
  return [
    "EVAVO Vector Studio CLI",
    "",
    "Usage:",
    "  evavo-vector inspect <input.svg>",
    "  evavo-vector optimise <input.svg> [--out output.svg]",
    "  evavo-vector raster:inspect <input.png>",
    "  evavo-vector trace <input.png> [--out output.svg] [--profile auto|logo|icon|line-art|illustration|photo]",
    "                     [--candidate-mode adaptive|single] [--max-colours 1..256]",
    "                     [--preserve-palette|--simplify-palette] [--no-optimise]",
    "                     [--diff-out output.diff.png] [--difference-max-dimension 32..1024]",
    "                     [--title \"Accessible title\"]",
    "  evavo-vector input-policy",
    "  evavo-vector manifest",
    "  evavo-vector --version",
    "",
    "Operational results are JSON so people and agents can consume them safely.",
  ].join("\n");
}

function has(args: readonly string[], name: string): boolean {
  return args.includes(name);
}

function option(args: readonly string[], name: string): string | null {
  const index = args.indexOf(name);
  if (index < 0) return null;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    fail({ error: "VECTOR_CLI_OPTION_VALUE_REQUIRED", option: name });
  }
  return value;
}

function parseIntegerOption(args: readonly string[], name: string): number | undefined {
  const raw = option(args, name);
  if (raw === null) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value)) fail({ error: "VECTOR_CLI_OPTION_INVALID", option: name, value: raw });
  return value;
}

function samePath(left: string, right: string): boolean {
  return process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right;
}

function traceOptions(sourcePath: string, args: readonly string[]): RasterTraceOptions {
  const rawProfile = option(args, "--profile") ?? "auto";
  if (!TRACE_PROFILES.has(rawProfile as RasterTraceProfileSelection)) {
    fail({ error: "VECTOR_CLI_OPTION_INVALID", option: "--profile", value: rawProfile, allowed: [...TRACE_PROFILES] });
  }
  const rawCandidateMode = option(args, "--candidate-mode") ?? "adaptive";
  if (!CANDIDATE_MODES.has(rawCandidateMode as RasterCandidateMode)) {
    fail({ error: "VECTOR_CLI_OPTION_INVALID", option: "--candidate-mode", value: rawCandidateMode, allowed: [...CANDIDATE_MODES] });
  }
  if (has(args, "--preserve-palette") && has(args, "--simplify-palette")) {
    fail({ error: "VECTOR_CLI_OPTION_CONFLICT", options: ["--preserve-palette", "--simplify-palette"] });
  }

  const differenceRequested = has(args, "--diff-out");
  const differenceOutput = option(args, "--diff-out");
  if (differenceRequested && differenceOutput === null) {
    fail({ error: "VECTOR_CLI_OPTION_VALUE_REQUIRED", option: "--diff-out" });
  }
  const differenceMaxDimension = parseIntegerOption(args, "--difference-max-dimension");
  if (differenceMaxDimension !== undefined && !differenceRequested) {
    fail({
      error: "VECTOR_CLI_OPTION_CONFLICT",
      option: "--difference-max-dimension",
      requires: "--diff-out",
    });
  }
  if (
    differenceMaxDimension !== undefined &&
    (differenceMaxDimension < 32 || differenceMaxDimension > MAX_DIFFERENCE_DIMENSION)
  ) {
    fail({
      error: "VECTOR_CLI_OPTION_INVALID",
      option: "--difference-max-dimension",
      value: differenceMaxDimension,
      range: [32, MAX_DIFFERENCE_DIMENSION],
    });
  }

  const maxColours = parseIntegerOption(args, "--max-colours");
  return {
    sourceName: basename(sourcePath),
    profile: rawProfile as RasterTraceProfileSelection,
    candidateMode: rawCandidateMode as RasterCandidateMode,
    preservePalette: !has(args, "--simplify-palette"),
    maxColours,
    optimise: !has(args, "--no-optimise"),
    title: option(args, "--title") ?? undefined,
    includeDifferenceArtifact: differenceRequested,
    differenceMaxDimension,
  };
}

function defaultTraceOutput(sourcePath: string): string {
  const extension = extname(sourcePath);
  const stem = extension ? sourcePath.slice(0, -extension.length) : sourcePath;
  return `${stem}.vector.svg`;
}

async function inspectSvgFile(input: string): Promise<void> {
  const sourcePath = resolve(input);
  const source = await readFile(sourcePath, "utf8");
  const inspection = inspectSvg(source);
  print({ command: "inspect", sourcePath, ...inspection });
  if (!inspection.valid) process.exitCode = 2;
}

async function optimiseSvgFile(input: string, args: readonly string[]): Promise<void> {
  const sourcePath = resolve(input);
  const outputPath = resolve(option(args, "--out") ?? sourcePath.replace(/\.svg$/i, ".optimised.svg"));
  if (samePath(outputPath, sourcePath)) fail({ error: "VECTOR_SOURCE_OVERWRITE_REJECTED", sourcePath }, 2);
  const source = await readFile(sourcePath, "utf8");
  const result = optimiseSvg(source);
  if (!result.inspection.valid) {
    print({ command: "optimise", written: false, sourcePath, outputPath, ...result });
    process.exitCode = 2;
    return;
  }
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${result.svg}\n`, "utf8");
  print({ command: "optimise", written: true, sourcePath, outputPath, beforeBytes: result.beforeBytes, afterBytes: result.afterBytes, bytesSaved: result.bytesSaved, inspection: result.inspection });
}

async function inspectRasterFile(input: string): Promise<void> {
  const sourcePath = resolve(input);
  const source = await readFile(sourcePath);
  const analysis = await inspectRaster(source);
  print({ command: "raster:inspect", sourcePath, policy: RASTER_INPUT_POLICY.mode, analysis });
}

async function traceRasterFile(input: string, args: readonly string[]): Promise<void> {
  const sourcePath = resolve(input);
  const outputPath = resolve(option(args, "--out") ?? defaultTraceOutput(sourcePath));
  const rawDifferencePath = option(args, "--diff-out");
  const differenceOutputPath = rawDifferencePath ? resolve(rawDifferencePath) : null;

  if (samePath(outputPath, sourcePath)) fail({ error: "VECTOR_SOURCE_OVERWRITE_REJECTED", sourcePath }, 2);
  if (differenceOutputPath && samePath(differenceOutputPath, sourcePath)) {
    fail({ error: "VECTOR_SOURCE_OVERWRITE_REJECTED", sourcePath, differenceOutputPath }, 2);
  }
  if (differenceOutputPath && samePath(differenceOutputPath, outputPath)) {
    fail({ error: "VECTOR_OUTPUT_PATH_COLLISION", outputPath, differenceOutputPath }, 2);
  }

  const source = await readFile(sourcePath);
  const result = await traceRaster(source, traceOptions(sourcePath, args));
  const differencePng = result.artifacts.differencePng;
  if (differenceOutputPath && !differencePng) {
    fail({ error: "VECTOR_DIFFERENCE_ARTIFACT_MISSING", differenceOutputPath }, 2);
  }
  if (!differenceOutputPath && differencePng) {
    fail({ error: "VECTOR_DIFFERENCE_OUTPUT_PATH_MISSING" }, 2);
  }

  await mkdir(dirname(outputPath), { recursive: true });
  if (differenceOutputPath) await mkdir(dirname(differenceOutputPath), { recursive: true });
  const writes: Promise<void>[] = [writeFile(outputPath, `${result.svg}\n`, "utf8")];
  if (differenceOutputPath && differencePng) writes.push(writeFile(differenceOutputPath, differencePng));
  await Promise.all(writes);

  print({
    command: "trace",
    written: true,
    sourcePath,
    outputPath,
    differenceOutputPath,
    inputPolicy: RASTER_INPUT_POLICY.mode,
    approval: result.evidence.qualityGates.productionApproval,
    renderComparison: result.evidence.qualityGates.renderComparison,
    selectedCandidate: result.evidence.selection.selectedCandidateId,
    candidateCount: result.evidence.selection.attemptedCandidateCount,
    inspection: result.inspection,
    evidence: result.evidence,
  });
}

function inputPolicy(): JsonRecord {
  return {
    command: "input-policy",
    contractVersion: "1.4",
    policy: RASTER_INPUT_POLICY,
    applicationLimits: {
      maxInputBytes: DEFAULT_MAX_INPUT_BYTES,
      maxDecodedPixels: DEFAULT_MAX_PIXELS,
    },
    rejectionCode: "RASTER_MULTI_IMAGE_UNSUPPORTED",
  };
}

function manifest(): JsonRecord {
  return {
    name: "evavo-vector",
    version: VERSION,
    contractVersion: "1.4",
    discoveryCommands: ["manifest", "input-policy"],
    deterministicCommands: ["inspect", "optimise", "raster:inspect"],
    boundedCommands: ["trace"],
    commands: {
      inspect: { input: "path to SVG", output: "JSON safety, geometry, topology and structure inspection" },
      optimise: { input: "path to SVG", options: { "--out": "output path" }, output: "optimised SVG plus JSON evidence" },
      "raster:inspect": { input: "path to one supported static raster", output: "JSON source analysis and profile recommendation" },
      trace: {
        input: "path to one supported static raster",
        options: {
          "--candidate-mode": ["adaptive", "single"],
          "--diff-out": "optional visual difference PNG path",
          "--difference-max-dimension": { default: DEFAULT_DIFFERENCE_MAX_DIMENSION, range: [32, MAX_DIFFERENCE_DIMENSION] },
        },
        output: "selected SVG plus source, candidate, topology, geometry, render and optional difference artefact evidence",
        approvalState: "human-review-required",
      },
      "input-policy": { input: "none", output: "JSON accepted and pre-decode rejected raster container classes" },
    },
    inputPolicy: RASTER_INPUT_POLICY,
    safety: {
      scriptsRejected: true,
      foreignObjectRejected: true,
      externalReferencesRejected: true,
      duplicateIdsRejected: true,
      unresolvedLocalReferencesRejected: true,
      sourceOverwrittenByDefault: false,
      outputPathCollisionsRejected: true,
      maxInputBytes: DEFAULT_MAX_INPUT_BYTES,
      maxDecodedPixels: DEFAULT_MAX_PIXELS,
      rasterTracingAvailable: true,
      renderComparisonAvailable: true,
      renderComparisonMaximumDimensions: [64, 256, 1024],
      differenceArtifactAvailable: true,
      differenceArtifactMaximumDimension: MAX_DIFFERENCE_DIMENSION,
      adaptiveCandidateMaximums: { threeCandidatesThroughPixels: 4000000, twoCandidatesThroughPixels: 12000000, otherwise: 1 },
      productionAutoApprovalAvailable: false,
    },
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];
  if (!command || command === "--help" || command === "help") {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  if (command === "--version" || command === "version") {
    process.stdout.write(`${VERSION}\n`);
    return;
  }
  if (command === "manifest") {
    print(manifest());
    return;
  }
  if (command === "input-policy" || command === "raster:policy") {
    print(inputPolicy());
    return;
  }
  const input = args[1];
  if (!input) fail(`Missing input path.\n\n${usage()}`);
  const commandArgs = args.slice(2);
  if (command === "inspect") return inspectSvgFile(input);
  if (command === "optimise") return optimiseSvgFile(input, commandArgs);
  if (command === "raster:inspect" || command === "analyse") return inspectRasterFile(input);
  if (command === "trace") return traceRasterFile(input, commandArgs);
  fail(`Unknown command: ${command}\n\n${usage()}`);
}

main().catch((error: unknown) => {
  if (error instanceof RasterEngineError) {
    fail({ error: error.code, message: error.message, status: error.status, details: error.details }, 2);
  }
  const message = error instanceof Error ? error.message : String(error);
  fail({ error: "VECTOR_CLI_FAILED", message });
});
