import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { Pool } from "pg";
import type { Sql } from "../../lib/actions/db";
import { migrate } from "../../lib/actions/migrate";
import { DAILY_CAP, losAngelesParts } from "../../lib/alerts/clock";
import { flushInstant } from "../../lib/alerts/deliver";
import { memorySql } from "../helpers/sql";

async function ready() {
  const sql = await memorySql();
  await migrate(sql);
  return sql;
}

async function enqueue(
  sql: Awaited<ReturnType<typeof ready>>,
  createdAt: string,
  id = randomUUID(),
  userId = "reviewer",
  summary = "Next step proposed.",
) {
  await sql.query(
    `INSERT INTO alert_outbox (
      id, idempotency_key, user_id, to_email, category, channel, site_id, site_label, summary, author_id, href, ref_id, created_at, status
    ) VALUES ($1, $2, $4, $5, 'approvals', 'instant', 'PIPE-PHX-0067', 'Sinclair (PIPE-PHX-0067)', $6, 'contributor', '/?view=review&site=PIPE-PHX-0067', $1, $3, 'pending')`,
    [id, `approvals:${id}:${userId}`, createdAt, userId, userId === "jaideep" ? "jaideep@dhanoa.in" : "reviewer@example.com", summary],
  );
  return id;
}

describe("alert batching", { concurrency: 1 }, () => {
test("a burst inside the minute is one email, and a later item does not hold it", async () => {
  const previous = process.env.ALERT_BATCH_MS;
  delete process.env.ALERT_BATCH_MS;
  delete process.env.RESEND_API_KEY;
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASS;
  const sql = await ready();
  const start = Date.parse("2026-11-09T15:00:00.000Z");
  const windowMs = 60_000;
  for (let i = 0; i < 10; i += 1) {
    await enqueue(sql, new Date(start + i * 2_000).toISOString(), randomUUID(), "reviewer", `Next step proposed ${i}.`);
  }
  assert.equal(await flushInstant(sql, new Date(start + windowMs - 1)), 0);
  assert.equal(await flushInstant(sql, new Date(start + windowMs)), 1);
  assert.equal(await flushInstant(sql, new Date(start + 30 * 60_000)), 0);
  const logs = await sql.query<{ status: string; subject: string; body: string }>(`SELECT status, subject, body FROM alert_log`);
  assert.equal(logs.rows.length, 1);
  assert.equal(logs.rows[0]?.status, "would_send");
  assert.equal(logs.rows[0]?.subject, "Distributed Sites · 10 updates");
  assert.equal((logs.rows[0]?.subject || "").includes("daily digest"), false);
  assert.equal((logs.rows[0]?.body || "").includes("Daily digest"), false);
  for (let i = 0; i < 10; i += 1) assert.match(logs.rows[0]?.body || "", new RegExp(`Next step proposed ${i}`));

  const later = start + 10 * 60_000;
  await enqueue(sql, new Date(later).toISOString(), randomUUID(), "reviewer", "A later proposal.");
  assert.equal(await flushInstant(sql, new Date(later + windowMs - 1)), 0);
  assert.equal(await flushInstant(sql, new Date(later + windowMs)), 1);
  const again = await sql.query(`SELECT id FROM alert_log`);
  assert.equal(again.rows.length, 2);
  if (previous == null) delete process.env.ALERT_BATCH_MS;
  else process.env.ALERT_BATCH_MS = previous;
});

test("an older item is sent with anything already waiting, and it does not wait for a future one", async () => {
  delete process.env.ALERT_BATCH_MS;
  delete process.env.RESEND_API_KEY;
  const sql = await ready();
  const start = Date.parse("2026-11-09T16:00:00.000Z");
  await enqueue(sql, new Date(start).toISOString(), randomUUID(), "reviewer", "First proposal.");
  await enqueue(sql, new Date(start + 20_000).toISOString(), randomUUID(), "reviewer", "Second proposal.");
  assert.equal(await flushInstant(sql, new Date(start + 60_000)), 1);
  const first = await sql.query<{ body: string }>(`SELECT body FROM alert_log`);
  assert.match(first.rows[0]?.body || "", /First proposal/);
  assert.match(first.rows[0]?.body || "", /Second proposal/);
  await enqueue(sql, new Date(start + 70_000).toISOString(), randomUUID(), "reviewer", "After the send.");
  assert.equal(await flushInstant(sql, new Date(start + 70_000 + 30_000)), 0);
  assert.equal(await flushInstant(sql, new Date(start + 70_000 + 60_000)), 1);
  const logs = await sql.query<{ body: string }>(`SELECT body FROM alert_log`);
  assert.equal(logs.rows.length, 2);
  const laterMail = logs.rows.find((row) => row.body.includes("After the send"));
  assert.ok(laterMail);
  assert.equal(laterMail.body.includes("First proposal"), false);
});

test("the queued backlog is one digest-style email per person", async () => {
  delete process.env.ALERT_BATCH_MS;
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASS;
  delete process.env.ALERT_FROM;
  process.env.RESEND_API_KEY = "re_test_key";
  process.env.RESEND_EMAIL_DOMAIN = "distributedsites.com";
  const sql = await ready();
  const summaries = [
    "Nov 9 approval.",
    "Nov 10 mention.",
    "Nov 11 reply.",
    "Nov 12 flag.",
    "Nov 13 assignment.",
    "Nov 14 note.",
    "Nov 14 second.",
    "Nov 15 morning.",
  ];
  for (let i = 0; i < summaries.length; i += 1) {
    await enqueue(sql, new Date(Date.parse("2026-11-09T15:00:00.000Z") + i * 24 * 60 * 60_000).toISOString(), randomUUID(), "jaideep", summaries[i]);
  }
  await enqueue(sql, "2026-11-10T15:00:00.000Z", randomUUID(), "reviewer", "Reviewer only.");
  await enqueue(sql, "2026-11-12T15:00:00.000Z", randomUUID(), "reviewer", "Reviewer later.");
  const original = globalThis.fetch;
  const sentTo: string[] = [];
  globalThis.fetch = (async (_url: unknown, init?: { body?: string }) => {
    const body = JSON.parse(String(init?.body || "{}")) as { to?: string[] };
    sentTo.push(body.to?.[0] || "");
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  try {
    assert.equal(await flushInstant(sql, new Date("2026-11-15T18:00:00.000Z")), 2);
    assert.equal(await flushInstant(sql, new Date("2026-11-15T19:00:00.000Z")), 0);
  } finally {
    globalThis.fetch = original;
    delete process.env.RESEND_API_KEY;
    delete process.env.RESEND_EMAIL_DOMAIN;
  }
  assert.deepEqual(sentTo, ["jaideep@dhanoa.in"]);
  const logs = await sql.query<{ user_id: string; status: string; subject: string; body: string; warning: string }>(
    `SELECT user_id, status, subject, body, warning FROM alert_log ORDER BY user_id ASC`,
  );
  assert.equal(logs.rows.length, 2);
  const jaideep = logs.rows.find((row) => row.user_id === "jaideep");
  const reviewer = logs.rows.find((row) => row.user_id === "reviewer");
  assert.equal(jaideep?.status, "sent");
  assert.equal(jaideep?.subject, "Distributed Sites catch-up · 8 updates");
  assert.equal((jaideep?.subject || "").includes("daily digest"), false);
  assert.equal((jaideep?.body || "").includes("Daily digest"), false);
  for (const summary of summaries) assert.match(jaideep?.body || "", new RegExp(summary.replace(".", "\\.")));
  assert.equal(reviewer?.status, "would_send");
  assert.match(reviewer?.warning || "", /not approved for live mail/);
  const left = await sql.query(`SELECT id FROM alert_outbox WHERE status = 'pending'`);
  assert.equal(left.rows.length, 0);
});

test("a fresh claim is left alone and a stale claim is sent once", async () => {
  delete process.env.ALERT_BATCH_MS;
  delete process.env.RESEND_API_KEY;
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASS;
  const fresh = await ready();
  const freshId = await enqueue(fresh, "2026-11-09T15:00:00.000Z");
  await fresh.query(`UPDATE alert_outbox SET status = 'sending', batch_key = $2 WHERE id = $1`, [freshId, "claim:9999999999999"]);
  assert.equal(await flushInstant(fresh, new Date("2026-11-15T18:00:00.000Z")), 0);
  const held = await fresh.query<{ status: string }>(`SELECT status FROM alert_outbox WHERE id = $1`, [freshId]);
  assert.equal(held.rows[0]?.status, "sending");

  const stale = await ready();
  const staleId = await enqueue(stale, "2026-11-09T15:00:00.000Z");
  await stale.query(`UPDATE alert_outbox SET status = 'sending', batch_key = $2 WHERE id = $1`, [staleId, "claim:0000000000000"]);
  assert.equal(await flushInstant(stale, new Date("2026-11-15T18:00:00.000Z")), 1);
  assert.equal(await flushInstant(stale, new Date("2026-11-15T19:00:00.000Z")), 0);
  const logs = await stale.query(`SELECT id FROM alert_log`);
  assert.equal(logs.rows.length, 1);
});

test("a failed send puts the rows back for one retry", async () => {
  delete process.env.ALERT_BATCH_MS;
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASS;
  delete process.env.ALERT_FROM;
  process.env.RESEND_API_KEY = "re_test_key";
  process.env.RESEND_EMAIL_DOMAIN = "distributedsites.com";
  const sql = await ready();
  await enqueue(sql, "2026-11-09T15:00:00.000Z", randomUUID(), "jaideep", "Please retry.");
  const original = globalThis.fetch;
  let called = 0;
  globalThis.fetch = (async () => {
    called += 1;
    if (called === 1) return new Response("no", { status: 500 });
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  try {
    assert.equal(await flushInstant(sql, new Date("2026-11-15T18:00:00.000Z")), 0);
    const pending = await sql.query<{ status: string }>(`SELECT status FROM alert_outbox`);
    assert.equal(pending.rows[0]?.status, "pending");
    assert.equal(await flushInstant(sql, new Date("2026-11-15T18:05:00.000Z")), 1);
  } finally {
    globalThis.fetch = original;
    delete process.env.RESEND_API_KEY;
    delete process.env.RESEND_EMAIL_DOMAIN;
  }
  assert.equal(called, 2);
  const logs = await sql.query<{ status: string }>(`SELECT status FROM alert_log`);
  assert.equal(logs.rows.length, 1);
  assert.equal(logs.rows[0]?.status, "sent");
});

test("overlapping flushes send a batch once", async () => {
  delete process.env.ALERT_BATCH_MS;
  delete process.env.RESEND_API_KEY;
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASS;
  const db = new PGlite();
  const admin: Sql = {
    async query(text, values) {
      const result = await db.query(text, values as never[] | undefined);
      return { rows: result.rows as Record<string, unknown>[] };
    },
    async exec(text) {
      await db.exec(text);
    },
  };
  await migrate(admin);
  const server = new PGLiteSocketServer({ db, host: "127.0.0.1", port: 0, maxConnections: 4 });
  await server.start();
  const address = server.getServerConn();
  const pool = new Pool({
    connectionString: `postgres://postgres:postgres@${address}/postgres`,
    max: 2,
    ssl: false,
    connectionTimeoutMillis: 5_000,
  });
  const first = await pool.connect();
  const second = await pool.connect();
  const wrap = (client: { query: Pool["query"] }): Sql => ({
    async query(text, values) {
      const result = await client.query(text, values as never[]);
      return { rows: result.rows as Record<string, unknown>[] };
    },
    async exec(text) {
      await client.query(text);
    },
  });
  try {
    await first.query("SET statement_timeout = '15000'");
    await second.query("SET statement_timeout = '15000'");
    const id = randomUUID();
    await first.query(
      `INSERT INTO alert_outbox (
        id, idempotency_key, user_id, to_email, category, channel, site_id, site_label, summary, author_id, href, ref_id, created_at, status
      ) VALUES ($1, $2, 'reviewer', 'reviewer@example.com', 'approvals', 'instant', 'PIPE-PHX-0067', 'Sinclair', 'Shared row.', 'contributor', '/review', $1, $3, 'pending')`,
      [id, `approvals:${id}:reviewer`, "2026-11-09T15:00:00.000Z"],
    );
    const now = new Date("2026-11-15T18:00:00.000Z");
    const raced = Promise.all([
      flushInstant(wrap(first), now),
      flushInstant(wrap(second), now),
    ]);
    const counts = await Promise.race([
      raced,
      new Promise<never>((_resolve, reject) => {
        setTimeout(() => reject(new Error("overlapping flushes did not finish")), 20_000);
      }),
    ]);
    assert.equal(counts[0] + counts[1], 1);
    const logs = await first.query(`SELECT id FROM alert_log`);
    assert.equal(logs.rows.length, 1);
    const pending = await first.query(`SELECT id FROM alert_outbox WHERE status = 'pending' OR status = 'sending'`);
    assert.equal(pending.rows.length, 0);
  } finally {
    first.release();
    second.release();
    await pool.end();
    await server.stop();
  }
});

test("a failed batch drops its pending log when the retry has different rows", async () => {
  delete process.env.ALERT_BATCH_MS;
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASS;
  delete process.env.ALERT_FROM;
  process.env.RESEND_API_KEY = "re_test_key";
  process.env.RESEND_EMAIL_DOMAIN = "distributedsites.com";
  const sql = await ready();
  await enqueue(sql, "2026-11-14T15:00:00.000Z", randomUUID(), "jaideep", "First waiting.");
  await enqueue(sql, "2026-11-14T16:00:00.000Z", randomUUID(), "jaideep", "Second waiting.");
  const original = globalThis.fetch;
  let called = 0;
  globalThis.fetch = (async () => {
    called += 1;
    if (called === 1) return new Response("no", { status: 500 });
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  try {
    assert.equal(await flushInstant(sql, new Date("2026-11-15T18:00:00.000Z")), 0);
    const pendingLog = await sql.query<{ status: string }>(`SELECT status FROM alert_log`);
    assert.equal(pendingLog.rows.length, 1);
    assert.equal(pendingLog.rows[0]?.status, "pending");
    await enqueue(sql, "2026-11-14T17:00:00.000Z", randomUUID(), "jaideep", "Third waiting.");
    assert.equal(await flushInstant(sql, new Date("2026-11-15T18:05:00.000Z")), 1);
  } finally {
    globalThis.fetch = original;
    delete process.env.RESEND_API_KEY;
    delete process.env.RESEND_EMAIL_DOMAIN;
  }
  const logs = await sql.query<{ status: string }>(`SELECT status FROM alert_log ORDER BY status`);
  assert.deepEqual(logs.rows.map((row) => row.status), ["sent"]);
  const outbox = await sql.query<{ status: string }>(`SELECT status FROM alert_outbox`);
  assert.equal(outbox.rows.every((row) => row.status === "sent"), true);
});

test("the daily cap records a warning and does not send", async () => {
  delete process.env.RESEND_API_KEY;
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASS;
  const sql = await ready();
  const now = new Date("2026-11-09T18:00:00.000Z");
  const day = losAngelesParts(now).day;
  for (let i = 0; i < DAILY_CAP; i += 1) {
    await sql.query(
      `INSERT INTO alert_log (id, idempotency_key, user_id, to_email, subject, body, status, sent_on) VALUES ($1, $2, 'reviewer', 'reviewer@example.com', 'Sent', 'Sent', 'sent', $3)`,
      [randomUUID(), `old:${i}`, day],
    );
  }
  process.env.RESEND_API_KEY = "re_test_key";
  process.env.RESEND_EMAIL_DOMAIN = "distributedsites.com";
  delete process.env.ALERT_FROM;
  await enqueue(sql, new Date(now.getTime() - 10 * 60_000).toISOString(), randomUUID(), "jaideep");
  const original = globalThis.fetch;
  let called = 0;
  globalThis.fetch = (async () => {
    called += 1;
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  try {
    await flushInstant(sql, now);
  } finally {
    globalThis.fetch = original;
    delete process.env.RESEND_API_KEY;
    delete process.env.RESEND_EMAIL_DOMAIN;
    delete process.env.ALERT_FROM;
  }
  assert.equal(called, 0);
  const capped = await sql.query<{ status: string; warning: string }>(
    `SELECT status, warning FROM alert_log WHERE status = 'capped'`,
  );
  assert.equal(capped.rows.length, 1);
  assert.match(capped.rows[0]?.warning || "", /400/);
});

test("a recipient who is not opted in is logged and is not sent", async () => {
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASS;
  delete process.env.ALERT_FROM;
  process.env.RESEND_API_KEY = "re_test_key";
  process.env.RESEND_EMAIL_DOMAIN = "distributedsites.com";
  const sql = await ready();
  await enqueue(sql, new Date(Date.now() - 10 * 60_000).toISOString());
  const original = globalThis.fetch;
  let called = 0;
  globalThis.fetch = (async () => {
    called += 1;
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  try {
    await flushInstant(sql, new Date());
  } finally {
    globalThis.fetch = original;
    delete process.env.RESEND_API_KEY;
    delete process.env.RESEND_EMAIL_DOMAIN;
  }
  assert.equal(called, 0);
  const logged = await sql.query<{ status: string; warning: string }>(`SELECT status, warning FROM alert_log`);
  assert.equal(logged.rows.length, 1);
  assert.equal(logged.rows[0]?.status, "would_send");
  assert.match(logged.rows[0]?.warning || "", /not approved for live mail/);
});
});
