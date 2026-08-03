# Deterministic test and build isolation

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
