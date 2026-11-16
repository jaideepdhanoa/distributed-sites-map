import assert from "node:assert/strict";
import test from "node:test";
import { migrate } from "../../lib/actions/migrate";
import { printCatchUp, runCatchUp } from "../../lib/alerts/catchup";
import { CATCHUP_KEY, CATCHUP_SUBJECT } from "../../lib/alerts/summary";
import type { Sql } from "../../lib/actions/db";
import { memorySql } from "../helpers/sql";

const MARKER_NOTE = "MARKER_NOTE_ALPHA";
const MARKER_COMMS = "MARKER_COMMS_BETA";
const MARKER_DECISION = "MARKER_DECISION_GAMMA";
const PRICE = "$999,999";

async function ready(): Promise<Sql> {
  const sql = await memorySql();
  await migrate(sql);
  return sql;
}

async function seed(sql: Sql) {
  await sql.query(
    `INSERT INTO agent_inbox (id, kind, ref_id, site_id, actor, body, thread_key, idempotency_key, created_at)
     VALUES
       ('in-old', 'note', 'old', 'PIPE-PHX-0008', 'cindel', 'Old note.', 'note:old', 'note:old', '2026-11-01T00:00:00.000Z'),
       ('in-new', 'note', 'new', 'PIPE-PHX-0008', 'cindel', 'New note.', 'note:new', 'note:new', '2026-11-10T00:00:00.000Z'),
       ('in-hidden', 'note', 'hidden', 'PIPE-PHX-0006', 'cindel', 'Hidden note.', 'note:hidden', 'note:hidden', '2026-11-10T00:00:00.000Z'),
       ('in-dec', 'decision', 'dec-1', 'PIPE-PHX-0008', 'jaideep', $1, 'proposal:dec-1', 'decision:dec-1', '2026-11-11T00:00:00.000Z'),
       ('in-dec-hidden', 'decision', 'dec-2', 'PIPE-PHX-0006', 'jaideep', 'Hidden decision.', 'proposal:dec-2', 'decision:dec-2', '2026-11-11T00:00:00.000Z')`,
    [`${MARKER_DECISION} accepted the step.`],
  );
  await sql.query(
    `INSERT INTO agent_recommendations (id, inbox_id, kind, draft_text, decision, rationale, sources, confidence, model, created_at)
     VALUES
       ('rec-old', 'in-old', 'reply', 'Old draft.', 'none', 'Old.', '[]'::jsonb, 'low', 'muse', '2026-11-01T00:00:00.000Z'),
       ('rec-new', 'in-new', 'reply', $1, 'none', 'Because.', '[]'::jsonb, 'medium', 'muse', '2026-11-10T00:00:00.000Z'),
       ('rec-hidden', 'in-hidden', 'reply', 'Hidden draft.', 'none', 'Hidden.', '[]'::jsonb, 'low', 'muse', '2026-11-10T00:00:00.000Z'),
       ('rec-open', 'in-new', 'decision', 'Approve the step.', 'approve', 'Because.', '[]'::jsonb, 'high', 'muse', '2026-11-11T00:00:00.000Z'),
       ('rec-closed', 'in-dec', 'decision', 'Already decided.', 'approve', 'Done.', '[]'::jsonb, 'high', 'muse', '2026-11-11T00:00:00.000Z')`,
    [`${MARKER_NOTE} please wire ${PRICE}`],
  );
  await sql.query(
    `INSERT INTO events (id, entity_type, entity_id, site_id, payload, source, actor, idempotency_key, created_at)
     VALUES
       ('EV-stage', 'stage', 'PIPE-PHX-0008', 'PIPE-PHX-0008', '{"stage":"2 Financial screen","previous_stage":"1 Desk screen"}'::jsonb, 'agent', 'jaideep', 'ev-stage', '2026-11-12T00:00:00.000Z'),
       ('EV-stage-first', 'stage', 'PIPE-PHX-0010', 'PIPE-PHX-0010', '{"stage":"1 Desk screen","previous_stage":null}'::jsonb, 'agent', 'jaideep', 'ev-stage-first', '2026-11-12T00:00:00.000Z'),
       ('EV-stage-same', 'stage', 'PIPE-PHX-0011', 'PIPE-PHX-0011', '{"stage":"2 Financial screen","previous_stage":"2 Financial screen"}'::jsonb, 'agent', 'jaideep', 'ev-stage-same', '2026-11-12T00:00:00.000Z'),
       ('EV-stage-book', 'stage', 'PIPE-PHX-0012', 'PIPE-PHX-0012', '{"stage":"3 Site checks","previous_stage":"1 Desk screen"}'::jsonb, 'workbook snapshot nov15', 'workbook-sync', 'ev-stage-book', '2026-11-15T00:00:00.000Z'),
       ('EV-stage-old', 'stage', 'PIPE-PHX-0008', 'PIPE-PHX-0008', '{"stage":"1 Desk screen"}'::jsonb, 'agent', 'muse', 'ev-stage-old', '2026-11-01T00:00:00.000Z'),
       ('EV-stage-hidden', 'stage', 'PIPE-PHX-0006', 'PIPE-PHX-0006', '{"stage":"Dropped"}'::jsonb, 'agent', 'muse', 'ev-stage-hidden', '2026-11-12T00:00:00.000Z'),
       ('EV-act', 'activity', 'A-1', 'PIPE-PHX-0008', '{"summary":"Visited."}'::jsonb, 'agent', 'muse', 'ev-act', '2026-11-12T00:00:00.000Z'),
       ('EV-act-old', 'activity', 'A-0', 'PIPE-PHX-0008', '{"summary":"Old visit."}'::jsonb, 'agent', 'muse', 'ev-act-old', '2026-11-01T00:00:00.000Z'),
       ('EV-act-hidden', 'activity', 'A-9', 'PIPE-PHX-0006', '{"summary":"Hidden visit."}'::jsonb, 'agent', 'muse', 'ev-act-hidden', '2026-11-12T00:00:00.000Z'),
       ('EV-comms', 'comms', 'CM-1', 'PIPE-PHX-0008', $1::jsonb, 'agent', 'muse', 'ev-comms', '2026-11-12T00:00:00.000Z'),
       ('EV-comms-out', 'comms', 'CM-2', 'PIPE-PHX-0008', '{"direction":"out","summary":"Sent outbound."}'::jsonb, 'agent', 'muse', 'ev-comms-out', '2026-11-12T00:00:00.000Z'),
       ('EV-comms-self', 'comms', 'CM-3', 'PIPE-PHX-0008', '{"direction":"in","summary":"Sent by the reviewer."}'::jsonb, 'agent', 'jaideep', 'ev-comms-self', '2026-11-12T00:00:00.000Z'),
       ('EV-comms-hidden', 'comms', 'CM-9', 'PIPE-PHX-0006', '{"summary":"Hidden comms."}'::jsonb, 'agent', 'muse', 'ev-comms-hidden', '2026-11-12T00:00:00.000Z')`,
    [JSON.stringify({ summary: MARKER_COMMS, person: "Alex", direction: "in" })],
  );
  await sql.query(`UPDATE agent_recommendations SET used_at = created_at WHERE id = 'rec-closed'`);
}

test("dry run prints counts and no message content", async () => {
  const sql = await ready();
  await seed(sql);
  const result = await runCatchUp(sql, { dryRun: true, now: new Date("2026-11-15T16:00:00.000Z") });
  assert.equal(result.status, "dry_run");
  assert.equal(result.counts.recommendations, 1);
  assert.equal(result.counts.decisions, 1);
  assert.equal(result.counts.stages, 1);
  assert.equal(result.counts.activity, 0);
  assert.equal(result.counts.comms, 1);
  assert.equal(result.counts.sites, 0);
  assert.equal(result.counts.asks, 0);
  const lines: string[] = [];
  const original = console.log;
  console.log = (message?: unknown) => {
    lines.push(String(message ?? ""));
  };
  try {
    printCatchUp(result);
  } finally {
    console.log = original;
  }
  const printed = lines.join("\n");
  assert.match(printed, /recommendations: 1/);
  assert.match(printed, /decisions: 1/);
  assert.match(printed, /stages: 1/);
  assert.match(printed, /activity: 0/);
  assert.match(printed, /comms: 1/);
  assert.match(printed, /sites: 0/);
  assert.match(printed, /asks: 0/);
  assert.equal(printed.includes(MARKER_NOTE), false);
  assert.equal(printed.includes(MARKER_COMMS), false);
  assert.equal(printed.includes(MARKER_DECISION), false);
  assert.equal(printed.includes(PRICE), false);
  assert.equal(printed.includes("@"), false);
  assert.equal(printed.includes("$"), false);
  assert.equal(printed.includes("PIPE-PHX-0006"), false);
  assert.equal(printed.includes("PIPE-PHX-0008"), false);
  const log = await sql.query(`SELECT id FROM alert_log`);
  assert.equal(log.rows.length, 0);
});

test("the catch-up sends once to the one mailbox and leaves out PIPE-PHX-0006", async () => {
  const previous = {
    key: process.env.RESEND_API_KEY,
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    url: process.env.APP_URL,
  };
  process.env.RESEND_API_KEY = "test-key";
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASS;
  process.env.APP_URL = "https://preview.distributedsites.com";
  const calls: { to?: string[]; subject?: string; text?: string; html?: string }[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    calls.push(JSON.parse(String(init?.body || "{}")) as { to?: string[]; subject?: string; text?: string; html?: string });
    return new Response("{}", { status: 200 });
  };
  const sql = await ready();
  try {
    await seed(sql);
    const now = new Date("2026-11-15T16:00:00.000Z");
    const first = await runCatchUp(sql, { dryRun: false, now });
    const second = await runCatchUp(sql, { dryRun: false, now });
    assert.equal(first.status, "sent");
    assert.equal(second.status, "sent");
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0]?.to, ["jaideep@dhanoa.in"]);
    assert.equal(calls[0]?.subject, CATCHUP_SUBJECT);
    const text = `${calls[0]?.text || ""}\n${calls[0]?.html || ""}`;
    assert.equal(text.includes("PIPE-PHX-0006"), false);
    assert.equal(text.includes(MARKER_COMMS), false);
    assert.equal(text.includes(MARKER_DECISION), false);
    assert.equal(text.includes(PRICE), false);
    assert.equal(text.includes("999,999"), false);
    assert.equal(text.includes("PIPE-PHX-0008"), true);
    assert.equal(text.includes("vercel.app"), false);
    assert.equal(text.includes("preview."), false);
    const logs = await sql.query<{ idempotency_key: string; to_email: string; status: string; subject: string }>(
      `SELECT idempotency_key, to_email, status, subject FROM alert_log`,
    );
    assert.equal(logs.rows.length, 1);
    assert.equal(logs.rows[0]?.idempotency_key, CATCHUP_KEY);
    assert.equal(logs.rows[0]?.to_email, "jaideep@dhanoa.in");
    assert.equal(logs.rows[0]?.status, "sent");
    assert.equal(logs.rows[0]?.subject, CATCHUP_SUBJECT);
  } finally {
    globalThis.fetch = original;
    if (previous.key == null) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = previous.key;
    if (previous.user == null) delete process.env.SMTP_USER;
    else process.env.SMTP_USER = previous.user;
    if (previous.pass == null) delete process.env.SMTP_PASS;
    else process.env.SMTP_PASS = previous.pass;
    if (previous.url == null) delete process.env.APP_URL;
    else process.env.APP_URL = previous.url;
  }
});
