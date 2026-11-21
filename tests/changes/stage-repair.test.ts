import assert from "node:assert/strict";
import test from "node:test";
import { migrate } from "../../lib/actions/migrate";
import type { RecordLookup } from "../../lib/actions/records";
import { createSuggestion, decideSuggestion } from "../../lib/actions/suggestions";
import { EXCLUDED_SITE_ID } from "../../lib/alerts/excluded";
import { applyStageRepair, assertStageRepairApply, formatStageRepair, planStageRepair, repairActivityLine, repairDayLabel } from "../../lib/changes/stageRepair";
import { listRecordedHistory } from "../../lib/queue/events";
import { memorySql } from "../helpers/sql";

const desk = { stage: "1 Desk screen", stage_group: "desk", kind: "pipeline" };

function lookup(): RecordLookup {
  const rows: Record<string, Record<string, unknown>> = {
    "PIPE-PHX-0008": { deal_id: "PIPE-PHX-0008", ...desk },
    "PIPE-PHX-0018": { deal_id: "PIPE-PHX-0018", ...desk },
    [EXCLUDED_SITE_ID]: { deal_id: EXCLUDED_SITE_ID, ...desk },
    "PIPE-LAS-0004": { deal_id: "PIPE-LAS-0004", ...desk },
    "PIPE-PHX-0004": { deal_id: "PIPE-PHX-0004", ...desk },
  };
  return (kind, id) => (kind === "deal" ? rows[id] || null : null);
}

async function ready() {
  const sql = await memorySql();
  await migrate(sql);
  return sql;
}

test("dry run lists stuck accepted stages and apply writes only a human decision", async () => {
  const sql = await ready();
  const previous = process.env.AUTH_USERS;
  process.env.AUTH_USERS = JSON.stringify([
    { u: "cindel", h: "$2b$08$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ012", role: "admin", name: "Cindel" },
    { u: "jaideep", h: "$2b$08$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ012", role: "admin", name: "Jaideep" },
  ]);
  const find = lookup();
  try {
    const drop = await createSuggestion(sql, {
      targetKind: "deal",
      targetId: "PIPE-PHX-0008",
      field: "proposed_next_step",
      detail: "knock_off",
      proposedValue: "Dropped",
      reason: "The lot is too small.",
      authorId: "cindel",
    }, find);
    await decideSuggestion(sql, { id: drop.id, status: "accepted", actorId: "jaideep" }, find);
    await sql.query("UPDATE site_stages SET stage = '1 Desk screen', updated_by = 'workbook-sync' WHERE site_id = 'PIPE-PHX-0008'");

    const advance = await createSuggestion(sql, {
      targetKind: "deal",
      targetId: "PIPE-PHX-0018",
      field: "proposed_next_step",
      detail: "stage_move",
      proposedValue: "financial",
      reason: "Package received",
      authorId: "cindel",
    }, find);
    await decideSuggestion(sql, { id: advance.id, status: "accepted", actorId: "cindel" }, find);
    await sql.query("DELETE FROM site_stages WHERE site_id = 'PIPE-PHX-0018'");

    const quarantined = await createSuggestion(sql, {
      targetKind: "deal",
      targetId: EXCLUDED_SITE_ID,
      field: "proposed_next_step",
      detail: "knock_off",
      proposedValue: "Dropped",
      reason: "The lot is too small.",
      authorId: "cindel",
    }, find);
    await decideSuggestion(sql, { id: quarantined.id, status: "accepted", actorId: "jaideep" }, find);
    await sql.query("UPDATE site_stages SET stage = '1 Desk screen' WHERE site_id = $1", [EXCLUDED_SITE_ID]);

    await createSuggestion(sql, {
      targetKind: "deal",
      targetId: "PIPE-PHX-0004",
      field: "proposed_next_step",
      detail: "knock_off",
      proposedValue: "Dropped",
      reason: "The lot is too small.",
      authorId: "cindel",
    }, find);

    await sql.query(
      `INSERT INTO suggestions (
        id, target_kind, target_id, field_name, detail, current_value, proposed_value, reason, status, author_id, decided_by, decided_at
      ) VALUES ('agent-drop', 'deal', 'PIPE-LAS-0004', 'proposed_next_step', 'knock_off', '1 Desk screen', 'Dropped', 'The lot is too small.', 'accepted', 'system', 'system', now())`,
    );

    const plan = await planStageRepair(sql, find);
    const printed = formatStageRepair(plan);
    assert.match(printed, /PIPE-PHX-0008/);
    assert.match(printed, /PIPE-PHX-0018/);
    assert.match(printed, new RegExp(drop.id));
    assert.match(printed, new RegExp(advance.id));
    assert.equal(printed.includes(EXCLUDED_SITE_ID), false);
    assert.equal(printed.includes("PIPE-LAS-0004"), false);
    assert.equal(printed.includes("PIPE-PHX-0004"), false);
    assert.equal(printed.includes("The lot is too small"), false);
    assert.match(printed, /Dropped/);
    assert.match(printed, /2 Financial screen/);
    assert.match(printed, /Jaideep/);
    assert.match(printed, /Cindel/);
    const dropRow = plan.find((row) => row.siteId === "PIPE-PHX-0008");
    const advanceRow = plan.find((row) => row.siteId === "PIPE-PHX-0018");
    assert.equal(dropRow?.targetStage, "Dropped");
    assert.equal(dropRow?.currentStage, "1 Desk screen");
    assert.equal(advanceRow?.targetStage, "2 Financial screen");
    assert.ok(dropRow?.acceptedAt);
    assert.match(dropRow?.acceptedAt || "", /[+-]\d{2}:\d{2}$/);

    const now = new Date("2026-11-20T20:00:00.000Z");
    assert.equal(repairDayLabel(now), "Nov 20 2026");
    const written = await applyStageRepair(sql, plan, now);
    assert.equal(written, 2);
    const stages = await sql.query<{ site_id: string; stage: string; updated_by: string }>(
      "SELECT site_id, stage, updated_by FROM site_stages WHERE site_id IN ('PIPE-PHX-0008', 'PIPE-PHX-0018') ORDER BY site_id",
    );
    assert.deepEqual(stages.rows.map((row) => [row.site_id, row.stage, row.updated_by]), [
      ["PIPE-PHX-0008", "Dropped", "jaideep"],
      ["PIPE-PHX-0018", "2 Financial screen", "cindel"],
    ]);
    const quarantinedStage = await sql.query<{ stage: string }>("SELECT stage FROM site_stages WHERE site_id = $1", [EXCLUDED_SITE_ID]);
    assert.notEqual(quarantinedStage.rows[0]?.stage, "Dropped");
    const lines = await listRecordedHistory(sql, ["PIPE-PHX-0008", "PIPE-PHX-0018"], ["drop", "stage_repair"]);
    const dropLine = lines.find((row) => row.siteId === "PIPE-PHX-0008" && row.summary.startsWith("applied on"));
    assert.equal(dropLine?.summary, repairActivityLine({
      appliedOn: "Nov 20 2026",
      acceptedAt: dropRow!.acceptedAt,
      acceptedBy: "Jaideep",
    }));
    assert.match(lines.find((row) => row.siteId === "PIPE-PHX-0018")?.summary || "", /applied on Nov 20 2026 per Jaideep, originally accepted .+ by Cindel/);
    assert.equal(await applyStageRepair(sql, plan, now), 0);

    const invented = await applyStageRepair(sql, [{
      siteId: "PIPE-LAS-0009",
      proposalId: "not-accepted",
      acceptedAt: "2026-11-01T00:00:00.000-08:00",
      acceptedBy: "system",
      targetStage: "Dropped",
      currentStage: "1 Desk screen",
      reason: "The lot is too small.",
      field: "proposed_next_step",
      detail: "knock_off",
      proposedValue: "Dropped",
      actorId: "system",
    }], now);
    assert.equal(invented, 0);
    const absent = await sql.query("SELECT stage FROM site_stages WHERE site_id = 'PIPE-LAS-0009'");
    assert.equal(absent.rows.length, 0);

    assert.throws(() => assertStageRepairApply("postgres://example", ""), /Dry run is the default/);
  } finally {
    if (previous == null) delete process.env.AUTH_USERS;
    else process.env.AUTH_USERS = previous;
  }
});
