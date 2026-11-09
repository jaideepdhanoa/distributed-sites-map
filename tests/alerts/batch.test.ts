import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, test } from "node:test";
import { migrate } from "../../lib/actions/migrate";
import { DAILY_CAP, losAngelesParts } from "../../lib/alerts/clock";
import { flushInstant } from "../../lib/alerts/deliver";
import { memorySql } from "../helpers/sql";

async function ready() {
  const sql = await memorySql();
  await migrate(sql);
  return sql;
}

async function enqueue(sql: Awaited<ReturnType<typeof ready>>, createdAt: string, id = randomUUID(), userId = "reviewer") {
  await sql.query(
    `INSERT INTO alert_outbox (
      id, idempotency_key, user_id, to_email, category, channel, site_id, site_label, summary, author_id, href, ref_id, created_at, status
    ) VALUES ($1, $2, $4, $5, 'approvals', 'instant', 'PIPE-PHX-0067', 'Sinclair (PIPE-PHX-0067)', 'Next step proposed.', 'contributor', '/?view=review&site=PIPE-PHX-0067', $1, $3, 'pending')`,
    [id, `approvals:${id}:${userId}`, createdAt, userId, userId === "jaideep" ? "jaideep@dhanoa.in" : "reviewer@example.com"],
  );
  return id;
}

describe("alert batching", { concurrency: 1 }, () => {
test("ten proposals across fifteen minutes become one email after a five minute quiet", async () => {
  const previous = process.env.ALERT_BATCH_MS;
  delete process.env.ALERT_BATCH_MS;
  delete process.env.RESEND_API_KEY;
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASS;
  const sql = await ready();
  const start = Date.parse("2026-11-09T15:00:00.000Z");
  for (let i = 0; i < 10; i += 1) {
    await enqueue(sql, new Date(start + i * 90_000).toISOString());
  }
  const during = await flushInstant(sql, new Date(start + 15 * 60_000));
  assert.equal(during, 0);
  const after = await flushInstant(sql, new Date(start + 14 * 60_000 + 5 * 60_000));
  assert.equal(after, 1);
  const again = await flushInstant(sql, new Date(start + 30 * 60_000));
  assert.equal(again, 0);
  const logs = await sql.query<{ status: string; body: string }>(`SELECT status, body FROM alert_log`);
  assert.equal(logs.rows.length, 1);
  assert.equal(logs.rows[0]?.status, "would_send");
  assert.equal((logs.rows[0]?.body.match(/Next step proposed/g) || []).length, 10);
  if (previous == null) delete process.env.ALERT_BATCH_MS;
  else process.env.ALERT_BATCH_MS = previous;
});

test("a second burst after the quiet period is a second email", async () => {
  delete process.env.ALERT_BATCH_MS;
  delete process.env.RESEND_API_KEY;
  const sql = await ready();
  const start = Date.parse("2026-11-09T16:00:00.000Z");
  await enqueue(sql, new Date(start).toISOString());
  await enqueue(sql, new Date(start + 60_000).toISOString());
  assert.equal(await flushInstant(sql, new Date(start + 60_000 + 5 * 60_000)), 1);
  await enqueue(sql, new Date(start + 12 * 60_000).toISOString());
  assert.equal(await flushInstant(sql, new Date(start + 12 * 60_000 + 4 * 60_000)), 0);
  assert.equal(await flushInstant(sql, new Date(start + 12 * 60_000 + 5 * 60_000)), 1);
  const logs = await sql.query(`SELECT id FROM alert_log`);
  assert.equal(logs.rows.length, 2);
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
