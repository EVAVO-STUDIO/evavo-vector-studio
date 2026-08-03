from __future__ import annotations

import json
from pathlib import Path


def write(path: str, content: str) -> None:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")


def replace_once(source: str, old: str, new: str, label: str) -> str:
    count = source.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one match, found {count}")
    return source.replace(old, new, 1)


workspace_manifests = sorted(
    [
        *Path("apps").glob("*/package.json"),
        *Path("packages").glob("*/package.json"),
        *Path("workers").glob("*/package.json"),
    ],
    key=lambda item: item.as_posix(),
)
converted: list[str] = []
for manifest_path in workspace_manifests:
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    scripts = manifest.get("scripts")
    if not isinstance(scripts, dict):
        continue
    test_script = scripts.get("test")
    if not isinstance(test_script, str):
        continue
    prefix = "tsc -p tsconfig.json && "
    if test_script.startswith(prefix) and "node --test dist/" in test_script:
        scripts["test"] = test_script[len(prefix):]
        converted.append(manifest_path.as_posix())
        manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")

if not converted:
    raise SystemExit("no TypeScript test script was converted to immutable build consumption")

turbo_path = Path("turbo.json")
turbo = json.loads(turbo_path.read_text(encoding="utf-8"))
test_task = turbo.get("tasks", {}).get("test")
if not isinstance(test_task, dict):
    raise SystemExit("turbo.json does not expose a test task")
test_task["dependsOn"] = ["build", "^build"]
turbo_path.write_text(json.dumps(turbo, indent=2) + "\n", encoding="utf-8")

write(
    "scripts/check-test-build-isolation.mjs",
    r'''import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const errors = [];
const checkedFiles = new Set();

async function read(relativePath) {
  checkedFiles.add(relativePath);
  try {
    return (await fs.readFile(path.join(root, relativePath), "utf8")).replace(/^\uFEFF/, "");
  } catch (error) {
    errors.push(`Missing or unreadable test-build isolation file: ${relativePath} (${error instanceof Error ? error.message : String(error)})`);
    return "";
  }
}

async function readJson(relativePath) {
  const source = await read(relativePath);
  if (!source) return null;
  try {
    return JSON.parse(source);
  } catch (error) {
    errors.push(`Invalid JSON: ${relativePath} (${error instanceof Error ? error.message : String(error)})`);
    return null;
  }
}

function requireTokens(relativePath, source, tokens) {
  for (const token of tokens) {
    if (!source.includes(token)) errors.push(`${relativePath} is missing test-build isolation token: ${token}`);
  }
}

const packageJson = await readJson("package.json");
const turboJson = await readJson("turbo.json");
const quality = await read(".github/workflows/quality.yml");
const documentation = await read("docs/TEST-BUILD-ISOLATION.md");
const readme = await read("README.md");

if (packageJson?.scripts?.["test-build-isolation:check"] !== "node scripts/check-test-build-isolation.mjs") {
  errors.push("package.json must expose test-build-isolation:check.");
}
if (!String(packageJson?.scripts?.check ?? "").includes("pnpm test-build-isolation:check")) {
  errors.push("package.json check must include test-build-isolation:check before dependency-backed gates.");
}

const testDependencies = turboJson?.tasks?.test?.dependsOn;
if (
  !Array.isArray(testDependencies) ||
  testDependencies.length !== 2 ||
  testDependencies[0] !== "build" ||
  testDependencies[1] !== "^build"
) {
  errors.push('turbo.json test must depend on same-package "build" before dependency "^build".');
}

const manifestPaths = [];
for (const directory of ["apps", "packages", "workers"]) {
  let entries = [];
  try {
    entries = await fs.readdir(path.join(root, directory), { withFileTypes: true });
  } catch {
    continue;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) manifestPaths.push(`${directory}/${entry.name}/package.json`);
  }
}
manifestPaths.sort();

const builtTestPackages = [];
for (const relativePath of manifestPaths) {
  const manifest = await readJson(relativePath);
  if (!manifest) continue;
  const build = String(manifest.scripts?.build ?? "").trim();
  const test = String(manifest.scripts?.test ?? "").trim();
  if (!test) continue;

  if (/\btsc\b/.test(test)) {
    errors.push(`${relativePath} test must not compile into a shared output directory: ${test}`);
  }
  if (/\b(?:rm|rimraf|rmdir|del)\b/.test(test)) {
    errors.push(`${relativePath} test must not clean shared build output: ${test}`);
  }
  if (test.includes("node --test dist/")) {
    builtTestPackages.push(String(manifest.name ?? relativePath));
    if (!build) errors.push(`${relativePath} consumes dist tests without a build script.`);
    if (!/^tsc\s+-p\s+tsconfig\.json(?:\s|$)/.test(build)) {
      errors.push(`${relativePath} dist tests require the governed TypeScript build script; received ${build}.`);
    }
  }
}

if (builtTestPackages.length < 1) {
  errors.push("No workspace package consumes immutable dist test output.");
}

requireTokens(".github/workflows/quality.yml", quality, [
  "Verify test and build output isolation",
  "id: contract_test_build_isolation",
  "node scripts/check-test-build-isolation.mjs",
  "CONTRACT_TEST_BUILD_ISOLATION_OUTCOME",
]);
requireTokens("docs/TEST-BUILD-ISOLATION.md", documentation, [
  "same-package `build`",
  "immutable `dist` output",
  "must not invoke `tsc`",
  "pnpm test-build-isolation:check",
]);
requireTokens("README.md", readme, [
  "docs/TEST-BUILD-ISOLATION.md",
]);

if (errors.length > 0) {
  process.stderr.write(`${JSON.stringify({
    check: "evavo-vector-studio-test-build-isolation",
    ok: false,
    contractVersion: "1.0",
    errors,
  }, null, 2)}\n`);
  process.exit(1);
}

process.stdout.write(`${JSON.stringify({
  check: "evavo-vector-studio-test-build-isolation",
  ok: true,
  contractVersion: "1.0",
  samePackageBuildRequired: true,
  testCompilationWritesSharedDist: false,
  builtTestPackages: builtTestPackages.sort(),
  checkedFiles: [...checkedFiles].sort(),
}, null, 2)}\n`);
''',
)

write(
    "docs/TEST-BUILD-ISOLATION.md",
    r'''# Deterministic test and build isolation

Every compiled workspace test consumes the package's completed immutable `dist` output. Turbo therefore requires the same-package `build` task before `test`, as well as dependency builds through `^build`.

A package test that executes `dist/*.test.js` must not invoke `tsc`, delete `dist`, or otherwise write to the production output directory. This prevents a package build and its test compilation from racing over the same JavaScript modules while downstream packages are built in parallel.

The governed task relationship is:

```json
{
  "test": {
    "dependsOn": ["build", "^build"]
  }
}
```

The dependency-free contract is:

```powershell
pnpm test-build-isolation:check
```

The complete quality workflow runs this contract before lint, typecheck, tests and production build. A future test compiler that writes to shared `dist` fails before dependency-backed execution.
''',
)

package_path = Path("package.json")
package = json.loads(package_path.read_text(encoding="utf-8"))
package["scripts"]["test-build-isolation:check"] = "node scripts/check-test-build-isolation.mjs"
package["scripts"]["check"] = replace_once(
    package["scripts"]["check"],
    "pnpm capabilities-api:check && pnpm readiness:check",
    "pnpm capabilities-api:check && pnpm test-build-isolation:check && pnpm readiness:check",
    "root check test-build isolation",
)
package_path.write_text(json.dumps(package, indent=2) + "\n", encoding="utf-8")

readme_path = Path("README.md")
readme = readme_path.read_text(encoding="utf-8")
readme = replace_once(
    readme,
    "- [`docs/READINESS.md`](docs/READINESS.md)\n- [`docs/CLI.md`](docs/CLI.md)",
    "- [`docs/READINESS.md`](docs/READINESS.md)\n- [`docs/TEST-BUILD-ISOLATION.md`](docs/TEST-BUILD-ISOLATION.md)\n- [`docs/CLI.md`](docs/CLI.md)",
    "README test-build isolation link",
)
readme_path.write_text(readme, encoding="utf-8")

quality_path = Path(".github/workflows/quality.yml")
quality = quality_path.read_text(encoding="utf-8")
isolation_step = '''      - name: Verify test and build output isolation
        id: contract_test_build_isolation
        if: ${{ !cancelled() && steps.install.outcome == 'success' }}
        continue-on-error: true
        shell: bash
        run: |
          mkdir -p .ci/contracts
          set -o pipefail
          node scripts/check-test-build-isolation.mjs 2>&1 | tee .ci/contracts/contract_test_build_isolation.log

'''
quality = replace_once(
    quality,
    "      - name: Verify runtime readiness contract\n",
    isolation_step + "      - name: Verify runtime readiness contract\n",
    "quality test-build isolation step",
)
quality = replace_once(
    quality,
    "          CONTRACT_CAPABILITIES_OUTCOME: ${{ steps.contract_capabilities.outcome }}\n",
    "          CONTRACT_CAPABILITIES_OUTCOME: ${{ steps.contract_capabilities.outcome }}\n          CONTRACT_TEST_BUILD_ISOLATION_OUTCOME: ${{ steps.contract_test_build_isolation.outcome }}\n",
    "quality test-build isolation environment",
)
quality = replace_once(
    quality,
    '            "$CONTRACT_CAPABILITIES_OUTCOME"\n',
    '            "$CONTRACT_CAPABILITIES_OUTCOME"\n            "$CONTRACT_TEST_BUILD_ISOLATION_OUTCOME"\n',
    "quality test-build isolation aggregate",
)
quality_path.write_text(quality, encoding="utf-8")
