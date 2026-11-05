import assert from "node:assert/strict";
import test from "node:test";
import { migrate } from "../../lib/actions/migrate";
import type { RecordLookup } from "../../lib/actions/records";
import { createSuggestion, decideSuggestion, nextStepsCsv, reviseSuggestion } from "../../lib/actions/suggestions";
import { InputError } from "../../lib/actions/text";
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

test("bring back needs a stage and does not take an assignee", async () => {
  const sql = await ready();
  await assert.rejects(
    () => createSuggestion(sql, {
      targetKind: "site",
      targetId: "PHX-U180",
      field: "proposed_next_step",
      detail: "bring_back",
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
    detail: "bring_back",
    proposedValue: "desk",
    ownerId: "reviewer",
    reason: "",
    authorId: "writer",
  }, lookup);
  assert.equal(step.title, "Bring back to Desk screen");
  assert.equal(step.ownerId, null);
  assert.equal(step.proposedValue, "desk");
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
