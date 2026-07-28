import { lstat, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { BatchEngineError } from "./errors.js";

export type BatchPathPolicy = Readonly<{
  root: string;
  resolveInputFile: (requestedPath: string) => Promise<string>;
  resolveOutputPath: (requestedPath: string) => Promise<string>;
  assertDistinct: (paths: readonly string[]) => void;
}>;

function pathKey(value: string): string {
  const normalised = path.normalize(value);
  return process.platform === "win32"
    ? normalised.toLowerCase()
    : normalised;
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (
      relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative)
    )
  );
}

function requestedAbsolutePath(
  requestedPath: string,
  root: string,
): string {
  if (!requestedPath.trim() || requestedPath.includes("\0")) {
    throw new BatchEngineError(
      "BATCH_PATH_INVALID",
      "A non-empty batch filesystem path without null bytes is required.",
      { details: { requestedPath } },
    );
  }
  return path.resolve(root, requestedPath);
}

function assertAllowed(
  root: string,
  candidate: string,
  requestedPath: string,
): void {
  if (!isWithin(root, candidate)) {
    throw new BatchEngineError(
      "BATCH_PATH_OUTSIDE_ROOT",
      "The batch path resolves outside the canonical execution root.",
      {
        details: {
          requestedPath,
          resolvedPath: candidate,
          root,
        },
      },
    );
  }
}

async function nearestExistingDirectory(
  directory: string,
): Promise<Readonly<{
  canonical: string;
  missing: readonly string[];
}>> {
  let current = directory;
  const missing: string[] = [];
  for (;;) {
    try {
      const information = await stat(current);
      if (!information.isDirectory()) {
        throw new BatchEngineError(
          "BATCH_OUTPUT_PARENT_INVALID",
          "A batch output ancestor exists but is not a directory.",
          { details: { ancestor: current } },
        );
      }
      return Object.freeze({
        canonical: await realpath(current),
        missing: Object.freeze(missing),
      });
    } catch (error) {
      if (error instanceof BatchEngineError) throw error;
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw new BatchEngineError(
          "BATCH_OUTPUT_PARENT_INVALID",
          "The batch output parent cannot be inspected safely.",
          {
            details: {
              directory: current,
              cause: error instanceof Error ? error.message : String(error),
            },
            cause: error,
          },
        );
      }
      const parent = path.dirname(current);
      if (parent === current) {
        throw new BatchEngineError(
          "BATCH_OUTPUT_PARENT_INVALID",
          "No existing batch output ancestor could be resolved.",
          { details: { directory } },
        );
      }
      missing.unshift(path.basename(current));
      current = parent;
    }
  }
}

export async function canonicalBatchRoot(
  requestedRoot: string,
): Promise<string> {
  const absolute = path.resolve(requestedRoot);
  let canonical: string;
  try {
    canonical = await realpath(absolute);
  } catch (error) {
    throw new BatchEngineError(
      "BATCH_ROOT_INVALID",
      "The batch execution root does not exist or cannot be resolved.",
      {
        details: {
          requestedRoot,
          absolute,
          cause: error instanceof Error ? error.message : String(error),
        },
        cause: error,
      },
    );
  }
  const information = await stat(canonical);
  if (!information.isDirectory()) {
    throw new BatchEngineError(
      "BATCH_ROOT_INVALID",
      "The batch execution root must be a directory.",
      { details: { requestedRoot, canonical } },
    );
  }
  return canonical;
}

export async function createBatchPathPolicy(
  requestedRoot: string,
): Promise<BatchPathPolicy> {
  const root = await canonicalBatchRoot(requestedRoot);

  async function resolveInputFile(requestedPath: string): Promise<string> {
    const absolute = requestedAbsolutePath(requestedPath, root);
    let canonical: string;
    try {
      canonical = await realpath(absolute);
    } catch (error) {
      throw new BatchEngineError(
        "BATCH_INPUT_NOT_FOUND",
        "The requested batch input file does not exist or cannot be resolved.",
        {
          details: {
            requestedPath,
            absolute,
            cause: error instanceof Error ? error.message : String(error),
          },
          cause: error,
        },
      );
    }
    assertAllowed(root, canonical, requestedPath);
    const information = await stat(canonical);
    if (!information.isFile()) {
      throw new BatchEngineError(
        "BATCH_INPUT_NOT_FILE",
        "The requested batch input is not a regular file.",
        { details: { requestedPath, canonical } },
      );
    }
    return canonical;
  }

  async function resolveOutputPath(requestedPath: string): Promise<string> {
    const absolute = requestedAbsolutePath(requestedPath, root);
    const outputName = path.basename(absolute);
    if (!outputName || outputName === "." || outputName === "..") {
      throw new BatchEngineError(
        "BATCH_PATH_INVALID",
        "The batch output path must include a file name.",
        { details: { requestedPath, absolute } },
      );
    }

    const ancestor = await nearestExistingDirectory(path.dirname(absolute));
    const candidateParent = path.resolve(
      ancestor.canonical,
      ...ancestor.missing,
    );
    const candidate = path.resolve(candidateParent, outputName);
    assertAllowed(root, candidate, requestedPath);

    try {
      const information = await lstat(candidate);
      if (information.isSymbolicLink()) {
        let target = candidate;
        try {
          target = await realpath(candidate);
        } catch {
          // A broken output symlink is still unsafe and occupied.
        }
        assertAllowed(root, target, requestedPath);
        throw new BatchEngineError(
          "BATCH_OUTPUT_PARENT_INVALID",
          "A durable batch output path may not be a symbolic link.",
          { details: { requestedPath, resolvedPath: candidate, target } },
        );
      }
      if (!information.isFile()) {
        throw new BatchEngineError(
          "BATCH_OUTPUT_PARENT_INVALID",
          "An existing durable batch output must be a regular file.",
          { details: { requestedPath, resolvedPath: candidate } },
        );
      }
      const canonical = await realpath(candidate);
      assertAllowed(root, canonical, requestedPath);
      return canonical;
    } catch (error) {
      if (error instanceof BatchEngineError) throw error;
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw new BatchEngineError(
          "BATCH_OUTPUT_PARENT_INVALID",
          "The batch output path cannot be inspected safely.",
          {
            details: {
              requestedPath,
              resolvedPath: candidate,
              cause: error instanceof Error ? error.message : String(error),
            },
            cause: error,
          },
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
        throw new BatchEngineError(
          "BATCH_PATH_COLLISION",
          "Batch input and output paths must be distinct.",
          { details: { firstPath: previous, secondPath: value } },
        );
      }
      seen.set(key, value);
    }
  }

  return Object.freeze({
    root,
    resolveInputFile,
    resolveOutputPath,
    assertDistinct,
  });
}
