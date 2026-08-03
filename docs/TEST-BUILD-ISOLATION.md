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

The focused readiness workflow runs this contract before frozen installation, then repeats the complete governed build boundary after installation.

## Cache declaration

The Turbo test task uses an empty test-output declaration. Tests consume the same package's completed `dist` tree but do not claim a separate `coverage/**` product that the current test commands never create. This removes misleading cache-output warnings.

A future test compiler that writes to shared `dist`, a test command that deletes build output, or a false retained-output declaration fails before dependency-backed execution.
