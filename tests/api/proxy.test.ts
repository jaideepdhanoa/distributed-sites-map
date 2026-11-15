import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { proxy } from "../../proxy";
import { signSession } from "../../lib/session";

function call(path: string, headers?: HeadersInit) {
  return proxy(new NextRequest(`http://local${path}`, { method: "POST", headers }));
}

test("a bearer on /api/changes reaches the handler and other routes stay closed", async () => {
  const passed = await call("/api/changes", { authorization: "Bearer present" });
  assert.equal(passed.headers.get("x-middleware-next"), "1");
  assert.equal(passed.status, 200);
  assert.equal(passed.headers.get("cache-control"), "private, no-store");
  assert.equal(passed.headers.get("x-robots-tag"), "noindex, nofollow");

  const lower = await call("/api/changes?unused=1", { authorization: "bEaReR present" });
  assert.equal(lower.headers.get("x-middleware-next"), "1");
  assert.equal(lower.status, 200);

  const padded = await call("/api/changes", { authorization: "  Bearer present" });
  assert.equal(padded.headers.get("x-middleware-next"), "1");

  const missing = await call("/api/changes");
  assert.equal(missing.status, 401);
  assert.equal(missing.headers.get("x-middleware-next"), null);
  assert.deepEqual(await missing.json(), { error: "Unauthorized" });

  const basic = await call("/api/changes", { authorization: "Basic present" });
  assert.equal(basic.status, 401);
  assert.deepEqual(await basic.json(), { error: "Unauthorized" });

  const noSpace = await call("/api/changes", { authorization: "Bearer" });
  assert.equal(noSpace.status, 401);

  const nested = await call("/api/changes/extra", { authorization: "Bearer present" });
  assert.equal(nested.status, 401);

  const sites = await call("/api/data/sites", { authorization: "Bearer present" });
  assert.equal(sites.status, 401);
  assert.deepEqual(await sites.json(), { error: "Unauthorized" });

  const page = await proxy(new NextRequest("http://local/map"));
  assert.equal(page.status, 307);
  assert.equal(new URL(page.headers.get("location") || "http://local/").pathname, "/login");
});

test("a bearer on the cron paths reaches the handler and other routes stay closed", async () => {
  for (const path of ["/api/alerts/digest", "/api/alerts/flush", "/api/data/revalidate"]) {
    const passed = await call(path, { authorization: "Bearer present" });
    assert.equal(passed.headers.get("x-middleware-next"), "1", path);
    assert.equal(passed.status, 200, path);
    assert.equal(passed.headers.get("cache-control"), "private, no-store", path);
    assert.equal(passed.headers.get("x-robots-tag"), "noindex, nofollow", path);

    const open = await call(path);
    assert.equal(open.status, 401, path);
    assert.equal(open.headers.get("x-middleware-next"), null, path);
    assert.deepEqual(await open.json(), { error: "Unauthorized" });

    const basic = await call(path, { authorization: "Basic present" });
    assert.equal(basic.status, 401, path);
  }

  const lower = await call("/api/alerts/flush", { authorization: "bEaReR present" });
  assert.equal(lower.headers.get("x-middleware-next"), "1");

  const digest = await proxy(new NextRequest("http://local/api/alerts/digest", {
    method: "GET",
    headers: { authorization: "Bearer present" },
  }));
  assert.equal(digest.headers.get("x-middleware-next"), "1");
  assert.equal(digest.status, 200);

  const preferences = await call("/api/alerts/preferences", { authorization: "Bearer present" });
  assert.equal(preferences.status, 401);
  const sample = await call("/api/alerts/test", { authorization: "Bearer present" });
  assert.equal(sample.status, 401);
  const nestedFlush = await call("/api/alerts/flush/now", { authorization: "Bearer present" });
  assert.equal(nestedFlush.status, 401);
  const nestedRefresh = await call("/api/data/revalidate/extra", { authorization: "Bearer present" });
  assert.equal(nestedRefresh.status, 401);
  const sites = await call("/api/data/sites");
  assert.equal(sites.status, 401);
  assert.deepEqual(await sites.json(), { error: "Unauthorized" });
});

test("a session cookie still opens the API and a bearer is not required", async () => {
  const saved = { secret: process.env.AUTH_SECRET, users: process.env.AUTH_USERS };
  process.env.AUTH_SECRET = "test-secret";
  process.env.AUTH_USERS = JSON.stringify([{ u: "jaideep", h: "$2b$04$abcdefghijklmnopqrstuu", role: "user" }]);
  try {
    const token = await signSession("jaideep");
    const session = await call("/api/changes", { cookie: `sites_session=${token}` });
    assert.equal(session.headers.get("x-middleware-next"), "1");
    assert.equal(session.status, 200);
    assert.equal(session.headers.get("x-robots-tag"), "noindex, nofollow");

    const read = await proxy(new NextRequest("http://local/api/data/sites", { headers: { cookie: `sites_session=${token}` } }));
    assert.equal(read.headers.get("x-middleware-next"), "1");
    assert.equal(read.status, 200);

    const stranger = await call("/api/data/sites", { cookie: "sites_session=not-a-session" });
    assert.equal(stranger.status, 401);
  } finally {
    if (saved.secret === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = saved.secret;
    if (saved.users === undefined) delete process.env.AUTH_USERS;
    else process.env.AUTH_USERS = saved.users;
  }
});
