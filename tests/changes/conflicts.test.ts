import assert from "node:assert/strict";
import test from "node:test";
import { migrate } from "../../lib/actions/migrate";
import { InputError } from "../../lib/actions/text";
import { defaultPreferences } from "../../lib/alerts/preferences";
import { loadDigestBrief } from "../../lib/alerts/summary";
import { EXCLUDED_SITE_ID } from "../../lib/alerts/excluded";
import { applyBatch, VersionConflictError } from "../../lib/changes/apply";
import { validateBatch, type Actor } from "../../lib/changes/schema";
import { conflictLoops } from "../../lib/conflicts/loops";
import { readConflict } from "../../lib/conflicts/record";
import { buildPnlGrid } from "../../lib/pnl/grid";
import { sampleStatement } from "../../lib/pnl/fixture";
import { memorySql } from "../helpers/sql";

const muse: Actor = { id: "muse", kind: "agent" };
const indie: Actor = { id: "indie", kind: "agent" };
const reviewer: Actor = { id: "jaideep", kind: "human", role: "reviewer" };
const AT = "2026-03-01T15:00:00-07:00";
const LATER = "2026-03-02T16:00:00-07:00";

function conflict(partial: Record<string, unknown> = {}, expected = 0, entityId?: string) {
  return {
    entity_type: "data_conflict",
    site_id: "PIPE-LAS-9001",
    expected_version: expected,
    ...(entityId ? { entity_id: entityId } : {}),
    source: "Sample notes",
    payload: {
      subject: "pnl_line",
      field: "ebitda",
      period: "2026-01-01/2026-06-14",
      sources: [
        { value: "100000", document: "Sample package", page: "1" },
        { value: "90000", document: "Sample notes", page: "2" },
      ],
      value_in_use: "100000",
      status: "open",
      at: AT,
      ...partial,
    },
  };
}

async function ready() {
  const sql = await memorySql();
  await migrate(sql);
  return sql;
}

test("only Muse can record a conflict, and a bad clock or a number is rejected", () => {
  assert.throws(
    () => validateBatch(indie, "k1", { changes: [conflict()] }),
    (error: unknown) => error instanceof InputError && error.field === "actor" && /Only Muse/.test(error.message),
  );
  assert.throws(() => validateBatch(reviewer, "k1", { changes: [conflict()] }), /Only Muse/);
  assert.throws(
    () => validateBatch(muse, "k1", { changes: [conflict({ at: "2026-03-01" })] }),
    (error: unknown) => error instanceof InputError && error.field === "at" && /ISO-8601/.test(error.message),
  );
  assert.throws(
    () => validateBatch(muse, "k1", { changes: [conflict({ at: undefined })] }),
    (error: unknown) => error instanceof InputError && error.field === "at" && /at is required/.test(error.message),
  );
  assert.throws(
    () => validateBatch(muse, "k1", { changes: [conflict({ value_in_use: 100000 })] }),
    (error: unknown) => error instanceof InputError && error.field === "value" && /not a number/.test(error.message),
  );
  assert.throws(
    () => validateBatch(muse, "k1", { changes: [conflict({ value_in_use: "80000" })] }),
    /value_in_use must be one of the source values/,
  );
  assert.throws(
    () => validateBatch(muse, "k1", { changes: [conflict({ status: "resolved" })] }),
    /resolution note/,
  );
  assert.throws(() => validateBatch(muse, "k1", { changes: [{ ...conflict(), site_id: EXCLUDED_SITE_ID }] }), /not written here/);
  assert.doesNotThrow(() => validateBatch(muse, "k1", { changes: [conflict()] }));
});

test("a conflict keeps both sources, the exact times, and an append-only event", async () => {
  const sql = await ready();
  const created = await applyBatch(sql, muse, "conflict-1", { changes: [conflict()] });
  const id = created.results[0]?.entity_id || "";
  assert.match(id, /^CF-\d{6}$/);
  const row = await readConflict(sql, id);
  assert.equal(row?.createdBy, "muse");
  assert.equal(row?.updatedBy, "muse");
  assert.equal(row?.createdAt, AT);
  assert.equal(row?.updatedAt, AT);
  assert.equal(row?.valueInUse, "100000");
  assert.equal(row?.sources[1]?.value, "90000");
  assert.equal(row?.status, "open");

  await assert.rejects(
    () => applyBatch(sql, muse, "conflict-dup", { changes: [conflict()] }),
    (error: unknown) => error instanceof VersionConflictError && error.conflicts[0]?.entity_id === id,
  );

  const asked = await applyBatch(sql, muse, "conflict-2", {
    changes: [conflict({ status: "asked_broker", at: LATER }, 1, id)],
  });
  assert.equal(asked.results[0]?.version, 2);
  const askedRow = await readConflict(sql, id);
  assert.equal(askedRow?.status, "asked_broker");
  assert.equal(askedRow?.createdAt, AT);
  assert.equal(askedRow?.updatedAt, LATER);
  assert.equal(askedRow?.createdBy, "muse");

  const resolved = await applyBatch(sql, muse, "conflict-3", {
    changes: [conflict({ status: "resolved", resolution_note: "Kept the later sample.", at: "2026-03-03T12:00:00Z" }, 2, id)],
  });
  assert.equal(resolved.results[0]?.version, 3);
  const done = await readConflict(sql, id);
  assert.equal(done?.status, "resolved");
  assert.equal(done?.resolutionNote, "Kept the later sample.");
  assert.equal(done?.updatedAt, "2026-03-03T12:00:00Z");

  const events = await sql.query<{ payload: { actor?: string; at?: string; sources?: unknown[] }; actor: string }>(
    `SELECT payload, actor FROM events WHERE entity_type = 'data_conflict' AND entity_id = $1 ORDER BY id`,
    [id],
  );
  assert.equal(events.rows.length, 3);
  assert.equal(events.rows[0]?.actor, "muse");
  assert.equal(events.rows[0]?.payload.at, AT);
  assert.equal(events.rows[2]?.payload.at, "2026-03-03T12:00:00Z");
  assert.equal(Array.isArray(events.rows[2]?.payload.sources), true);

  const check = await sql.query<{ def: string }>(
    `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'events_entity_type_check'`,
  );
  assert.match(check.rows[0]?.def || "", /data_conflict/);
  assert.match(check.rows[0]?.def || "", /site_space/);
  assert.match(check.rows[0]?.def || "", /pnl_line/);
});

test("open conflicts show on the matching cell, in open loops, and in the brief count", async () => {
  const sql = await ready();
  await applyBatch(sql, muse, "conflict-surface", { changes: [conflict({ field: "labor", period: "FY2024" })] });
  const grid = buildPnlGrid(sampleStatement(), "years", undefined, (await readConflict(sql, "CF-000001")) ? [ (await readConflict(sql, "CF-000001"))! ] : []);
  const labor = grid.rows.find((row) => row.id === "labor");
  const marked = labor?.cells.find((cell) => cell.conflict);
  assert.equal(marked?.conflict?.status, "open");
  assert.equal(marked?.conflict?.sources[0]?.document, "Sample package");
  assert.equal(marked?.conflict?.sources[1]?.page, "2");
  assert.equal(grid.rows.find((row) => row.id === "ebitda")?.cells.some((cell) => cell.conflict), false);

  const loops = await conflictLoops(sql);
  assert.equal(loops.length, 1);
  assert.equal(loops[0]?.id, "CF-000001");
  assert.equal(loops[0]?.label, "PIPE-LAS-9001");
  assert.equal(loops[0]?.folded_site_ids[0], "PIPE-LAS-9001");
  assert.match(loops[0]?.detail || "", /labor · FY2024 · Open/);
  assert.equal((loops[0]?.detail || "").includes("100000"), false);
  assert.equal((loops[0]?.detail || "").includes("90000"), false);
  assert.equal(loops[0]?.court, "Us — diligence");

  const brief = await loadDigestBrief(sql, {
    userId: "reviewer",
    since: new Date("2026-01-01T00:00:00.000Z"),
    prefs: defaultPreferences("reviewer"),
  });
  assert.equal(brief.counts.conflicts, 1);
  const line = brief.items.find((item) => item.summary.includes("data conflict"));
  assert.equal(line?.summary, "1 open data conflict.");
  assert.equal(brief.items.some((item) => item.summary.includes("100000") || item.summary.includes("90000")), false);
});
