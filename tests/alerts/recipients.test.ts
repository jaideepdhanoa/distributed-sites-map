import assert from "node:assert/strict";
import test from "node:test";
import { accountEmail, deliveryRecipients } from "../../lib/alerts/recipients";

const hash = "$2b$04$abcdefghijklmnopqrstuuabcdefghijklmnopqrstuuabcdefghijk";

function useUsers() {
  process.env.AUTH_USERS = JSON.stringify([
    { u: "jaideep", h: hash, role: "admin", actionRole: "reviewer", name: "Jaideep", email: "other@example.com" },
    { u: "cindel", h: hash, role: "user", actionRole: "reviewer", name: "Cindel", email: "cindel.pena@moove.io" },
    { u: "viewer", h: hash, role: "user", actionRole: "viewer", name: "Viewer" },
  ]);
}

test("recipient resolution uses the account map and never invents an address", () => {
  const previousUsers = process.env.AUTH_USERS;
  const previousMap = process.env.ALERT_EMAILS;
  useUsers();
  delete process.env.ALERT_EMAILS;
  assert.equal(accountEmail("cindel"), "cindel.pena@moove.io");
  assert.equal(accountEmail("jaideep"), "other@example.com");
  assert.equal(accountEmail("viewer"), null);
  assert.equal(accountEmail("broker@example.com"), null);
  assert.equal(accountEmail("some broker"), null);
  process.env.ALERT_EMAILS = JSON.stringify({
    jaideep: "jaideep@dhanoa.in",
    cindel: "cindel.pena@moove.io",
    stranger: "stranger@example.com",
  });
  assert.equal(accountEmail("jaideep"), "jaideep@dhanoa.in");
  assert.equal(accountEmail("stranger"), null);
  assert.deepEqual(
    deliveryRecipients("cindel", ["cindel", "jaideep", "viewer", "not-an-account"]),
    [{ userId: "jaideep", email: "jaideep@dhanoa.in" }],
  );
  if (previousUsers == null) delete process.env.AUTH_USERS;
  else process.env.AUTH_USERS = previousUsers;
  if (previousMap == null) delete process.env.ALERT_EMAILS;
  else process.env.ALERT_EMAILS = previousMap;
});
