import assert from "node:assert/strict";
import test from "node:test";
import { actionsDown, quietActionsFetch } from "../../lib/actions/quiet.ts";

test("one actions 503 stops the reads that follow", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return new Response("no", { status: 503 });
  }) as typeof fetch;
  try {
    const first = quietActionsFetch("/api/queue");
    const second = quietActionsFetch("/api/actions/accounts");
    assert.equal((await first).status, 503);
    assert.equal((await second).status, 503);
    assert.equal(calls, 1);
    assert.equal(actionsDown(), true);
  } finally {
    globalThis.fetch = original;
  }
});
