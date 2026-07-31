import assert from "node:assert/strict";
import test from "node:test";
import {
  SvgPrintPreflightError,
  preflightSvgForPrint,
} from "./print-preflight.js";

test("commercial preflight verifies exact trim and bleed dimensions", () => {
  const result = preflightSvgForPrint(
    '<svg width="216mm" height="303mm" viewBox="0 0 216 303"><path fill="#111" d="M0 0H216V303H0Z"/></svg>',
    {
      profile: "commercial",
      trimWidthMm: 210,
      trimHeightMm: 297,
      bleedMm: 3,
    },
  );

  assert.equal(result.contractVersion, "1.0");
  assert.equal(result.profile, "commercial");
  assert.equal(result.passed, true);
  assert.equal(result.canvas.widthMm, 216);
  assert.equal(result.canvas.heightMm, 303);
  assert.equal(result.canvas.explicitPhysicalUnits, true);
  assert.equal(result.target.dimensionsMatched, true);
  assert.ok(
    result.findings.some(
      (finding) => finding.code === "PRINT_TRIM_BLEED_DIMENSIONS_MATCH",
    ),
  );
  assert.equal(result.approval, "review-required");
});

test("commercial preflight rejects CSS pixel canvas dimensions", () => {
  const result = preflightSvgForPrint(
    '<svg width="800px" height="600px" viewBox="0 0 800 600"><path d="M0 0H800V600H0Z"/></svg>',
  );

  assert.equal(result.passed, false);
  assert.equal(result.canvas.explicitPhysicalUnits, false);
  assert.ok(
    result.findings.some(
      (finding) =>
        finding.code === "PRINT_PHYSICAL_UNITS_REQUIRED" &&
        finding.severity === "error",
    ),
  );
});

test("large-format preflight permits CSS pixel dimensions with a warning", () => {
  const result = preflightSvgForPrint(
    '<svg width="1920" height="1080" viewBox="0 0 1920 1080"><path d="M0 0H1920V1080H0Z"/></svg>',
    { profile: "large-format" },
  );

  assert.equal(result.passed, true);
  assert.ok(
    result.findings.some(
      (finding) =>
        finding.code === "PRINT_PHYSICAL_UNITS_REQUIRED" &&
        finding.severity === "warning",
    ),
  );
});

test("preflight rejects a physical and viewBox aspect-ratio mismatch", () => {
  const result = preflightSvgForPrint(
    '<svg width="100mm" height="100mm" viewBox="0 0 200 100"><path d="M0 0H200V100H0Z"/></svg>',
  );

  assert.equal(result.passed, false);
  assert.ok(
    result.findings.some(
      (finding) => finding.code === "PRINT_ASPECT_RATIO_MISMATCH",
    ),
  );
});

test("cut-vinyl preflight rejects live text and complex paint", () => {
  const result = preflightSvgForPrint(
    '<svg width="100mm" height="50mm" viewBox="0 0 100 50"><defs><linearGradient id="g"><stop stop-color="#000"/><stop offset="1" stop-color="#fff"/></linearGradient></defs><text opacity="0.5">Cut me</text><path fill="url(#g)" d="M0 0H100V50H0Z"/></svg>',
    { profile: "cut-vinyl" },
  );

  assert.equal(result.passed, false);
  for (const code of [
    "PRINT_TEXT_REMAINS",
    "PRINT_GRADIENT_PRESENT",
    "PRINT_TRANSPARENCY_PRESENT",
  ]) {
    assert.ok(
      result.findings.some(
        (finding) => finding.code === code && finding.severity === "error",
      ),
    );
  }
});

test("screen-print preflight enforces a configured process-colour ceiling", () => {
  const result = preflightSvgForPrint(
    '<svg width="100mm" height="100mm" viewBox="0 0 100 100"><path fill="#f00" d="M0 0H30V100H0Z"/><path fill="#0f0" d="M35 0H65V100H35Z"/><path fill="#00f" d="M70 0H100V100H70Z"/></svg>',
    { profile: "screen-print", maximumProcessColours: 2 },
  );

  assert.equal(result.features.uniqueProcessColourCount, 3);
  assert.equal(result.passed, false);
  assert.ok(
    result.findings.some(
      (finding) => finding.code === "PRINT_PROCESS_COLOUR_LIMIT_EXCEEDED",
    ),
  );
});

test("cut-vinyl preflight rejects measured strokes below the line-weight floor", () => {
  const result = preflightSvgForPrint(
    '<svg width="100mm" height="100mm" viewBox="0 0 100 100"><path fill="none" stroke="#000" stroke-width="0.05" d="M0 50H100"/></svg>',
    { profile: "cut-vinyl", minimumStrokePt: 0.25 },
  );

  assert.equal(result.strokes.measuredStrokeCount, 1);
  assert.equal(result.strokes.belowMinimumCount, 1);
  assert.equal(result.passed, false);
  assert.ok(
    result.findings.some(
      (finding) =>
        finding.code === "PRINT_STROKE_BELOW_MINIMUM" &&
        finding.severity === "error",
    ),
  );
});

test("commercial preflight can allow embedded raster while retaining resolution warning", () => {
  const result = preflightSvgForPrint(
    '<svg width="100mm" height="100mm" viewBox="0 0 100 100"><image href="data:image/png;base64,AA==" width="100" height="100"/></svg>',
    { allowEmbeddedRaster: true },
  );

  assert.equal(result.passed, true);
  assert.equal(result.features.embeddedRasterCount, 1);
  assert.ok(
    result.findings.some(
      (finding) => finding.code === "PRINT_RASTER_RESOLUTION_UNVERIFIED",
    ),
  );
  assert.equal(
    result.findings.some(
      (finding) => finding.code === "PRINT_EMBEDDED_RASTER_REVIEW",
    ),
    false,
  );
});

test("preflight requires trim dimensions as an atomic pair", () => {
  assert.throws(
    () =>
      preflightSvgForPrint(
        '<svg width="100mm" height="100mm" viewBox="0 0 100 100"/>',
        { trimWidthMm: 90 },
      ),
    (error: unknown) =>
      error instanceof SvgPrintPreflightError &&
      error.code === "SVG_PRINT_PREFLIGHT_OPTIONS_INVALID",
  );
});
