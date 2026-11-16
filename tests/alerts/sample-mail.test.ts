import assert from "node:assert/strict";
import test from "node:test";
import { migrate } from "../../lib/actions/migrate";
import { renderAlert } from "../../lib/alerts/template";
import { defaultPreferences } from "../../lib/alerts/preferences";
import { loadCatchUp, loadDigestBrief } from "../../lib/alerts/summary";
import type { Sql } from "../../lib/actions/db";
import { memorySql } from "../helpers/sql";

const MARKER = "WORKBOOK_ROW_MARKER";

async function ready(): Promise<Sql> {
  const sql = await memorySql();
  await migrate(sql);
  return sql;
}

test("digest and catch-up counts ignore the workbook import and keep inbound mail only", async () => {
  const sql = await ready();
  const inbox: string[] = [];
  const recs: string[] = [];
  for (let i = 0; i < 5; i += 1) {
    inbox.push(`('in-r${i}', 'note', 'r${i}', 'PIPE-PHX-010${i}', 'muse', 'Draft.', 'note:r${i}', 'note:r${i}', '2026-11-12T00:00:00.000Z')`);
    recs.push(`('rec-r${i}', 'in-r${i}', 'reply', 'Draft reply.', 'none', 'Because.', '[]'::jsonb, 'medium', 'muse', '2026-11-12T00:00:00.000Z')`);
  }
  for (let i = 0; i < 3; i += 1) {
    inbox.push(`('in-d${i}', 'suggestion', 'd${i}', 'PIPE-PHX-020${i}', 'muse', 'Open.', 'proposal:d${i}', 'proposal:d${i}', '2026-11-12T00:00:00.000Z')`);
    recs.push(`('rec-d${i}', 'in-d${i}', 'decision', 'Decide.', 'approve', 'Because.', '[]'::jsonb, 'high', 'muse', '2026-11-12T00:00:00.000Z')`);
  }
  inbox.push(`('in-closed', 'suggestion', 'closed', 'PIPE-PHX-0008', 'jaideep', 'Closed.', 'proposal:closed', 'proposal:closed', '2026-11-12T00:00:00.000Z')`);
  recs.push(`('rec-closed', 'in-closed', 'decision', 'Old.', 'approve', 'Done.', '[]'::jsonb, 'high', 'muse', '2026-11-12T00:00:00.000Z')`);
  await sql.query(`INSERT INTO agent_inbox (id, kind, ref_id, site_id, actor, body, thread_key, idempotency_key, created_at) VALUES ${inbox.join(",")}`);
  await sql.query(
    `INSERT INTO agent_recommendations (id, inbox_id, kind, draft_text, decision, rationale, sources, confidence, model, created_at) VALUES ${recs.join(",")}`,
  );
  await sql.query(
    `INSERT INTO suggestions (id, target_kind, target_id, field_name, proposed_value, reason, status, author_id)
     VALUES ('sug-closed', 'site', 'PIPE-PHX-0008', 'stage', '2 Financial screen', 'Done.', 'accepted', 'jaideep')`,
  );
  await sql.query(`UPDATE agent_inbox SET proposal_id = 'sug-closed' WHERE id = 'in-closed'`);
  await sql.query(`UPDATE agent_recommendations SET used_at = created_at WHERE id = 'rec-closed'`);

  const events: string[] = [];
  for (let i = 0; i < 40; i += 1) {
    const site = `PIPE-PHX-${String(1000 + i)}`;
    events.push(
      `('EV-s${i}', 'stage', '${site}', '${site}', '{"stage":"2 Financial screen","previous_stage":"1 Desk screen"}'::jsonb, 'agent', 'jaideep', 'ev-s${i}', '2026-11-12T00:00:00.000Z')`,
    );
  }
  for (let i = 0; i < 80; i += 1) {
    const site = `PIPE-PHX-${String(2000 + i)}`;
    events.push(
      `('EV-w${i}', 'stage', '${site}', '${site}', '{"stage":"3 Site checks","previous_stage":"1 Desk screen","summary":"${MARKER}"}'::jsonb, 'workbook-copy', 'workbook-sync', 'ev-w${i}', '2026-11-15T00:00:00.000Z')`,
    );
  }
  events.push(
    `('EV-in-a', 'comms', 'CM-1', 'PIPE-PHX-1000', '{"direction":"in"}'::jsonb, 'agent', 'muse', 'ev-in-a', '2026-11-12T00:00:00.000Z')`,
    `('EV-in-b', 'comms', 'CM-2', 'PIPE-PHX-1000', '{"direction":"in"}'::jsonb, 'agent', 'muse', 'ev-in-b', '2026-11-12T00:00:00.000Z')`,
    `('EV-in-c', 'comms', 'CM-3', 'PIPE-PHX-1001', '{"direction":"in"}'::jsonb, 'agent', 'muse', 'ev-in-c', '2026-11-12T00:00:00.000Z')`,
    `('EV-out', 'comms', 'CM-4', 'PIPE-PHX-1001', '{"direction":"out"}'::jsonb, 'agent', 'muse', 'ev-out', '2026-11-12T00:00:00.000Z')`,
    `('EV-self', 'comms', 'CM-5', 'PIPE-PHX-1001', '{"direction":"in"}'::jsonb, 'agent', 'jaideep', 'ev-self', '2026-11-12T00:00:00.000Z')`,
  );
  const markets = ["PHX", "PHX", "PHX", "LAS", "LAS"];
  markets.forEach((market, index) => {
    const site = `LAND-PHX-30${index}`;
    events.push(
      `('EV-site${index}', 'site', '${site}', '${site}', '{"market":"${market}","name":"Listing ${index}"}'::jsonb, 'agent', 'muse', 'ev-site${index}', '2026-11-13T00:00:00.000Z')`,
    );
  });
  events.push(
    `('EV-site-book', 'site', 'LAND-PHX-3999', 'LAND-PHX-3999', '{"market":"PHX","name":"${MARKER}"}'::jsonb, 'workbook import', 'workbook-sync', 'ev-site-book', '2026-11-15T00:00:00.000Z')`,
  );
  await sql.query(
    `INSERT INTO events (id, entity_type, entity_id, site_id, payload, source, actor, idempotency_key, created_at) VALUES ${events.join(",")}`,
  );

  const catchup = await loadCatchUp(sql);
  assert.equal(catchup.counts.recommendations, 5);
  assert.equal(catchup.counts.decisions, 3);
  assert.equal(catchup.counts.stages, 40);
  assert.equal(catchup.counts.activity, 0);
  assert.equal(catchup.counts.comms, 3);
  assert.equal(catchup.counts.sites, 5);

  const digest = await loadDigestBrief(sql, {
    userId: "jaideep",
    since: new Date("2026-11-11T00:00:00.000Z"),
    prefs: defaultPreferences("reviewer"),
  });
  assert.equal(digest.counts.recommendations, 5);
  assert.equal(digest.counts.decisions, 3);
  assert.equal(digest.counts.stages, 40);
  assert.equal(digest.counts.comms, 3);
  assert.equal(digest.counts.sites, 5);
  const renderedDigest = renderAlert(digest.items, { now: new Date("2026-11-16T15:00:00.000Z"), kind: "digest" });
  const renderedCatch = renderAlert(catchup.items, { now: new Date("2026-11-16T15:00:00.000Z"), kind: "catchup" });
  assert.ok(renderedDigest);
  assert.ok(renderedCatch);
  for (const mail of [renderedDigest, renderedCatch]) {
    assert.equal(mail.body.includes(MARKER), false);
    assert.equal(mail.html.includes(MARKER), false);
    assert.equal(mail.body.includes("PIPE-PHX-0006"), false);
    assert.match(mail.body, /40 stage changes/);
    assert.match(mail.body, /5 agent draft replies/);
    assert.match(mail.body, /3 open decision requests/);
    assert.match(mail.body, /New listings: LAS 2, PHX 3|New listings: PHX 3, LAS 2/);
    assert.equal((mail.body.match(/inbound reply/g) || []).length >= 1, true);
  }
});
