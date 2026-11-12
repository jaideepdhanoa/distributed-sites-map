import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { migrate } from "../../lib/actions/migrate";
import { emptyNextStepActions } from "../../lib/actions/nextStepTypes";
import type { RecordLookup } from "../../lib/actions/records";
import { createSuggestion, decideSuggestion, reconcileSuggestions } from "../../lib/actions/suggestions";
import { decisionFeed } from "../../lib/agent/inbox";
import { withSuggestedDrops } from "../../lib/suggestedDrop";
import {
  applyStageOverlay,
  overlayVerdict,
  patchLiveStage,
  type StageDecision,
} from "../../lib/stageOverlay";
import { memorySql } from "../helpers/sql";

const REASON = "The lot is smaller than the screen requires.";

function decision(partial: Partial<StageDecision> & Pick<StageDecision, "id" | "detail" | "proposedValue" | "status">): StageDecision {
  return {
    targetKind: "deal",
    targetId: "PIPE-PHX-0008",
    field: "proposed_next_step",
    currentValue: "",
    reason: REASON,
    actorName: "Reviewer",
    decidedAt: "2026-11-12T18:00:00.000Z",
    createdAt: "2026-11-12T17:00:00.000Z",
    stageAt: "1 Desk screen",
    detail: partial.detail,
    ...partial,
  };
}

function dealFile(stage = "1 Desk screen", group = "desk") {
  return {
    features: [
      {
        properties: {
          deal_id: "PIPE-PHX-0008",
          universe_id: "PHX-U180",
          stage,
          stage_group: group,
          suggested_drop: "Lot too small",
        },
      },
      { properties: { deal_id: "PIPE-PHX-0001", stage: "2 Financial screen", stage_group: "financial" } },
    ],
  };
}

function siteFile() {
  return {
    features: [
      { properties: { site_id: "PHX-U180", linked_deal_id: "PIPE-PHX-0008", pipeline_stage: "1 Desk screen", linked_deal_stage: "1 Desk screen" } },
    ],
  };
}

const links = [{ dealId: "PIPE-PHX-0008", siteId: "PHX-U180" }];

test("a stage move, a drop, and a bring-back overlay the generated stage", () => {
  const moved = applyStageOverlay(dealFile(), [
    decision({ id: "move", detail: "stage_move", proposedValue: "financial", status: "accepted" }),
  ], { kind: "deal", links, includeNames: true });
  const move = moved.features[0].properties;
  assert.equal(move.stage, "2 Financial screen");
  assert.equal(move.stage_group, "financial");
  assert.equal(move.stage_pending, "Moved to Financial screen by Reviewer, waiting for workbook");
  assert.equal(move.stage_pending.includes(REASON), false);
  assert.equal(moved.features[1].properties.stage, "2 Financial screen");

  const dropped = applyStageOverlay(dealFile(), [
    decision({ id: "drop", detail: "knock_off", proposedValue: "Dropped", status: "accepted" }),
  ], { kind: "deal", links, includeNames: true });
  const drop = dropped.features[0].properties;
  assert.equal(drop.stage, "Dropped");
  assert.equal(drop.stage_group, "dropped");
  assert.equal(drop.suggested_drop, undefined);
  assert.equal(emptyNextStepActions(String(drop.stage_group), String(drop.stage))[0]?.id, "bring_back");

  const brought = applyStageOverlay(dealFile("Dropped", "dropped"), [
    decision({
      id: "back",
      detail: "bring_back",
      proposedValue: "desk",
      status: "accepted",
      stageAt: "Dropped",
    }),
  ], { kind: "deal", links, includeNames: true });
  assert.equal(brought.features[0].properties.stage_group, "desk");
  assert.equal(brought.features[0].properties.stage, "1 Desk screen");
  assert.match(String(brought.features[0].properties.stage_pending), /Moved to Desk screen by Reviewer/);
});

test("an applied decision is a no-op and a matching workbook stage is a no-op", () => {
  const applied = applyStageOverlay(dealFile(), [
    decision({ id: "done", detail: "stage_move", proposedValue: "financial", status: "applied" }),
  ], { kind: "deal", links });
  assert.equal(applied.features[0].properties.stage_group, "desk");
  assert.equal(applied.features[0].properties.stage_pending, undefined);

  const same = applyStageOverlay(dealFile("2 Financial screen", "financial"), [
    decision({ id: "match", detail: "stage_move", proposedValue: "financial", status: "accepted", stageAt: "1 Desk screen" }),
  ], { kind: "deal", links });
  assert.equal(same.features[0].properties.stage, "2 Financial screen");
  assert.equal(same.features[0].properties.stage_pending, undefined);
  assert.equal(overlayVerdict("2 Financial screen", decision({ id: "match", detail: "stage_move", proposedValue: "financial", status: "accepted" })), "already");
});

test("a newer workbook stage wins, and a pending proposal is not overlaid", () => {
  const newer = applyStageOverlay(dealFile("3 Site checks", "checks"), [
    decision({ id: "stale", detail: "stage_move", proposedValue: "financial", status: "accepted", stageAt: "1 Desk screen" }),
  ], { kind: "deal", links });
  assert.equal(newer.features[0].properties.stage, "3 Site checks");
  assert.equal(newer.features[0].properties.stage_group, "checks");
  assert.equal(newer.features[0].properties.stage_pending, undefined);
  assert.equal(overlayVerdict("3 Site checks", decision({ id: "stale", detail: "stage_move", proposedValue: "financial", status: "accepted", stageAt: "1 Desk screen" })), "workbook");

  const pending = applyStageOverlay(dealFile(), [
    decision({
      id: "cindel-nov-8",
      detail: "stage_move",
      proposedValue: "financial",
      status: "open",
      actorName: "Cindel",
      createdAt: "2026-11-08T15:00:00.000Z",
      decidedAt: null,
      stageAt: "1 Desk screen",
    }),
    decision({
      id: "cindel-waiting",
      detail: "knock_off",
      proposedValue: "Dropped",
      status: "agreed_waiting",
      actorName: "Cindel",
      createdAt: "2026-11-08T16:00:00.000Z",
      decidedAt: "2026-11-08T17:00:00.000Z",
    }),
  ], { kind: "deal", links, includeNames: true });
  assert.equal(pending.features[0].properties.stage, "1 Desk screen");
  assert.equal(pending.features[0].properties.stage_group, "desk");
  assert.equal(pending.features[0].properties.stage_pending, undefined);
});

test("the latest accepted decision wins, a duplicate id does not change stage, and names can be omitted", () => {
  const latest = applyStageOverlay(dealFile(), [
    decision({ id: "older", detail: "knock_off", proposedValue: "Dropped", status: "accepted", decidedAt: "2026-11-01T15:00:00.000Z" }),
    decision({ id: "newer", detail: "stage_move", proposedValue: "checks", status: "accepted", decidedAt: "2026-11-10T15:00:00.000Z" }),
  ], { kind: "deal", links });
  assert.equal(latest.features[0].properties.stage_group, "checks");
  assert.equal(latest.features[0].properties.stage, "3 Site checks");

  const duplicate = applyStageOverlay(dealFile(), [
    decision({ id: "dup", detail: "mark_duplicate", proposedValue: "PIPE-PHX-0001", status: "accepted" }),
  ], { kind: "deal", links });
  assert.equal(duplicate.features[0].properties.stage_group, "desk");

  const quiet = applyStageOverlay(dealFile(), [
    decision({ id: "move", detail: "stage_move", proposedValue: "financial", status: "accepted" }),
  ], { kind: "deal", links, includeNames: false });
  assert.equal(quiet.features[0].properties.stage_group, "financial");
  assert.equal(quiet.features[0].properties.stage_pending, "Moved to Financial screen, waiting for workbook");

  const original = dealFile();
  applyStageOverlay(original, [
    decision({ id: "move", detail: "stage_move", proposedValue: "financial", status: "accepted" }),
  ], { kind: "deal", links });
  assert.equal(original.features[0].properties.stage, "1 Desk screen");
});

test("a site linked to the deal takes the same stage, and a dropped overlay clears the suggested-drop badge", () => {
  const sites = applyStageOverlay(siteFile(), [
    decision({ id: "move", detail: "bring_back", proposedValue: "financial", status: "accepted", stageAt: "1 Desk screen" }),
  ], { kind: "site", links, includeNames: true });
  assert.equal(sites.features[0].properties.pipeline_stage, "2 Financial screen");
  assert.equal(sites.features[0].properties.linked_deal_stage, "2 Financial screen");
  assert.match(String(sites.features[0].properties.stage_pending), /by Reviewer/);

  const file = JSON.parse(readFileSync("data/generated/deals.geojson", "utf8")) as {
    features: { properties: { deal_id?: string; stage?: string; stage_group?: string; suggested_drop?: string } }[];
  };
  const before = file.features.find((feature) => feature.properties.deal_id === "PIPE-PHX-0085");
  assert.equal(before?.properties.stage_group, "desk");
  const overlaid = applyStageOverlay(file, [
    decision({
      id: "drop-0085",
      targetId: "PIPE-PHX-0085",
      detail: "knock_off",
      proposedValue: "Dropped",
      status: "accepted",
      stageAt: "1 Desk screen",
      reason: "Broker sold it",
    }),
  ], { kind: "deal", includeNames: true });
  const annotated = withSuggestedDrops(overlaid);
  const deal = annotated.features?.find((feature) => feature.properties?.deal_id === "PIPE-PHX-0085")?.properties;
  assert.equal(deal?.stage_group, "dropped");
  assert.equal(deal?.suggested_drop, undefined);
  assert.equal(deal?.stage_pending?.includes("Broker sold it"), false);
  assert.equal(before?.properties.stage_group, "desk");
  assert.equal(before?.properties.suggested_drop, undefined);
});

test("an optimistic patch moves the deal and the linked site", () => {
  const patched = patchLiveStage({ deals: dealFile(), sites: siteFile() }, {
    targetKind: "deal",
    targetId: "PIPE-PHX-0008",
    stage: "Dropped",
    stageGroup: "dropped",
    note: "Moved to Dropped by Reviewer, waiting for workbook",
  });
  assert.equal(patched.deals.features[0].properties.stage_group, "dropped");
  assert.equal(patched.deals.features[0].properties.stage_pending, "Moved to Dropped by Reviewer, waiting for workbook");
  assert.equal(patched.deals.features[0].properties.suggested_drop, undefined);
  assert.equal(patched.sites.features[0].properties.linked_deal_stage, "Dropped");
  assert.equal(patched.deals.features[1].properties.stage_group, "financial");
});

test("every approved stage change Jaideep accepts tells the workbook writer what to write", () => {
  const move = decisionFeed({
    id: "move",
    status: "accepted",
    actorId: "jaideep",
    note: "Move it forward.",
    siteId: "PIPE-PHX-0008",
    recordId: "PIPE-PHX-0008",
    field: "proposed_next_step",
    detail: "stage_move",
    title: "Prioritize: push to Financial screen",
    proposedValue: "financial",
    reason: "",
  });
  assert.equal(move.workbookStage, true);
  assert.equal(move.stage, "financial");
  assert.match(move.text, /Approved stage: Financial screen \(financial\)\. Write this stage on the workbook Stage column\./);

  const drop = decisionFeed({
    id: "drop",
    status: "accepted",
    actorId: "jaideep",
    note: "",
    siteId: "PIPE-PHX-0008",
    recordId: "PIPE-PHX-0008",
    field: "proposed_next_step",
    detail: "knock_off",
    title: "Drop from pipeline",
    proposedValue: "Dropped",
    reason: REASON,
  });
  assert.equal(drop.workbookStage, true);
  assert.equal(drop.stage, "Dropped");
  assert.match(drop.text, /Approved stage: Dropped\. Write this stage on the workbook Stage column\./);
  assert.equal(drop.text.includes(REASON), false);

  const back = decisionFeed({
    id: "back",
    status: "accepted",
    actorId: "jaideep",
    note: "",
    siteId: "PIPE-PHX-0008",
    recordId: "PIPE-PHX-0008",
    field: "proposed_next_step",
    detail: "bring_back",
    title: "Bring back to Desk screen",
    proposedValue: "desk",
    reason: "The buyer fell through.",
  });
  assert.equal(back.workbookStage, true);
  assert.equal(back.stage, "desk");
  assert.match(back.text, /Approved stage: Desk screen \(desk\)\. Write this stage on the workbook Stage column\./);

  const editor = decisionFeed({
    id: "other",
    status: "accepted",
    actorId: "editor",
    note: "",
    siteId: "PIPE-PHX-0008",
    recordId: "PIPE-PHX-0008",
    field: "proposed_next_step",
    detail: "knock_off",
    title: "Drop from pipeline",
    proposedValue: "Dropped",
    reason: REASON,
  });
  assert.equal(editor.workbookStage, false);
  assert.equal(editor.stage, null);
  assert.equal(editor.text.includes("workbook Stage"), false);
});

test("reconcile marks an accepted stage decision applied only when the workbook matches", async () => {
  const sql = await memorySql();
  await migrate(sql);
  const record = { deal_id: "PIPE-PHX-0008", stage: "1 Desk screen", name: "Sample" };
  const lookup: RecordLookup = (kind, id) => (kind === "deal" && id === record.deal_id ? record : null);
  const pending = await createSuggestion(sql, {
    targetKind: "deal",
    targetId: record.deal_id,
    field: "proposed_next_step",
    detail: "stage_move",
    proposedValue: "financial",
    reason: "",
    authorId: "cindel",
  }, lookup);
  assert.equal(pending.status, "open");
  const drop = await createSuggestion(sql, {
    targetKind: "deal",
    targetId: record.deal_id,
    field: "proposed_next_step",
    detail: "knock_off",
    proposedValue: "Dropped",
    reason: REASON,
    authorId: "writer",
  }, lookup);
  await decideSuggestion(sql, { id: drop.id, status: "accepted", actorId: "reviewer" }, lookup);
  assert.equal(await reconcileSuggestions(sql, lookup), 0);

  const matched: RecordLookup = (kind, id) => {
    const row = lookup(kind, id);
    return row ? { ...row, stage: "Dropped" } : null;
  };
  assert.equal(await reconcileSuggestions(sql, matched), 1);
  const rows = await sql.query<{ id: string; status: string }>(`SELECT id, status FROM suggestions ORDER BY created_at ASC`);
  assert.equal(rows.rows.find((row) => row.id === pending.id)?.status, "open");
  assert.equal(rows.rows.find((row) => row.id === drop.id)?.status, "applied");
  assert.equal(record.stage, "1 Desk screen");
});
