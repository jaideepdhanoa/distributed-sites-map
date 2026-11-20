import assert from "node:assert/strict";
import test from "node:test";
import { migrate } from "../../lib/actions/migrate";
import type { RecordLookup } from "../../lib/actions/records";
import { createSuggestion, decideSuggestion, reconcileSuggestions } from "../../lib/actions/suggestions";
import { importChanged } from "../../lib/changes/backfill";
import { applyHeldStages, loadHeldStages } from "../../lib/changes/heldStage";
import { droppedDecisionLine } from "../../lib/droppedLine";
import { buildQueue } from "../../lib/queue/order";
import { countDroppedDeals, dealOnPipeStep } from "../../lib/reach";
import { droppedDealsShown } from "../../lib/pipeStage";
import { unpackFile } from "../../lib/snapshot/pack";
import { publishSnapshot, selectLiveBundle } from "../../lib/snapshot/store";
import { mergeBringBackHistory } from "../../lib/timeline/history";
import { memorySql } from "../helpers/sql";

const dropId = "PIPE-PHX-0008";
const advanceId = "PIPE-MIA-0076";

function deal(id: string, stage: string, group: string) {
  return {
    features: [{
      properties: {
        deal_id: id,
        kind: "pipeline",
        city: id.includes("-MIA-") ? "MIA" : "PHX",
        stage,
        stage_group: group,
        service_area_class: "inside",
        suggested_drop: "Lot too small",
      },
    }],
  };
}

function lookupFor(rows: Record<string, Record<string, unknown>>): RecordLookup {
  return (kind, id) => (kind === "deal" ? rows[id] || null : null);
}

async function ready() {
  const sql = await memorySql();
  await migrate(sql);
  return sql;
}

test("an accepted drop sticks in the list, counts, map, review queue, and Dropped view after a snapshot", async () => {
  const sql = await ready();
  const previous = process.env.AUTH_USERS;
  process.env.AUTH_USERS = JSON.stringify([
    { u: "writer", h: "$2b$08$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ012", role: "user", name: "Writer" },
    { u: "editor", h: "$2b$08$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ012", role: "admin", name: "Editor" },
  ]);
  const record: Record<string, unknown> = { deal_id: dropId, stage: "1 Desk screen", stage_group: "desk", kind: "pipeline" };
  const lookup = lookupFor({ [dropId]: record });
  try {
    const proposal = await createSuggestion(sql, {
      targetKind: "deal",
      targetId: dropId,
      field: "proposed_next_step",
      detail: "knock_off",
      proposedValue: "Dropped",
      reason: "The lot is too small.",
      authorId: "writer",
    }, lookup);
    assert.equal(proposal.status, "open");
    const waiting = buildQueue({
      sites: [{ id: dropId, city: "PHX", stage: "1 Desk screen", stageGroup: "desk", active: true }],
      reasons: {},
      reviewedAt: {},
      snoozeUntil: {},
      flagged: new Set(),
      mentioned: new Set(),
      assigned: new Set(),
      needsApproval: new Set([dropId]),
      today: "2026-11-20",
      filters: { approvalOnly: true },
    });
    assert.equal(waiting[0]?.siteId, dropId);
    assert.equal(waiting[0]?.needsApproval, true);

    const approverReason = "The building will not fit.";
    await decideSuggestion(sql, { id: proposal.id, status: "accepted", actorId: "editor", note: approverReason }, lookup);
    record.stage = "Dropped";
    record.stage_group = "dropped";
    const applied = await reconcileSuggestions(sql, lookup);
    assert.equal(applied, 1);
    const status = await sql.query<{ status: string }>("SELECT status FROM suggestions WHERE id = $1", [proposal.id]);
    assert.equal(status.rows[0]?.status, "applied");

    const stored = await sql.query<{ stage: string; reason: string; updated_by: string }>(
      "SELECT stage, reason, updated_by FROM site_stages WHERE site_id = $1",
      [dropId],
    );
    assert.equal(stored.rows[0]?.stage, "Dropped");
    assert.equal(stored.rows[0]?.reason, approverReason);
    assert.equal(stored.rows[0]?.updated_by, "editor");

    const oldSnapshot = JSON.stringify(deal(dropId, "1 Desk screen", "desk"));
    await publishSnapshot(sql, {
      sourceRunId: "held-stage",
      workbookModifiedAt: null,
      gitSha: "abc",
      files: [{ name: "deals.geojson", body: oldSnapshot }, { name: "sites.geojson", body: JSON.stringify({ features: [{ properties: { site_id: "PHX-U180", linked_deal_id: dropId, pipeline_stage: "1 Desk screen", linked_deal_stage: "1 Desk screen" } }] }) }],
    });
    const live = await selectLiveBundle(sql);
    const publishedDeals = JSON.parse(unpackFile(live!.files["deals.geojson"])) as ReturnType<typeof deal>;
    assert.equal(publishedDeals.features[0].properties.stage_group, "desk");
    const held = await loadHeldStages(sql, lookup);
    const listed = applyHeldStages(publishedDeals, held, "deal");
    const row = listed.features?.[0].properties;
    assert.equal(row?.stage, "Dropped");
    assert.equal(row?.stage_group, "dropped");
    assert.equal(row?.suggested_drop, undefined);
    assert.equal(row?.decision_reason, approverReason);
    assert.equal(row?.decision_proposer, "Writer");
    assert.equal(row?.decision_approver, "Editor");
    assert.match(String(row?.decision_at || ""), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$/);
    assert.equal(dealOnPipeStep(row, "desk"), false);
    assert.equal(dealOnPipeStep(row, "dropped"), true);
    assert.equal(countDroppedDeals([row!]), 1);
    assert.equal(droppedDealsShown({ all: true, stage: "desk", droppedLayer: false, searchWide: false }), false);
    assert.equal(droppedDealsShown({ all: false, stage: "dropped", droppedLayer: false, searchWide: false }), true);
    assert.match(droppedDecisionLine(row || {}), /The building will not fit/);
    assert.match(droppedDecisionLine(row || {}), /Proposed by Writer/);
    assert.match(droppedDecisionLine(row || {}), /Approved by Editor/);

    const sites = applyHeldStages(JSON.parse(unpackFile(live!.files["sites.geojson"])), held, "site");
    assert.equal(sites.features?.[0].properties?.pipeline_stage, "Dropped");
    assert.equal(sites.features?.[0].properties?.linked_deal_stage, "Dropped");

    const queue = buildQueue({
      sites: [{ id: dropId, city: "PHX", stage: String(row?.stage), stageGroup: "dropped", active: false }],
      reasons: { [dropId]: [{ at: "2026-11-20T18:00:00.000Z", summary: "Editor dropped this site.", type: "drop" }] },
      reviewedAt: {},
      snoozeUntil: {},
      flagged: new Set(),
      mentioned: new Set(),
      assigned: new Set(),
      needsApproval: new Set(),
      today: "2026-11-20",
      filters: {},
    });
    assert.equal(queue.length, 0);

    const imported = await importChanged(sql, {
      stages: [{ site_id: dropId, stage: "1 Desk screen", market: "PHX", service_area_class: "inside", reason: "" }],
      activities: [],
      comms: [],
      sites: [],
    }, "later-sync");
    assert.equal(imported.inserted.stage, 0);
    const stayed = await sql.query<{ stage: string }>("SELECT stage FROM site_stages WHERE site_id = $1", [dropId]);
    assert.equal(stayed.rows[0]?.stage, "Dropped");

    const history = mergeBringBackHistory(
      [{ date: "", type: "drop_suggested", summary: "Recommended drop. The lot is too small.", eventId: `suggested-drop:${dropId}` }],
      [
        { at: "2026-11-20", type: "drop_suggested", summary: "Writer proposed dropping this site. Awaiting approval.", eventId: "proposal" },
        { at: "2026-11-20", type: "drop", summary: "Editor dropped this site.", eventId: "decision" },
      ],
    );
    assert.equal(history.some((item) => item.eventId.startsWith("suggested-drop:")), false);
    assert.equal(history.filter((item) => item.type === "drop").length, 1);
  } finally {
    if (previous == null) delete process.env.AUTH_USERS;
    else process.env.AUTH_USERS = previous;
  }
});

test("an accepted advance sticks after the workbook matches and a later snapshot restores the old stage", async () => {
  const sql = await ready();
  const record: Record<string, unknown> = { deal_id: advanceId, stage: "1 Desk screen", stage_group: "desk", kind: "pipeline" };
  const lookup = lookupFor({ [advanceId]: record });
  const proposal = await createSuggestion(sql, {
    targetKind: "deal",
    targetId: advanceId,
    field: "proposed_next_step",
    detail: "stage_move",
    proposedValue: "financial",
    reason: "Package received",
    authorId: "cindel",
  }, lookup);
  await decideSuggestion(sql, { id: proposal.id, status: "accepted", actorId: "jaideep", note: "Package received" }, lookup);
  record.stage = "2 Financial screen";
  record.stage_group = "financial";
  await reconcileSuggestions(sql, lookup);
  const old = deal(advanceId, "1 Desk screen", "desk");
  const held = await loadHeldStages(sql, lookup);
  const listed = applyHeldStages(old, held, "deal");
  const row = listed.features?.[0].properties;
  assert.equal(row?.stage, "2 Financial screen");
  assert.equal(row?.stage_group, "financial");
  assert.equal(dealOnPipeStep(row, "desk"), false);
  assert.equal(dealOnPipeStep(row, "financial"), true);
  await importChanged(sql, {
    stages: [{ site_id: advanceId, stage: "1 Desk screen", market: "MIA", service_area_class: "inside", reason: "" }],
    activities: [],
    comms: [],
    sites: [],
  }, "advance-sync");
  const stayed = await sql.query<{ stage: string; updated_by: string }>(
    "SELECT stage, updated_by FROM site_stages WHERE site_id = $1",
    [advanceId],
  );
  assert.equal(stayed.rows[0]?.stage, "2 Financial screen");
  assert.equal(stayed.rows[0]?.updated_by, "jaideep");
});
