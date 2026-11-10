import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import test from "node:test";
import { findUserByLogin, passwordMatches } from "../lib/login";

const hash = bcrypt.hashSync("correct-horse", 8);

function withUsers(run: () => void) {
  const previousUsers = process.env.AUTH_USERS;
  const previousEmails = process.env.ALERT_EMAILS;
  process.env.AUTH_USERS = JSON.stringify([
    { u: "jaideep", h: hash, role: "user", name: "Jaideep" },
    { u: "indie", h: hash, role: "user", actionRole: "contributor", name: "Indie" },
    { u: "cindel", h: hash, role: "user", actionRole: "contributor", name: "Cindel" },
    { u: "other", h: hash, role: "user", actionRole: "viewer", name: "Other", email: "other@example.com" },
    { u: "twin", h: hash, role: "user", actionRole: "viewer", name: "Twin", email: "shared@example.com" },
  ]);
  process.env.ALERT_EMAILS = JSON.stringify({ cindel: "Cindel.Pena@Moove.io", other: "shared@example.com" });
  try {
    run();
  } finally {
    if (previousUsers == null) delete process.env.AUTH_USERS;
    else process.env.AUTH_USERS = previousUsers;
    if (previousEmails == null) delete process.env.ALERT_EMAILS;
    else process.env.ALERT_EMAILS = previousEmails;
  }
}

test("username sign-in is unchanged, including accounts with no mailbox", () => {
  withUsers(() => {
    const indie = findUserByLogin("  Indie  ");
    assert.equal(indie?.u, "indie");
    assert.equal(passwordMatches(indie, "correct-horse"), true);
    assert.equal(passwordMatches(indie, "wrong-password"), false);
    assert.equal(findUserByLogin("indie@example.com"), undefined);
  });
});

test("an email resolves to the mailbox alerts use, in any case", () => {
  withUsers(() => {
    assert.equal(findUserByLogin("  CINDEL.PENA@MOOVE.IO ").u, "cindel");
    assert.equal(findUserByLogin("jaideep@dhanoa.in")?.u, "jaideep");
    assert.equal(passwordMatches(findUserByLogin("cindel.pena@moove.io"), "correct-horse"), true);
    assert.equal(passwordMatches(findUserByLogin("cindel.pena@moove.io"), "nope"), false);
  });
});

test("unknown email and a shared mailbox do not reveal an account", () => {
  withUsers(() => {
    assert.equal(findUserByLogin("nobody@example.com"), undefined);
    assert.equal(findUserByLogin("shared@example.com"), undefined);
    assert.equal(passwordMatches(undefined, "correct-horse"), false);
    assert.equal(passwordMatches(findUserByLogin("jaideep"), "correct-horse"), true);
  });
});
