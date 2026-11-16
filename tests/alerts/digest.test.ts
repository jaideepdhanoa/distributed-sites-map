import assert from "node:assert/strict";
import test from "node:test";
import { migrate } from "../../lib/actions/migrate";
import { FIRST_DIGEST_AT, digestWindowStart, losAngelesParts } from "../../lib/alerts/clock";
import { sendDigests } from "../../lib/alerts/deliver";
import { memorySql } from "../helpers/sql";

const hash = "$2b$04$abcdefghijklmnopqrstuuabcdefghijklmnopqrstuuabcdefghijk";

test("the digest uses the Pacific day and sends at most once per user that day", async () => {
  const previous = {
    users: process.env.AUTH_USERS,
    emails: process.env.ALERT_EMAILS,
    key: process.env.RESEND_API_KEY,
    smtpUser: process.env.SMTP_USER,
    smtpPass: process.env.SMTP_PASS,
  };
  process.env.AUTH_USERS = JSON.stringify([
    { u: "reviewer", h: hash, role: "admin", actionRole: "reviewer", name: "Reviewer", email: "reviewer@example.com" },
  ]);
  delete process.env.ALERT_EMAILS;
  delete process.env.RESEND_API_KEY;
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASS;
  const sql = await memorySql();
  await migrate(sql);
  try {
    const winter = new Date("2026-11-09T15:30:00.000Z");
    const summerMorning = new Date("2026-07-09T14:30:00.000Z");
    const summerLate = new Date("2026-07-09T15:30:00.000Z");
    await sql.query(
      `INSERT INTO events (id, entity_type, entity_id, site_id, payload, source, actor, idempotency_key, created_at)
       VALUES
         ('EV-win', 'stage', 'PIPE-PHX-0008', 'PIPE-PHX-0008', '{"stage":"2 Financial screen","previous_stage":"1 Desk screen"}'::jsonb, 'agent', 'jaideep', 'ev-win', '2026-11-09T12:00:00.000Z'),
         ('EV-jul', 'stage', 'PIPE-PHX-0008', 'PIPE-PHX-0008', '{"stage":"3 Site checks","previous_stage":"2 Financial screen"}'::jsonb, 'agent', 'jaideep', 'ev-jul', '2026-07-09T12:00:00.000Z'),
         ('EV-hide', 'stage', 'PIPE-PHX-0006', 'PIPE-PHX-0006', '{"stage":"Dropped","previous_stage":"1 Desk screen"}'::jsonb, 'agent', 'jaideep', 'ev-hide', '2026-11-09T12:00:00.000Z')`,
    );
    assert.equal(await sendDigests(sql, winter), 1);
    assert.equal(await sendDigests(sql, winter), 0);
    const winterLogs = await sql.query<{ id: string; body: string; subject: string }>(`SELECT id, body, subject FROM alert_log`);
    assert.equal(winterLogs.rows.length, 1);
    assert.equal(winterLogs.rows.some((row) => row.body.includes("PIPE-PHX-0006") || row.subject.includes("PIPE-PHX-0006")), false);
    assert.equal(await sendDigests(sql, summerLate), 0);
    assert.equal(await sendDigests(sql, summerMorning), 1);
    const summerLogs = await sql.query(`SELECT id FROM alert_log`);
    assert.equal(summerLogs.rows.length, 2);
  } finally {
    if (previous.users == null) delete process.env.AUTH_USERS;
    else process.env.AUTH_USERS = previous.users;
    if (previous.emails == null) delete process.env.ALERT_EMAILS;
    else process.env.ALERT_EMAILS = previous.emails;
    if (previous.key == null) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = previous.key;
    if (previous.smtpUser == null) delete process.env.SMTP_USER;
    else process.env.SMTP_USER = previous.smtpUser;
    if (previous.smtpPass == null) delete process.env.SMTP_PASS;
    else process.env.SMTP_PASS = previous.smtpPass;
  }
});

test("the Monday 7 AM run sends, and its window starts after the Nov 15 import", async () => {
  const mondayMorning = new Date("2026-11-16T15:00:00.000Z");
  const sixAm = new Date("2026-11-16T14:00:00.000Z");
  assert.equal(losAngelesParts(mondayMorning).hour, 7);
  assert.equal(losAngelesParts(sixAm).hour, 6);
  assert.equal(digestWindowStart(mondayMorning, null).toISOString(), FIRST_DIGEST_AT.toISOString());
  assert.equal(
    digestWindowStart(mondayMorning, new Date("2026-11-15T15:00:00.000Z")).toISOString(),
    FIRST_DIGEST_AT.toISOString(),
  );
  assert.equal(
    digestWindowStart(new Date("2026-11-17T15:00:00.000Z"), new Date("2026-11-16T15:05:00.000Z")).toISOString(),
    "2026-11-16T15:05:00.000Z",
  );

  const previous = {
    users: process.env.AUTH_USERS,
    emails: process.env.ALERT_EMAILS,
    key: process.env.RESEND_API_KEY,
    smtpUser: process.env.SMTP_USER,
    smtpPass: process.env.SMTP_PASS,
  };
  const hash = "$2b$04$abcdefghijklmnopqrstuuabcdefghijklmnopqrstuuabcdefghijk";
  process.env.AUTH_USERS = JSON.stringify([
    { u: "reviewer", h: hash, role: "admin", actionRole: "reviewer", name: "Reviewer", email: "reviewer@example.com" },
  ]);
  delete process.env.ALERT_EMAILS;
  delete process.env.RESEND_API_KEY;
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASS;
  const sql = await memorySql();
  await migrate(sql);
  try {
    await sql.query(
      `INSERT INTO alert_digest_runs (user_id, sent_on, sent_at) VALUES ('reviewer', '2026-11-15', '2026-11-15T15:10:00.000Z')`,
    );
    await sql.query(
      `INSERT INTO events (id, entity_type, entity_id, site_id, payload, source, actor, idempotency_key, created_at)
       VALUES
         ('EV-import', 'stage', 'PIPE-PHX-0100', 'PIPE-PHX-0100', '{"stage":"2 Financial screen","previous_stage":"1 Desk screen"}'::jsonb, 'workbook snapshot nov15', 'workbook-sync', 'ev-import', '2026-11-15T20:00:00.000Z'),
         ('EV-sunday', 'stage', 'PIPE-PHX-0101', 'PIPE-PHX-0101', '{"stage":"3 Site checks","previous_stage":"2 Financial screen"}'::jsonb, 'agent', 'jaideep', 'ev-sunday', '2026-11-15T20:00:00.000Z'),
         ('EV-morning', 'stage', 'PIPE-PHX-0102', 'PIPE-PHX-0102', '{"stage":"3 Site checks","previous_stage":"2 Financial screen"}'::jsonb, 'agent', 'jaideep', 'ev-morning', '2026-11-16T12:00:00.000Z')`,
    );
    assert.equal(await sendDigests(sql, sixAm), 0);
    assert.equal(await sendDigests(sql, mondayMorning), 1);
    const logs = await sql.query<{ body: string; subject: string }>(`SELECT body, subject FROM alert_log`);
    assert.equal(logs.rows.length, 1);
    const body = logs.rows[0]?.body || "";
    assert.equal(body.includes("PIPE-PHX-0100"), false);
    assert.equal(body.includes("PIPE-PHX-0101"), false);
    assert.equal(body.includes("workbook"), false);
    assert.equal(body.includes("PIPE-PHX-0102"), true);
  } finally {
    if (previous.users == null) delete process.env.AUTH_USERS;
    else process.env.AUTH_USERS = previous.users;
    if (previous.emails == null) delete process.env.ALERT_EMAILS;
    else process.env.ALERT_EMAILS = previous.emails;
    if (previous.key == null) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = previous.key;
    if (previous.smtpUser == null) delete process.env.SMTP_USER;
    else process.env.SMTP_USER = previous.smtpUser;
    if (previous.smtpPass == null) delete process.env.SMTP_PASS;
    else process.env.SMTP_PASS = previous.smtpPass;
  }
});
