#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { inspectSvg, optimiseSvg } from "@evavo/vector-core";

const VERSION = "0.1.0";

type JsonRecord = Record<string, unknown>;

function print(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function fail(message: string, code = 1): never {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

function usage(): string {
  return [
    "EVAVO Vector Studio CLI",
    "",
    "Usage:",
    "  evavo-vector inspect <input.svg>",
    "  evavo-vector optimise <input.svg> [--out output.svg]",
    "  evavo-vector manifest",
    "  evavo-vector --version",
    "",
    "All command results are JSON so agents can consume them safely.",
  ].join("\n");
}

function option(args: readonly string[], name: string): string | null {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] ?? null : null;
}

async function inspect(input: string): Promise<void> {
  const sourcePath = resolve(input);
  const source = await readFile(sourcePath, "utf8");
  const inspection = inspectSvg(source);
  print({ command: "inspect", sourcePath, ...inspection });
  if (!inspection.valid) process.exitCode = 2;
}

async function optimise(input: string, args: readonly string[]): Promise<void> {
  const sourcePath = resolve(input);
  const outputPath = resolve(option(args, "--out") ?? sourcePath.replace(/\.svg$/i, ".optimised.svg"));
  const source = await readFile(sourcePath, "utf8");
  const result = optimiseSvg(source);
  if (!result.inspection.valid) {
    print({ command: "optimise", written: false, sourcePath, outputPath, ...result });
    process.exitCode = 2;
    return;
  }
  await writeFile(outputPath, `${result.svg}\n`, "utf8");
  print({ command: "optimise", written: true, sourcePath, outputPath, beforeBytes: result.beforeBytes, afterBytes: result.afterBytes, bytesSaved: result.bytesSaved, inspection: result.inspection });
}

function manifest(): JsonRecord {
  return {
    name: "evavo-vector",
    version: VERSION,
    contractVersion: "1.0",
    deterministicCommands: ["inspect", "optimise"],
    commands: {
      inspect: { input: "path to SVG", output: "JSON inspection", exitCodes: { 0: "valid", 2: "unsafe or invalid SVG" } },
      optimise: { input: "path to SVG", options: { "--out": "output path" }, output: "optimised SVG plus JSON evidence", exitCodes: { 0: "written", 2: "rejected" } },
    },
    safety: {
      scriptsRejected: true,
      foreignObjectRejected: true,
      sourceOverwrittenByDefault: false,
      rasterTracingAvailable: false,
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
  if (command === "inspect") return inspect(input);
  if (command === "optimise") return optimise(input, args.slice(2));
  fail(`Unknown command: ${command}\n\n${usage()}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  fail(JSON.stringify({ error: "VECTOR_CLI_FAILED", message }));
});
