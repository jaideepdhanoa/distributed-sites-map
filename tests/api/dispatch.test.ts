import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { allowHeader, apiRoutes, dispatch } from "../../lib/api/dispatch.ts";

const expected = [
  "GET /api/actions/accounts",
  "GET /api/actions/audit",
  "POST /api/actions/exports",
  "POST /api/actions/notes/:id/reopen",
  "POST /api/actions/notes/:id/resolve",
  "PATCH /api/actions/notes/:id",
  "DELETE /api/actions/notes/:id",
  "GET /api/actions/notes",
  "POST /api/actions/notes",
  "GET /api/actions/status",
  "GET /api/actions/suggestions/export",
  "POST /api/actions/suggestions/:id/done",
  "POST /api/actions/suggestions/:id",
  "PATCH /api/actions/suggestions/:id",
  "GET /api/actions/suggestions",
  "POST /api/actions/suggestions",
  "DELETE /api/actions/views/:id",
  "GET /api/actions/views",
  "POST /api/actions/views",
  "GET /api/alerts/digest",
  "GET /api/alerts/flush",
  "POST /api/alerts/flush",
  "GET /api/alerts/preferences",
  "PUT /api/alerts/preferences",
  "POST /api/alerts/test",
  "GET /api/data/areas",
  "GET /api/data/deals",
  "GET /api/data/depots",
  "GET /api/data/financials/:id",
  "GET /api/data/funnel",
  "GET /api/data/grid",
  "GET /api/data/parcels",
  "GET /api/data/sites/:id",
  "GET /api/data/sites",
  "GET /api/data/timeline/summary",
  "GET /api/data/timeline",
  "GET /api/data/unscreened",
  "POST /api/login",
  "POST /api/logout",
  "GET /api/me",
  "POST /api/queue/flag",
  "POST /api/queue/follow",
  "POST /api/queue/mentions",
  "POST /api/queue/snooze",
  "GET /api/queue",
  "POST /api/queue",
];

function listed() {
  return apiRoutes.flatMap((route) => Object.keys(route.methods).map((method) => `${method} ${route.path}`));
}

test("the dispatcher keeps every API url except photos", () => {
  assert.deepEqual(listed().sort(), [...expected].sort());
  assert.equal(apiRoutes.some((route) => route.path.includes("photos")), false);
});

test("allow headers match a route file that exports only those methods", () => {
  assert.equal(allowHeader(["POST"]), "OPTIONS, POST");
  assert.equal(allowHeader(["GET"]), "GET, HEAD, OPTIONS");
  assert.equal(allowHeader(["GET", "POST"]), "GET, HEAD, OPTIONS, POST");
  assert.equal(allowHeader(["DELETE", "PATCH"]), "DELETE, OPTIONS, PATCH");
});

async function call(method: string, path: string) {
  const parts = path.split("/").filter(Boolean).slice(1);
  return dispatch(method, new NextRequest(`http://localhost${path}`), parts);
}

test("an unsupported method is an empty 405", async () => {
  const response = await call("GET", "/api/login");
  assert.equal(response.status, 405);
  assert.equal(await response.text(), "");
  assert.equal(response.headers.get("allow"), null);
});

test("options advertises the methods of that path", async () => {
  assert.equal((await call("OPTIONS", "/api/login")).headers.get("allow"), "OPTIONS, POST");
  assert.equal((await call("OPTIONS", "/api/data/deals")).headers.get("allow"), "GET, HEAD, OPTIONS");
  assert.equal((await call("OPTIONS", "/api/actions/notes")).headers.get("allow"), "GET, HEAD, OPTIONS, POST");
  assert.equal((await call("OPTIONS", "/api/actions/notes/abc")).headers.get("allow"), "DELETE, OPTIONS, PATCH");
  assert.equal((await call("OPTIONS", "/api/actions/suggestions/export")).headers.get("allow"), "GET, HEAD, OPTIONS");
  assert.equal((await call("OPTIONS", "/api/actions/suggestions/abc")).headers.get("allow"), "OPTIONS, PATCH, POST");
  assert.equal((await call("OPTIONS", "/api/alerts/flush")).headers.get("allow"), "GET, HEAD, OPTIONS, POST");
});

test("an unknown path is the app not-found", async () => {
  await assert.rejects(() => call("GET", "/api/no-such-route"));
  await assert.rejects(() => call("GET", "/api/data/timeline/summary/extra"));
});
