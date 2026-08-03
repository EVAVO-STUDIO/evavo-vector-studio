from pathlib import Path

old_command = 'tsc -p tsconfig.json && node --test dist/*.test.js'
new_command = 'node --test dist/*.test.js'
changed = []

for target in sorted(Path("scripts").glob("check-*.mjs"), key=lambda item: item.as_posix()):
    source = target.read_text(encoding="utf-8")
    updated = source.replace(old_command, new_command)
    updated = updated.replace(
        "must compile and execute tests.",
        "must execute tests from immutable same-package build output.",
    )
    if updated != source:
        target.write_text(updated, encoding="utf-8")
        changed.append(target.as_posix())

hub_contract = Path("scripts/check-hub-integration-contract.mjs")
hub_source = hub_contract.read_text(encoding="utf-8")
needle = 'if (hubPackage?.scripts?.test !== "node --test dist/*.test.js") errors.push("Hub auth must execute tests from immutable same-package build output.");'
if hub_source.count(needle) != 1:
    raise SystemExit("Hub integration contract did not align to the immutable test command")
build_assertion = 'if (hubPackage?.scripts?.build !== "tsc -p tsconfig.json") errors.push("Hub auth must retain the governed TypeScript build.");\n'
hub_source = hub_source.replace(needle, build_assertion + needle, 1)
hub_contract.write_text(hub_source, encoding="utf-8")

if not changed:
    raise SystemExit("No stale test compilation contract was aligned")
