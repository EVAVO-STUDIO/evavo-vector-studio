import assert from "node:assert/strict";
import test from "node:test";
import { inspectSvg, optimiseSvg } from "./svg.js";

test("counts implicit path segments and estimated anchors", () => {
  const inspection = inspectSvg('<svg viewBox="0 0 100 100"><path d="M0 0 10 10 L20 20 H30 V40 C40 40 50 50 60 60 Q70 70 80 80 A5 5 0 0 1 90 90 Z"/></svg>');
  assert.equal(inspection.valid, true);
  assert.equal(inspection.pathCount, 1);
  assert.equal(inspection.geometry.commands.move, 1);
  assert.equal(inspection.geometry.commands.line, 2);
  assert.equal(inspection.geometry.commands.horizontal, 1);
  assert.equal(inspection.geometry.commands.vertical, 1);
  assert.equal(inspection.geometry.commands.cubic, 1);
  assert.equal(inspection.geometry.commands.quadratic, 1);
  assert.equal(inspection.geometry.commands.arc, 1);
  assert.equal(inspection.geometry.commands.close, 1);
  assert.equal(inspection.geometry.estimatedAnchorCount, 8);
  assert.equal(inspection.geometry.commandCount, 9);
  assert.equal(inspection.geometry.parseIssueCount, 0);
});

test("rejects active handlers and external image references", () => {
  const inspection = inspectSvg('<svg viewBox="0 0 10 10" onload="run()"><image href="https://example.com/a.png"/><a href="javascript:run()"><path d="M0 0L1 1"/></a></svg>');
  assert.equal(inspection.valid, false);
  assert.equal(inspection.eventHandlerCount, 1);
  assert.equal(inspection.javascriptHrefCount, 1);
  assert.equal(inspection.externalRasterCount, 1);
  assert.ok(inspection.findings.some((finding) => finding.code === "SVG_EVENT_HANDLER_PRESENT"));
  assert.ok(inspection.findings.some((finding) => finding.code === "SVG_EXTERNAL_RASTER"));
});

test("reports malformed path parameter groups without executing SVG", () => {
  const inspection = inspectSvg('<svg viewBox="0 0 10 10"><path d="M0 0 C1 2 3"/></svg>');
  assert.equal(inspection.valid, true);
  assert.equal(inspection.geometry.parseIssueCount, 1);
  assert.ok(inspection.findings.some((finding) => finding.code === "SVG_PATH_PARSE_ISSUE"));
});

test("editable delivery adds deterministic collision-safe path IDs", () => {
  const result = optimiseSvg(
    '<svg viewBox="0 0 10 10"><path d="M0 0L1 1"/><path id="vector-shape-0001" d="M2 2L3 3"/></svg>',
    { profile: "editable" },
  );

  assert.equal(result.inspection.valid, true);
  assert.equal(result.evidence.profile, "editable");
  assert.equal(result.evidence.stableIds.enabled, true);
  assert.equal(result.evidence.stableIds.added, 1);
  assert.equal(result.evidence.stableIds.preserved, 1);
  assert.equal(result.evidence.stableIds.collisionSkips, 1);
  assert.match(result.svg, /<path id="vector-shape-0001-2"/);
  assert.equal(result.inspection.topology.idCount, 2);
  assert.equal(result.inspection.topology.duplicateIdCount, 0);
});

test("web delivery removes responsive dimensions and unreferenced metadata without adding IDs", () => {
  const result = optimiseSvg(
    '<?xml version="1.0"?><svg width="100" height="50" viewBox="0 0 100 50"><metadata>draft</metadata><path fill="#AABBCC" d="M0 0L1 1"/></svg>',
    { profile: "web" },
  );

  assert.equal(result.inspection.valid, true);
  assert.equal(result.evidence.stableIds.enabled, false);
  assert.equal(result.evidence.metadataElementsRemoved, 1);
  assert.equal(result.evidence.paintValuesNormalised, 1);
  assert.equal(result.evidence.rootDimensions, "removed-responsive");
  assert.equal(result.inspection.width, null);
  assert.equal(result.inspection.height, null);
  assert.equal(result.svg.includes("<metadata"), false);
  assert.match(result.svg, /fill="#abc"/);
  assert.equal(result.svg.includes(" id="), false);
});

test("profile transforms roll back when removing metadata would break a local reference", () => {
  const result = optimiseSvg(
    '<svg width="10" height="10" viewBox="0 0 10 10"><metadata id="retained"/><use href="#retained"/></svg>',
    { profile: "web" },
  );

  assert.equal(result.inspection.valid, true);
  assert.equal(result.evidence.safetyRollbackApplied, true);
  assert.equal(result.evidence.metadataElementsRemoved, 0);
  assert.equal(result.evidence.rootDimensions, "preserved");
  assert.match(result.svg, /<metadata id="retained"\/>/);
  assert.equal(result.inspection.topology.unresolvedReferenceCount, 0);
});

test("document normalisation preserves meaningful text whitespace", () => {
  const result = optimiseSvg(
    '<svg viewBox="0 0 10 10"><text>hello   world</text></svg>',
    { profile: "print" },
  );
  assert.match(result.svg, /hello   world/);
});

test("rejects unsafe custom stable ID prefixes", () => {
  assert.throws(
    () => optimiseSvg('<svg viewBox="0 0 10 10"><path d="M0 0L1 1"/></svg>', {
      profile: "motion",
      stableIdPrefix: "1 invalid prefix",
    }),
    /SVG_STABLE_ID_PREFIX_INVALID/,
  );
});
