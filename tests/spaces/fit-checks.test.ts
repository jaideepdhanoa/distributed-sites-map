import assert from "node:assert/strict";
import test from "node:test";
import { checkSpaceFit } from "../../lib/spaces/fitCheck";
import type { Zone } from "../../lib/spaces/options";

const frame = { width: 100, height: 100, metersPerPixel: 0.304801 };
function footprint(length: number, depth: number): Zone {
  return {kind: "parking", label: "Test footprint", points: [[0,0],[length,0],[length,depth],[0,depth]]};
}
test("distinguishes four physical fit outcomes using the same source scale", () => {
  assert.equal(checkSpaceFit(footprint(55,51),frame).check, "inside");
  assert.equal(checkSpaceFit(footprint(48,43),frame).check, "clearance");
  assert.equal(checkSpaceFit(footprint(36,22),frame).check, "adjacent");
  assert.equal(checkSpaceFit(footprint(35,20),frame).check, "short");
});
test("holds unscaled, irregular and interior footprints for measurement", () => {
  const row = footprint(55,51);
  assert.equal(checkSpaceFit(row).check,"measure");
  assert.equal(checkSpaceFit({...row, points:row.points.slice(0,3)},frame).check,"measure");
  assert.equal(checkSpaceFit({...row, kind:"bay"},frame).check,"interior");
});
