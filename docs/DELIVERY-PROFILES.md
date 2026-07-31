# Vector delivery profiles

EVAVO Vector Studio separates reconstruction quality from delivery intent. A successful trace first produces measured vector geometry and alpha-aware evidence, then applies one governed delivery profile. Delivery packaging never converts deterministic completion into production approval.

## Shared reconstruction boundary

All profiles inherit the same source and safety rules:

- hidden RGB beneath fully transparent pixels is ignored;
- partially transparent colour evidence is alpha-weighted;
- visible-content bounds, coverage and aspect ratio are recorded;
- candidate selection balances measured render fidelity and geometry cost;
- scripts, event handlers, `foreignObject`, unresolved local references, external raster references and duplicate IDs fail closed;
- output is written with new-file-only semantics;
- unsafe profile transforms use safety rollback rather than retaining a broken result;
- human review remains required for curves, topology, negative space, brand fidelity, motion timing, accessibility and destination compatibility.

## Editable master (`editable`)

The editable master profile is the default for tracing, SVG optimisation, API, CLI, MCP, durable batches and object-backed worker jobs.

It:

- preserves root `width` and `height` when present;
- preserves metadata unless another safe optimiser removes it before packaging;
- adds deterministic, collision-safe stable path IDs;
- preserves existing IDs;
- records the stable ID prefix, number added, number preserved and collision skips;
- produces suitable named targets for later manual editing, comparison and motion authoring.

Default generated IDs use `vector-shape-0001`, `vector-shape-0002` and so on. A custom `stableIdPrefix` is accepted only when it begins with a letter or underscore and contains only letters, numbers, underscores, periods or hyphens.

## Web compact (`web`)

The web compact profile prepares a safe responsive SVG without inventing motion targets.

It:

- does not generate stable path IDs;
- removes root `width` and `height` only when a valid `viewBox` exists;
- removes unreferenced metadata;
- normalises simple hexadecimal paint values;
- preserves topology and local-reference counts;
- rolls back the profile transform if metadata removal or another rewrite would invalidate a reference or introduce a safety failure.

The result remains an SVG asset, not a complete performance guarantee. Review bytes, path count, estimated anchors, paint order, browser rendering and the intended loading context.

## Motion ready (`motion`)

The motion ready profile creates deterministic animation targets while retaining responsive scaling.

It:

- adds deterministic, collision-safe stable path IDs using the default `motion-shape` prefix;
- removes root `width` and `height` only with a valid `viewBox`;
- removes unreferenced metadata;
- normalises simple paint values;
- reports whether every path has an available stable target ID;
- remains compatible with the governed motion-v1, animated SVG and Lottie workflows only when those later subset checks pass.

Motion readiness does not imply that every reconstructed path should move. A human must still define semantic groups, transform origins, timing, easing and reduced-motion behaviour.

## Print safe (`print`)

The print safe profile performs conservative document normalisation while preserving explicit root dimensions.

It:

- does not generate path IDs;
- preserves `width` and `height`;
- preserves metadata;
- normalises simple paint values;
- retains a valid `viewBox` when present;
- avoids web-specific responsive rewrites.

Print production still requires destination-specific review of physical size, colour space, spot colours, overprint, bleed, stroke scaling, font outlining and the final PDF or application export. SVG packaging alone cannot prove those requirements.

## Evidence

Every packaged SVG reports:

```text
deliveryProfile
stablePathIdCount
stableIdPrefix
optimisationPasses
metadataElementsRemoved
paintValuesNormalised
rootDimensions
localReferenceCountPreserved
unresolvedReferenceCountPreserved
safetyRollbackApplied
```

Raster traces include the same fields inside selected-candidate evidence. CLI and MCP operations return file receipts rather than embedding generated SVG or PNG bodies in agent context.

## Direct examples

CLI tracing:

```powershell
pnpm vector:trace -- .\source\mark.png `
  --out .\output\mark.motion.svg `
  --delivery-profile motion `
  --stable-id-prefix brand-mark `
  --diff-out .\output\mark.motion.difference.png
```

CLI packaging:

```powershell
pnpm vector:optimise -- .\source\mark.svg `
  --out .\output\mark.web.svg `
  --delivery-profile web
```

MCP trace options:

```json
{
  "inputPath": "C:\\EVAVO\\VectorAssets\\source\\mark.png",
  "outputSvgPath": "C:\\EVAVO\\VectorAssets\\output\\mark.editable.svg",
  "deliveryProfile": "editable",
  "stableIdPrefix": "mark-shape",
  "evidenceLevel": "summary"
}
```

## Durable batch manifests

The same delivery contract is accepted by `trace-raster` and `optimise-svg` batch items. The selected profile and optional stable ID prefix are part of the canonical manifest revision, so changing delivery intent under an existing job ID fails as manifest drift rather than silently reusing an incompatible output.

```json
{
  "version": "1.0",
  "id": "brand-motion-assets-v1",
  "name": "Motion-ready brand assets",
  "failureMode": "continue",
  "items": [
    {
      "id": "primary-mark",
      "operation": "optimise-svg",
      "spec": {
        "inputPath": "source/primary-mark.svg",
        "outputPath": "output/primary-mark.motion.svg",
        "evidenceOutputPath": "output/primary-mark.motion.evidence.json",
        "deliveryProfile": "motion",
        "stableIdPrefix": "primary-mark"
      }
    }
  ]
}
```

The local batch CLI, MCP durable batch tools and their shared operation registry retain compact delivery evidence in job state while writing full evidence to the declared JSON output. Object-backed worker jobs use the same profile vocabulary through their separately validated payload boundary. All automated surfaces default to `editable` when no profile is supplied.

`stableIdPrefix` is valid only with `editable` and `motion`. `web` and `print` reject a supplied prefix rather than ignoring it. Completed items are reused only when both their canonical input revision and output receipts still verify.

## Approval boundary

A profile is a governed packaging decision, not an artistic verdict. Production use remains human review required even when SVG safety, structural validation, render comparison, stable IDs and delivery-profile checks all pass.
