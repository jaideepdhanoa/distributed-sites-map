import assert from "node:assert/strict";
import test from "node:test";
import { GET as digest } from "../../lib/api/handlers/alerts/digest";
import { GET as flushGet, POST as flushPost } from "../../lib/api/handlers/alerts/flush";
import { authorizeJob } from "../../lib/alerts/job";

const FIXTURE = "cron-secret";

async function expectUnauthorized(response: Response) {
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "Unauthorized" });
}

test("flush and digest handlers reject a missing or junk bearer", async () => {
  const previous = process.env.CRON_SECRET;
  process.env.CRON_SECRET = FIXTURE;
  try {
    await expectUnauthorized(await digest(new Request("http://localhost/api/alerts/digest")));
    await expectUnauthorized(await digest(new Request("http://localhost/api/alerts/digest", {
      headers: { authorization: `Bearer nope` },
    })));
    await expectUnauthorized(await flushPost(new Request("http://localhost/api/alerts/flush", { method: "POST" })));
    await expectUnauthorized(await flushPost(new Request("http://localhost/api/alerts/flush", {
      method: "POST",
      headers: { authorization: "Bearer nope" },
    })));
    await expectUnauthorized(await flushGet(new Request("http://localhost/api/alerts/flush")));
    await expectUnauthorized(await flushGet(new Request("http://localhost/api/alerts/flush", {
      headers: { authorization: "Bearer" },
    })));
    assert.equal(await authorizeJob(new Request("http://localhost/api/alerts/flush", {
      method: "POST",
      headers: { authorization: `Bearer ${FIXTURE}` },
    })), true);
    assert.equal(await authorizeJob(new Request("http://localhost/api/alerts/digest")), false);
    delete process.env.CRON_SECRET;
    await expectUnauthorized(await flushPost(new Request("http://localhost/api/alerts/flush", {
      method: "POST",
      headers: { authorization: `Bearer ${FIXTURE}` },
    })));
  } finally {
    if (previous === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = previous;
  }
});
