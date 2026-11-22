import assert from "node:assert/strict";
import test from "node:test";
import { migrate } from "../../lib/actions/migrate";
import { createNote } from "../../lib/actions/notes";
import type { RecordLookup } from "../../lib/actions/records";
import { isPacificMonday, weekOfLabel } from "../../lib/alerts/clock";
import { sendDigests } from "../../lib/alerts/deliver";
import { memorySql } from "../helpers/sql";

const hash = "$2b$04$abcdefghijklmnopqrstuuabcdefghijklmnopqrstuuabcdefghijk";
const monday = new Date("2026-11-23T15:00:00.000Z");
const tuesday = new Date("2026-11-24T15:00:00.000Z");
const deal = Object.freeze({ deal_id: "PIPE-PHX-0188", stage: "1 Desk screen", name: "Sample deal" });
const lookup: RecordLookup = (kind, id) => (kind === "deal" && id === deal.deal_id ? deal : null);

function users() {
  return JSON.stringify([
    { u: "jason", h: hash, role: "user", actionRole: "contributor", name: "Jason", email: "jason@example.com" },
    { u: "ming", h: hash, role: "user", actionRole: "contributor", name: "Ming", email: "ming@example.com" },
    { u: "jaideep", h: hash, role: "user", actionRole: "reviewer", name: "Jaideep", email: "jaideep@example.com" },
  ]);
}

async function withTeam(run: (sql: Awaited<ReturnType<typeof memorySql>>) => Promise<void>) {
  const previous = {
    users: process.env.AUTH_USERS,
    emails: process.env.ALERT_EMAILS,
    key: process.env.RESEND_API_KEY,
    smtpUser: process.env.SMTP_USER,
    smtpPass: process.env.SMTP_PASS,
    batch: process.env.ALERT_BATCH_MS,
  };
  process.env.AUTH_USERS = users();
  delete process.env.ALERT_EMAILS;
  delete process.env.RESEND_API_KEY;
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASS;
  process.env.ALERT_BATCH_MS = "0";
  const sql = await memorySql();
  await migrate(sql);
  try {
    await run(sql);
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
    if (previous.batch == null) delete process.env.ALERT_BATCH_MS;
    else process.env.ALERT_BATCH_MS = previous.batch;
  }
}

test("Monday is the weekly morning, and the label is the Monday seven days earlier", () => {
  assert.equal(isPacificMonday(monday), true);
  assert.equal(isPacificMonday(tuesday), false);
  assert.equal(weekOfLabel(monday), "Nov 16");
});

test("a live contributor and jaideep get both digests, and Ming gets only the weekly", async () => {
  await withTeam(async (sql) => {
    await sql.query(
      `INSERT INTO events (id, entity_type, entity_id, site_id, payload, source, actor, idempotency_key, created_at)
       VALUES
         ('EV-old', 'stage', 'PIPE-PHX-0115', 'PIPE-PHX-0115', '{"stage":"2 Financial screen","previous_stage":"1 Desk screen"}'::jsonb, 'agent', 'desk', 'ev-old', '2026-11-15T18:00:00.000Z'),
         ('EV-week', 'stage', 'PIPE-PHX-0181', 'PIPE-PHX-0181', '{"stage":"3 Site checks","previous_stage":"2 Financial screen"}'::jsonb, 'agent', 'desk', 'ev-week', '2026-11-18T18:00:00.000Z'),
         ('EV-day', 'stage', 'PIPE-PHX-0123', 'PIPE-PHX-0123', '{"stage":"3 Site checks","previous_stage":"2 Financial screen"}'::jsonb, 'agent', 'desk', 'ev-day', '2026-11-23T12:00:00.000Z')`,
    );
    assert.equal(await sendDigests(sql, monday), 5);
    assert.equal(await sendDigests(sql, monday), 0);
    const logs = await sql.query<{ user_id: string; subject: string; body: string }>(
      `SELECT user_id, subject, body FROM alert_log ORDER BY user_id, subject`,
    );
    const forUser = (id: string) => logs.rows.filter((row) => row.user_id === id);
    for (const id of ["jason", "jaideep"]) {
      const rows = forUser(id);
      assert.equal(rows.length, 2, id);
      assert.equal(rows.filter((row) => row.subject.includes("daily digest")).length, 1);
      const week = rows.find((row) => row.subject.startsWith("Distributed Sites: week of Nov 16"));
      assert.ok(week, id);
      assert.match(week.body, /Week of Nov 16/);
      assert.equal(week.body.includes("daily digest"), false);
      assert.equal(week.body.includes("PIPE-PHX-0181"), true);
      assert.equal(week.body.includes("PIPE-PHX-0115"), false);
      const daily = rows.find((row) => row.subject.includes("daily digest"));
      assert.equal(daily?.body.includes("PIPE-PHX-0123"), true);
      assert.equal(daily?.body.includes("PIPE-PHX-0181"), false);
    }
    const ming = forUser("ming");
    assert.equal(ming.length, 1);
    assert.equal(ming[0]?.subject.startsWith("Distributed Sites: week of Nov 16"), true);
    assert.equal(ming[0]?.body.includes("PIPE-PHX-0181"), true);
    assert.equal(ming[0]?.body.includes("PIPE-PHX-0115"), false);
    assert.equal(ming.some((row) => row.subject.includes("daily digest")), false);
  });
});

test("Ming gets no daily digest on a weekday", async () => {
  await withTeam(async (sql) => {
    await sql.query(
      `INSERT INTO events (id, entity_type, entity_id, site_id, payload, source, actor, idempotency_key, created_at)
       VALUES ('EV-tue', 'stage', 'PIPE-PHX-0124', 'PIPE-PHX-0124', '{"stage":"2 Financial screen","previous_stage":"1 Desk screen"}'::jsonb, 'agent', 'desk', 'ev-tue', '2026-11-24T12:00:00.000Z')`,
    );
    assert.equal(await sendDigests(sql, tuesday), 2);
    const logs = await sql.query<{ user_id: string; subject: string }>(`SELECT user_id, subject FROM alert_log`);
    assert.equal(logs.rows.filter((row) => row.user_id === "ming").length, 0);
    assert.equal(logs.rows.filter((row) => row.subject.includes("daily digest")).length, 2);
    assert.equal(logs.rows.some((row) => row.subject.includes("week of")), false);
  });
});

test("Ming still gets an instant mention", async () => {
  await withTeam(async (sql) => {
    await createNote(sql, {
      targetKind: "deal",
      targetId: deal.deal_id,
      body: "Please look at the frontage.",
      authorId: "jason",
      mentions: ["ming"],
    }, lookup);
    const logs = await sql.query<{ subject: string; status: string; body: string }>(
      `SELECT subject, status, body FROM alert_log WHERE user_id = 'ming'`,
    );
    assert.equal(logs.rows.length, 1);
    assert.equal(logs.rows[0]?.status, "would_send");
    assert.match(logs.rows[0]?.subject || "", /mentioned you/i);
    assert.match(logs.rows[0]?.body || "", /Please look at the frontage/);
    const queued = await sql.query<{ channel: string }>(
      `SELECT channel FROM alert_outbox WHERE user_id = 'ming' AND category = 'mentions'`,
    );
    assert.equal(queued.rows[0]?.channel, "instant");
  });
});
