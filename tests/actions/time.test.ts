import assert from "node:assert/strict";
import test from "node:test";
import { formatActivityWhen, formatPacific, replyCount } from "../../lib/actions/time";

test("note times are shown in Pacific time", () => {
  assert.equal(formatPacific("2026-11-05T01:18:00.000Z"), "Nov 4, 5:18 PM PT");
  assert.equal(formatPacific("2026-07-05T00:18:00.000Z"), "Jul 4, 5:18 PM PT");
  assert.equal(formatPacific("not-a-time"), "not-a-time");
  const wall = formatActivityWhen("2026-11-13 19:43 PT", false);
  assert.equal(wall.label, "Nov 13, 7:43 PM PT");
  assert.equal(wall.title, "2026-11-13 19:43 PT");
  const approx = formatActivityWhen("2026-11-15T18:20:00-08:00", true);
  assert.equal(approx.label, "Nov 15 (approx.)");
  assert.equal(approx.title, "2026-11-15T18:20:00-08:00");
  assert.equal(formatActivityWhen("2026-11-13", false).label, "Nov 13");
});

test("one reply stays singular", () => {
  assert.equal(replyCount(1), "1 reply");
  assert.equal(replyCount(2), "2 replies");
  assert.equal(replyCount(0), "0 replies");
});
