import assert from "node:assert/strict";
import test from "node:test";
import { listAudit } from "../../lib/actions/audit";
import { createWithReceipt } from "../../lib/actions/createReceipt";
import { parseEvidenceTarget } from "../../lib/actions/evidenceLookup";
import { migrate } from "../../lib/actions/migrate";
import { createNote, resolveNote } from "../../lib/actions/notes";
import { readDecision, saveDecision } from "../../lib/actions/viewDecision";
import { createView } from "../../lib/actions/views";
import type { CitedFigure } from "../../lib/comparisonDecision";
import { memorySql } from "../helpers/sql";

test("saved decision preserves its cited value, follows its original request, and enforces scope and revision", async () => {
  const sql = await memorySql();
  await migrate(sql);
  const options = { name: "Diligence", query: "compare=alpha%7Cbravo", ownerId: "reviewer", allowTeam: true };
  const team = await createView(sql, { ...options, scope: "team" });
  const privateView = await createView(sql, { ...options, scope: "personal" });
  const figure: CitedFigure = { targetKind: "site", targetId: "alpha", measure: "power", period: "", basis: "", value: "—" };
  const source = parseEvidenceTarget(new URLSearchParams(figure)).source;
  const note = await createNote(sql, { targetKind: "site", targetId: "alpha", authorId: "reviewer", body: "Missing evidence\nConfirm service." + source }, () => ({}));
  const draft = { preferred: "alpha", rationale: "Verify service before proceeding.", citations: [figure] };
  const req = new Request("http://localhost/api/actions/comparison-decision", { headers: { "Idempotency-Key": crypto.randomUUID() } });
  const write = () => createWithReceipt(sql, req, "reviewer", draft, tx => saveDecision(tx, team.id, "reviewer", draft, ""));
  const saved = await write();
  assert.deepEqual(await write(), saved);
  assert.equal(saved.decision?.citations[0].followUp?.note, note.id);
  await resolveNote(sql, { id: note.id, actorId: "reviewer" });
  const reopened = await readDecision(sql, team.id, "teammate", true);
  assert.equal(reopened.editable, false);
  assert.equal(reopened.decision?.citations[0].followUp?.status, "resolved");
  assert.equal(reopened.decision?.citations[0].value, "—");
  await assert.rejects(saveDecision(sql, team.id, "teammate", draft, saved.decision!.version), /owner/);
  await assert.rejects(saveDecision(sql, team.id, "reviewer", draft, ""), /newer/);
  await assert.rejects(saveDecision(sql, team.id, "reviewer", { ...draft, citations: [{ ...figure, targetId: "unknown" }] }, saved.decision!.version), /belong/);
  const held = await saveDecision(sql, team.id, "reviewer", { ...draft, preferred: null }, saved.decision!.version);
  assert.equal(held.decision?.preferred, null);
  await saveDecision(sql, privateView.id, "reviewer", draft, "");
  const laterNote = await createNote(sql, { targetKind: "site", targetId: "alpha", authorId: "reviewer",
    body: "Missing evidence\nCheck the updated survey." + source }, () => ({}));
  await resolveNote(sql, { id: laterNote.id, actorId: "reviewer" });
  const privateDecision = await readDecision(sql, privateView.id, "reviewer", true);
  assert.equal(privateDecision.decision?.citations[0].followUp?.note, laterNote.id);
  assert.equal(privateDecision.decision?.citations[0].followUp?.status, "resolved");
  await assert.rejects(readDecision(sql, privateView.id, "teammate", true), /unavailable/);
  assert.equal((await listAudit(sql)).some(entry => entry.action === "view.decision"), false);
});

test("linked power records recover an earlier site thread with its owner and due date", async () => {
  const { indexPowerLinks } = await import("../../lib/actions/powerLinks");
  const { findRequest } = await import("../../lib/actions/evidenceLookup");
  const { createSuggestion } = await import("../../lib/actions/suggestions");
  const { gapReference } = await import("../../lib/actions/gapReference");
  const pairs = indexPowerLinks([["deal-a","site-a"],["deal-b","ambiguous"],["deal-c","ambiguous"]]);
  assert.equal(pairs.has("deal:deal-b"), false);
  const target = (kind: "site" | "deal") => {
    const id = kind + "-a";
    return { ...parseEvidenceTarget(new URLSearchParams({targetKind:kind,targetId:id,measure:"power"})), linked:pairs.get(kind+":"+id) };
  };
  const sql = await memorySql();
  await migrate(sql);
  for (const kind of ["site","deal"] as const) {
    const record = target(kind);
    const note = await createNote(sql,{targetKind:kind,targetId:record.targetId,authorId:"reviewer",body:"Missing evidence\nConfirm service." + record.source}, () => ({}));
    const suggestion = await createSuggestion(sql,{targetKind:kind,targetId:record.targetId,authorId:"reviewer",field:"proposed_next_step",detail:"work_item",
      title:"Confirm service",proposedValue:"Confirm service",targetOn:"2030-03-15",reason:gapReference(record.targetId,note.id)}, () => ({}));
    await sql.query("UPDATE suggestions SET owner_id=$1 WHERE id=$2",["reviewer",suggestion.id]);
    const other = target(kind === "deal" ? "site" : "deal");
    const found = await findRequest(sql,other);
    assert.deepEqual([found?.note,found?.owner,found?.due,found?.targetId],[note.id,"reviewer","2030-03-15",record.targetId]);
    await resolveNote(sql,{id:note.id,actorId:"reviewer"});
    assert.equal((await findRequest(sql,other,note.id))?.status,"resolved");
  }
});
