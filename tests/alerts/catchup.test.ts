import assert from "node:assert/strict";
import test from "node:test";
import { migrate } from "../../lib/actions/migrate";
import { catchUpPreviewAllowed, previewCatchUp, printCatchUp, runCatchUp } from "../../lib/alerts/catchup";
import { proposalHref } from "../../lib/alerts/links";
import { loadCatchUp, CATCHUP_KEY, CATCHUP_SUBJECT } from "../../lib/alerts/summary";
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
  assert.equal(result.counts.recommendations, 2);
  assert.equal(result.counts.decisions, 1);
  assert.equal(result.counts.stages, 1);
  assert.equal(result.counts.activity, 0);
  assert.equal(result.counts.comms, 1);
  assert.equal(result.counts.sites, 0);
  assert.equal(result.counts.proposals, 0);
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
  assert.match(printed, /recommendations: 2/);
  assert.match(printed, /proposals: 0/);
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
    assert.match(text, /2 agent draft replies are waiting for you/);
    assert.equal(text.split("\n").includes("Site"), false);
    assert.equal(text.toLowerCase().includes("jaideep"), false);
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

test("catch-up keeps unresolved items from before Nov 9 and lists each open proposal", async () => {
  const previous = process.env.AUTH_USERS;
  process.env.AUTH_USERS = JSON.stringify([
    { u: "cindel", h: "$2b$04$abcdefghijklmnopqrstuuabcdefghijklmnopqrstuuabcdefghijk", role: "user", name: "Cindel" },
    { u: "jaideep", h: "$2b$04$abcdefghijklmnopqrstuuabcdefghijklmnopqrstuuabcdefghijk", role: "admin", name: "Jaideep" },
  ]);
  const sql = await ready();
  try {
    await sql.query(
      `INSERT INTO suggestions (id, target_kind, target_id, field_name, title, proposed_value, reason, status, author_id, created_at)
       VALUES
         ('sug-nov8', 'site', 'PIPE-PHX-0100', 'stage', 'Sample proposal headline.', 'Desk screen', 'Fixture reason.', 'open', 'cindel', '2026-11-08T18:00:00.000Z'),
         ('sug-ready', 'site', 'PIPE-LAS-0103', 'stage', 'Later proposal headline.', 'Desk screen', 'Fixture reason.', 'ready', 'cindel', '2026-11-10T18:00:00.000Z'),
         ('sug-decided', 'site', 'PIPE-PHX-0101', 'stage', 'Decided proposal headline.', 'Desk screen', 'Fixture reason.', 'accepted', 'cindel', '2026-11-08T18:00:00.000Z'),
         ('sug-self', 'site', 'PIPE-PHX-0102', 'stage', 'Own proposal headline.', 'Desk screen', 'Fixture reason.', 'open', 'jaideep', '2026-11-08T18:00:00.000Z'),
         ('sug-hidden', 'site', 'PIPE-PHX-0006', 'stage', 'Hidden proposal headline.', 'Desk screen', 'Fixture reason.', 'open', 'cindel', '2026-11-08T18:00:00.000Z')`,
    );
    await sql.query(
      `INSERT INTO agent_inbox (id, kind, ref_id, site_id, actor, body, thread_key, idempotency_key, status, created_at)
       VALUES
         ('gap-old', 'ask_gap', 'gap-old', 'PIPE-PHX-0100', 'cindel', 'Old open question.', 'ask:old', 'ask:old', 'new', '2026-11-01T00:00:00.000Z'),
         ('gap-done', 'ask_gap', 'gap-done', 'PIPE-PHX-0100', 'cindel', 'Closed question.', 'ask:done', 'ask:done', 'done', '2026-11-01T00:00:00.000Z'),
         ('gap-hidden', 'ask_gap', 'gap-hidden', 'PIPE-PHX-0006', 'cindel', 'Hidden question.', 'ask:hidden', 'ask:hidden', 'new', '2026-11-12T00:00:00.000Z')`,
    );
    await sql.query(
      `INSERT INTO events (id, entity_type, entity_id, site_id, payload, source, actor, idempotency_key, created_at)
       VALUES
         ('EV-nov8', 'stage', 'PIPE-PHX-0104', 'PIPE-PHX-0104', '{"stage":"2 Financial screen","previous_stage":"1 Desk screen"}'::jsonb, 'agent', 'cindel', 'ev-nov8', '2026-11-08T12:00:00.000Z'),
         ('EV-nov7', 'stage', 'PIPE-PHX-0105', 'PIPE-PHX-0105', '{"stage":"2 Financial screen","previous_stage":"1 Desk screen"}'::jsonb, 'agent', 'cindel', 'ev-nov7', '2026-11-07T12:00:00.000Z'),
         ('EV-book', 'stage', 'PIPE-PHX-0104', 'PIPE-PHX-0104', '{"stage":"3 Site checks","previous_stage":"1 Desk screen"}'::jsonb, 'workbook import', 'workbook-sync', 'ev-book', '2026-11-08T13:00:00.000Z'),
         ('EV-first', 'stage', 'PIPE-PHX-0106', 'PIPE-PHX-0106', '{"stage":"1 Desk screen","previous_stage":null}'::jsonb, 'agent', 'jaideep', 'ev-first', '2026-11-08T14:00:00.000Z'),
         ('EV-same', 'stage', 'PIPE-PHX-0107', 'PIPE-PHX-0107', '{"stage":"2 Financial screen","previous_stage":"2 Financial screen"}'::jsonb, 'agent', 'jaideep', 'ev-same', '2026-11-08T15:00:00.000Z')`,
    );
    const loaded = await loadCatchUp(sql);
    assert.equal(loaded.counts.proposals, 2);
    assert.equal(loaded.counts.asks, 1);
    assert.equal(loaded.counts.stages, 1);
    const proposals = loaded.items.filter((item) => item.category === "proposals" && item.siteId);
    assert.deepEqual(proposals.map((item) => item.siteId), ["PIPE-PHX-0100", "PIPE-LAS-0103"]);
    assert.equal(proposals[0]?.authorId, "cindel");
    assert.equal(proposals[0]?.summary, "Sample proposal headline.");
    assert.equal(proposals[0]?.href, proposalHref("PIPE-PHX-0100"));
    assert.equal(proposals.every((item) => item.siteId !== "PIPE-PHX-0006"), true);
    assert.equal(loaded.items.some((item) => item.summary.includes("Decided proposal") || item.summary.includes("Own proposal") || item.summary.includes("Hidden proposal")), false);

    const mail = await previewCatchUp(sql, new Date("2026-11-15T16:00:00.000Z"));
    assert.ok(mail);
    assert.equal(mail.subject, "Distributed Sites catch-up · since Nov 8");
    assert.match(mail.body, /1 open ask gap\./);
    assert.match(mail.body, /2 open proposals\./);
    assert.match(mail.body, /Sample proposal headline\./);
    assert.match(mail.body, /Cindel sent a proposal\./);
    assert.match(mail.body, /PIPE-PHX-0100/);
    assert.match(mail.body, new RegExp(proposalHref("PIPE-PHX-0100").replace(/[?&]/g, "\\$&")));
    assert.match(mail.html, /Sample proposal headline/);
    assert.match(mail.html, /Cindel sent a proposal/);
    assert.equal(mail.html.includes(`href="${proposalHref("PIPE-PHX-0100").replace(/&/g, "&amp;")}"`), true);
    assert.equal(mail.body.split("\n").includes("Site"), false);
    assert.equal(mail.html.includes(">Site<"), false);
    assert.equal(mail.body.toLowerCase().includes("jaideep"), false);
    assert.equal(mail.html.toLowerCase().includes("jaideep"), false);
    assert.equal(mail.body.includes("PIPE-PHX-0006"), false);
    assert.equal(mail.html.includes("PIPE-PHX-0006"), false);
    assert.equal(mail.body.includes("Decided proposal"), false);
    assert.equal(mail.body.includes("Own proposal"), false);
    assert.equal(mail.body.includes("PIPE-PHX-0105"), false);
    assert.equal(mail.body.includes("PIPE-PHX-0106"), false);
    const logs = await sql.query(`SELECT id FROM alert_log`);
    const outbox = await sql.query(`SELECT id FROM alert_outbox`);
    assert.equal(logs.rows.length, 0);
    assert.equal(outbox.rows.length, 0);
  } finally {
    if (previous == null) delete process.env.AUTH_USERS;
    else process.env.AUTH_USERS = previous;
  }
});

test("preview is refused in CI", () => {
  const previous = process.env.GITHUB_ACTIONS;
  process.env.GITHUB_ACTIONS = "true";
  try {
    assert.equal(catchUpPreviewAllowed(), false);
  } finally {
    if (previous == null) delete process.env.GITHUB_ACTIONS;
    else process.env.GITHUB_ACTIONS = previous;
  }
  assert.equal(catchUpPreviewAllowed(), true);
});
