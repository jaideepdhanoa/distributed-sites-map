import assert from "node:assert/strict";
import test from "node:test";
import { migrate } from "../../lib/actions/migrate";
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
    const summer = new Date("2026-07-09T15:30:00.000Z");
    assert.equal(await sendDigests(sql, winter), 1);
    assert.equal(await sendDigests(sql, winter), 0);
    const winterLogs = await sql.query(`SELECT id FROM alert_log`);
    assert.equal(winterLogs.rows.length, 1);
    assert.equal(await sendDigests(sql, summer), 1);
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
