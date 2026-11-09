import assert from "node:assert/strict";
import test from "node:test";
import { accountEmail } from "../../lib/alerts/recipients";
import { defaultPreferences } from "../../lib/alerts/preferences";
import { getUsers } from "../../lib/users";

const hash = "$2b$08$012345678901234567890u";

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
