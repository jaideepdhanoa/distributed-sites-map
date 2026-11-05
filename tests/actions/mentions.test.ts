import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { listAudit } from "../../lib/actions/audit";
import { clearMentionThread } from "../../lib/actions/mentions";
import { migrate } from "../../lib/actions/migrate";
import { createNote, listNotes } from "../../lib/actions/notes";
import type { RecordLookup } from "../../lib/actions/records";
import { completeSuggestion, createSuggestion, decideSuggestion, listSuggestions, nextStepsCsv } from "../../lib/actions/suggestions";
import { InputError } from "../../lib/actions/text";
import { PolicyError } from "../../lib/policy/banned";
import { loadCatalog } from "../../lib/queue/catalog";
import { loadQueue, markAllReviewed } from "../../lib/queue/load";
import { memorySql } from "../helpers/sql";

const active = loadCatalog().find((item) => item.active);
if (!active) throw new Error("expected an active pipeline deal");
const deal = Object.freeze({ deal_id: active.id, stage: active.stage, name: "Sample deal" });
const lookup: RecordLookup = (kind, id) => (kind === "deal" && id === deal.deal_id ? deal : null);
const hash = "$2b$04$abcdefghijklmnopqrstuuabcdefghijklmnopqrstuuabcdefghijk";

function blockedWord(): string {
  const file = JSON.parse(readFileSync("config/display-policy.json", "utf8")) as { words: string[] };
  const word = file.words
    .map((item) => Buffer.from(item, "base64").toString("utf8").replace(/^term:/, ""))
    .find((item) => item.length >= 6);
  if (!word) throw new Error("missing term");
  return word;
}

async function ready() {
  process.env.AUTH_USERS = JSON.stringify([
    { u: "contributor", h: hash, role: "user", actionRole: "contributor", name: "Contributor" },
    { u: "reviewer", h: hash, role: "admin", actionRole: "reviewer", name: "Reviewer" },
    { u: "other", h: hash, role: "user", actionRole: "contributor", name: "Other person" },
  ]);
  const sql = await memorySql();
  await migrate(sql);
  const queue = await loadQueue(sql, "reviewer", { market: "all", viable: true }, true);
  await markAllReviewed(sql, "reviewer", queue.items.map((item) => item.siteId));
  await markAllReviewed(sql, "other", queue.items.map((item) => item.siteId));
  await markAllReviewed(sql, "contributor", queue.items.map((item) => item.siteId));
  return sql;
}

test("a mention is stored as an account id and queued only for that account", async () => {
  const sql = await ready();
  const typed = "Someone not on the list";
  await assert.rejects(
    () => createNote(sql, { targetKind: "deal", targetId: deal.deal_id, body: "Please look at the frontage.", authorId: "contributor", mentions: [typed] }, lookup),
    (error: unknown) => error instanceof InputError && !error.message.includes(typed),
  );
  await assert.rejects(
    () => createNote(sql, { targetKind: "deal", targetId: deal.deal_id, body: `See ${blockedWord()}`, authorId: "contributor", mentions: ["reviewer"] }, lookup),
    PolicyError,
  );
  const note = await createNote(sql, {
    targetKind: "deal",
    targetId: deal.deal_id,
    body: "Please look at the frontage.",
    authorId: "contributor",
    mentions: ["reviewer"],
  }, lookup);
  assert.equal(note.body, "Please look at the frontage.");
  assert.equal(note.body.includes("@"), false);
  assert.deepEqual(note.mentions.map((item) => item.id), ["reviewer"]);
  assert.equal((await listNotes(sql, "deal", deal.deal_id))[0]?.mentions[0]?.name, "Reviewer");

  const reviewer = await loadQueue(sql, "reviewer", { market: "all", viable: true }, true);
  const hit = reviewer.items.find((item) => item.siteId === deal.deal_id);
  assert.equal(hit?.mentioned, true);
  assert.equal(hit?.reasons.some((reason) => reason.summary === "Mentioned you."), true);
  const other = await loadQueue(sql, "other", { market: "all", viable: true, mentionsOnly: true }, false);
  assert.equal(other.items.some((item) => item.reasons.some((reason) => reason.type === "mention")), false);

  await clearMentionThread(sql, "reviewer", note.id);
  const cleared = await loadQueue(sql, "reviewer", { market: "all", viable: true, mentionsOnly: true }, true);
  assert.equal(cleared.items.some((item) => item.siteId === deal.deal_id), false);
});

test("an assignment shows under Assigned to me, and Done is limited to the owner or a reviewer", async () => {
  const sql = await ready();
  const step = await createSuggestion(sql, {
    targetKind: "deal",
    targetId: deal.deal_id,
    field: "proposed_next_step",
    title: "Ask for the sales package",
    proposedValue: "Ask for the sales package",
    targetOn: "2026-12-01",
    ownerId: "reviewer",
    reason: "",
    authorId: "contributor",
    mentions: ["other"],
  }, lookup);
  assert.deepEqual(step.mentions.map((item) => item.id), ["other"]);
  const assigned = await loadQueue(sql, "reviewer", { market: "all", viable: true, assignedOnly: true }, true);
  const card = assigned.items.find((item) => item.siteId === deal.deal_id);
  assert.ok(card);
  assert.equal(card?.snapshot?.assignments[0]?.title, "Ask for the sales package");
  assert.equal(card?.snapshot?.assignments[0]?.date, "2026-12-01");
  const notMine = await loadQueue(sql, "contributor", { market: "all", viable: true, assignedOnly: true }, false);
  assert.equal(notMine.items.some((item) => item.siteId === deal.deal_id), false);

  await assert.rejects(
    () => completeSuggestion(sql, { id: step.id, actorId: "contributor", reviewer: false }),
    (error: unknown) => error instanceof InputError && error.status === 403,
  );
  const done = await completeSuggestion(sql, { id: step.id, actorId: "reviewer", reviewer: true });
  assert.ok(done.doneAt);
  const audit = await listAudit(sql);
  assert.equal(audit.some((row) => row.action === "suggestion.done" && row.actorId === "reviewer"), true);
  const after = await loadQueue(sql, "reviewer", { market: "all", viable: true, assignedOnly: true }, true);
  assert.equal(after.items.some((item) => item.snapshot?.assignments.some((item) => item.id === step.id)), false);

  const owned = await createSuggestion(sql, {
    targetKind: "deal",
    targetId: deal.deal_id,
    field: "proposed_next_step",
    title: "Schedule a site visit",
    proposedValue: "Schedule a site visit",
    targetOn: "2026-12-15",
    ownerId: "contributor",
    reason: "",
    authorId: "other",
  }, lookup);
  await completeSuggestion(sql, { id: owned.id, actorId: "contributor", reviewer: false });
  await decideSuggestion(sql, { id: owned.id, status: "accepted", actorId: "reviewer" });
  const csv = nextStepsCsv(await listSuggestions(sql), lookup);
  assert.equal(csv.split("\n")[0], "site_id,date,title,owner,approved_at,done_at");
  assert.match(csv, /Schedule a site visit/);
  assert.match(csv, /done_at/);
  const line = csv.split("\n").find((item) => item.includes("Schedule a site visit"));
  assert.ok(line && !line.endsWith(`""`));
});
