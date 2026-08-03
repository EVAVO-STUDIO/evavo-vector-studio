# Repository hygiene

Vector Studio keeps generated state out of Git and keeps package-manager installation independent of compiled workspace output.

## Generated paths

The repository ignores and rejects tracked files beneath:

```text
.turbo/
.ci/
.vercel/
```

It also ignores and rejects tracked `*.tsbuildinfo` files and generated `next-env.d.ts` files. Build output remains governed through the existing `dist/`, `.next/`, `build/` and `out/` rules.

## CLI launch shims

The four package binaries point to checked-in `.mjs` launch shims. The shims exist before `pnpm install`, so workspace linking does not emit missing-bin warnings. Each shim imports exactly one compiled `dist` entrypoint; production commands still build the CLI before execution.

## Turbo test outputs

Compiled tests depend on same-package `build` and dependency `^build` tasks. Tests consume immutable `dist` output but declare no cache output of their own, preventing misleading “no output files found” warnings.

## Enforcement

```text
pnpm hygiene:check
```

The dependency-free guard checks the ignore policy, tracked-file boundary, temporary publisher removal, permanent readiness workflow, CLI bin map and shims, Turbo test semantics, and the focused readiness workflow gates. It records no secret values and performs no mutation.
