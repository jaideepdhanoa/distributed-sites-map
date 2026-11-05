import assert from "node:assert/strict";
import test from "node:test";
import { formatPacific, replyCount } from "../../lib/actions/time";

test("note times are shown in Pacific time", () => {
  assert.equal(formatPacific("2026-11-05T01:18:00.000Z"), "Nov 4, 5:18 PM PT");
  assert.equal(formatPacific("2026-07-05T00:18:00.000Z"), "Jul 4, 5:18 PM PT");
  assert.equal(formatPacific("not-a-time"), "not-a-time");
});

test("one reply stays singular", () => {
  assert.equal(replyCount(1), "1 reply");
  assert.equal(replyCount(2), "2 replies");
  assert.equal(replyCount(0), "0 replies");
});
