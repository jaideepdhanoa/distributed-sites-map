import assert from "node:assert/strict";
import test from "node:test";
import { losAngelesParts } from "../../lib/alerts/clock";
import { defaultPreferences, shouldSendDigest } from "../../lib/alerts/preferences";

test("role defaults", () => {
  assert.deepEqual(defaultPreferences("reviewer"), {
    approvals: "instant",
    mentions: "instant",
    replies: "instant",
    flags: "instant",
    assignments: "instant",
    followed: "digest",
  });
  assert.deepEqual(defaultPreferences("contributor"), {
    approvals: "off",
    mentions: "instant",
    replies: "instant",
    flags: "instant",
    assignments: "instant",
    followed: "digest",
  });
  assert.deepEqual(defaultPreferences("viewer"), {
    approvals: "off",
    mentions: "instant",
    replies: "off",
    flags: "off",
    assignments: "off",
    followed: "off",
  });
});

test("the digest is skipped when there is nothing to report", () => {
  assert.equal(shouldSendDigest({ items: 0, queueCount: 0, digestOn: true }), false);
  assert.equal(shouldSendDigest({ items: 0, queueCount: 4, digestOn: false }), false);
  assert.equal(shouldSendDigest({ items: 0, queueCount: 4, digestOn: true }), true);
  assert.equal(shouldSendDigest({ items: 2, queueCount: 0, digestOn: false }), true);
});

test("7:00 AM Pacific is hour 7 in winter and summer", () => {
  assert.equal(losAngelesParts(new Date("2026-11-09T15:00:00.000Z")).hour, 7);
  assert.equal(losAngelesParts(new Date("2026-07-09T14:00:00.000Z")).hour, 7);
  assert.equal(losAngelesParts(new Date("2026-11-09T15:00:00.000Z")).day, "2026-11-09");
});
