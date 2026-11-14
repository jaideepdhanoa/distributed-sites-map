import assert from "node:assert/strict";
import { stripPlace, stripStats, stripTip } from "../lib/rangeStrip.ts";

const stats = stripStats([10, 20, 30, 40]);
assert.ok(stats);
assert.equal(stats.min, 10);
assert.equal(stats.max, 40);
assert.equal(stats.median, 25);
assert.equal(stats.zero, false);

const low = stripPlace(10, stats, "lower");
const high = stripPlace(40, stats, "lower");
const mid = stripPlace(25, stats, "lower");
assert.equal(low.left, 0);
assert.equal(high.left, 100);
assert.equal(low.tone, "better");
assert.equal(high.tone, "worse");
assert.equal(mid.tone, "neutral");
assert.equal(low.rank, 1);
assert.equal(high.rank, 4);

const higher = stripPlace(40, stats, "higher");
assert.equal(higher.tone, "better");
assert.equal(higher.rank, 1);
assert.equal(stripPlace(10, stats, "higher").tone, "worse");
assert.equal(stripPlace(20, stats, "neutral").tone, "neutral");

const cash = stripStats([100, -50, 200], true);
assert.ok(cash);
assert.equal(cash.min, -50);
assert.equal(cash.max, 200);
assert.equal(cash.zero, true);
const negative = stripPlace(-50, cash, "higher", true);
assert.equal(negative.tone, "negative");
assert.ok(negative.zeroLeft != null);
assert.ok(negative.left < negative.zeroLeft);

const ties = stripStats([5, 5, 9]);
assert.ok(ties);
assert.equal(stripPlace(5, ties, "lower").rank, 1);
assert.equal(stripPlace(9, ties, "lower").rank, 3);

assert.equal(stripTip("$7.1x", "6.0x", 2, 9), "$7.1x · median 6.0x · rank 2 of 9 in this filter");
assert.equal(stripStats([]), null);
assert.equal(stripPlace(3, stripStats([3])!, "higher").left, 50);
assert.equal(stripPlace(3, stripStats([3])!, "higher").tone, "neutral");

console.log("range strip ok");
