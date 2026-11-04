import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { listAudit } from "../../lib/actions/audit";
import { migrate } from "../../lib/actions/migrate";
import { createNote, listNotes } from "../../lib/actions/notes";
import type { RecordLookup } from "../../lib/actions/records";
import { valuesMatch } from "../../lib/actions/records";
import {
  createSuggestion,
  decideSuggestion,
  listSuggestions,
  reconcileSuggestions,
  suggestionsCsv,
} from "../../lib/actions/suggestions";
import { cleanQuery, InputError } from "../../lib/actions/text";
import { createView, deleteView, listViews } from "../../lib/actions/views";
import { PolicyError } from "../../lib/policy/banned";
import { memorySql } from "../helpers/sql";

const site = Object.freeze({ site_id: "PHX-U180", name: "Self Service Car Wash", pipeline_stage: "1 Desk screen", listed: false });
const deal = Object.freeze({ deal_id: "PIPE-PHX-0008", stage: "1 Desk screen", name: "Sample deal" });

const lookup: RecordLookup = (kind, id) => {
  if (kind === "site" && id === site.site_id) return site;
  if (kind === "deal" && id === deal.deal_id) return deal;
  return null;
};

function blockedWord(): string {
  const file = JSON.parse(readFileSync("config/display-policy.json", "utf8")) as { words: string[] };
  const word = file.words
    .map((item) => Buffer.from(item, "base64").toString("utf8").replace(/^term:/, ""))
    .find((item) => item.length >= 6);
  if (!word) throw new Error("missing term");
  return word;
}

async function ready() {
  const sql = await memorySql();
  const applied = await migrate(sql);
  assert.deepEqual(applied, ["001_actions.sql"]);
  assert.deepEqual(await migrate(sql), []);
  return sql;
}

test("notes store the author and reject blocked text", async () => {
  const sql = await ready();
  const note = await createNote(sql, {
    targetKind: "site",
    targetId: "PHX-U180",
    body: "The lot looks smaller than the screen requires.",
    authorId: "writer",
  }, lookup);
  assert.equal(note.authorId, "writer");
  assert.equal((await listNotes(sql, "site", "PHX-U180")).length, 1);
  const audit = await listAudit(sql);
  assert.equal(audit[0]?.action, "note.create");
  assert.equal(audit[0]?.actorId, "writer");
  await assert.rejects(
    () => createNote(sql, { targetKind: "site", targetId: "PHX-U180", body: `See ${blockedWord()}`, authorId: "writer" }, lookup),
    (error: unknown) => error instanceof PolicyError && !error.message.includes(blockedWord()),
  );
  assert.equal((await listNotes(sql, "site", "PHX-U180")).length, 1);
});

test("a suggestion never writes the record and can be marked applied when data matches", async () => {
  const sql = await ready();
  const created = await createSuggestion(sql, {
    targetKind: "deal",
    targetId: "PIPE-PHX-0008",
    field: "stage",
    proposedValue: "Dropped",
    reason: "The lot is smaller than the screen requires.",
    authorId: "writer",
  }, lookup);
  assert.equal(created.status, "open");
  assert.equal(created.currentValue, "1 Desk screen");
  assert.equal(deal.stage, "1 Desk screen");
  assert.equal(await reconcileSuggestions(sql, lookup), 0);
  assert.equal((await listSuggestions(sql))[0]?.status, "open");

  await assert.rejects(
    () => decideSuggestion(sql, { id: created.id, status: "applied" as "accepted", actorId: "editor" }),
    InputError,
  );
  const accepted = await decideSuggestion(sql, { id: created.id, status: "accepted", actorId: "editor" });
  assert.equal(accepted.status, "accepted");
  assert.equal(deal.stage, "1 Desk screen");

  const matched: RecordLookup = (kind, id) => {
    const row = lookup(kind, id);
    if (!row) return null;
    return { ...row, stage: "Dropped" };
  };
  assert.equal(await reconcileSuggestions(sql, matched), 1);
  assert.equal((await listSuggestions(sql))[0]?.status, "applied");
  assert.equal(deal.stage, "1 Desk screen");

  const rejected = await createSuggestion(sql, {
    targetKind: "deal",
    targetId: "PIPE-PHX-0008",
    field: "stage",
    proposedValue: "Dropped",
    reason: "Second pass, still too small.",
    authorId: "writer",
  }, lookup);
  await decideSuggestion(sql, { id: rejected.id, status: "rejected", actorId: "editor" });
  assert.equal(await reconcileSuggestions(sql, matched), 0);
  const rows = await listSuggestions(sql);
  assert.equal(rows.find((row) => row.id === rejected.id)?.status, "rejected");
});

test("saved views keep a query string and stay personal unless allowed", async () => {
  const sql = await ready();
  const view = await createView(sql, {
    name: "Phoenix spare land",
    query: "?city=PHX&stage=land",
    ownerId: "writer",
    scope: "personal",
    allowTeam: false,
  });
  assert.equal((await listViews(sql, "writer"))[0]?.id, view.id);
  assert.equal((await listViews(sql, "other")).length, 0);
  await assert.rejects(
    () => createView(sql, { name: "Team", query: "city=PHX", ownerId: "writer", scope: "team", allowTeam: false }),
    (error: unknown) => error instanceof InputError && error.status === 403,
  );
  const team = await createView(sql, { name: "Team desk", query: "funnel=pipeline", ownerId: "editor", scope: "team", allowTeam: true });
  assert.equal((await listViews(sql, "writer")).some((item) => item.id === team.id), true);
  await assert.rejects(() => deleteView(sql, { id: team.id, actorId: "writer", canModerate: false }), InputError);
  await deleteView(sql, { id: view.id, actorId: "writer", canModerate: false });
  assert.equal((await listViews(sql, "writer")).some((item) => item.id === view.id), false);
  assert.throws(() => cleanQuery("https://example.test"), InputError);
});

test("the suggestion csv is for a person to apply in the workbook", async () => {
  const sql = await ready();
  await createSuggestion(sql, {
    targetKind: "site",
    targetId: "PHX-U180",
    field: "flag",
    proposedValue: "aside",
    reason: "Needs another look, the lot is tight.",
    authorId: "writer",
  }, lookup);
  const csv = suggestionsCsv(await listSuggestions(sql));
  assert.match(csv, /PHX-U180/);
  assert.match(csv, /aside/);
  assert.equal(csv.split("\n")[0], "id,target_kind,target_id,field,detail,current_value,proposed_value,reason,status,author_id,created_at,decided_by,decided_at,applied_at");
});

test("stage matching is case-insensitive and does not invent a stage", () => {
  assert.equal(valuesMatch("stage", null, "dropped", { stage: "Dropped" }), true);
  assert.equal(valuesMatch("stage", null, "Dropped", { stage: "1 Desk screen" }), false);
  assert.equal(valuesMatch("listed", null, "yes", { listed: true }), true);
  assert.equal(valuesMatch("listed", null, "no", { listed: true }), false);
});
