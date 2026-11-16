import assert from "node:assert/strict";
import test from "node:test";
import { migrate } from "../../lib/actions/migrate";
import { applyBatch, raiseIdFloor } from "../../lib/changes/apply";
import { importChanged } from "../../lib/changes/backfill";
import { loadMirrorRows } from "../../lib/changes/mirror";
import { applyActivityRenumber, planActivityRenumber } from "../../lib/changes/renumber";
import type { Actor } from "../../lib/changes/schema";
import { applySummaryRestore, formatSummaryPlan, planSummaryRestore, summariesFromCommsTable } from "../../lib/changes/summaries";
import type { SheetTable } from "../../lib/changes/mirror";
import { memorySql } from "../helpers/sql";

const human: Actor = { id: "jaideep", kind: "human", role: "reviewer" };

function activityChange() {
  return {
    entity_type: "activity" as const,
    site_id: "PIPE-PHX-0001",
    expected_version: 0,
    source: "listing note",
    payload: { date: "2026-11-15T12:00:00-08:00", type: "listing" as const, summary: "Listing noted" },
  };
}

test("new activity ids stay above the workbook set and the stored rows", async () => {
  const sql = await memorySql();
  await migrate(sql);
  await importChanged(
    sql,
    {
      stages: [],
      activities: [
        { entity_id: "A-000010", site_id: "PIPE-PHX-0001", date: "2026-11-01", type: "listing", summary: "Listing noted", source_link: "" },
      ],
      comms: [],
      workbookActivityIds: ["A-000010", "A-000273"],
    },
    "snap-floor",
  );
  const minted = await applyBatch(sql, human, "above-workbook", {
    changes: [activityChange()],
  });
  assert.equal(minted.results[0]?.entity_id, "A-000274");

  await sql.query(
    `INSERT INTO activities (entity_id, site_id, payload, version, updated_by)
     VALUES ('A-000300', 'PIPE-PHX-0001', '{"date":"2026-11-01","type":"listing","summary":"Listing noted","source_link":""}'::jsonb, 1, 'test')`,
  );
  const again = await applyBatch(sql, human, "above-table", {
    changes: [activityChange()],
  });
  assert.equal(again.results[0]?.entity_id, "A-000301");
});

test("the mirror marks API activity rows as not imported", async () => {
  const sql = await memorySql();
  await migrate(sql);
  await importChanged(
    sql,
    {
      stages: [],
      activities: [
        { entity_id: "A-000001", site_id: "PIPE-PHX-0001", date: "2026-11-01", type: "listing", summary: "Listing noted", source_link: "" },
      ],
      comms: [],
    },
    "snap-origin",
  );
  await raiseIdFloor(sql, "activity", 271);
  await applyBatch(sql, human, "api-origin", { changes: [activityChange()] });
  const rows = await loadMirrorRows(sql);
  assert.equal(rows.activities.find((row) => row.entity_id === "A-000001")?.imported, true);
  assert.equal(rows.activities.find((row) => row.entity_id === "A-000272")?.imported, false);
});

test("a dry-run renumber plan moves only the API collisions, and apply keeps the text", async () => {
  const sql = await memorySql();
  await migrate(sql);
  await raiseIdFloor(sql, "activity", 271);
  await applyBatch(sql, human, "collide-272", { changes: [activityChange()] });
  await applyBatch(sql, human, "collide-273", { changes: [activityChange()] });
  const planned = await planActivityRenumber(sql, 273);
  assert.deepEqual(planned.moves, [
    { from: "A-000272", to: "A-000274" },
    { from: "A-000273", to: "A-000275" },
  ]);
  assert.equal(JSON.stringify(planned).includes("Listing noted"), false);

  const applied = await applyActivityRenumber(sql, 273);
  assert.deepEqual(applied.moves.map((move) => move.to), ["A-000274", "A-000275"]);
  const left = await sql.query<{ entity_id: string; summary: string }>(
    `SELECT entity_id, payload->>'summary' AS summary FROM activities ORDER BY entity_id`,
  );
  assert.deepEqual(left.rows.map((row) => row.entity_id), ["A-000274", "A-000275"]);
  assert.equal(left.rows.every((row) => row.summary === "Listing noted"), true);
  const next = await applyBatch(sql, human, "after-renumber", { changes: [activityChange()] });
  assert.equal(next.results[0]?.entity_id, "A-000276");
});

test("an imported activity id is not re-numbered", async () => {
  const sql = await memorySql();
  await migrate(sql);
  await importChanged(
    sql,
    {
      stages: [],
      activities: [
        { entity_id: "A-000272", site_id: "PIPE-PHX-0001", date: "2026-11-06", type: "listing", summary: "Listing noted", source_link: "" },
      ],
      comms: [],
    },
    "snap-keep",
  );
  const planned = await planActivityRenumber(sql, 273);
  assert.deepEqual(planned.moves, []);
  assert.equal(planned.skipped.some((row) => row.id === "A-000272" && row.reason === "imported from the workbook"), true);
});

test("full comms summaries replace a clipped prefix and a later import does not shorten them", async () => {
  const sql = await memorySql();
  await migrate(sql);
  const clipped = "x".repeat(300);
  const full = `${clipped} more`;
  await importChanged(
    sql,
    {
      stages: [],
      activities: [],
      comms: [
        {
          entity_id: "CM-0382",
          site_id: "PIPE-PHX-0001",
          site_ids: "PIPE-PHX-0001; PIPE-PHX-0003",
          direction: "in",
          at: "2026-11-06 09:00",
          person: "Ada",
          firm: "",
          channel: "",
          summary: clipped,
          subject: "",
          thread_id: "",
          link: "",
          asks_made: "",
          asks_answered: "",
          attachments: "",
          state_changes: "",
          workbook_source: "",
          message_id: "",
        },
      ],
    },
    "snap-clip",
  );
  const before = await sql.query<{ summary: string; version: number | string; direction: string; site_id: string }>(
    `SELECT site_id, payload->>'summary' AS summary, payload->>'direction' AS direction, version FROM comms_entries WHERE entity_id = 'CM-0382'`,
  );
  const row = before.rows[0];
  assert.ok(row);
  const plan = planSummaryRestore(
    [{ entity_id: "CM-0382", site_id: row.site_id, summary: row.summary, direction: row.direction, version: Number(row.version) }],
    new Map([["CM-0382", full]]),
  );
  assert.equal(formatSummaryPlan(plan), "CM-0382 300 -> 305");
  assert.equal(formatSummaryPlan(plan).includes(full), false);
  await applySummaryRestore(sql, new Map([["CM-0382", full]]), plan);
  const stored = await sql.query<{ summary: string; site_ids: string; person: string }>(
    `SELECT payload->>'summary' AS summary, payload->>'site_ids' AS site_ids, payload->>'person' AS person FROM comms_entries WHERE entity_id = 'CM-0382'`,
  );
  assert.equal(stored.rows[0]?.summary, full);
  assert.equal(stored.rows[0]?.site_ids, "PIPE-PHX-0001; PIPE-PHX-0003");
  assert.equal(stored.rows[0]?.person, "Ada");

  const again = await importChanged(
    sql,
    {
      stages: [],
      activities: [],
      comms: [
        {
          entity_id: "CM-0382",
          site_id: "PIPE-PHX-0001",
          site_ids: "PIPE-PHX-0001; PIPE-PHX-0003",
          direction: "in",
          at: "2026-11-06 09:00",
          person: "Ada",
          firm: "",
          channel: "",
          summary: clipped,
          subject: "",
          thread_id: "",
          link: "",
          asks_made: "",
          asks_answered: "",
          attachments: "",
          state_changes: "",
          workbook_source: "",
          message_id: "",
        },
      ],
    },
    "snap-clip-again",
  );
  assert.equal(again.inserted.comms, 0);
  const kept = await sql.query<{ summary: string }>(`SELECT payload->>'summary' AS summary FROM comms_entries WHERE entity_id = 'CM-0382'`);
  assert.equal(kept.rows[0]?.summary, full);
});

test("the sheet summary is not clipped, and a sync does not expand a stored clip", async () => {
  const long = `${"y".repeat(300)} more`;
  const table: SheetTable = {
    title: "Comms Log",
    headerRow: 1,
    headers: ["Comms ID", "Summary"],
    rows: [{ row: 2, cells: ["CM-0382", long] }, { row: 3, cells: ["CM-9002", `  ${long}  `] }],
  };
  const sheet = summariesFromCommsTable(table);
  assert.equal(sheet.get("CM-0382"), long);
  assert.equal(sheet.get("CM-9002"), long);
  assert.equal(long.length > 300, true);

  const sql = await memorySql();
  await migrate(sql);
  const clipped = "y".repeat(300);
  const base = {
    entity_id: "CM-0382",
    site_id: "PIPE-PHX-0001",
    site_ids: "PIPE-PHX-0001",
    direction: "in",
    at: "2026-11-06 09:00",
    person: "Ada",
    firm: "",
    channel: "",
    summary: clipped,
    subject: "",
    thread_id: "",
    link: "",
    asks_made: "",
    asks_answered: "",
    attachments: "",
    state_changes: "",
    workbook_source: "",
    message_id: "",
  };
  await importChanged(sql, { stages: [], activities: [], comms: [base] }, "snap-short");
  const expanded = await importChanged(
    sql,
    {
      stages: [],
      activities: [],
      comms: [
        { ...base, summary: long },
        { ...base, entity_id: "CM-9002", summary: long },
      ],
    },
    "snap-long",
  );
  assert.equal(expanded.inserted.comms, 1);
  assert.equal(expanded.unchanged.comms, 1);
  const rows = await sql.query<{ entity_id: string; summary: string }>(
    `SELECT entity_id, payload->>'summary' AS summary FROM comms_entries ORDER BY entity_id`,
  );
  assert.equal(rows.rows.find((row) => row.entity_id === "CM-0382")?.summary, clipped);
  assert.equal(rows.rows.find((row) => row.entity_id === "CM-9002")?.summary, long);
});
