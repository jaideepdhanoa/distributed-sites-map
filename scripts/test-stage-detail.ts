import assert from "node:assert/strict";
import { stageDetail } from "../lib/labels.ts";

assert.equal(stageDetail("Dropped", "dropped"), "Dropped");
assert.equal(stageDetail("1 Desk screen", "desk"), "Desk screen");
assert.equal(stageDetail("2 Financial screen", "contacted"), "Financial screen");
assert.equal(stageDetail("Dropped (not enough spare land)", "dropped"), "Dropped (not enough spare land)");
assert.equal(stageDetail("Dropped ((not enough spare land))", "dropped"), "Dropped (not enough spare land)");
assert.equal(stageDetail("2 Financial screen", "financial"), "Financial screen");
assert.equal(stageDetail("3 Site checks", "checks"), "Site checks");
console.log("stage labels ok");
