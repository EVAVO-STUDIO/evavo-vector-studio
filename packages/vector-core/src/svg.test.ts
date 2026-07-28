import assert from "node:assert/strict";
import test from "node:test";
import { inspectSvg } from "./svg.js";

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
