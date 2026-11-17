import assert from "node:assert/strict";
import test from "node:test";
import { estimateLabel, estimateSlots, spaceRollup, stallFootprint } from "../../lib/spaces/slots";

test("a 90° stall is 9 ft along the row and 18 ft deep", () => {
  const stall = stallFootprint(90);
  assert.ok(Math.abs(stall.alongFt - 9) < 1e-9);
  assert.ok(Math.abs(stall.depthFt - 18) < 1e-9);
});

test("angled stalls use the projected 9×18 footprint", () => {
  const sixty = stallFootprint(60);
  assert.ok(Math.abs(sixty.alongFt - 9 / Math.sin(Math.PI / 3)) < 1e-9);
  assert.ok(Math.abs(sixty.depthFt - (18 * Math.sin(Math.PI / 3) + 4.5)) < 1e-9);
  const fortyFive = stallFootprint(45);
  assert.ok(Math.abs(fortyFive.alongFt - 9 / Math.sin(Math.PI / 4)) < 1e-9);
  assert.ok(Math.abs(fortyFive.depthFt - (18 + 9) * Math.sin(Math.PI / 4)) < 1e-9);
});

test("slot counts follow the layout and stay labelled Estimated", () => {
  assert.equal(estimateSlots(90, 60, "stalls_90"), 20);
  assert.equal(estimateSlots(90, 42, "stalls_90"), 10);
  assert.equal(estimateSlots(90, 41, "stalls_90"), 0);
  assert.equal(estimateSlots(90, 102, "stalls_90"), 30);
  assert.equal(estimateSlots(8.9, 60, "stalls_90"), 0);
  assert.equal(estimateSlots(90, 60, "stalls_60"), 16);
  assert.equal(estimateSlots(90, 60, "stalls_45"), 14);
  assert.equal(estimateSlots(90, 60, "pull_through"), 7);
  assert.equal(estimateSlots(48, 40, "pull_through"), 4);
  assert.equal(estimateSlots(11, 40, "pull_through"), 0);
  assert.equal(estimateLabel(20, "stall"), "Estimated · 20 stalls");
  assert.equal(estimateLabel(1, "bay"), "Estimated · 1 bay");
  assert.equal(estimateLabel(0, "stall"), "Estimated · 0 stalls");
  assert.equal(spaceRollup(0, 0), "No lots drawn yet");
  assert.equal(spaceRollup(2, 14, 10800), "2 lots · 10,800 sq ft · ~14 slots");
  assert.equal(spaceRollup(1, 20, 5400), "1 lot · 5,400 sq ft · ~20 slots");
});

test("switching layout on the same rectangle changes the estimate", () => {
  const counts = ["stalls_90", "stalls_60", "stalls_45", "pull_through"].map((layout) =>
    estimateSlots(120, 80, layout as "stalls_90"),
  );
  assert.deepEqual(counts, [26, 22, 18, 20]);
});
