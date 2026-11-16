import assert from "node:assert/strict";
import test from "node:test";
import { migrate } from "../../lib/actions/migrate";
import { losAngelesParts } from "../../lib/alerts/clock";
import { defaultPreferences, loadPreferences, savePreferences, shouldSendDigest } from "../../lib/alerts/preferences";
import { memorySql } from "../helpers/sql";

test("role defaults", () => {
  assert.deepEqual(defaultPreferences("reviewer"), {
    approvals: "instant",
    mentions: "instant",
    replies: "digest",
    flags: "instant",
    assignments: "instant",
    recommendations: "digest",
    proposals: "instant",
    decisions: "instant",
    stages: "digest",
    asks: "digest",
    followed: "digest",
  });
  assert.deepEqual(defaultPreferences("contributor"), {
    approvals: "off",
    mentions: "instant",
    replies: "digest",
    flags: "instant",
    assignments: "instant",
    recommendations: "digest",
    proposals: "digest",
    decisions: "digest",
    stages: "digest",
    asks: "digest",
    followed: "digest",
  });
  assert.deepEqual(defaultPreferences("viewer"), {
    approvals: "off",
    mentions: "instant",
    replies: "off",
    flags: "off",
    assignments: "off",
    recommendations: "off",
    proposals: "off",
    decisions: "off",
    stages: "off",
    asks: "off",
    followed: "off",
  });
});

test("the digest is skipped when there is nothing to report", () => {
  assert.equal(shouldSendDigest({ items: 0, queueCount: 0, digestOn: true }), false);
  assert.equal(shouldSendDigest({ items: 0, queueCount: 4, digestOn: false }), false);
  assert.equal(shouldSendDigest({ items: 0, queueCount: 4, digestOn: true }), true);
  assert.equal(shouldSendDigest({ items: 2, queueCount: 0, digestOn: false }), true);
});

test("new categories default on and can be saved", async () => {
  const previous = process.env.AUTH_USERS;
  process.env.AUTH_USERS = JSON.stringify([
    { u: "jaideep", h: "$2b$04$abcdefghijklmnopqrstuuabcdefghijklmnopqrstuuabcdefghijk", role: "user" },
  ]);
  const sql = await memorySql();
  await migrate(sql);
  try {
    const defaults = await loadPreferences(sql, "jaideep");
    assert.equal(defaults?.recommendations, "digest");
    assert.equal(defaults?.stages, "digest");
    assert.equal(defaults?.decisions, "instant");
    assert.equal(defaults?.asks, "digest");
    const saved = await savePreferences(sql, "jaideep", { ...defaults, stages: "off", recommendations: "digest" });
    assert.equal(saved?.stages, "off");
    const loaded = await loadPreferences(sql, "jaideep");
    assert.equal(loaded?.stages, "off");
    assert.equal(loaded?.recommendations, "digest");
    assert.equal(loaded?.approvals, "instant");
  } finally {
    if (previous == null) delete process.env.AUTH_USERS;
    else process.env.AUTH_USERS = previous;
  }
});

test("7:00 AM Pacific is hour 7 in winter and summer", () => {
  assert.equal(losAngelesParts(new Date("2026-11-09T15:00:00.000Z")).hour, 7);
  assert.equal(losAngelesParts(new Date("2026-07-09T14:00:00.000Z")).hour, 7);
  assert.equal(losAngelesParts(new Date("2026-11-09T15:00:00.000Z")).day, "2026-11-09");
});
