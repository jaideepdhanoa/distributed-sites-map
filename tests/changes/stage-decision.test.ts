import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { migrate } from "../../lib/actions/migrate";
import type { RecordLookup } from "../../lib/actions/records";
import { createSuggestion, decideSuggestion } from "../../lib/actions/suggestions";
import { applyBatch } from "../../lib/changes/apply";
import { formatZonedTimestamp, parseZonedTimestamp, validateBatch, type Actor } from "../../lib/changes/schema";
import { memorySql } from "../helpers/sql";

const reviewer: Actor = { id: "jaideep", kind: "human", role: "reviewer" };
const contributor: Actor = { id: "cindel", kind: "human", role: "contributor" };
const system: Actor = { id: "system", kind: "agent" };

const record = { deal_id: "PIPE-PHX-0008", name: "Sample", stage: "1 Desk screen" };
const lookup: RecordLookup = (kind, id) => (kind === "deal" && id === record.deal_id ? record : null);

function stage(stageName: string, extra: Record<string, unknown> = {}) {
  return {
    entity_type: "stage",
    site_id: "PIPE-PHX-0001",
    expected_version: 0,
    source: "desk review",
    payload: { stage: stageName, market: "PHX", ...extra },
  };
}

async function ready() {
  const sql = await memorySql();
  await migrate(sql);
  return sql;
}

test("a zoned timestamp round-trips and a stage time without an offset is refused", () => {
  const iso = formatZonedTimestamp(new Date("2026-11-16T01:02:03.004Z"));
  const parsed = parseZonedTimestamp(iso);
  assert.ok(parsed);
  assert.match(parsed.iso, /[+-]\d{2}:\d{2}$/);
  assert.equal(parsed.iso.endsWith("Z"), false);
  assert.throws(() => validateBatch(reviewer, "bare-day", { changes: [stage("1 Desk screen", { at: "2026-11-16" })] }), /ISO-8601 time with a zone offset/);
  assert.doesNotThrow(() => validateBatch(reviewer, "zoned", { changes: [stage("2 Financial screen", { at: "2026-11-16T09:30:00-08:00" })] }));
});

test("the system cannot set Dropped", () => {
  assert.throws(
    () => validateBatch(system, "system-drop", { changes: [stage("Dropped", { reason: "Lot too small" })] }),
    /cannot set Stage to Dropped/,
  );
  assert.throws(
    () => validateBatch({ id: "system", kind: "human", role: "reviewer" }, "system-human-drop", { changes: [stage("Dropped", { reason: "Lot too small" })] }),
    /cannot set Stage to Dropped/,
  );
});

test("accepting a stage decision writes the stage, the event, and the receipt", async () => {
  const sql = await ready();
  const proposal = await createSuggestion(sql, {
    targetKind: "deal",
    targetId: record.deal_id,
    field: "proposed_next_step",
    detail: "stage_move",
    proposedValue: "financial",
    reason: "The file is ready.",
    authorId: "cindel",
  }, lookup);
  const open = await sql.query<{ stage: string }>("SELECT stage FROM site_stages WHERE site_id = $1", [record.deal_id]);
  assert.equal(open.rows.length, 0);

  const accepted = await decideSuggestion(sql, { id: proposal.id, status: "accepted", actorId: "jaideep" }, lookup);
  assert.equal(accepted.status, "accepted");
  const row = await sql.query<{ stage: string; version: number | string; updated_by: string }>(
    "SELECT stage, version, updated_by FROM site_stages WHERE site_id = $1",
    [record.deal_id],
  );
  assert.equal(row.rows[0]?.stage, "2 Financial screen");
  assert.equal(Number(row.rows[0]?.version), 1);
  assert.equal(row.rows[0]?.updated_by, "jaideep");
  const event = await sql.query<{ source: string; actor: string; payload: { at?: string; stage?: string; previous_stage?: string | null } }>(
    "SELECT source, actor, payload FROM events WHERE entity_type = 'stage' AND site_id = $1",
    [record.deal_id],
  );
  assert.equal(event.rows[0]?.source, "Accepted stage decision");
  assert.equal(event.rows[0]?.actor, "jaideep");
  assert.equal(event.rows[0]?.payload.stage, "2 Financial screen");
  assert.equal(event.rows[0]?.payload.previous_stage, null);
  assert.match(event.rows[0]?.payload.at || "", /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$/);
  const receipt = await sql.query<{ actor: string; response: { results?: { version: number }[] } }>(
    "SELECT actor, response FROM change_receipts WHERE idempotency_key = $1",
    [`stage-decision-${proposal.id}`],
  );
  assert.equal(receipt.rows[0]?.actor, "jaideep");
  assert.equal(receipt.rows[0]?.response.results?.[0]?.version, 1);
});

test("a suggested drop stays a suggestion until it is accepted", async () => {
  const sql = await ready();
  const drop = await createSuggestion(sql, {
    targetKind: "deal",
    targetId: record.deal_id,
    field: "proposed_next_step",
    detail: "knock_off",
    proposedValue: "Dropped",
    reason: "The lot is too small.",
    authorId: "cindel",
  }, lookup);
  const pending = await sql.query<{ stage: string }>("SELECT stage FROM site_stages WHERE site_id = $1", [record.deal_id]);
  assert.equal(pending.rows.length, 0);
  assert.equal(drop.status, "open");

  await decideSuggestion(sql, { id: drop.id, status: "accepted", actorId: "jaideep" }, lookup);
  const row = await sql.query<{ stage: string; reason: string; updated_by: string }>(
    "SELECT stage, reason, updated_by FROM site_stages WHERE site_id = $1",
    [record.deal_id],
  );
  assert.equal(row.rows[0]?.stage, "Dropped");
  assert.equal(row.rows[0]?.reason, "The lot is too small.");
  assert.equal(row.rows[0]?.updated_by, "jaideep");
});

test("a stage correction writes the numbered stage and an unknown label does not stick", async () => {
  const sql = await ready();
  const correction = await createSuggestion(sql, {
    targetKind: "deal",
    targetId: record.deal_id,
    field: "correction",
    detail: "stage",
    proposedValue: "3 Site checks",
    reason: "The stage was wrong.",
    authorId: "cindel",
  }, lookup);
  await decideSuggestion(sql, { id: correction.id, status: "accepted", actorId: "jaideep" }, lookup);
  const row = await sql.query<{ stage: string }>("SELECT stage FROM site_stages WHERE site_id = $1", [record.deal_id]);
  assert.equal(row.rows[0]?.stage, "3 Site checks");

  const unknown = await createSuggestion(sql, {
    targetKind: "deal",
    targetId: "PIPE-LAS-0004",
    field: "stage",
    proposedValue: "Sourced",
    reason: "Not a numbered stage.",
    authorId: "cindel",
  }, (kind, id) => (kind === "deal" && id === "PIPE-LAS-0004" ? { deal_id: id, stage: "1 Desk screen" } : null));
  await assert.rejects(
    () => decideSuggestion(sql, { id: unknown.id, status: "accepted", actorId: "jaideep" }, (kind, id) => (kind === "deal" && id === "PIPE-LAS-0004" ? { deal_id: id, stage: "1 Desk screen" } : null)),
    /not a known stage/,
  );
  const kept = await sql.query<{ status: string }>("SELECT status FROM suggestions WHERE id = $1", [unknown.id]);
  assert.equal(kept.rows[0]?.status, "open");
  const absent = await sql.query("SELECT stage FROM site_stages WHERE site_id = 'PIPE-LAS-0004'");
  assert.equal(absent.rows.length, 0);
});

test("a new site gets Desk screen and one Site added activity", async () => {
  const sql = await ready();
  const created = await applyBatch(sql, contributor, "capture-1", {
    changes: [{
      entity_type: "site",
      site_id: "PIPE-LAS-0004",
      expected_version: 0,
      source: "desk note",
      payload: { name: "Sample wash", market: "LAS" },
    }],
  });
  assert.equal(created.results.some((row) => row.entity_type === "stage"), true);
  assert.equal(created.results.some((row) => row.entity_type === "activity"), true);
  const stage = await sql.query<{ stage: string; updated_by: string }>(
    "SELECT stage, updated_by FROM site_stages WHERE site_id = 'PIPE-LAS-0004'",
  );
  assert.equal(stage.rows[0]?.stage, "1 Desk screen");
  assert.notEqual(stage.rows[0]?.stage, "Dropped");
  assert.equal(stage.rows[0]?.updated_by, "system");
  const stageEvent = await sql.query<{ source: string; actor: string; payload: { at?: string } }>(
    "SELECT source, actor, payload FROM events WHERE entity_type = 'stage' AND site_id = 'PIPE-LAS-0004'",
  );
  assert.equal(stageEvent.rows[0]?.source, "Initial stage for new capture");
  assert.equal(stageEvent.rows[0]?.actor, "system");
  assert.match(stageEvent.rows[0]?.payload.at || "", /[+-]\d{2}:\d{2}$/);
  const activity = await sql.query<{ updated_by: string; payload: { summary?: string; date?: string; date_iso?: string; type?: string } }>(
    "SELECT updated_by, payload FROM activities WHERE site_id = 'PIPE-LAS-0004'",
  );
  assert.equal(activity.rows.length, 1);
  assert.equal(activity.rows[0]?.updated_by, "cindel");
  assert.equal(activity.rows[0]?.payload.summary, "Site added");
  assert.equal(activity.rows[0]?.payload.type, "capture");
  assert.match(activity.rows[0]?.payload.date || "", /^\d{4}-\d{2}-\d{2}$/);
  assert.match(activity.rows[0]?.payload.date_iso || "", /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$/);
  const activityEvent = await sql.query<{ source: string; actor: string }>(
    "SELECT source, actor FROM events WHERE entity_type = 'activity' AND site_id = 'PIPE-LAS-0004'",
  );
  assert.equal(activityEvent.rows[0]?.source, "desk note");
  assert.equal(activityEvent.rows[0]?.actor, "cindel");

  const moved = await createSuggestion(sql, {
    targetKind: "deal",
    targetId: "PIPE-LAS-0004",
    field: "proposed_next_step",
    detail: "stage_move",
    proposedValue: "financial",
    reason: "",
    authorId: "cindel",
  }, (kind, id) => (kind === "deal" && id === "PIPE-LAS-0004" ? { deal_id: id, stage: "1 Desk screen" } : null));
  await decideSuggestion(sql, { id: moved.id, status: "accepted", actorId: "jaideep" }, (kind, id) => (kind === "deal" && id === "PIPE-LAS-0004" ? { deal_id: id, stage: "1 Desk screen" } : null));
  const next = await sql.query<{ stage: string; version: number | string; updated_by: string }>(
    "SELECT stage, version, updated_by FROM site_stages WHERE site_id = 'PIPE-LAS-0004'",
  );
  assert.equal(next.rows[0]?.stage, "2 Financial screen");
  assert.equal(Number(next.rows[0]?.version), 2);
  assert.equal(next.rows[0]?.updated_by, "jaideep");
});

test("a batch that already has an activity does not add a second one", async () => {
  const sql = await ready();
  await applyBatch(sql, contributor, "capture-with-activity", {
    changes: [
      {
        entity_type: "site",
        site_id: "PIPE-MIA-0004",
        expected_version: 0,
        source: "desk note",
        payload: { name: "Sample wash", market: "MIA" },
      },
      {
        entity_type: "activity",
        site_id: "PIPE-MIA-0004",
        expected_version: 0,
        source: "desk note",
        payload: { date: "2026-11-01T12:00:00-08:00", type: "visit", summary: "Visit noted" },
      },
    ],
  });
  const rows = await sql.query<{ summary: string }>("SELECT payload->>'summary' AS summary FROM activities WHERE site_id = 'PIPE-MIA-0004'");
  assert.deepEqual(rows.rows.map((row) => row.summary), ["Visit noted"]);
  const stage = await sql.query<{ stage: string }>("SELECT stage FROM site_stages WHERE site_id = 'PIPE-MIA-0004'");
  assert.equal(stage.rows[0]?.stage, "1 Desk screen");
});

test("the activity screen renders a successful part when the other part fails", () => {
  const ui = readFileSync("components/timeline/Timeline.tsx", "utf8");
  const load = readFileSync("lib/timeline/load.ts", "utf8");
  assert.match(ui, /Promise\.allSettled/);
  assert.doesNotMatch(ui, /Promise\.all\(/);
  assert.match(ui, /activity-timeline-error/);
  assert.match(ui, /activity-comms-error/);
  assert.match(ui, /activity-gap/);
  assert.equal(load.includes("15000"), true);
  assert.match(ui, /ACTIVITY_TIMEOUT_MS/);
});
