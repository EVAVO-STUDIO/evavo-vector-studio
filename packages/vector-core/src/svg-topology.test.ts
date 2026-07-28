import assert from "node:assert/strict";
import test from "node:test";
import { inspectSvg } from "./svg.js";
import { inspectSvgTopology } from "./svg-topology.js";

test("rejects duplicate IDs and unresolved local references", () => {
  const inspection = inspectSvg(
    '<svg viewBox="0 0 10 10"><defs><linearGradient id="paint"/><clipPath id="paint"/></defs><path fill="url(#missing)" d="M0 0L10 0Z"/></svg>',
  );

  assert.equal(inspection.valid, false);
  assert.equal(inspection.topology.idCount, 2);
  assert.equal(inspection.topology.uniqueIdCount, 1);
  assert.equal(inspection.topology.duplicateIdCount, 1);
  assert.equal(inspection.topology.localReferenceCount, 1);
  assert.equal(inspection.topology.unresolvedReferenceCount, 1);
  assert.ok(inspection.findings.some((finding) => finding.code === "SVG_DUPLICATE_ID"));
  assert.ok(inspection.findings.some((finding) => finding.code === "SVG_LOCAL_REFERENCE_UNRESOLVED"));
});

test("reports duplicate paths, open filled geometry and unoutlined text without declaring the SVG unsafe", () => {
  const inspection = inspectSvg(
    '<svg viewBox="0 0 10 10"><path id="shape" d="M0 0L10 0" fill="#000"/><path d="M0,0 L10,0" fill="#000"/><use href="#shape"/><text>Word</text><style>.x{fill:red}</style></svg>',
  );

  assert.equal(inspection.valid, true);
  assert.equal(inspection.topology.duplicatePathDataCount, 1);
  assert.equal(inspection.topology.openSubpathCount, 2);
  assert.equal(inspection.topology.potentialOpenFilledPathCount, 2);
  assert.equal(inspection.topology.textElementCount, 1);
  assert.equal(inspection.topology.useElementCount, 1);
  assert.equal(inspection.topology.styleElementCount, 1);
  assert.equal(inspection.topology.unresolvedReferenceCount, 0);
  assert.ok(inspection.findings.some((finding) => finding.code === "SVG_DUPLICATE_PATH_DATA"));
  assert.ok(inspection.findings.some((finding) => finding.code === "SVG_TEXT_NOT_OUTLINED"));
  assert.ok(inspection.findings.some((finding) => finding.code === "SVG_OPEN_FILLED_SUBPATH"));
});

test("counts compound and explicitly even-odd geometry", () => {
  const topology = inspectSvgTopology(
    '<svg viewBox="0 0 10 10"><g transform="translate(1 1)"><path fill-rule="evenodd" d="M0 0L10 0L10 10Z M2 2L3 2L3 3Z"/><rect x="0" y="0" width="1" height="1"/></g></svg>',
  );

  assert.equal(topology.pathElementCount, 1);
  assert.equal(topology.compoundPathCount, 1);
  assert.equal(topology.closedSubpathCount, 2);
  assert.equal(topology.openSubpathCount, 0);
  assert.equal(topology.evenOddFillPathCount, 1);
  assert.equal(topology.transformedElementCount, 1);
  assert.equal(topology.nonPathShapeCount, 1);
});
