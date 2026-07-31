import assert from "node:assert/strict";
import test from "node:test";
import { optimiseSvg } from "./index.js";

const SOURCE = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20"><title>Mark</title><path d="M2 2H18V18H2Z"/></svg>';

test("accepts deliveryProfile as the public optimisation alias", () => {
  const result = optimiseSvg(SOURCE, {
    deliveryProfile: "motion",
    stableIdPrefix: "alias-shape",
  });
  assert.equal(result.evidence.profile, "motion");
  assert.equal(result.evidence.stableIds.prefix, "alias-shape");
  assert.equal(result.evidence.stableIds.added, 1);
  assert.equal(result.evidence.rootDimensions, "removed-responsive");
  assert.match(result.svg, /id="alias-shape-0001"/);
  assert.doesNotMatch(result.svg, /\swidth=/i);
  assert.doesNotMatch(result.svg, /\sheight=/i);
});

test("rejects conflicting profile aliases", () => {
  assert.throws(
    () => optimiseSvg(SOURCE, {
      profile: "web",
      deliveryProfile: "motion",
    }),
    /SVG_DELIVERY_PROFILE_CONFLICT/,
  );
});
