import assert from "node:assert/strict";
import test from "node:test";
import { listAudit } from "../../lib/actions/audit";
import { migrate } from "../../lib/actions/migrate";
import { createNote, deleteNote, editNote, listNotes, reopenNote, resolveNote } from "../../lib/actions/notes";
import type { RecordLookup } from "../../lib/actions/records";
import { valuesMatch } from "../../lib/actions/records";
import {
  createSuggestion,
  decideSuggestion,
  listSuggestions,
  nextStepsCsv,
  permanentSiteId,
  reconcileSuggestions,
  suggestionsCsv,
} from "../../lib/actions/suggestions";
import { cleanQuery, InputError } from "../../lib/actions/text";
import { createView, deleteView, listViews } from "../../lib/actions/views";
import { memorySql } from "../helpers/sql";

const site = Object.freeze({ site_id: "PHX-U180", name: "Self Service Car Wash", pipeline_stage: "1 Desk screen", listed: false, linked_deal_id: "PIPE-PHX-0008" });
const deal = Object.freeze({ deal_id: "PIPE-PHX-0008", stage: "1 Desk screen", name: "Sample deal" });

const lookup: RecordLookup = (kind, id) => {
  if (kind === "site" && id === site.site_id) return site;
  if (kind === "deal" && id === deal.deal_id) return deal;
  return null;
};

const TEAM_NOTE = "Under 4 stalls fit. Waiting on an NDA. The offer covers charging and utility bills.";

async function ready() {
  const sql = await memorySql();
  const applied = await migrate(sql);
  assert.deepEqual(applied, ["001_actions.sql", "002_threads.sql", "003_queue.sql", "004_mentions.sql", "005_alerts.sql", "006_agent.sql", "007_proposal_outcomes.sql"]);
  assert.deepEqual(await migrate(sql), []);
  return sql;
}

test("notes store the author and team language", async () => {
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
  const posted = await createNote(sql, { targetKind: "site", targetId: "PHX-U180", body: TEAM_NOTE, authorId: "writer" }, lookup);
  assert.equal(posted.body, TEAM_NOTE);
  assert.equal((await listNotes(sql, "site", "PHX-U180")).length, 2);
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

test("a note can take one level of replies, and the author can edit or remove it", async () => {
  const sql = await ready();
  const root = await createNote(sql, { targetKind: "site", targetId: "PHX-U180", body: "The frontage needs another look.", authorId: "writer" }, lookup);
  const reply = await createNote(sql, { targetKind: "site", targetId: "PHX-U180", parentId: root.id, body: "The driveway is the tight part.", authorId: "writer" }, lookup);
  assert.equal(reply.parentId, root.id);
  await assert.rejects(
    () => createNote(sql, { targetKind: "site", targetId: "PHX-U180", parentId: reply.id, body: "Too deep.", authorId: "writer" }, lookup),
    InputError,
  );
  const edited = await editNote(sql, { id: reply.id, body: "The driveway is narrow.", actorId: "writer" });
  assert.match(edited.body, /narrow/);
  await assert.rejects(() => editNote(sql, { id: reply.id, body: "Not mine.", actorId: "other" }), (error: unknown) => error instanceof InputError && error.status === 403);
  await deleteNote(sql, { id: reply.id, actorId: "writer" });
  const notes = await listNotes(sql, "site", "PHX-U180");
  assert.equal(notes.find((item) => item.id === reply.id)?.deleted, true);
  assert.equal(notes.find((item) => item.id === reply.id)?.body, "");
  const audit = await listAudit(sql);
  assert.ok(audit.some((row) => row.action === "note.reply"));
  assert.ok(audit.some((row) => row.action === "note.edit"));
  assert.ok(audit.some((row) => row.action === "note.delete"));
  await assert.rejects(() => resolveNote(sql, { id: reply.id, actorId: "editor" }), InputError);
  const resolved = await resolveNote(sql, { id: root.id, actorId: "editor" });
  assert.ok(resolved.resolvedAt);
  const reopened = await reopenNote(sql, { id: root.id, actorId: "editor" });
  assert.equal(reopened.resolvedAt, null);
  await assert.rejects(() => reopenNote(sql, { id: root.id, actorId: "editor" }), InputError);
});

test("an approved next step stays on the card and earlier approvals remain history", async () => {
  const sql = await ready();
  const first = await createSuggestion(sql, {
    targetKind: "site",
    targetId: "PHX-U180",
    field: "proposed_next_step",
    proposedValue: "Ask the broker for the sales package",
    title: "Ask the broker for the sales package",
    targetOn: "2026-11-20",
    ownerId: "",
    reason: "",
    authorId: "writer",
  }, lookup);
  assert.equal(first.status, "open");
  assert.equal(first.targetOn, "2026-11-20");
  const worded = await createSuggestion(sql, {
    targetKind: "site",
    targetId: "PHX-U180",
    field: "proposed_next_step",
    proposedValue: TEAM_NOTE,
    title: TEAM_NOTE,
    reason: "The site is on hold for the charging stalls.",
    authorId: "writer",
  }, lookup);
  assert.equal(worded.proposedValue, TEAM_NOTE);
  assert.equal(worded.title, TEAM_NOTE);
  await decideSuggestion(sql, { id: first.id, status: "accepted", actorId: "editor", note: "Approved." });
  const second = await createSuggestion(sql, {
    targetKind: "site",
    targetId: "PHX-U180",
    field: "proposed_next_step",
    proposedValue: "Schedule a site visit",
    title: "Schedule a site visit",
    targetOn: "2026-12-01",
    reason: "",
    authorId: "writer",
  }, lookup);
  await decideSuggestion(sql, { id: second.id, status: "accepted", actorId: "editor" });
  const rows = (await listSuggestions(sql)).filter((row) => row.field === "proposed_next_step" && row.status === "accepted");
  const ordered = rows.sort((a, b) => (b.decidedAt || "").localeCompare(a.decidedAt || ""));
  assert.equal(ordered[0]?.title, "Schedule a site visit");
  assert.equal(ordered[1]?.title, "Ask the broker for the sales package");
  assert.equal(await reconcileSuggestions(sql, lookup), 0);
  assert.equal(site.pipeline_stage, "1 Desk screen");
  const csv = nextStepsCsv(await listSuggestions(sql), lookup);
  assert.match(csv, /PIPE-PHX-0008/);
  assert.match(csv, /Schedule a site visit/);
  assert.match(csv, /2026-12-01/);
  assert.equal(permanentSiteId("site", "PHX-U180", lookup), "PIPE-PHX-0008");
  const reply = await createNote(sql, { targetKind: "suggestion", targetId: second.id, body: "Bring the site plan.", authorId: "writer" });
  assert.equal(reply.targetId, second.id);
});

test("stage matching is case-insensitive and does not invent a stage", () => {
  assert.equal(valuesMatch("stage", null, "dropped", { stage: "Dropped" }), true);
  assert.equal(valuesMatch("stage", null, "Dropped", { stage: "1 Desk screen" }), false);
  assert.equal(valuesMatch("listed", null, "yes", { listed: true }), true);
  assert.equal(valuesMatch("listed", null, "no", { listed: true }), false);
  assert.equal(valuesMatch("proposed_next_step", null, "Schedule a site visit", { next_step: "Schedule a site visit" }), false);
});
