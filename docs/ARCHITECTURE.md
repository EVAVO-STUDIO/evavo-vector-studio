# Architecture

EVAVO Vector Studio will use a governed multi-stage vector-production pipeline:

1. Inspect the source image.
2. Classify artwork type and intended output.
3. Clean noise, halos and compression artefacts.
4. Segment colours, transparency and visual regions.
5. Detect edges, contours, corners and curves.
6. Reconstruct intentional vector geometry.
7. Fit and optimise Bézier paths.
8. Preserve negative space and compound shapes.
9. Rebuild fills, strokes, gradients and layers.
10. Simplify paths under bounded visual-error constraints.
11. Validate SVG structure and rendering.
12. Compare rasterised SVG output against the source.
13. Produce quality evidence and editable deliverables.
14. Optionally construct SVG or Lottie animation.

Automated output must remain inspectable, deterministic where possible, and suitable for professional editing.
