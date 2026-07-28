#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, extname, resolve } from "node:path";
import { inspectSvg, optimiseSvg } from "@evavo/vector-core";
import {
  RasterEngineError,
  inspectRaster,
  traceRaster,
  type RasterTraceOptions,
  type RasterTraceProfileSelection,
} from "@evavo/raster-engine";

const VERSION = "0.2.0";
const TRACE_PROFILES = new Set<RasterTraceProfileSelection>(["auto", "logo", "icon", "line-art", "illustration", "photo"]);

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
    "                     [--max-colours 1..256] [--preserve-palette|--simplify-palette]",
    "                     [--no-optimise] [--title \"Accessible title\"]",
    "  evavo-vector manifest",
    "  evavo-vector --version",
    "",
    "Operational results are JSON so people and agents can consume them safely.",
  ].join("\n");
}

function option(args: readonly string[], name: string): string | null {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] ?? null : null;
}

function has(args: readonly string[], name: string): boolean {
  return args.includes(name);
}

function parseIntegerOption(args: readonly string[], name: string): number | undefined {
  const raw = option(args, name);
  if (raw === null) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value)) fail({ error: "VECTOR_CLI_OPTION_INVALID", option: name, value: raw });
  return value;
}

function traceOptions(sourcePath: string, args: readonly string[]): RasterTraceOptions {
  const rawProfile = option(args, "--profile") ?? "auto";
  if (!TRACE_PROFILES.has(rawProfile as RasterTraceProfileSelection)) {
    fail({ error: "VECTOR_CLI_OPTION_INVALID", option: "--profile", value: rawProfile, allowed: [...TRACE_PROFILES] });
  }
  if (has(args, "--preserve-palette") && has(args, "--simplify-palette")) {
    fail({ error: "VECTOR_CLI_OPTION_CONFLICT", options: ["--preserve-palette", "--simplify-palette"] });
  }
  const maxColours = parseIntegerOption(args, "--max-colours");
  return {
    sourceName: basename(sourcePath),
    profile: rawProfile as RasterTraceProfileSelection,
    preservePalette: !has(args, "--simplify-palette"),
    maxColours,
    optimise: !has(args, "--no-optimise"),
    title: option(args, "--title") ?? undefined,
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
  if (outputPath === sourcePath) fail({ error: "VECTOR_SOURCE_OVERWRITE_REJECTED", sourcePath }, 2);
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
  print({ command: "raster:inspect", sourcePath, analysis });
}

async function traceRasterFile(input: string, args: readonly string[]): Promise<void> {
  const sourcePath = resolve(input);
  const outputPath = resolve(option(args, "--out") ?? defaultTraceOutput(sourcePath));
  if (outputPath === sourcePath) fail({ error: "VECTOR_SOURCE_OVERWRITE_REJECTED", sourcePath }, 2);
  const source = await readFile(sourcePath);
  const result = await traceRaster(source, traceOptions(sourcePath, args));
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${result.svg}\n`, "utf8");
  print({
    command: "trace",
    written: true,
    sourcePath,
    outputPath,
    approval: result.evidence.qualityGates.productionApproval,
    renderComparison: result.evidence.qualityGates.renderComparison,
    inspection: result.inspection,
    evidence: result.evidence,
  });
}

function manifest(): JsonRecord {
  return {
    name: "evavo-vector",
    version: VERSION,
    contractVersion: "1.2",
    deterministicCommands: ["inspect", "optimise", "raster:inspect"],
    boundedCommands: ["trace"],
    commands: {
      inspect: { input: "path to SVG", output: "JSON safety and structure inspection" },
      optimise: { input: "path to SVG", options: { "--out": "output path" }, output: "optimised SVG plus JSON evidence" },
      "raster:inspect": { input: "path to PNG, JPEG, WebP, GIF, BMP or classic TIFF", output: "JSON source analysis and profile recommendation" },
      trace: {
        input: "path to supported raster",
        output: "SVG file plus source, geometry and alpha-aware multi-scale render evidence",
        approvalState: "human-review-required",
      },
    },
    safety: {
      scriptsRejected: true,
      foreignObjectRejected: true,
      sourceOverwrittenByDefault: false,
      maxInputBytes: 26214400,
      maxDecodedPixels: 40000000,
      rasterTracingAvailable: true,
      renderComparisonAvailable: true,
      renderComparisonMaximumDimensions: [64, 256, 1024],
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
