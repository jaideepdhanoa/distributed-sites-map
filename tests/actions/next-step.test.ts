import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { migrate } from "../../lib/actions/migrate";
import type { RecordLookup } from "../../lib/actions/records";
import { createSuggestion, decideSuggestion, nextStepsCsv, reviseSuggestion } from "../../lib/actions/suggestions";
import { emptyNextStepActions } from "../../lib/actions/nextStepTypes";
import { InputError } from "../../lib/actions/text";
import { listBringBackHistory, listRecordedHistory } from "../../lib/queue/events";
import { presentCard } from "../../lib/timeline/filter";
import { mergeBringBackHistory } from "../../lib/timeline/history";
import { memorySql } from "../helpers/sql";

const site = Object.freeze({ site_id: "PHX-U180", name: "Sinclair", pipeline_stage: "1 Desk screen", linked_deal_id: "PIPE-PHX-0008" });
const lookup: RecordLookup = (kind, id) => (kind === "site" && id === site.site_id ? site : null);

async function ready() {
  const sql = await memorySql();
  await migrate(sql);
  return sql;
}

test("a knock off needs a reason and exports Dropped", async () => {
  const sql = await ready();
  await assert.rejects(
    () => createSuggestion(sql, {
      targetKind: "site",
      targetId: "PHX-U180",
      field: "proposed_next_step",
      detail: "knock_off",
      proposedValue: "Dropped",
      reason: "",
      authorId: "writer",
    }, lookup),
    InputError,
  );
  const step = await createSuggestion(sql, {
    targetKind: "site",
    targetId: "PHX-U180",
    field: "proposed_next_step",
    detail: "knock_off",
    proposedValue: "Dropped",
    reason: "The broker confirmed another buyer.",
    authorId: "writer",
  }, lookup);
  assert.equal(step.detail, "knock_off");
  assert.equal(step.title, "Drop from pipeline");
  assert.equal(step.ownerId, null);
  assert.equal(step.proposedValue, "Dropped");
  const accepted = await decideSuggestion(sql, { id: step.id, status: "accepted", actorId: "editor" });
  assert.equal(accepted.status, "accepted");
  const csv = nextStepsCsv([accepted], lookup);
  assert.match(csv, /^site_id,date,title,owner,approved_at,done_at,type,stage/);
  assert.match(csv, /knock_off","Dropped/);
  assert.equal(site.pipeline_stage, "1 Desk screen");
});

test("a person drop records the recommendation and, once approved, who dropped it and why", async () => {
  const sql = await ready();
  const previous = process.env.AUTH_USERS;
  process.env.AUTH_USERS = JSON.stringify([
    { u: "writer", h: "$2b$08$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ012", role: "user", name: "Writer" },
    { u: "editor", h: "$2b$08$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ012", role: "admin", name: "Editor" },
  ]);
  const reason = "The broker confirmed another buyer.";
  try {
    const step = await createSuggestion(sql, {
      targetKind: "site",
      targetId: "PHX-U180",
      field: "proposed_next_step",
      detail: "knock_off",
      proposedValue: "Dropped",
      reason,
      authorId: "writer",
    }, lookup);
    assert.equal(step.reason, reason);
    assert.equal(site.pipeline_stage, "1 Desk screen");
    const suggested = await listRecordedHistory(sql, ["PHX-U180", "PIPE-PHX-0008"], ["drop_suggested"]);
    assert.equal(suggested.length, 1);
    assert.match(suggested[0]?.summary || "", /Writer recommended dropping this site/);
    assert.match(suggested[0]?.summary || "", /broker confirmed another buyer/);
    const accepted = await decideSuggestion(sql, { id: step.id, status: "accepted", actorId: "editor" }, lookup);
    assert.equal(accepted.reason, reason);
    assert.equal(accepted.status, "accepted");
    assert.equal(site.pipeline_stage, "1 Desk screen");
    const dropped = await listRecordedHistory(sql, ["PIPE-PHX-0008"], ["drop"]);
    assert.equal(dropped.length, 1);
    assert.match(dropped[0]?.summary || "", /Writer dropped this site/);
    assert.match(dropped[0]?.summary || "", /broker confirmed another buyer/);
    const card = mergeBringBackHistory(
      [{ date: "2026-10-18", type: "stage", summary: "Stage set to Desk screen", eventId: "A-1" }],
      dropped,
    );
    assert.equal(card.some((item) => item.type === "drop" && /Writer dropped this site/.test(item.summary)), true);
    assert.equal(card.some((item) => item.type === "stage"), true);
  } finally {
    if (previous == null) delete process.env.AUTH_USERS;
    else process.env.AUTH_USERS = previous;
  }
});

test("mark duplicate names the surviving record and does not set a stage", async () => {
  const sql = await ready();
  await assert.rejects(
    () => createSuggestion(sql, {
      targetKind: "site",
      targetId: "PHX-U180",
      field: "proposed_next_step",
      detail: "mark_duplicate",
      proposedValue: "",
      reason: "",
      authorId: "writer",
    }, lookup),
    InputError,
  );
  const step = await createSuggestion(sql, {
    targetKind: "site",
    targetId: "PHX-U180",
    field: "proposed_next_step",
    detail: "mark_duplicate",
    proposedValue: "WB-PHX-0016",
    reason: "Same parcel after the reviewer confirmed the address.",
    authorId: "writer",
  }, lookup);
  assert.equal(step.detail, "mark_duplicate");
  assert.equal(step.proposedValue, "WB-PHX-0016");
  assert.equal(step.title, "Duplicate of WB-PHX-0016");
  const csv = nextStepsCsv([step], lookup);
  assert.doesNotMatch(csv, /Dropped/);
});

test("bring back needs a reason and a stage, and approval records who, why, and the stage", async () => {
  const sql = await ready();
  const previous = process.env.AUTH_USERS;
  process.env.AUTH_USERS = JSON.stringify([
    { u: "writer", h: "$2b$08$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ012", role: "user", name: "Writer" },
    { u: "editor", h: "$2b$08$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ012", role: "admin", name: "Editor" },
  ]);
  const reason = `The seller put it back on the market. ${"Confirmed available. ".repeat(16)}`;
  try {
    await assert.rejects(
      () => createSuggestion(sql, {
        targetKind: "site",
        targetId: "PHX-U180",
        field: "proposed_next_step",
        detail: "bring_back",
        proposedValue: "desk",
        reason: "   ",
        authorId: "writer",
      }, lookup),
      InputError,
    );
    await assert.rejects(
      () => createSuggestion(sql, {
        targetKind: "site",
        targetId: "PHX-U180",
        field: "proposed_next_step",
        detail: "bring_back",
        proposedValue: "",
        reason,
        authorId: "writer",
      }, lookup),
      InputError,
    );
    const step = await createSuggestion(sql, {
      targetKind: "site",
      targetId: "PHX-U180",
      field: "proposed_next_step",
      detail: "bring_back",
      proposedValue: "desk",
      ownerId: "reviewer",
      reason,
      authorId: "writer",
    }, lookup);
    assert.equal(step.title, "Bring back to Desk screen");
    assert.equal(step.ownerId, null);
    assert.equal(step.proposedValue, "desk");
    assert.equal(step.reason, reason.trim());
    assert.equal(step.reason.length > 240, true);
    const accepted = await decideSuggestion(sql, { id: step.id, status: "accepted", actorId: "editor" }, lookup);
    assert.equal(accepted.status, "accepted");
    assert.equal(accepted.reason, reason.trim());
    assert.equal(accepted.proposedValue, "desk");
    assert.equal(site.pipeline_stage, "1 Desk screen");
    const history = await listBringBackHistory(sql, ["PHX-U180", "PIPE-PHX-0008"]);
    assert.equal(history.length, 1);
    assert.equal(history[0]?.siteId, "PIPE-PHX-0008");
    assert.match(history[0]?.summary || "", /Writer brought this site back to Desk screen/);
    assert.match(history[0]?.summary || "", /The seller put it back on the market/);
    assert.equal((history[0]?.summary || "").includes(reason.trim().slice(-20)), true);
    assert.match(history[0]?.at || "", /^\d{4}-\d{2}-\d{2}$/);
    assert.equal((await listBringBackHistory(sql, ["PIPE-PHX-0099"])).length, 0);
    const card = presentCard({ items: [{ record_id: "PIPE-PHX-0008", event_id: "A-1", date: "2026-10-18", type: "stage", summary: "Stage set to Dropped" }] }, ["PIPE-PHX-0008"]);
    const items = mergeBringBackHistory(card.items, history);
    assert.equal(items.some((item) => item.type === "stage" && item.summary === "Stage set to Dropped"), true);
    const brought = items.find((item) => item.type === "bring_back");
    assert.match(brought?.summary || "", /Writer/);
    assert.match(brought?.summary || "", /Desk screen/);
    assert.match(brought?.summary || "", /seller put it back on the market/);
    const csv = nextStepsCsv([accepted], lookup);
    assert.match(csv, /Desk screen/);
  } finally {
    if (previous == null) delete process.env.AUTH_USERS;
    else process.env.AUTH_USERS = previous;
  }
});

test("a dropped site leads with bring back, and an active site does not", () => {
  const dropped = emptyNextStepActions("dropped", "Dropped");
  assert.equal(dropped[0]?.id, "bring_back");
  assert.equal(dropped[0]?.prominent, true);
  assert.equal(dropped.find((item) => item.id === "stage_move")?.prominent, false);
  assert.equal(dropped.find((item) => item.id === "knock_off")?.prominent, false);
  assert.equal(emptyNextStepActions(null, "Dropped")[0]?.id, "bring_back");
  const active = emptyNextStepActions("desk", "1 Desk screen");
  assert.equal(active[0]?.id, "stage_move");
  assert.equal(active[0]?.prominent, true);
  assert.equal(active.some((item) => item.id === "bring_back"), false);
  assert.equal(active.some((item) => item.id === "knock_off"), true);
});

test("bring-back history stays on the activity card beside workbook lines", () => {
  const raw = JSON.parse(readFileSync(new URL("../../data/generated/timeline.json", import.meta.url), "utf8"));
  const card = presentCard(raw, ["PIPE-PHX-0014", "PHX-U229"]);
  assert.equal(card.items.some((item) => item.type === "stage" && item.summary.includes("Dropped")), true);
  assert.match(card.folderUrl, /^https:\/\/drive\.google\.com\/drive\/folders\//);
  const items = mergeBringBackHistory(card.items, [{
    summary: "Writer brought this site back to Financial screen. The ask is $2 million and the seller reopened it.",
    at: "2026-11-11",
    eventId: "bring-1",
  }]);
  const brought = items.find((item) => item.type === "bring_back");
  assert.match(brought?.summary || "", /Writer brought this site back to Financial screen/);
  assert.match(brought?.summary || "", /\$2 million/);
  assert.match(brought?.summary || "", /seller reopened it/);
  assert.equal(items.some((item) => item.type === "stage" && item.summary.includes("Dropped")), true);
});

test("a work item can be reassigned after approval", async () => {
  const sql = await ready();
  const previous = process.env.AUTH_USERS;
  process.env.AUTH_USERS = JSON.stringify([
    { u: "writer", h: "$2b$08$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ012", role: "user", name: "Writer" },
    { u: "reviewer", h: "$2b$08$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ012", role: "admin", name: "Reviewer" },
  ]);
  try {
    const step = await createSuggestion(sql, {
      targetKind: "site",
      targetId: "PHX-U180",
      field: "proposed_next_step",
      detail: "work_item",
      title: "Request the rent roll",
      proposedValue: "Request the rent roll",
      targetOn: "2026-11-12",
      ownerId: "writer",
      reason: "",
      authorId: "writer",
    }, lookup);
    await decideSuggestion(sql, { id: step.id, status: "accepted", actorId: "reviewer" });
    const revised = await reviseSuggestion(sql, { id: step.id, actorId: "reviewer", reviewer: true, ownerId: "reviewer" });
    assert.equal(revised.ownerId, "reviewer");
    assert.equal(revised.targetOn, "2026-11-12");
    assert.equal(revised.title, "Request the rent roll");
  } finally {
    if (previous == null) delete process.env.AUTH_USERS;
    else process.env.AUTH_USERS = previous;
  }
});
