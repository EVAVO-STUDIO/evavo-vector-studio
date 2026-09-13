#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const VECTOR_NODE_VERSION = "22.16.0";
export const VECTOR_NODE_ENGINE = "22.16.x";
export const VECTOR_PACKAGE_MANAGER = "pnpm@10.14.0";
export const VECTOR_CONTRACT_COMMAND =
  "node scripts/check-runtime-version.mjs && node scripts/check-release-contract.mjs";

function result(ok, errors, details = {}) {
  return Object.freeze({
    check: "evavo-vector-studio-runtime-version",
    ok,
    errors: Object.freeze([...errors]),
    ...details,
  });
}

export function evaluateRuntimeVersionContract({
  packageJsonRaw,
  nvmrcRaw,
}) {
  const errors = [];
  let packageJson = null;

  if (typeof packageJsonRaw !== "string" || packageJsonRaw.length === 0) {
    errors.push("package.json is missing or empty");
  } else {
    try {
      packageJson = JSON.parse(packageJsonRaw);
    } catch (error) {
      errors.push(
        `package.json is invalid JSON: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  if (nvmrcRaw !== `${VECTOR_NODE_VERSION}\n`) {
    errors.push(
      `.nvmrc must contain exactly ${VECTOR_NODE_VERSION} followed by one newline`,
    );
  }
  if (packageJson?.engines?.node !== VECTOR_NODE_ENGINE) {
    errors.push(
      `package.json engines.node must be ${VECTOR_NODE_ENGINE}; received ${String(
        packageJson?.engines?.node,
      )}`,
    );
  }
  if (packageJson?.packageManager !== VECTOR_PACKAGE_MANAGER) {
    errors.push(
      `package.json packageManager must remain ${VECTOR_PACKAGE_MANAGER}; received ${String(
        packageJson?.packageManager,
      )}`,
    );
  }
  if (
    packageJson?.scripts?.["contract:check"] !== VECTOR_CONTRACT_COMMAND
  ) {
    errors.push(
      "package.json contract:check must run the runtime-version contract before the release contract",
    );
  }
  if (
    !String(packageJson?.scripts?.check ?? "").startsWith(
      "pnpm contract:check &&",
    )
  ) {
    errors.push(
      "package.json check must execute contract:check before dependency-backed gates",
    );
  }

  return result(errors.length === 0, errors, {
    nodeVersion: VECTOR_NODE_VERSION,
    nodeEngine: VECTOR_NODE_ENGINE,
    packageManager: VECTOR_PACKAGE_MANAGER,
  });
}

function runSelfTest() {
  const validPackage = JSON.stringify({
    packageManager: VECTOR_PACKAGE_MANAGER,
    scripts: {
      "contract:check": VECTOR_CONTRACT_COMMAND,
      check: "pnpm contract:check && pnpm test",
    },
    engines: {
      node: VECTOR_NODE_ENGINE,
    },
  });

  const valid = evaluateRuntimeVersionContract({
    packageJsonRaw: validPackage,
    nvmrcRaw: `${VECTOR_NODE_VERSION}\n`,
  });
  const unbounded = evaluateRuntimeVersionContract({
    packageJsonRaw: validPackage.replace(VECTOR_NODE_ENGINE, ">=22.0.0"),
    nvmrcRaw: `${VECTOR_NODE_VERSION}\n`,
  });
  const mismatchedSelector = evaluateRuntimeVersionContract({
    packageJsonRaw: validPackage,
    nvmrcRaw: "24\n",
  });
  const reorderedGate = evaluateRuntimeVersionContract({
    packageJsonRaw: validPackage.replace(
      VECTOR_CONTRACT_COMMAND,
      "node scripts/check-release-contract.mjs",
    ),
    nvmrcRaw: `${VECTOR_NODE_VERSION}\n`,
  });

  if (
    !valid.ok ||
    unbounded.ok ||
    mismatchedSelector.ok ||
    reorderedGate.ok
  ) {
    throw new Error("VECTOR_RUNTIME_VERSION_SELF_TEST_FAILED");
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        check: "evavo-vector-studio-runtime-version-self-test",
        ok: true,
        cases: [
          "exact Node selector accepted",
          "open-ended Node range rejected",
          "mismatched .nvmrc rejected",
          "release gate without runtime check rejected",
        ],
      },
      null,
      2,
    )}\n`,
  );
}

function runRepositoryCheck() {
  const root = process.cwd();
  const evaluation = evaluateRuntimeVersionContract({
    packageJsonRaw: fs.readFileSync(path.join(root, "package.json"), "utf8"),
    nvmrcRaw: fs.readFileSync(path.join(root, ".nvmrc"), "utf8"),
  });

  const stream = evaluation.ok ? process.stdout : process.stderr;
  stream.write(`${JSON.stringify(evaluation, null, 2)}\n`);
  if (!evaluation.ok) process.exitCode = 1;
}

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : "";
if (import.meta.url === invokedPath) {
  if (process.argv.includes("--self-test")) runSelfTest();
  else runRepositoryCheck();
}
