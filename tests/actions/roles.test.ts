import assert from "node:assert/strict";
import test from "node:test";
import { canDecide, canWriteContent, resolveActionRole, roleAllows } from "../../lib/actions/roles";
import { getUsers } from "../../lib/users";

test("defaults keep admin as reviewer and user as viewer", () => {
  delete process.env.ACTION_ROLE_MAP;
  assert.equal(resolveActionRole({ role: "admin", roleLabel: "admin", actionRole: null }), "reviewer");
  assert.equal(resolveActionRole({ role: "user", roleLabel: "user", actionRole: null }), "viewer");
});

test("the role map changes labels and ignores account names", () => {
  process.env.ACTION_ROLE_MAP = JSON.stringify({ user: "contributor", "some-person": "reviewer" });
  assert.equal(resolveActionRole({ role: "user", roleLabel: "user", actionRole: null }), "contributor");
  assert.equal(
    resolveActionRole({ role: "user", roleLabel: "user", actionRole: null }),
    "contributor",
  );
  delete process.env.ACTION_ROLE_MAP;
});

test("an account actionRole wins over the map", () => {
  process.env.ACTION_ROLE_MAP = JSON.stringify({ user: "viewer" });
  assert.equal(resolveActionRole({ role: "user", roleLabel: "user", actionRole: "contributor" }), "contributor");
  assert.equal(resolveActionRole({ role: "user", roleLabel: "reviewer", actionRole: "reviewer" }), "reviewer");
  delete process.env.ACTION_ROLE_MAP;
});

test("a broken map falls back to the defaults", () => {
  process.env.ACTION_ROLE_MAP = "{";
  assert.equal(resolveActionRole({ role: "admin", roleLabel: "admin" }), "reviewer");
  assert.equal(resolveActionRole({ role: "user", roleLabel: "user" }), "viewer");
  delete process.env.ACTION_ROLE_MAP;
});

test("permissions follow viewer, contributor, reviewer", () => {
  assert.equal(canWriteContent("viewer"), false);
  assert.equal(canWriteContent("contributor"), true);
  assert.equal(canDecide("contributor"), false);
  assert.equal(canDecide("reviewer"), true);
  assert.equal(roleAllows("reviewer", "contributor"), true);
  assert.equal(roleAllows("viewer", "contributor"), false);
});

test("account parsing reads actionRole and does not invent names", () => {
  process.env.AUTH_USERS = JSON.stringify([
    { u: "owner", h: "$2b$12$abcdefghijklmnopqrstuv", role: "admin" },
    { u: "writer", h: "$2b$12$abcdefghijklmnopqrstuv", role: "user", actionRole: "contributor" },
    { u: "guest", h: "$2b$12$abcdefghijklmnopqrstuv", role: "viewer" },
    { u: "skip", h: "not-a-hash", role: "admin" },
  ]);
  const users = getUsers();
  assert.deepEqual(users.map((user) => [user.u, user.role, user.actionRole]), [
    ["owner", "admin", null],
    ["writer", "user", "contributor"],
    ["guest", "user", "viewer"],
  ]);
  delete process.env.AUTH_USERS;
});
