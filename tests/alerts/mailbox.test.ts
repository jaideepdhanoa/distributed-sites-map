import assert from "node:assert/strict";
import test from "node:test";
import alertDefaults from "../../config/alerts.json";
import { accountEmail } from "../../lib/alerts/recipients";
import { INSTANT_DAILY_CAP } from "../../lib/alerts/clock";
import { digestCadence } from "../../lib/alerts/cadence";
import { defaultPreferences } from "../../lib/alerts/preferences";
import { liveMailAllowed } from "../../lib/alerts/transport";
import { getUsers } from "../../lib/users";

const hash = "$2b$08$012345678901234567890u";

test("live mail includes the team and still uses the role defaults and the instant cap", () => {
  assert.deepEqual(alertDefaults.liveUsernames, [
    "jaideep",
    "cindel",
    "ming",
    "ricardo",
    "yuka",
    "jason",
    "mark",
    "brittni",
    "jose",
  ]);
  for (const id of alertDefaults.liveUsernames) assert.equal(liveMailAllowed(id), true);
  assert.equal(liveMailAllowed("muse"), false);
  assert.equal(liveMailAllowed("indie"), false);
  assert.equal(INSTANT_DAILY_CAP, 6);
  assert.deepEqual(alertDefaults.weeklyOnlyUsernames, ["ming"]);
  assert.deepEqual(digestCadence("jason"), { daily: true, weekly: true });
  assert.deepEqual(digestCadence("jaideep"), { daily: true, weekly: true });
  assert.deepEqual(digestCadence("ming"), { daily: false, weekly: true });
  assert.deepEqual(digestCadence("indie"), { daily: true, weekly: false });
  assert.equal(defaultPreferences("contributor").mentions, "instant");
  assert.equal(defaultPreferences("contributor").followed, "instant");
  assert.equal(defaultPreferences("contributor").proposals, "digest");
  assert.equal(defaultPreferences("reviewer").followed, "instant");
  assert.equal(defaultPreferences("viewer").followed, "off");
  assert.equal(defaultPreferences("reviewer").approvals, "instant");
  assert.equal(defaultPreferences("viewer").comments, "off");
});

test("the named admin account resolves to its mailbox and reviewer defaults", () => {
  const previous = process.env.AUTH_USERS;
  const emails = process.env.ALERT_EMAILS;
  process.env.AUTH_USERS = JSON.stringify([
    { u: "jaideep", h: hash, role: "user" },
    { u: "contributor", h: hash, role: "user", actionRole: "contributor" },
  ]);
  delete process.env.ALERT_EMAILS;
  try {
    const accounts = getUsers();
    const admin = accounts.find((user) => user.u === "jaideep");
    assert.equal(admin?.role, "admin");
    assert.equal(admin?.actionRole, "reviewer");
    assert.equal(accountEmail("jaideep"), "jaideep@dhanoa.in");
    assert.equal(defaultPreferences("reviewer").approvals, "instant");
    assert.equal(defaultPreferences("contributor").approvals, "off");
    assert.equal(accountEmail("contributor"), null);
  } finally {
    if (previous == null) delete process.env.AUTH_USERS;
    else process.env.AUTH_USERS = previous;
    if (emails == null) delete process.env.ALERT_EMAILS;
    else process.env.ALERT_EMAILS = emails;
  }
});

test("preview elevation stops in production and never adds a mailbox", () => {
  const previousUsers = process.env.AUTH_USERS;
  const previousEnv = process.env.VERCEL_ENV;
  process.env.AUTH_USERS = JSON.stringify([
    { u: "indie", h: hash, role: "user", actionRole: "contributor" },
  ]);
  try {
    process.env.VERCEL_ENV = "production";
    let account = getUsers().find((user) => user.u === "indie");
    assert.equal(account?.role, "user");
    assert.equal(account?.actionRole, "contributor");
    assert.equal(account?.email, "");
    assert.equal(accountEmail("indie"), null);
    assert.equal(liveMailAllowed("indie"), false);

    delete process.env.VERCEL_ENV;
    account = getUsers().find((user) => user.u === "indie");
    assert.equal(account?.role, "user");
    assert.equal(account?.actionRole, "contributor");

    process.env.VERCEL_ENV = "preview";
    account = getUsers().find((user) => user.u === "indie");
    assert.equal(account?.role, "admin");
    assert.equal(account?.actionRole, "reviewer");
    assert.equal(accountEmail("indie"), null);
    assert.equal(liveMailAllowed("indie"), false);
    assert.equal(defaultPreferences("reviewer").approvals, "instant");
  } finally {
    if (previousUsers == null) delete process.env.AUTH_USERS;
    else process.env.AUTH_USERS = previousUsers;
    if (previousEnv == null) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = previousEnv;
  }
});
