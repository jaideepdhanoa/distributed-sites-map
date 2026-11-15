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
    replies: "instant",
    flags: "instant",
    assignments: "instant",
    recommendations: "instant",
    proposals: "instant",
    decisions: "instant",
    stages: "instant",
    followed: "digest",
  });
  assert.deepEqual(defaultPreferences("contributor"), {
    approvals: "off",
    mentions: "instant",
    replies: "instant",
    flags: "instant",
    assignments: "instant",
    recommendations: "digest",
    proposals: "digest",
    decisions: "digest",
    stages: "digest",
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
    followed: "off",
  });
});

test("the morning digest sends when it is on, including a quiet day", () => {
  assert.equal(shouldSendDigest({ items: 0, queueCount: 0, digestOn: true }), true);
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
    assert.equal(defaults?.recommendations, "instant");
    assert.equal(defaults?.stages, "instant");
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
