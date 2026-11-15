import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, test } from "node:test";
import { migrate } from "../../lib/actions/migrate";
import { DEFAULT_BATCH_MS } from "../../lib/alerts/clock";
import { notifyFlag } from "../../lib/alerts/notify";
import { backgroundFlushDelayMs, runScheduledFlush, scheduleInstantFlush } from "../../lib/alerts/schedule";
import { memorySql } from "../helpers/sql";

describe("alert scheduling", { concurrency: 1 }, () => {
test("the background flush waits just past the debounce and stays capped", () => {
  const previous = process.env.ALERT_BATCH_MS;
  try {
    delete process.env.ALERT_BATCH_MS;
    assert.equal(backgroundFlushDelayMs(), DEFAULT_BATCH_MS + 1_000);
    process.env.ALERT_BATCH_MS = "0";
    assert.equal(backgroundFlushDelayMs(), 0);
    process.env.ALERT_BATCH_MS = "10000";
    assert.equal(backgroundFlushDelayMs(), 11_000);
    process.env.ALERT_BATCH_MS = "600000";
    assert.equal(backgroundFlushDelayMs(), 90_000);
  } finally {
    if (previous == null) delete process.env.ALERT_BATCH_MS;
    else process.env.ALERT_BATCH_MS = previous;
  }
});

test("the scheduled flush waits without opening a database", async () => {
  const previous = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  try {
    let waited = -1;
    await runScheduledFlush(25, async (ms) => {
      waited = ms;
    });
    assert.equal(waited, 25);
  } finally {
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
  }
});

test("scheduling outside a request does not wait or throw", async () => {
  const previousDatabase = process.env.DATABASE_URL;
  const previousBatch = process.env.ALERT_BATCH_MS;
  delete process.env.DATABASE_URL;
  delete process.env.ALERT_BATCH_MS;
  try {
    const start = Date.now();
    scheduleInstantFlush();
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.ok(Date.now() - start < 2_000);
  } finally {
    if (previousDatabase === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabase;
    if (previousBatch == null) delete process.env.ALERT_BATCH_MS;
    else process.env.ALERT_BATCH_MS = previousBatch;
  }
});

test("a zero window sends the queued alert before the request returns", async () => {
  const previousUsers = process.env.AUTH_USERS;
  const previousBatch = process.env.ALERT_BATCH_MS;
  const hash = "$2b$04$abcdefghijklmnopqrstuuabcdefghijklmnopqrstuuabcdefghijk";
  process.env.AUTH_USERS = JSON.stringify([
    { u: "jaideep", h: hash, role: "admin", actionRole: "reviewer", name: "Jaideep" },
    { u: "contributor", h: hash, role: "user", actionRole: "contributor", name: "Contributor" },
  ]);
  process.env.ALERT_BATCH_MS = "0";
  delete process.env.RESEND_API_KEY;
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASS;
  const sql = await memorySql();
  await migrate(sql);
  try {
    await notifyFlag(sql, {
      id: randomUUID(),
      siteId: "PIPE-PHX-0067",
      fromUser: "contributor",
      toUser: "jaideep",
      note: "Please look at this site.",
    });
    const rows = await sql.query<{ status: string }>(`SELECT status FROM alert_outbox`);
    assert.equal(rows.rows[0]?.status, "would_send");
    const logs = await sql.query<{ status: string }>(`SELECT status FROM alert_log`);
    assert.equal(logs.rows.length, 1);
    assert.equal(logs.rows[0]?.status, "would_send");
  } finally {
    if (previousUsers == null) delete process.env.AUTH_USERS;
    else process.env.AUTH_USERS = previousUsers;
    if (previousBatch == null) delete process.env.ALERT_BATCH_MS;
    else process.env.ALERT_BATCH_MS = previousBatch;
  }
});

test("a flag queues an instant alert and does not send it in the request", async () => {
  const previousUsers = process.env.AUTH_USERS;
  const previousBatch = process.env.ALERT_BATCH_MS;
  const hash = "$2b$04$abcdefghijklmnopqrstuuabcdefghijklmnopqrstuuabcdefghijk";
  process.env.AUTH_USERS = JSON.stringify([
    { u: "jaideep", h: hash, role: "admin", actionRole: "reviewer", name: "Jaideep" },
    { u: "contributor", h: hash, role: "user", actionRole: "contributor", name: "Contributor" },
  ]);
  delete process.env.ALERT_BATCH_MS;
  delete process.env.RESEND_API_KEY;
  const sql = await memorySql();
  await migrate(sql);
  try {
    await notifyFlag(sql, {
      id: randomUUID(),
      siteId: "PIPE-PHX-0067",
      fromUser: "contributor",
      toUser: "jaideep",
      note: "Please look at this site.",
    });
    const rows = await sql.query<{ status: string; user_id: string; author_id: string }>(
      `SELECT status, user_id, author_id FROM alert_outbox`,
    );
    assert.equal(rows.rows.length, 1);
    assert.equal(rows.rows[0]?.status, "pending");
    assert.equal(rows.rows[0]?.user_id, "jaideep");
    assert.equal(rows.rows[0]?.author_id, "contributor");
    const logs = await sql.query(`SELECT id FROM alert_log`);
    assert.equal(logs.rows.length, 0);
  } finally {
    if (previousUsers == null) delete process.env.AUTH_USERS;
    else process.env.AUTH_USERS = previousUsers;
    if (previousBatch == null) delete process.env.ALERT_BATCH_MS;
    else process.env.ALERT_BATCH_MS = previousBatch;
  }
});
});
