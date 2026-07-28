import assert from "node:assert/strict";
import test from "node:test";
import { LottieEngineError } from "./errors.js";
import { prepareSvgSourceForLottie } from "./svg-source.js";

const SOURCE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="10 20 200 100">
  <title>Layered mark</title>
  <path id="background" fill="#ffffff" d="M10 20h200v100H10z"/>
  <g id="mark" fill="#ff244e">
    <path id="body" d="M30 40h80v50H30z"/>
    <path id="accent" fill="rgba(0,0,0,.5)" fill-rule="evenodd" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="bevel" d="M50 50h40v30H50z"/>
  </g>
</svg>`;

test("extracts source-ordered static and animated path render units", () => {
  const prepared = prepareSvgSourceForLottie(SOURCE, ["mark"], 4);

  assert.deepEqual(prepared.viewBox, [10, 20, 200, 100]);
  assert.equal(prepared.width, 200);
  assert.equal(prepared.height, 100);
  assert.equal(prepared.pathElementCount, 3);
  assert.equal(prepared.renderUnits.length, 2);

  const background = prepared.renderUnits[0];
  const mark = prepared.renderUnits[1];
  assert.equal(background?.id, "background");
  assert.equal(background?.animatedTargetId, null);
  assert.deepEqual(background?.bounds, {
    minX: 0,
    minY: 0,
    maxX: 200,
    maxY: 100,
  });

  assert.equal(mark?.id, "mark");
  assert.equal(mark?.animatedTargetId, "mark");
  assert.deepEqual(mark?.paths.map((path) => path.id), ["body", "accent"]);
  assert.deepEqual(mark?.paths[0]?.style.fill?.colour, [1, 36 / 255, 78 / 255]);
  assert.equal(mark?.paths[1]?.style.fillRule, 2);
  assert.equal(mark?.paths[1]?.style.fill?.opacity, 0.5);
  assert.equal(mark?.paths[1]?.style.stroke?.width, 2);
  assert.equal(mark?.paths[1]?.style.stroke?.lineCap, 2);
  assert.equal(mark?.paths[1]?.style.stroke?.lineJoin, 3);
});

test("rejects unflattened transforms, unsupported primitives and group opacity", () => {
  const invalidSources = [
    `<svg viewBox="0 0 10 10"><g id="mark" transform="translate(1 1)"><path d="M0 0h5v5H0z"/></g></svg>`,
    `<svg viewBox="0 0 10 10"><g id="mark"><rect width="5" height="5"/></g></svg>`,
    `<svg viewBox="0 0 10 10"><g id="mark" opacity="0.5"><path d="M0 0h5v5H0z"/></g></svg>`,
  ];

  for (const source of invalidSources) {
    assert.throws(
      () => prepareSvgSourceForLottie(source, ["mark"]),
      (error: unknown) =>
        error instanceof LottieEngineError &&
        error.code === "LOTTIE_SOURCE_UNSUPPORTED",
    );
  }
});

test("rejects missing and overlapping motion targets", () => {
  assert.throws(
    () => prepareSvgSourceForLottie(SOURCE, ["missing"]),
    (error: unknown) =>
      error instanceof LottieEngineError &&
      error.code === "LOTTIE_TARGET_MISSING",
  );

  const nested = `<svg viewBox="0 0 10 10"><g id="outer"><g id="inner"><path d="M0 0h5v5H0z"/></g></g></svg>`;
  assert.throws(
    () => prepareSvgSourceForLottie(nested, ["outer", "inner"]),
    (error: unknown) =>
      error instanceof LottieEngineError &&
      error.code === "LOTTIE_TARGET_OVERLAP",
  );
});

test("rejects network-independent but unsupported style semantics", () => {
  const dashed = `<svg viewBox="0 0 10 10"><path id="mark" fill="none" stroke="#000" stroke-dasharray="2 2" d="M0 0L10 10"/></svg>`;
  assert.throws(
    () => prepareSvgSourceForLottie(dashed, ["mark"]),
    (error: unknown) =>
      error instanceof LottieEngineError &&
      error.code === "LOTTIE_SOURCE_UNSUPPORTED",
  );
});
