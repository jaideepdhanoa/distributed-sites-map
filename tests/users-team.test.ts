import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import test from "node:test";
import { resolveActionRole } from "../lib/actions/roles";
import { findUserByLogin, passwordMatches } from "../lib/login";
import { getUsers } from "../lib/users";

const hash = bcrypt.hashSync("team-pass", 8);
const primary = { u: "owner", h: hash, role: "admin", name: "Owner" };
const teammate = { u: "teammate", h: hash, role: "user", name: "Teammate" };
const overlap = { u: "owner", h: hash, role: "user", name: "Not owner" };

function withEnv(users: string | undefined, team: string | undefined, run: () => void) {
  const previousUsers = process.env.AUTH_USERS;
  const previousTeam = process.env.AUTH_USERS_TEAM;
  if (users == null) delete process.env.AUTH_USERS;
  else process.env.AUTH_USERS = users;
  if (team == null) delete process.env.AUTH_USERS_TEAM;
  else process.env.AUTH_USERS_TEAM = team;
  try {
    run();
  } finally {
    if (previousUsers == null) delete process.env.AUTH_USERS;
    else process.env.AUTH_USERS = previousUsers;
    if (previousTeam == null) delete process.env.AUTH_USERS_TEAM;
    else process.env.AUTH_USERS_TEAM = previousTeam;
  }
}

test("AUTH_USERS_TEAM accounts sign in and resolve as contributors", () => {
  withEnv(JSON.stringify([primary]), JSON.stringify([teammate]), () => {
    const names = getUsers().map((user) => user.u);
    assert.deepEqual(names, ["owner", "teammate"]);
    const account = findUserByLogin("Teammate");
    assert.equal(account?.u, "teammate");
    assert.equal(passwordMatches(account, "team-pass"), true);
    assert.equal(resolveActionRole(account || { role: "user" }), "contributor");
  });
});

test("a username in both lists keeps the AUTH_USERS account", () => {
  withEnv(JSON.stringify([primary]), JSON.stringify([overlap, teammate]), () => {
    const owner = getUsers().find((user) => user.u === "owner");
    assert.equal(owner?.role, "admin");
    assert.equal(owner?.displayName, "Owner");
    assert.equal(getUsers().filter((user) => user.u === "owner").length, 1);
  });
});

test("a missing or invalid AUTH_USERS_TEAM is ignored and its value is not logged", () => {
  const lines: string[] = [];
  const info = console.info;
  const error = console.error;
  console.info = (message?: unknown) => { lines.push(String(message)); };
  console.error = (message?: unknown) => { lines.push(String(message)); };
  const secret = "team-secret-value-should-not-appear";
  try {
    withEnv(JSON.stringify([primary]), undefined, () => {
      assert.deepEqual(getUsers().map((user) => user.u), ["owner"]);
    });
    withEnv(JSON.stringify([primary]), secret, () => {
      assert.deepEqual(getUsers().map((user) => user.u), ["owner"]);
    });
    withEnv(JSON.stringify([primary]), JSON.stringify({ u: "nope" }), () => {
      assert.deepEqual(getUsers().map((user) => user.u), ["owner"]);
    });
  } finally {
    console.info = info;
    console.error = error;
  }
  const text = lines.join("\n");
  assert.match(text, /auth_users_team_ignored/);
  assert.match(text, /"reason":"missing"/);
  assert.match(text, /"reason":"invalid"/);
  assert.equal(text.includes(secret), false);
  assert.equal(text.includes("nope"), false);
});
