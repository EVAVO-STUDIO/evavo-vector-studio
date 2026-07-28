import { lstat, realpath, stat } from "node:fs/promises";
import path from "node:path";

export const VECTOR_MCP_ALLOWED_ROOTS_ENV = "VECTOR_MCP_ALLOWED_ROOTS";

export type VectorMcpPathErrorCode =
  | "VECTOR_MCP_ROOT_INVALID"
  | "VECTOR_MCP_PATH_INVALID"
  | "VECTOR_MCP_PATH_OUTSIDE_ROOT"
  | "VECTOR_MCP_INPUT_NOT_FOUND"
  | "VECTOR_MCP_INPUT_NOT_FILE"
  | "VECTOR_MCP_OUTPUT_EXISTS"
  | "VECTOR_MCP_OUTPUT_PARENT_INVALID"
  | "VECTOR_MCP_PATH_COLLISION";

export class VectorMcpPathError extends Error {
  readonly code: VectorMcpPathErrorCode;
  readonly details: Readonly<Record<string, unknown>> | undefined;

  constructor(
    code: VectorMcpPathErrorCode,
    message: string,
    details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = "VectorMcpPathError";
    this.code = code;
    this.details = details;
  }
}

export type VectorMcpPathPolicy = Readonly<{
  roots: readonly string[];
  resolveInputFile: (requestedPath: string) => Promise<string>;
  resolveOutputFile: (requestedPath: string) => Promise<string>;
  assertDistinct: (paths: readonly string[]) => void;
}>;

export type VectorMcpPathPolicyOptions = Readonly<{
  cwd?: string;
  allowedRoots?: readonly string[];
  environment?: Readonly<Record<string, string | undefined>>;
}>;

function pathKey(value: string): string {
  const normalised = path.normalize(value);
  return process.platform === "win32" ? normalised.toLowerCase() : normalised;
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function requestedAbsolutePath(requestedPath: string, cwd: string): string {
  if (!requestedPath.trim() || requestedPath.includes("\0")) {
    throw new VectorMcpPathError(
      "VECTOR_MCP_PATH_INVALID",
      "A non-empty filesystem path without null bytes is required.",
      { requestedPath },
    );
  }
  return path.resolve(cwd, requestedPath);
}

function configuredRootPaths(options: VectorMcpPathPolicyOptions, cwd: string): readonly string[] {
  if (options.allowedRoots && options.allowedRoots.length > 0) return options.allowedRoots;
  const environment = options.environment ?? process.env;
  const raw = environment[VECTOR_MCP_ALLOWED_ROOTS_ENV];
  if (!raw?.trim()) return Object.freeze([cwd]);
  const roots = raw
    .split(path.delimiter)
    .map((value) => value.trim())
    .filter(Boolean);
  if (roots.length === 0) return Object.freeze([cwd]);
  return Object.freeze(roots);
}

async function canonicalRoots(options: VectorMcpPathPolicyOptions, cwd: string): Promise<readonly string[]> {
  const roots: string[] = [];
  for (const requestedRoot of configuredRootPaths(options, cwd)) {
    const absolute = requestedAbsolutePath(requestedRoot, cwd);
    let canonical: string;
    try {
      canonical = await realpath(absolute);
    } catch (error) {
      throw new VectorMcpPathError(
        "VECTOR_MCP_ROOT_INVALID",
        "An allowed MCP filesystem root does not exist or cannot be resolved.",
        { requestedRoot, absolute, cause: error instanceof Error ? error.message : String(error) },
      );
    }
    const information = await stat(canonical);
    if (!information.isDirectory()) {
      throw new VectorMcpPathError(
        "VECTOR_MCP_ROOT_INVALID",
        "Every allowed MCP filesystem root must be a directory.",
        { requestedRoot, canonical },
      );
    }
    if (!roots.some((root) => pathKey(root) === pathKey(canonical))) roots.push(canonical);
  }
  if (roots.length === 0) {
    throw new VectorMcpPathError("VECTOR_MCP_ROOT_INVALID", "At least one allowed MCP filesystem root is required.");
  }
  return Object.freeze(roots);
}

function assertAllowed(candidate: string, roots: readonly string[], requestedPath: string): string {
  const allowedRoot = roots.find((root) => isWithin(root, candidate));
  if (!allowedRoot) {
    throw new VectorMcpPathError(
      "VECTOR_MCP_PATH_OUTSIDE_ROOT",
      "The requested path resolves outside every configured MCP filesystem root.",
      { requestedPath, resolvedPath: candidate, allowedRoots: roots },
    );
  }
  return allowedRoot;
}

async function nearestExistingDirectory(directory: string): Promise<Readonly<{ canonical: string; missing: readonly string[] }>> {
  let current = directory;
  const missing: string[] = [];
  for (;;) {
    try {
      const information = await stat(current);
      if (!information.isDirectory()) {
        throw new VectorMcpPathError(
          "VECTOR_MCP_OUTPUT_PARENT_INVALID",
          "An output path ancestor exists but is not a directory.",
          { ancestor: current },
        );
      }
      return Object.freeze({ canonical: await realpath(current), missing: Object.freeze(missing) });
    } catch (error) {
      if (error instanceof VectorMcpPathError) throw error;
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        throw new VectorMcpPathError(
          "VECTOR_MCP_OUTPUT_PARENT_INVALID",
          "The output path parent cannot be inspected.",
          { directory: current, cause: error instanceof Error ? error.message : String(error) },
        );
      }
      const parent = path.dirname(current);
      if (parent === current) {
        throw new VectorMcpPathError(
          "VECTOR_MCP_OUTPUT_PARENT_INVALID",
          "No existing output path ancestor could be resolved.",
          { directory },
        );
      }
      missing.unshift(path.basename(current));
      current = parent;
    }
  }
}

export async function createVectorMcpPathPolicy(
  options: VectorMcpPathPolicyOptions = {},
): Promise<VectorMcpPathPolicy> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const roots = await canonicalRoots(options, cwd);

  async function resolveInputFile(requestedPath: string): Promise<string> {
    const absolute = requestedAbsolutePath(requestedPath, cwd);
    let canonical: string;
    try {
      canonical = await realpath(absolute);
    } catch (error) {
      throw new VectorMcpPathError(
        "VECTOR_MCP_INPUT_NOT_FOUND",
        "The requested MCP input file does not exist or cannot be resolved.",
        { requestedPath, absolute, cause: error instanceof Error ? error.message : String(error) },
      );
    }
    assertAllowed(canonical, roots, requestedPath);
    const information = await stat(canonical);
    if (!information.isFile()) {
      throw new VectorMcpPathError(
        "VECTOR_MCP_INPUT_NOT_FILE",
        "The requested MCP input path is not a regular file.",
        { requestedPath, canonical },
      );
    }
    return canonical;
  }

  async function resolveOutputFile(requestedPath: string): Promise<string> {
    const absolute = requestedAbsolutePath(requestedPath, cwd);
    const outputName = path.basename(absolute);
    if (!outputName || outputName === "." || outputName === "..") {
      throw new VectorMcpPathError(
        "VECTOR_MCP_PATH_INVALID",
        "The MCP output path must include a file name.",
        { requestedPath, absolute },
      );
    }

    const ancestor = await nearestExistingDirectory(path.dirname(absolute));
    const candidateParent = path.resolve(ancestor.canonical, ...ancestor.missing);
    const candidate = path.resolve(candidateParent, outputName);
    assertAllowed(candidate, roots, requestedPath);

    try {
      await lstat(candidate);
      let existingTarget = candidate;
      try {
        existingTarget = await realpath(candidate);
      } catch {
        // Broken symlinks and other unresolved filesystem entries still count as occupied outputs.
      }
      assertAllowed(existingTarget, roots, requestedPath);
      throw new VectorMcpPathError(
        "VECTOR_MCP_OUTPUT_EXISTS",
        "MCP tools never overwrite an existing output path.",
        { requestedPath, resolvedPath: candidate },
      );
    } catch (error) {
      if (error instanceof VectorMcpPathError) throw error;
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw new VectorMcpPathError(
          "VECTOR_MCP_OUTPUT_PARENT_INVALID",
          "The MCP output path cannot be inspected safely.",
          { requestedPath, resolvedPath: candidate, cause: error instanceof Error ? error.message : String(error) },
        );
      }
    }
    return candidate;
  }

  function assertDistinct(paths: readonly string[]): void {
    const seen = new Map<string, string>();
    for (const value of paths) {
      const key = pathKey(value);
      const previous = seen.get(key);
      if (previous) {
        throw new VectorMcpPathError(
          "VECTOR_MCP_PATH_COLLISION",
          "MCP input and output paths must be distinct.",
          { firstPath: previous, secondPath: value },
        );
      }
      seen.set(key, value);
    }
  }

  return Object.freeze({ roots, resolveInputFile, resolveOutputFile, assertDistinct });
}
