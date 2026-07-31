#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import {
  DEFAULT_LOTTIE_FRAME_RATE,
  DEFAULT_LOTTIE_PRECISION,
  LottieEngineError,
  MAX_LOTTIE_FRAME_RATE,
  MAX_LOTTIE_PRECISION,
  MIN_LOTTIE_FRAME_RATE,
  createLottieFromSvgMotion,
  inspectLottie,
  type LottieExportOptions,
} from "@evavo/lottie-engine";
import {
  MotionEngineError,
  createAnimatedSvg,
  inspectAnimatedSvg,
  validateAnimatedSvgMotionSpec,
} from "@evavo/motion-engine";
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
  type RasterDeliveryProfile,
  type RasterTraceOptions,
  type RasterTraceProfileSelection,
} from "@evavo/raster-engine";
import {
  CliOutputTransactionError,
  commitNewOutputFiles,
  type CliOutputReceipt,
} from "./output-transaction.js";

const VERSION = "0.4.0";
const TRACE_PROFILES = new Set<RasterTraceProfileSelection>(["auto", "logo", "icon", "line-art", "illustration", "photo"]);
const CANDIDATE_MODES = new Set<RasterCandidateMode>(["adaptive", "single"]);
const DELIVERY_PROFILES = new Set<RasterDeliveryProfile>(["editable", "web", "motion", "print"]);
const STABLE_ID_PREFIX = /^[A-Za-z_][A-Za-z0-9_.-]{0,47}$/;

type JsonRecord = Record<string, unknown>;
type LabelledPath = Readonly<{ label: string; path: string }>;
type DeliveryOptions = Readonly<{
  deliveryProfile: RasterDeliveryProfile;
  stableIdPrefix?: string;
}>;

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
    "                     [--delivery-profile editable|web|motion|print] [--stable-id-prefix prefix]",
    "  evavo-vector raster:inspect <input.png>",
    "  evavo-vector trace <input.png> [--out output.svg] [--profile auto|logo|icon|line-art|illustration|photo]",
    "                     [--candidate-mode adaptive|single] [--max-colours 1..256]",
    "                     [--delivery-profile editable|web|motion|print] [--stable-id-prefix prefix]",
    "                     [--preserve-palette|--simplify-palette] [--no-optimise]",
    "                     [--diff-out output.diff.png] [--difference-max-dimension 32..1024]",
    "                     [--title \"Accessible title\"]",
    "  evavo-vector motion:validate <motion.json>",
    "  evavo-vector motion:inspect <animated.svg>",
    "  evavo-vector animate-svg <input.svg> --motion motion.json [--out output.animated.svg]",
    "                     [--evidence-out output.motion.evidence.json]",
    "  evavo-vector lottie:inspect <input.lottie.json>",
    "  evavo-vector lottie:export <input.svg> --motion motion.json [--out output.lottie.json]",
    "                     [--evidence-out output.lottie.evidence.json] [--frame-rate 1..120]",
    "                     [--precision 0..6] [--name \"Animation name\"]",
    "  evavo-vector input-policy",
    "  evavo-vector manifest",
    "  evavo-vector --version",
    "",
    "Operational results are JSON. Output commands create new files only.",
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

function requiredOption(args: readonly string[], name: string): string {
  const value = option(args, name);
  if (value === null) fail({ error: "VECTOR_CLI_OPTION_REQUIRED", option: name });
  return value;
}

function parseIntegerOption(args: readonly string[], name: string): number | undefined {
  const raw = option(args, name);
  if (raw === null) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value)) fail({ error: "VECTOR_CLI_OPTION_INVALID", option: name, value: raw });
  return value;
}

function deliveryOptions(args: readonly string[]): DeliveryOptions {
  const rawDeliveryProfile = option(args, "--delivery-profile") ?? "editable";
  if (!DELIVERY_PROFILES.has(rawDeliveryProfile as RasterDeliveryProfile)) {
    fail({
      error: "VECTOR_CLI_OPTION_INVALID",
      option: "--delivery-profile",
      value: rawDeliveryProfile,
      allowed: [...DELIVERY_PROFILES],
    });
  }
  const deliveryProfile = rawDeliveryProfile as RasterDeliveryProfile;
  const stableIdPrefix = option(args, "--stable-id-prefix") ?? undefined;
  if (stableIdPrefix && !STABLE_ID_PREFIX.test(stableIdPrefix)) {
    fail({
      error: "VECTOR_CLI_OPTION_INVALID",
      option: "--stable-id-prefix",
      value: stableIdPrefix,
      message: "The prefix must begin with a letter or underscore and contain only letters, numbers, underscores, periods or hyphens.",
    });
  }
  if (stableIdPrefix && deliveryProfile !== "editable" && deliveryProfile !== "motion") {
    fail({
      error: "VECTOR_CLI_OPTION_CONFLICT",
      option: "--stable-id-prefix",
      deliveryProfile,
      allowedDeliveryProfiles: ["editable", "motion"],
    });
  }
  return Object.freeze({ deliveryProfile, stableIdPrefix });
}

function pathKey(value: string): string {
  const resolved = resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function samePath(left: string, right: string): boolean {
  return pathKey(left) === pathKey(right);
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
  const receipt = receipts.find((item) => samePath(item.path, expectedPath));
  if (!receipt) {
    fail({
      error: "VECTOR_OUTPUT_RECEIPT_MISSING",
      expectedPath,
      receiptPaths: receipts.map((item) => item.path),
    }, 2);
  }
  return receipt;
}

async function readJsonFile(inputPath: string): Promise<unknown> {
  const source = await readFile(inputPath, "utf8");
  try {
    return JSON.parse(source) as unknown;
  } catch (error) {
    fail({
      error: "VECTOR_JSON_INVALID",
      inputPath,
      message: error instanceof Error ? error.message : String(error),
    }, 2);
  }
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
    ...deliveryOptions(args),
    preservePalette: !has(args, "--simplify-palette"),
    maxColours,
    optimise: !has(args, "--no-optimise"),
    title: option(args, "--title") ?? undefined,
    includeDifferenceArtifact: differenceRequested,
    differenceMaxDimension,
  };
}

function lottieOptions(args: readonly string[]): LottieExportOptions {
  const frameRate = parseIntegerOption(args, "--frame-rate");
  const precision = parseIntegerOption(args, "--precision");
  if (
    frameRate !== undefined &&
    (frameRate < MIN_LOTTIE_FRAME_RATE || frameRate > MAX_LOTTIE_FRAME_RATE)
  ) {
    fail({
      error: "VECTOR_CLI_OPTION_INVALID",
      option: "--frame-rate",
      value: frameRate,
      range: [MIN_LOTTIE_FRAME_RATE, MAX_LOTTIE_FRAME_RATE],
    }, 2);
  }
  if (
    precision !== undefined &&
    (precision < 0 || precision > MAX_LOTTIE_PRECISION)
  ) {
    fail({
      error: "VECTOR_CLI_OPTION_INVALID",
      option: "--precision",
      value: precision,
      range: [0, MAX_LOTTIE_PRECISION],
    }, 2);
  }
  return {
    frameRate,
    precision,
    name: option(args, "--name") ?? undefined,
  };
}

function stem(sourcePath: string): string {
  const extension = extname(sourcePath);
  return extension ? sourcePath.slice(0, -extension.length) : sourcePath;
}

function defaultTraceOutput(sourcePath: string): string {
  return `${stem(sourcePath)}.vector.svg`;
}

function defaultOptimisedOutput(sourcePath: string): string {
  return `${stem(sourcePath)}.optimised.svg`;
}

function defaultAnimatedOutput(sourcePath: string): string {
  return `${stem(sourcePath)}.animated.svg`;
}

function defaultLottieOutput(sourcePath: string): string {
  return `${stem(sourcePath)}.lottie.json`;
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
  const outputPath = resolve(option(args, "--out") ?? defaultOptimisedOutput(sourcePath));
  assertExtension(outputPath, ".svg", "--out");
  assertDistinctPaths([
    { label: "source", path: sourcePath },
    { label: "output", path: outputPath },
  ]);
  const source = await readFile(sourcePath, "utf8");
  const result = optimiseSvg(source, deliveryOptions(args));
  if (!result.inspection.valid) {
    print({ command: "optimise", written: false, sourcePath, outputPath, ...result });
    process.exitCode = 2;
    return;
  }
  const receipts = await commitNewOutputFiles([
    { path: outputPath, data: `${result.svg}\n`, mimeType: "image/svg+xml" },
  ]);
  print({
    command: "optimise",
    written: true,
    sourcePath,
    output: receiptFor(receipts, outputPath),
    beforeBytes: result.beforeBytes,
    afterBytes: result.afterBytes,
    bytesSaved: result.bytesSaved,
    bytesDelta: result.bytesDelta,
    delivery: result.evidence,
    inspection: result.inspection,
  });
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
  assertExtension(outputPath, ".svg", "--out");
  if (differenceOutputPath) assertExtension(differenceOutputPath, ".png", "--diff-out");
  assertDistinctPaths([
    { label: "source", path: sourcePath },
    { label: "svg-output", path: outputPath },
    ...(differenceOutputPath ? [{ label: "difference-output", path: differenceOutputPath }] : []),
  ]);

  const source = await readFile(sourcePath);
  const result = await traceRaster(source, traceOptions(sourcePath, args));
  const differencePng = result.artifacts.differencePng;
  if (differenceOutputPath && !differencePng) {
    fail({ error: "VECTOR_DIFFERENCE_ARTIFACT_MISSING", differenceOutputPath }, 2);
  }
  if (!differenceOutputPath && differencePng) {
    fail({ error: "VECTOR_DIFFERENCE_OUTPUT_PATH_MISSING" }, 2);
  }

  const receipts = await commitNewOutputFiles([
    { path: outputPath, data: `${result.svg}\n`, mimeType: "image/svg+xml" },
    ...(differenceOutputPath && differencePng
      ? [{ path: differenceOutputPath, data: differencePng, mimeType: "image/png" }]
      : []),
  ]);

  print({
    command: "trace",
    written: true,
    sourcePath,
    outputs: {
      svg: receiptFor(receipts, outputPath),
      differencePng: differenceOutputPath ? receiptFor(receipts, differenceOutputPath) : null,
    },
    inputPolicy: RASTER_INPUT_POLICY.mode,
    deliveryProfile: result.evidence.output.deliveryProfile,
    stablePathIdCount: result.evidence.output.stablePathIdCount,
    approval: result.evidence.qualityGates.productionApproval,
    renderComparison: result.evidence.qualityGates.renderComparison,
    selectedCandidate: result.evidence.selection.selectedCandidateId,
    candidateCount: result.evidence.selection.attemptedCandidateCount,
    inspection: result.inspection,
    evidence: result.evidence,
  });
}

async function validateMotionFile(input: string): Promise<void> {
  const motionPath = resolve(input);
  assertExtension(motionPath, ".json", "motion plan");
  const plan = await readJsonFile(motionPath);
  const normalized = validateAnimatedSvgMotionSpec(plan);
  print({
    command: "motion:validate",
    motionPath,
    contractVersion: "1.0",
    valid: true,
    normalized,
  });
}

async function inspectAnimatedSvgFile(input: string): Promise<void> {
  const sourcePath = resolve(input);
  const source = await readFile(sourcePath, "utf8");
  const inspection = inspectAnimatedSvg(source);
  print({ command: "motion:inspect", sourcePath, ...inspection });
  if (!inspection.valid) process.exitCode = 2;
}

async function animateSvgFile(input: string, args: readonly string[]): Promise<void> {
  const sourcePath = resolve(input);
  const motionPath = resolve(requiredOption(args, "--motion"));
  const outputPath = resolve(option(args, "--out") ?? defaultAnimatedOutput(sourcePath));
  const rawEvidencePath = option(args, "--evidence-out");
  const evidenceOutputPath = rawEvidencePath ? resolve(rawEvidencePath) : null;

  assertExtension(motionPath, ".json", "--motion");
  assertExtension(outputPath, ".svg", "--out");
  if (evidenceOutputPath) assertExtension(evidenceOutputPath, ".json", "--evidence-out");
  assertDistinctPaths([
    { label: "source", path: sourcePath },
    { label: "motion-plan", path: motionPath },
    { label: "animated-svg-output", path: outputPath },
    ...(evidenceOutputPath ? [{ label: "motion-evidence-output", path: evidenceOutputPath }] : []),
  ]);

  const [source, motionPlan] = await Promise.all([
    readFile(sourcePath, "utf8"),
    readJsonFile(motionPath),
  ]);
  const result = createAnimatedSvg(source, motionPlan);
  const evidenceDocument = {
    command: "animate-svg",
    contractVersion: "1.0",
    sourcePath,
    motionPath,
    outputPath,
    inspection: result.inspection,
    evidence: result.evidence,
  };
  const receipts = await commitNewOutputFiles([
    { path: outputPath, data: `${result.svg}\n`, mimeType: "image/svg+xml" },
    ...(evidenceOutputPath
      ? [{
          path: evidenceOutputPath,
          data: `${JSON.stringify(evidenceDocument, null, 2)}\n`,
          mimeType: "application/json",
        }]
      : []),
  ]);

  print({
    command: "animate-svg",
    written: true,
    sourcePath,
    motionPath,
    outputs: {
      animatedSvg: receiptFor(receipts, outputPath),
      evidence: evidenceOutputPath ? receiptFor(receipts, evidenceOutputPath) : null,
    },
    inspection: result.inspection,
    evidence: result.evidence,
  });
}

async function inspectLottieFile(input: string): Promise<void> {
  const inputPath = resolve(input);
  assertExtension(inputPath, ".json", "Lottie input");
  const source = await readFile(inputPath, "utf8");
  const inspection = inspectLottie(source);
  print({ command: "lottie:inspect", inputPath, ...inspection });
  if (!inspection.valid) process.exitCode = 2;
}

async function exportLottieFile(input: string, args: readonly string[]): Promise<void> {
  const sourcePath = resolve(input);
  const motionPath = resolve(requiredOption(args, "--motion"));
  const outputPath = resolve(option(args, "--out") ?? defaultLottieOutput(sourcePath));
  const rawEvidencePath = option(args, "--evidence-out");
  const evidenceOutputPath = rawEvidencePath ? resolve(rawEvidencePath) : null;

  assertExtension(sourcePath, ".svg", "source");
  assertExtension(motionPath, ".json", "--motion");
  assertExtension(outputPath, ".json", "--out");
  if (evidenceOutputPath) assertExtension(evidenceOutputPath, ".json", "--evidence-out");
  assertDistinctPaths([
    { label: "source", path: sourcePath },
    { label: "motion-plan", path: motionPath },
    { label: "lottie-output", path: outputPath },
    ...(evidenceOutputPath ? [{ label: "lottie-evidence-output", path: evidenceOutputPath }] : []),
  ]);

  const [source, motionPlan] = await Promise.all([
    readFile(sourcePath, "utf8"),
    readJsonFile(motionPath),
  ]);
  const options = lottieOptions(args);
  const result = createLottieFromSvgMotion(source, motionPlan, options);
  const evidenceDocument = {
    command: "lottie:export",
    contractVersion: result.evidence.contractVersion,
    sourcePath,
    motionPath,
    outputPath,
    options: {
      frameRate: options.frameRate ?? DEFAULT_LOTTIE_FRAME_RATE,
      precision: options.precision ?? DEFAULT_LOTTIE_PRECISION,
      name: options.name ?? null,
    },
    inspection: result.inspection,
    evidence: result.evidence,
  };
  const receipts = await commitNewOutputFiles([
    { path: outputPath, data: result.json, mimeType: "video/lottie+json" },
    ...(evidenceOutputPath
      ? [{
          path: evidenceOutputPath,
          data: `${JSON.stringify(evidenceDocument, null, 2)}\n`,
          mimeType: "application/json",
        }]
      : []),
  ]);

  print({
    command: "lottie:export",
    written: true,
    sourcePath,
    motionPath,
    outputs: {
      lottieJson: receiptFor(receipts, outputPath),
      evidence: evidenceOutputPath ? receiptFor(receipts, evidenceOutputPath) : null,
    },
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
    motionContractVersion: "1.0",
    lottieContractVersion: "1.0",
    discoveryCommands: ["manifest", "input-policy"],
    deterministicCommands: ["inspect", "motion:inspect", "motion:validate", "lottie:inspect", "raster:inspect"],
    boundedCommands: ["trace"],
    productionCommands: ["optimise", "trace", "animate-svg", "lottie:export"],
    deliveryProfiles: Object.freeze({
      editable: "deterministic collision-safe path IDs with source dimensions preserved",
      web: "responsive root dimensions and compact metadata policy without generated path IDs",
      motion: "deterministic collision-safe motion target IDs and responsive root dimensions",
      print: "conservative document normalisation with root dimensions preserved",
    }),
    commands: {
      inspect: { input: "path to SVG", output: "JSON safety, geometry, topology and structure inspection" },
      optimise: {
        input: "path to SVG",
        options: {
          "--out": "new SVG output path",
          "--delivery-profile": [...DELIVERY_PROFILES],
          "--stable-id-prefix": "optional editable or motion path-ID prefix",
        },
        output: "new governed SVG plus delivery and structural evidence",
      },
      "raster:inspect": { input: "path to one supported static raster", output: "alpha-aware JSON source analysis and profile recommendation" },
      trace: {
        input: "path to one supported static raster",
        options: {
          "--candidate-mode": ["adaptive", "single"],
          "--delivery-profile": [...DELIVERY_PROFILES],
          "--stable-id-prefix": "optional editable or motion path-ID prefix",
          "--diff-out": "optional new visual difference PNG path",
          "--difference-max-dimension": { default: DEFAULT_DIFFERENCE_MAX_DIMENSION, range: [32, MAX_DIFFERENCE_DIMENSION] },
        },
        output: "new selected SVG plus alpha-aware source, delivery, candidate, topology, geometry, render and optional difference evidence",
        approvalState: "human-review-required",
      },
      "motion:validate": { input: "motion plan JSON", output: "normalized v1 motion contract" },
      "motion:inspect": { input: "animated SVG", output: "motion metadata, rule and reduced-motion inspection" },
      "animate-svg": {
        input: "governed static SVG",
        options: {
          "--motion": "required v1 motion plan JSON",
          "--out": "optional new animated SVG path",
          "--evidence-out": "optional new JSON evidence path",
        },
        output: "new deterministic script-free CSS animated SVG plus optional evidence file",
        approvalState: "human-review-required",
      },
      "lottie:inspect": {
        input: "Lottie JSON",
        output: "governed shape-layer, property, keyframe, asset and expression inspection",
      },
      "lottie:export": {
        input: "governed path-only static SVG",
        options: {
          "--motion": "required v1 motion plan JSON",
          "--out": "optional new .lottie.json path",
          "--evidence-out": "optional new JSON evidence path",
          "--frame-rate": { default: DEFAULT_LOTTIE_FRAME_RATE, range: [MIN_LOTTIE_FRAME_RATE, MAX_LOTTIE_FRAME_RATE] },
          "--precision": { default: DEFAULT_LOTTIE_PRECISION, range: [0, MAX_LOTTIE_PRECISION] },
          "--name": "optional composition name",
        },
        output: "new governed shape-layer Lottie JSON plus optional evidence file",
        compatibility: "structurally inspected; independent player-render validation not yet performed",
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
      existingOutputsOverwritten: false,
      outputPathCollisionsRejected: true,
      atomicMultiFileCommit: true,
      maxInputBytes: DEFAULT_MAX_INPUT_BYTES,
      maxDecodedPixels: DEFAULT_MAX_PIXELS,
      rasterTracingAvailable: true,
      alphaAwareAnalysisAvailable: true,
      renderComparisonAvailable: true,
      renderComparisonMaximumDimensions: [64, 256, 1024],
      differenceArtifactAvailable: true,
      differenceArtifactMaximumDimension: MAX_DIFFERENCE_DIMENSION,
      adaptiveCandidateMaximums: { threeCandidatesThroughPixels: 4000000, twoCandidatesThroughPixels: 12000000, otherwise: 1 },
      deliveryProfiles: [...DELIVERY_PROFILES],
      deterministicStablePathIds: true,
      responsiveWebPackaging: true,
      animatedSvgAvailable: true,
      animatedSvgProperties: ["opacity", "translateX", "translateY", "scale", "rotateDeg"],
      reducedMotionFallbackRequired: true,
      lottieJsonExportAvailable: true,
      lottiePlayerRenderValidationAvailable: false,
      dotLottieAvailable: false,
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
  if (command === "motion:validate") return validateMotionFile(input);
  if (command === "motion:inspect") return inspectAnimatedSvgFile(input);
  if (command === "animate-svg") return animateSvgFile(input, commandArgs);
  if (command === "lottie:inspect") return inspectLottieFile(input);
  if (command === "lottie:export") return exportLottieFile(input, commandArgs);
  fail(`Unknown command: ${command}\n\n${usage()}`);
}

main().catch((error: unknown) => {
  if (error instanceof LottieEngineError) {
    fail({ error: error.code, message: error.message, details: error.details }, 2);
  }
  if (error instanceof MotionEngineError) {
    fail({ error: error.code, message: error.message, details: error.details }, 2);
  }
  if (error instanceof RasterEngineError) {
    fail({ error: error.code, message: error.message, status: error.status, details: error.details }, 2);
  }
  if (error instanceof CliOutputTransactionError) {
    fail({ error: error.code, message: error.message, details: error.details }, 2);
  }
  const message = error instanceof Error ? error.message : String(error);
  fail({ error: "VECTOR_CLI_FAILED", message });
});
