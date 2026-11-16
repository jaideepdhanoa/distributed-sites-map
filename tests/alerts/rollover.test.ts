import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { migrate } from "../../lib/actions/migrate";
import { INSTANT_DAILY_CAP, losAngelesParts } from "../../lib/alerts/clock";
import { flushInstant } from "../../lib/alerts/deliver";
import { memorySql } from "../helpers/sql";

test("the seventh instant email rolls into the digest and is not dropped", async () => {
  delete process.env.ALERT_BATCH_MS;
  delete process.env.RESEND_API_KEY;
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASS;
  const sql = await memorySql();
  await migrate(sql);
  const now = new Date("2026-11-16T18:00:00.000Z");
  const day = losAngelesParts(now).day;
  for (let i = 0; i < INSTANT_DAILY_CAP; i += 1) {
    await sql.query(
      `INSERT INTO alert_log (id, idempotency_key, user_id, to_email, subject, body, status, sent_on)
       VALUES ($1, $2, 'jaideep', 'jaideep@dhanoa.in', 'Sent', 'Sent', 'sent', $3)`,
      [randomUUID(), `batch:jaideep:${i}`, day],
    );
  }
  const id = randomUUID();
  await sql.query(
    `INSERT INTO alert_outbox (
      id, idempotency_key, user_id, to_email, category, channel, site_id, site_label, summary, author_id, href, ref_id, created_at, status
    ) VALUES ($1, $2, 'jaideep', 'jaideep@dhanoa.in', 'decisions', 'instant', 'PIPE-PHX-0008', 'Sample', 'A decision request is waiting.', 'muse', 'https://distributedsites.com/?site=PIPE-PHX-0008', $1, $3, 'pending')`,
    [id, `decisions:${id}:jaideep`, new Date(now.getTime() - 11 * 60_000).toISOString()],
  );
  assert.equal(await flushInstant(sql, now), 0);
  const row = await sql.query<{ channel: string; status: string }>(`SELECT channel, status FROM alert_outbox WHERE id = $1`, [id]);
  assert.equal(row.rows[0]?.channel, "digest");
  assert.equal(row.rows[0]?.status, "pending");
  const capped = await sql.query(`SELECT id FROM alert_log WHERE status = 'capped'`);
  assert.equal(capped.rows.length, 0);
});
