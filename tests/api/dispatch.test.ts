import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { NextRequest } from "next/server";
import { allowHeader, apiRoutes, dispatch } from "../../lib/api/dispatch.ts";
import * as askHandler from "../../lib/api/handlers/ask.ts";
import * as askStatus from "../../lib/api/handlers/ask-status.ts";
import * as recommendations from "../../lib/api/handlers/actions/recommendations.ts";
import * as recommendationsDismiss from "../../lib/api/handlers/actions/recommendations-dismiss.ts";

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
  "POST /api/actions/recommendations/:id/dismiss",
  "GET /api/actions/recommendations",
  "DELETE /api/actions/views/:id",
  "GET /api/actions/views",
  "POST /api/actions/views",
  "GET /api/alerts/digest",
  "GET /api/alerts/flush",
  "POST /api/alerts/flush",
  "GET /api/alerts/preferences",
  "PUT /api/alerts/preferences",
  "POST /api/alerts/test",
  "POST /api/agent/inbox/ack",
  "POST /api/agent/inbox/:id/recommendation",
  "GET /api/agent/inbox",
  "GET /api/ask/status",
  "POST /api/ask",
  "GET /api/data/areas",
  "GET /api/data/deals",
  "GET /api/data/depots",
  "GET /api/data/financials/:id",
  "GET /api/data/comms",
  "GET /api/data/nda",
  "GET /api/data/open-loops",
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
  assert.equal((await call("OPTIONS", "/api/agent/inbox")).headers.get("allow"), "GET, HEAD, OPTIONS");
  assert.equal((await call("OPTIONS", "/api/agent/inbox/ack")).headers.get("allow"), "OPTIONS, POST");
  assert.equal((await call("OPTIONS", "/api/agent/inbox/inbox-row-1/recommendation")).headers.get("allow"), "OPTIONS, POST");
  assert.equal((await call("OPTIONS", "/api/actions/recommendations")).headers.get("allow"), "GET, HEAD, OPTIONS");
  assert.equal((await call("OPTIONS", "/api/actions/recommendations/rec-1/dismiss")).headers.get("allow"), "OPTIONS, POST");
  assert.equal((await call("OPTIONS", "/api/ask")).headers.get("allow"), "OPTIONS, POST");
  assert.equal((await call("OPTIONS", "/api/ask/status")).headers.get("allow"), "GET, HEAD, OPTIONS");
});

test("the new agent and ask routes dispatch to their handlers", async () => {
  assert.equal((await call("GET", "/api/agent/inbox/ack")).status, 405);
  assert.equal((await call("POST", "/api/ask/status")).status, 405);
  assert.equal((await call("GET", "/api/ask")).status, 405);
  const previous = process.env.AGENT_INBOX_SECRET;
  delete process.env.AGENT_INBOX_SECRET;
  try {
    assert.equal((await call("GET", "/api/agent/inbox")).status, 401);
    assert.equal((await call("POST", "/api/agent/inbox/ack")).status, 401);
    assert.equal((await call("POST", "/api/agent/inbox/inbox-row-1/recommendation")).status, 401);
  } finally {
    if (previous === undefined) delete process.env.AGENT_INBOX_SECRET;
    else process.env.AGENT_INBOX_SECRET = previous;
  }
  const byPath = new Map(apiRoutes.map((route) => [route.path, route]));
  assert.equal(byPath.get("/api/ask")?.methods.POST, askHandler.POST);
  assert.equal(byPath.get("/api/ask/status")?.methods.GET, askStatus.GET);
  assert.equal(byPath.get("/api/actions/recommendations")?.methods.GET, recommendations.GET);
  assert.equal(byPath.get("/api/actions/recommendations/:id/dismiss")?.methods.POST, recommendationsDismiss.POST);
});

test("ask streams from the catch-all instead of its own function", () => {
  const ask = readFileSync("lib/api/handlers/ask.ts", "utf8");
  const route = readFileSync("app/api/[...route]/route.ts", "utf8");
  assert.match(ask, /streamAnswer/);
  assert.equal(ask.includes("maxDuration"), false);
  assert.match(route, /maxDuration = 300/);
  assert.match(route, /return dispatch/);
  assert.equal(route.includes("app/api/ask"), false);
});

test("an unknown path is the app not-found", async () => {
  await assert.rejects(() => call("GET", "/api/no-such-route"));
  await assert.rejects(() => call("GET", "/api/data/timeline/summary/extra"));
});
