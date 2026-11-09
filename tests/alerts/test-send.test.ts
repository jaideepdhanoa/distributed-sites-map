import assert from "node:assert/strict";
import test from "node:test";
import { migrate } from "../../lib/actions/migrate";
import { sendTestAlerts } from "../../lib/alerts/testSend";
import { memorySql } from "../helpers/sql";

async function ready() {
  const sql = await memorySql();
  await migrate(sql);
  return sql;
}

test("a test alert stays on the would-send log unless the account is approved for live mail", async () => {
  delete process.env.RESEND_API_KEY;
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASS;
  const sql = await ready();
  const result = await sendTestAlerts(sql, { userId: "reviewer", email: "reviewer@example.com" });
  assert.equal(result.limited, false);
  assert.equal(result.delivery, "would_send");
  assert.match(result.message, /would-send log/);
  assert.match(result.message, /not approved for live mail/);
  assert.match(result.message, /reviewer@example.com/);
  const logs = await sql.query<{ subject: string; body: string; to_email: string; status: string }>(
    `SELECT subject, body, to_email, status FROM alert_log ORDER BY subject`,
  );
  assert.equal(logs.rows.length, 2);
  for (const row of logs.rows) {
    assert.equal(row.status, "would_send");
    assert.equal(row.to_email, "reviewer@example.com");
    assert.match(row.subject, /^\[Test\] /);
    assert.match(row.body, /Sample site/);
    assert.doesNotMatch(row.body, /PIPE-|\$\d|broker/i);
  }
  const outbox = await sql.query(`SELECT id FROM alert_outbox`);
  const prefs = await sql.query(`SELECT user_id FROM alert_preferences`);
  const digests = await sql.query(`SELECT user_id FROM alert_digest_runs`);
  assert.equal(outbox.rows.length, 0);
  assert.equal(prefs.rows.length, 0);
  assert.equal(digests.rows.length, 0);

  const limited = await sendTestAlerts(sql, { userId: "reviewer", email: "reviewer@example.com" });
  assert.equal(limited.limited, true);
  assert.match(limited.message, /five minutes/);
  const still = await sql.query(`SELECT id FROM alert_log`);
  assert.equal(still.rows.length, 2);
});

test("an approved account receives one sample instant alert and one sample digest", async () => {
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASS;
  delete process.env.ALERT_FROM;
  process.env.RESEND_API_KEY = "re_test_key";
  process.env.RESEND_EMAIL_DOMAIN = "distributedsites.com";
  const sql = await ready();
  const original = globalThis.fetch;
  const sent: { to?: string[]; subject?: string; text?: string }[] = [];
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    sent.push(JSON.parse(String(init?.body || "{}")) as { to?: string[]; subject?: string; text?: string });
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  try {
    const result = await sendTestAlerts(sql, { userId: "jaideep", email: "jaideep@dhanoa.in" });
    assert.equal(result.delivery, "sent");
    assert.equal(result.instant, "sent");
    assert.equal(result.digest, "sent");
    assert.match(result.message, /Sent a sample instant alert and a sample daily digest to jaideep@dhanoa.in/);
  } finally {
    globalThis.fetch = original;
  }
  assert.equal(sent.length, 2);
  for (const mail of sent) {
    assert.deepEqual(mail.to, ["jaideep@dhanoa.in"]);
    assert.match(mail.subject || "", /^\[Test\] /);
    assert.match(mail.text || "", /Sample site/);
    assert.doesNotMatch(mail.text || "", /PIPE-|\$\d/);
  }
  assert.equal(sent.filter((mail) => /sample instant alert/.test(mail.text || "")).length, 1);
  assert.equal(sent.filter((mail) => /sample note for the daily digest/.test(mail.text || "")).length, 1);
  const outbox = await sql.query(`SELECT id FROM alert_outbox`);
  assert.equal(outbox.rows.length, 0);

  await sql.query(`UPDATE alert_log SET created_at = now() - interval '6 minutes'`);
  const originalAgain = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  try {
    const again = await sendTestAlerts(sql, { userId: "jaideep", email: "jaideep@dhanoa.in" });
    assert.equal(again.limited, false);
    assert.equal(again.delivery, "sent");
  } finally {
    globalThis.fetch = originalAgain;
    delete process.env.RESEND_API_KEY;
    delete process.env.RESEND_EMAIL_DOMAIN;
  }
  assert.equal(calls, 2);
});
