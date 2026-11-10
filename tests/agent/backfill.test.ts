import assert from "node:assert/strict";
import test from "node:test";
import { backfillInbox } from "../../lib/agent/backfill";
import { feedKey } from "../../lib/agent/inbox";
import { migrate } from "../../lib/actions/migrate";
import type { RecordLookup } from "../../lib/actions/records";
import { memorySql } from "../helpers/sql";

const lookup: RecordLookup = (kind, id) => {
  if (kind === "deal") return { deal_id: id };
  if (kind === "site") return { site_id: id, linked_deal_id: "" };
  return null;
};

async function ready() {
  const sql = await memorySql();
  await migrate(sql);
  await sql.query(
    `INSERT INTO notes (id, target_kind, target_id, parent_id, body, author_id, created_at) VALUES
      ('n1', 'deal', 'PIPE-PHX-0008', NULL, 'The frontage needs another look.', 'cindel', '2026-01-02T15:00:00.000Z'),
      ('n2', 'deal', 'PIPE-PHX-0008', 'n1', 'The driveway is the tight part.', 'ming', '2026-01-02T16:00:00.000Z'),
      ('n3', 'suggestion', 's1', NULL, 'Comment on the open proposal.', 'cindel', '2026-01-03T18:00:00.000Z')`,
  );
  await sql.query(
    `INSERT INTO mentions (id, user_id, site_id, source_kind, source_id, created_at) VALUES
      ('m1', 'jaideep', 'PIPE-PHX-0008', 'note', 'n1', '2026-01-02T15:00:00.000Z')`,
  );
  await sql.query(
    `INSERT INTO suggestions (
      id, target_kind, target_id, field_name, detail, proposed_value, reason, status, author_id, title, created_at, decided_by, decided_at, decision_note
    ) VALUES
      ('s1', 'deal', 'PIPE-PHX-0008', 'proposed_next_step', 'work_item', 'Order the survey', 'The frontage is tight.', 'open', 'cindel', 'Order the survey', '2026-01-03T15:00:00.000Z', NULL, NULL, NULL),
      ('s2', 'deal', 'PIPE-PHX-0008', 'proposed_next_step', 'stage_move', 'financial', 'Move it forward.', 'accepted', 'cindel', 'Advance', '2026-01-04T15:00:00.000Z', 'jaideep', '2026-01-05T15:00:00.000Z', 'Move it forward.'),
      ('s3', 'deal', 'PIPE-PHX-0008', 'flag', NULL, 'aside', 'Needs another look.', 'rejected', 'cindel', NULL, '2026-01-06T15:00:00.000Z', 'jaideep', '2026-01-06T15:00:00.000Z', 'Not now.'),
      ('s4', 'deal', 'PIPE-PHX-0008', 'stage', NULL, 'Dropped', 'Already in the workbook.', 'applied', 'cindel', NULL, '2026-01-07T15:00:00.000Z', NULL, NULL, NULL)`,
  );
  await sql.query(
    `INSERT INTO queue_flags (id, site_id, from_user, to_user, note, created_at) VALUES
      ('f1', 'PIPE-PHX-0008', 'cindel', 'jaideep', 'Please look at the frontage.', '2026-01-08T15:00:00.000Z')`,
  );
  return sql;
}

test("dry-run counts historical events by kind and actor and writes nothing", async () => {
  const sql = await ready();
  const report = await backfillInbox(sql, { dryRun: true, lookup });
  assert.equal(report.dryRun, true);
  assert.equal(report.inserted, 0);
  assert.equal(report.superseded, 0);
  assert.equal(report.alreadyPresent, 0);
  assert.equal(report.byKind.note, 2);
  assert.equal(report.byKind.reply, 1);
  assert.equal(report.byKind.mention, 1);
  assert.equal(report.byKind.suggestion, 4);
  assert.equal(report.byKind.decision, 2);
  assert.equal(report.byKind.flag, 1);
  assert.equal(report.byKind.ask_gap, undefined);
  assert.equal(report.byActor.cindel, 8);
  assert.equal(report.byActor.ming, 1);
  assert.equal(report.byActor.jaideep, 2);
  assert.equal(report.planned, 11);
  const note = report.counts.find((row) => row.kind === "note" && row.actor === "cindel");
  assert.equal(note?.count, 2);
  const rows = await sql.query<{ n: string }>(`SELECT count(*)::text AS n FROM agent_inbox`);
  assert.equal(rows.rows[0].n, "0");
});

test("backfill is idempotent and keeps the original time, key, and thread", async () => {
  const sql = await ready();
  const first = await backfillInbox(sql, { dryRun: false, lookup });
  assert.equal(first.dryRun, false);
  assert.equal(first.inserted, 11);
  assert.equal(first.byKind.suggestion, 4);
  assert.equal(first.byKind.decision, 2);

  const keys = await sql.query<{ idempotency_key: string }>(`SELECT idempotency_key FROM agent_inbox ORDER BY idempotency_key`);
  assert.deepEqual(keys.rows.map((row) => row.idempotency_key), [
    "decision:s2",
    "decision:s3",
    "flag:f1",
    "mention:n1",
    "note:n1",
    "note:n3",
    "reply:n2",
    "suggestion:s1",
    "suggestion:s2",
    "suggestion:s3",
    "suggestion:s4",
  ].sort());

  const note = await sql.query<{ created_at: Date | string; thread_key: string; actor: string; status: string }>(
    `SELECT created_at, thread_key, actor, status FROM agent_inbox WHERE idempotency_key = 'note:n1'`,
  );
  assert.equal(new Date(note.rows[0].created_at).toISOString(), "2026-01-02T15:00:00.000Z");
  assert.equal(note.rows[0].thread_key, "note:n1");
  assert.equal(note.rows[0].actor, "cindel");
  assert.equal(note.rows[0].status, "superseded");

  const reply = await sql.query<{ thread_key: string; thread_context: string; status: string; site_id: string }>(
    `SELECT thread_key, thread_context, status, site_id FROM agent_inbox WHERE idempotency_key = 'reply:n2'`,
  );
  assert.equal(reply.rows[0].thread_key, "note:n1");
  assert.equal(reply.rows[0].thread_context, "The frontage needs another look.");
  assert.equal(reply.rows[0].status, "new");
  assert.equal(reply.rows[0].site_id, "PIPE-PHX-0008");

  const mention = await sql.query<{ status: string; created_at: Date | string }>(
    `SELECT status, created_at FROM agent_inbox WHERE idempotency_key = 'mention:n1'`,
  );
  assert.equal(mention.rows[0].status, "superseded");
  assert.equal(new Date(mention.rows[0].created_at).toISOString(), "2026-01-02T15:00:00.000Z");

  const decision = await sql.query<{ workbook_stage: boolean; stage: string | null; proposal_status: string; status: string; actor: string }>(
    `SELECT workbook_stage, stage, proposal_status, status, actor FROM agent_inbox WHERE idempotency_key = 'decision:s2'`,
  );
  assert.equal(decision.rows[0].workbook_stage, true);
  assert.equal(decision.rows[0].stage, "financial");
  assert.equal(decision.rows[0].proposal_status, "accepted");
  assert.equal(decision.rows[0].status, "new");
  assert.equal(decision.rows[0].actor, "jaideep");

  const tied = await sql.query<{ status: string }>(
    `SELECT kind, status FROM agent_inbox WHERE ref_id = 's3' ORDER BY kind`,
  );
  assert.deepEqual(tied.rows.map((row) => row.status), ["new", "superseded"]);

  const openProposal = await sql.query<{ status: string; proposal_status: string; site_id: string; record_id: string }>(
    `SELECT status, proposal_status, site_id, record_id FROM agent_inbox WHERE idempotency_key = 'suggestion:s1'`,
  );
  assert.equal(openProposal.rows[0].status, "new");
  assert.equal(openProposal.rows[0].proposal_status, "open");

  const onProposal = await sql.query<{ site_id: string; record_id: string; kind: string }>(
    `SELECT site_id, record_id, kind FROM agent_inbox WHERE idempotency_key = 'note:n3'`,
  );
  assert.equal(onProposal.rows[0].kind, "note");
  assert.equal(onProposal.rows[0].site_id, "PIPE-PHX-0008");
  assert.equal(onProposal.rows[0].record_id, "s1");

  const applied = await sql.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM agent_inbox WHERE ref_id = 's4' AND kind = 'decision'`,
  );
  assert.equal(applied.rows[0].n, "0");

  const again = await backfillInbox(sql, { dryRun: false, lookup });
  assert.equal(again.inserted, 0);
  assert.equal(again.planned, 0);
  assert.equal(again.alreadyPresent, 11);
  assert.equal(again.superseded, 0);
  const after = await sql.query<{ n: string }>(`SELECT count(*)::text AS n FROM agent_inbox`);
  assert.equal(after.rows[0].n, "11");
  assert.equal(feedKey("note", "n1"), "note:n1");

  const preview = await backfillInbox(sql, { dryRun: true, lookup });
  assert.equal(preview.planned, 0);
  assert.equal(preview.inserted, 0);
  assert.deepEqual(preview.byKind, {});
});

test("backfill emits ready and overtaken once and leaves an open proposal open", async () => {
  const sql = await memorySql();
  await migrate(sql);
  await sql.query(
    `INSERT INTO suggestions (
      id, target_kind, target_id, field_name, detail, proposed_value, reason, status, author_id, title, created_at, decided_by, decided_at, decision_note
    ) VALUES
      ('keep', 'deal', 'PIPE-PHX-0008', 'proposed_next_step', 'stage_move', 'financial', 'Interest.', 'open', 'cindel', 'Prioritize', '2026-02-01T15:00:00.000Z', NULL, NULL, NULL),
      ('wait', 'deal', 'PIPE-PHX-0008', 'proposed_next_step', 'stage_move', 'financial', 'Interest.', 'agreed_waiting', 'cindel', 'Prioritize', '2026-02-02T15:00:00.000Z', 'reviewer', '2026-02-03T15:00:00.000Z', 'Waiting on the file.'),
      ('go', 'deal', 'PIPE-PHX-0008', 'proposed_next_step', 'stage_move', 'financial', 'Interest.', 'ready', 'cindel', 'Prioritize', '2026-02-04T15:00:00.000Z', 'reviewer', '2026-02-05T15:00:00.000Z', 'Clear.'),
      ('moot', 'deal', 'PIPE-PHX-0008', 'proposed_next_step', 'stage_move', 'financial', 'Interest.', 'overtaken', 'cindel', 'Prioritize', '2026-02-06T15:00:00.000Z', 'reviewer', '2026-02-07T15:00:00.000Z', 'The site was already dropped.')`,
  );
  const first = await backfillInbox(sql, { dryRun: false, lookup });
  assert.equal(first.byKind.suggestion, 4);
  assert.equal(first.byKind.decision, 1);
  assert.equal(first.byKind.proposal_ready, 1);
  assert.equal(first.byKind.proposal_overtaken, 1);
  const second = await backfillInbox(sql, { dryRun: false, lookup });
  assert.equal(second.inserted, 0);
  const statuses = await sql.query<{ id: string; status: string }>(`SELECT id, status FROM suggestions ORDER BY id`);
  assert.deepEqual(statuses.rows.map((row) => `${row.id}:${row.status}`), ["go:ready", "keep:open", "moot:overtaken", "wait:agreed_waiting"]);
  const ready = await sql.query<{ workbook_stage: boolean; actor: string }>(
    `SELECT workbook_stage, actor FROM agent_inbox WHERE idempotency_key = 'proposal_ready:go'`,
  );
  assert.equal(ready.rows[0].workbook_stage, false);
  assert.equal(ready.rows[0].actor, "system");
});
