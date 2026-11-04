import assert from "node:assert/strict";
import { stageDetail } from "../lib/labels.ts";

assert.equal(stageDetail("Dropped", "dropped"), "Dropped");
assert.equal(stageDetail("Dropped (not enough spare land)", "dropped"), "Dropped (not enough spare land)");
assert.equal(stageDetail("Dropped ((not enough spare land))", "dropped"), "Dropped (not enough spare land)");
console.log("stage labels ok");
