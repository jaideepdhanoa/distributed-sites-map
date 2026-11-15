import assert from "node:assert/strict";
import test from "node:test";
import { POST } from "../../lib/api/handlers/changes";
import { actorFromRequest, agentFromAuthorization, isActor } from "../../lib/changes/auth";
import { deleteClosedPreviewBranches, previewBranchDeletable } from "../../lib/changes/cleanup";
import { signSession } from "../../lib/session";

test("agent tokens name the actor and a session is a human", async () => {
  const saved = {
    indie: process.env.AGENT_WRITE_TOKEN_INDIE,
    muse: process.env.AGENT_WRITE_TOKEN_MUSE,
    users: process.env.AUTH_USERS,
    secret: process.env.AUTH_SECRET,
  };
  try {
    delete process.env.AGENT_WRITE_TOKEN_INDIE;
    delete process.env.AGENT_WRITE_TOKEN_MUSE;
    assert.equal(agentFromAuthorization("Bearer anything"), "missing-env");
    process.env.AGENT_WRITE_TOKEN_INDIE = "indie-test-token";
    process.env.AGENT_WRITE_TOKEN_MUSE = "muse-test-token";
    assert.deepEqual(agentFromAuthorization("Bearer indie-test-token"), { id: "indie", kind: "agent" });
    assert.deepEqual(agentFromAuthorization("Bearer muse-test-token"), { id: "muse", kind: "agent" });
    assert.equal(agentFromAuthorization("Bearer other-token"), "nomatch");

    process.env.AUTH_SECRET = "test-secret";
    process.env.AUTH_USERS = JSON.stringify([{ u: "jaideep", h: "$2b$04$abcdefghijklmnopqrstuu", role: "user" }]);
    const token = await signSession("jaideep");
    const session = await actorFromRequest(new Request("http://localhost/api/changes", { headers: { cookie: `sites_session=${token}` } }));
    assert.equal(isActor(session), true);
    if (isActor(session)) {
      assert.equal(session.id, "jaideep");
      assert.equal(session.kind, "human");
    }
    const both = await actorFromRequest(
      new Request("http://localhost/api/changes", {
        headers: { cookie: `sites_session=${token}`, authorization: "Bearer muse-test-token" },
      }),
    );
    assert.equal(isActor(both) && both.kind, "agent");
    assert.equal(isActor(both) && both.id, "muse");
    const wrong = await actorFromRequest(
      new Request("http://localhost/api/changes", {
        headers: { cookie: `sites_session=${token}`, authorization: "Bearer wrong-token" },
      }),
    );
    assert.equal(isActor(wrong), false);
    const crossSite = await POST(new Request("http://localhost/api/changes", {
      method: "POST",
      headers: { cookie: `sites_session=${token}`, "sec-fetch-site": "cross-site", "content-type": "application/json" },
      body: "{}",
    }));
    assert.equal(crossSite.status, 403);
    assert.match(((await crossSite.json()) as { error: string }).error, /refused/);
    const sameOrigin = await POST(new Request("http://localhost/api/changes", {
      method: "POST",
      headers: { cookie: `sites_session=${token}`, origin: "http://localhost", "content-type": "application/json" },
      body: "{}",
    }));
    assert.equal(sameOrigin.status, 503);

    const wrongBearer = await POST(new Request("http://localhost/api/changes", {
      method: "POST",
      headers: {
        authorization: "Bearer wrong-token",
        cookie: `sites_session=${token}`,
        "sec-fetch-site": "cross-site",
        "content-type": "application/json",
        "idempotency-key": "wrong-bearer",
      },
      body: JSON.stringify({ changes: [] }),
    }));
    assert.equal(wrongBearer.status, 401);
    assert.equal(((await wrongBearer.json()) as { error: string }).error, "Unauthorized");

    const around = {
      database: process.env.DATABASE_URL,
      vercel: process.env.VERCEL_ENV,
      enabled: process.env.CHANGES_API_ENABLED,
    };
    delete process.env.DATABASE_URL;
    delete process.env.VERCEL_ENV;
    delete process.env.CHANGES_API_ENABLED;
    let rightBearer: Response;
    try {
      rightBearer = await POST(new Request("http://localhost/api/changes", {
        method: "POST",
        headers: {
          authorization: "Bearer indie-test-token",
          "sec-fetch-site": "cross-site",
          "content-type": "application/json",
          "idempotency-key": "empty-batch",
        },
        body: JSON.stringify({ changes: [] }),
      }));
    } finally {
      if (around.database === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = around.database;
      if (around.vercel === undefined) delete process.env.VERCEL_ENV;
      else process.env.VERCEL_ENV = around.vercel;
      if (around.enabled === undefined) delete process.env.CHANGES_API_ENABLED;
      else process.env.CHANGES_API_ENABLED = around.enabled;
    }
    const rightBody = (await rightBearer.json()) as { error: string };
    assert.notEqual(rightBearer.status, 401);
    assert.doesNotMatch(rightBody.error, /refused/);
    if (rightBearer.status === 400) assert.match(rightBody.error, /at least one change/);
    else {
      assert.equal(rightBearer.status, 503);
      assert.match(rightBody.error, /database is configured/);
    }
  } finally {
    for (const [key, value] of [
      ["AGENT_WRITE_TOKEN_INDIE", saved.indie],
      ["AGENT_WRITE_TOKEN_MUSE", saved.muse],
      ["AUTH_USERS", saved.users],
      ["AUTH_SECRET", saved.secret],
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("closed pull requests delete preview/<name> branches only", async () => {
  assert.equal(previewBranchDeletable({ name: "preview" }), false);
  assert.equal(previewBranchDeletable({ name: "main" }), false);
  assert.equal(previewBranchDeletable({ name: "production" }), false);
  assert.equal(previewBranchDeletable({ name: "preview/cursor-phase", primary: true }), false);
  assert.equal(previewBranchDeletable({ name: "preview/cursor-phase", protected: true }), false);
  assert.equal(previewBranchDeletable({ name: "preview/cursor-phase" }), true);

  const calls: { url: string; method: string }[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method || "GET";
    calls.push({ url, method });
    if (method === "DELETE") return new Response("{}", { status: 200 });
    return new Response(
      JSON.stringify({
        branches: [
          { id: "br-preview", name: "preview", primary: false },
          { id: "br-main", name: "main", primary: true },
          { id: "br-pr", name: "preview/cursor-phase-2a" },
          { id: "br-keep", name: "preview/keep", protected: true },
        ],
      }),
      { status: 200 },
    );
  };
  const deleted = await deleteClosedPreviewBranches({
    apiKey: "test-api-key",
    projectId: "project-1",
    fetchImpl,
  });
  assert.deepEqual(deleted, ["preview/cursor-phase-2a"]);
  assert.equal(calls.some((call) => call.method === "DELETE" && call.url.endsWith("/br-pr")), true);
  assert.equal(calls.some((call) => call.method === "DELETE" && call.url.endsWith("/br-preview")), false);
  assert.equal(calls.some((call) => call.method === "DELETE" && call.url.endsWith("/br-main")), false);
  assert.equal(JSON.stringify(calls).includes("test-api-key"), false);
});
