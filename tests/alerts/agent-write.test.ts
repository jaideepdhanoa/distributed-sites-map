import assert from "node:assert/strict";
import test from "node:test";
import { migrate } from "../../lib/actions/migrate";
import { notifyAppliedChanges, notifyNewRecommendation } from "../../lib/alerts/agentWrite";
import { renderAlert } from "../../lib/alerts/template";
import { queueAgentAlert } from "../../lib/alerts/notify";
import { loadDigestBrief } from "../../lib/alerts/summary";
import { defaultPreferences } from "../../lib/alerts/preferences";
import { siteHref } from "../../lib/alerts/links";
import type { Sql } from "../../lib/actions/db";
import { memorySql } from "../helpers/sql";

const hash = "$2b$04$abcdefghijklmnopqrstuuabcdefghijklmnopqrstuuabcdefghijk";

async function ready(): Promise<Sql> {
  const sql = await memorySql();
  await migrate(sql);
  return sql;
}

function useAccounts() {
  process.env.AUTH_USERS = JSON.stringify([
    { u: "jaideep", h: hash, role: "user", name: "Jaideep" },
    { u: "muse", h: hash, role: "user", actionRole: "reviewer", name: "Muse", email: "muse@example.com" },
  ]);
  delete process.env.RESEND_API_KEY;
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASS;
  delete process.env.ALERT_EMAILS;
}

async function insertEvent(
  sql: Sql,
  input: { id: string; type: string; siteId: string; payload: Record<string, unknown>; at?: string },
) {
  await sql.query(
    `INSERT INTO events (id, entity_type, entity_id, site_id, payload, source, actor, idempotency_key, created_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, 'agent', 'muse', $6, $7)`,
    [input.id, input.type, input.id, input.siteId, JSON.stringify(input.payload), `key-${input.id}`, input.at || "2026-11-12T00:00:00.000Z"],
  );
}

test("the author is never alerted, a write alerts once, and routine comms stay out of instant mail", async () => {
  const previous = process.env.AUTH_USERS;
  useAccounts();
  const sql = await ready();
  try {
    await insertEvent(sql, { id: "EV-1", type: "stage", siteId: "PIPE-PHX-0008", payload: { stage: "2 Financial screen" } });
    const actor = { id: "muse", kind: "agent" as const };
    await notifyAppliedChanges(sql, actor, [{ entity_type: "stage", site_id: "PIPE-PHX-0008", event_id: "EV-1" }]);
    await notifyAppliedChanges(sql, actor, [{ entity_type: "stage", site_id: "PIPE-PHX-0008", event_id: "EV-1" }]);
    await queueAgentAlert(sql, {
      actorId: "muse",
      userIds: ["muse", "jaideep"],
      category: "stages",
      siteId: "PIPE-PHX-0008",
      summary: "Stage is now 2 Financial screen.",
      href: siteHref("PIPE-PHX-0008"),
      refId: "EV-1",
    });
    const stageRows = await sql.query<{ user_id: string; channel: string; idempotency_key: string }>(
      `SELECT user_id, channel, idempotency_key FROM alert_outbox WHERE ref_id = 'EV-1' ORDER BY user_id`,
    );
    assert.deepEqual(stageRows.rows.map((row) => row.user_id), ["jaideep"]);
    assert.equal(stageRows.rows[0]?.channel, "instant");
    assert.equal(stageRows.rows.length, 1);

    await insertEvent(sql, { id: "EV-2", type: "comms", siteId: "PIPE-PHX-0008", payload: { summary: "Sent the brochure.", person: "Alex" } });
    await notifyAppliedChanges(sql, actor, [{ entity_type: "comms", site_id: "PIPE-PHX-0008", event_id: "EV-2" }]);
    const routine = await sql.query(`SELECT id FROM alert_outbox WHERE ref_id = 'EV-2'`);
    assert.equal(routine.rows.length, 0);

    await insertEvent(sql, { id: "EV-3", type: "comms", siteId: "PIPE-PHX-0008", payload: { summary: "Please see this.", person: "Jaideep" } });
    await notifyAppliedChanges(sql, actor, [{ entity_type: "comms", site_id: "PIPE-PHX-0008", event_id: "EV-3" }]);
    const mentioned = await sql.query<{ user_id: string; channel: string; category: string }>(
      `SELECT user_id, channel, category FROM alert_outbox WHERE ref_id = 'EV-3'`,
    );
    assert.equal(mentioned.rows.length, 1);
    assert.equal(mentioned.rows[0]?.user_id, "jaideep");
    assert.equal(mentioned.rows[0]?.channel, "instant");
    assert.equal(mentioned.rows[0]?.category, "mentions");

    await notifyAppliedChanges(sql, { id: "jaideep", kind: "human" }, [{ entity_type: "stage", site_id: "PIPE-PHX-0008", event_id: "EV-1" }]);
    await notifyAppliedChanges(sql, { id: "workbook-sync", kind: "agent" }, [{ entity_type: "stage", site_id: "PIPE-PHX-0008", event_id: "EV-1" }]);
    const still = await sql.query(`SELECT id FROM alert_outbox WHERE category = 'stages'`);
    assert.equal(still.rows.length, 1);
  } finally {
    if (previous == null) delete process.env.AUTH_USERS;
    else process.env.AUTH_USERS = previous;
  }
});

test("PIPE-PHX-0006 is left out of instant alerts and the digest", async () => {
  const previousUsers = process.env.AUTH_USERS;
  const previousUrl = process.env.APP_URL;
  useAccounts();
  process.env.APP_URL = "https://sites-map-preview.vercel.app";
  const sql = await ready();
  try {
    await insertEvent(sql, { id: "EV-X", type: "stage", siteId: "PIPE-PHX-0006", payload: { stage: "Dropped" } });
    await insertEvent(sql, { id: "EV-Y", type: "stage", siteId: "PIPE-PHX-0008", payload: { stage: "3 Site checks" } });
    await insertEvent(sql, { id: "EV-Z", type: "activity", siteId: "PIPE-PHX-0006", payload: { summary: "Hidden activity." } });
    await notifyAppliedChanges(sql, { id: "indie", kind: "agent" }, [
      { entity_type: "stage", site_id: "PIPE-PHX-0006", event_id: "EV-X" },
      { entity_type: "stage", site_id: "PIPE-PHX-0008", event_id: "EV-Y" },
    ]);
    const rows = await sql.query<{ site_id: string; user_id: string }>(`SELECT site_id, user_id FROM alert_outbox`);
    assert.equal(rows.rows.length > 0, true);
    assert.equal(rows.rows.every((row) => row.site_id === "PIPE-PHX-0008"), true);
    assert.equal(rows.rows.some((row) => row.user_id === "indie"), false);
    const brief = await loadDigestBrief(sql, {
      userId: "jaideep",
      since: new Date("2026-11-10T00:00:00.000Z"),
      prefs: defaultPreferences("reviewer"),
    });
    const rendered = renderAlert(brief.items, { now: new Date("2026-11-15T16:00:00.000Z"), kind: "digest" });
    assert.ok(rendered);
    const blob = `${rendered.subject}\n${rendered.body}\n${rendered.html}`;
    assert.equal(blob.includes("PIPE-PHX-0006"), false);
    assert.equal(blob.includes("PIPE-PHX-0008"), true);
    assert.equal(blob.includes("vercel.app"), false);
    assert.equal(siteHref("PIPE-PHX-0008"), "https://distributedsites.com/?site=PIPE-PHX-0008");
    assert.equal(siteHref("PIPE-PHX-0006").includes("PIPE-PHX-0006"), false);
  } finally {
    if (previousUsers == null) delete process.env.AUTH_USERS;
    else process.env.AUTH_USERS = previousUsers;
    if (previousUrl == null) delete process.env.APP_URL;
    else process.env.APP_URL = previousUrl;
  }
});

test("a recommendation alerts Jaideep once and does not alert the model", async () => {
  const previous = process.env.AUTH_USERS;
  useAccounts();
  const sql = await ready();
  try {
    await sql.query(
      `INSERT INTO agent_inbox (id, kind, ref_id, site_id, actor, body, thread_key, idempotency_key)
       VALUES ('inbox-1', 'note', 'note-1', 'PIPE-PHX-0008', 'cindel', 'A note.', 'note:note-1', 'note:note-1')`,
    );
    await sql.query(
      `INSERT INTO agent_recommendations (id, inbox_id, kind, draft_text, decision, rationale, sources, confidence, model)
       VALUES ('rec-1', 'inbox-1', 'reply', 'Look at the frontage.', 'none', 'The thread is about the frontage.', '[]'::jsonb, 'medium', 'muse')`,
    );
    await notifyNewRecommendation(sql, "rec-1", "muse");
    await notifyNewRecommendation(sql, "rec-1", "muse");
    const rows = await sql.query<{ user_id: string; category: string }>(
      `SELECT user_id, category FROM alert_outbox WHERE ref_id = 'rec-1'`,
    );
    assert.equal(rows.rows.length, 1);
    assert.equal(rows.rows[0]?.user_id, "jaideep");
    assert.equal(rows.rows[0]?.category, "recommendations");
  } finally {
    if (previous == null) delete process.env.AUTH_USERS;
    else process.env.AUTH_USERS = previous;
  }
});
