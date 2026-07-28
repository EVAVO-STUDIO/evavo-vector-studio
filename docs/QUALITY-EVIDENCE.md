# Quality evidence and approval

EVAVO Vector Studio treats vector production as a chain of separate claims. A completed trace is not automatically a good trace, a close pixel match is not automatically editable geometry, and a technically safe SVG is not automatically an approved brand asset.

## Evidence layers

### 1. Source evidence

The raster engine records:

- byte-detected format and MIME type;
- encoded byte count;
- width, height and decoded pixel count;
- SHA-256 of the original encoded source;
- sampled alpha coverage;
- estimated palette complexity and dominant colours;
- luminance range, entropy and saturation;
- edge-density signals;
- suggested artwork profile and the signals behind it.

The source is rejected before native decoding when its header is malformed, its encoded size exceeds the application limit, or its declared canvas exceeds the decoded-pixel limit.

### 2. Reconstruction evidence

Every completed candidate records the exact configuration used for:

- colour versus binary tracing;
- stacked versus cutout hierarchy;
- colour precision and layer difference;
- speckle filtering;
- corner, length and splice thresholds;
- spline iteration and path precision;
- palette-preservation intent.

Adaptive mode may produce base, fidelity and economy candidates. Candidate count is bounded by source pixels. Alternative failures are retained rather than hidden.

### 3. Geometry evidence

The selected SVG inspection records:

- paths and paths missing `d` data;
- path-data bytes;
- explicit and implicit path commands;
- estimated anchors;
- straight and curved segments;
- subpaths and command-parse issues;
- groups, gradients and filters.

Anchor counts are estimates derived from path commands. They are suitable for comparison and review, not a claim that the system has reconstructed an editor's private object model.

### 4. Topology and editability evidence

The topology pass checks:

- total, unique and duplicate IDs;
- local fragment references and unresolved references;
- duplicate path data;
- compound paths;
- closed and open subpaths;
- paths with potentially filled open subpaths;
- explicit even-odd fill rules;
- remaining text elements;
- `use`, `symbol` and style indirection;
- clip paths, masks, transforms and primitive shapes.

Duplicate IDs and unresolved local references are structural blockers. Remaining text and duplicate paths are review warnings. Open filled paths, use instances and style blocks are surfaced as editability information because they can be intentional but deserve inspection.

The topology parser is deliberately bounded and document-oriented. It does not claim to solve arbitrary computational geometry, self-intersection, winding equivalence under every transform, or semantic layer naming.

### 5. Render evidence

Each completed candidate is rasterised with system fonts disabled and compared with the decoded source at bounded scales up to 64, 256 and 1024 pixels on the longest edge.

Metrics include:

- premultiplied RGB mean absolute error;
- alpha mean absolute error;
- black-composite error;
- white-composite error;
- aggregate visual mean absolute error;
- root-mean-square visual error;
- mismatch-pixel fraction;
- aspect-ratio drift.

The evidence includes the exact thresholds used for `excellent`, `good` and `review` classifications.

### 6. Candidate selection evidence

Selection is visual-first.

When all candidates require review, the best measured visual candidate wins. Otherwise, an alternative may be selected only when it remains in the same quality class and inside declared visual-cost, mismatch and aspect-ratio tolerances relative to the best visual result.

Among eligible candidates, the engine selects the lowest declared geometry cost. The response includes the cost weights and every candidate score so the decision is inspectable.

### 7. Difference-image evidence

When requested, the engine creates one PNG heatmap for the selected candidate only.

The artefact records:

- selected candidate ID;
- width and height;
- byte count;
- SHA-256;
- requested maximum dimension;
- bilinear source-sampling policy;
- white-to-red colour map;
- declared display amplification.

White indicates measured agreement and red indicates visual difference. Display amplification makes small differences visible; it does not alter the underlying render metrics.

The browser verifies the base64 transport, byte count, PNG signature, embedded PNG dimensions, selected-candidate binding and SHA-256 before displaying or offering the artefact for download.

## Safety evidence

Governed SVG inspection rejects:

- scripts;
- `foreignObject`;
- inline event handlers;
- `javascript:` references;
- external raster dependencies;
- external stylesheet or HTTP URL references;
- duplicate IDs;
- unresolved local fragment references.

An SVG can pass these checks and still need artistic repair.

## Approval states

### Execution complete

The bounded operation finished and declared outputs were produced.

### Render comparison passed

The selected result met the declared measured render threshold.

### Review required

A person must inspect the artwork. This remains the production state for every generated trace.

### Production approved

Not currently issued automatically. A future approval workflow must identify the reviewer, reviewed artefact hashes, decision, notes and time. It must not infer approval from a score or a download.

## What the evidence cannot prove

The current system cannot automatically prove that:

- a logo preserves every optical correction made by its designer;
- Bézier handles are placed as economically as an expert would place them;
- negative space and winding are semantically ideal under every editor;
- layers and names match a future animator's preferred structure;
- gradients, masks and compound paths are the best creative construction;
- an animated treatment is appropriate.

Those limits are explicit so automation can be powerful without becoming misleading.
