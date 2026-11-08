import assert from "node:assert/strict";
import test from "node:test";
import { migrate } from "../../lib/actions/migrate";
import type { RecordLookup } from "../../lib/actions/records";
import { createSuggestion, decideSuggestion } from "../../lib/actions/suggestions";
import { memorySql } from "../helpers/sql";

const deal = { deal_id: "PIPE-PHX-0001", name: "Sonoran", stage: "2 Screen", stage_group: "desk" };
const lookup: RecordLookup = (kind, id) => (kind === "deal" && id === deal.deal_id ? deal : null);

test("a document request needs one owner and does not change stage", async () => {
  const previous = process.env.AUTH_USERS;
  process.env.AUTH_USERS = JSON.stringify([
    { u: "writer", h: "$2b$08$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ012", role: "user", name: "Writer" },
    { u: "reviewer", h: "$2b$08$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ012", role: "admin", name: "Reviewer" },
  ]);
  const sql = await memorySql();
  await migrate(sql);
  try {
    await assert.rejects(() => createSuggestion(sql, {
      targetKind: "deal",
      targetId: deal.deal_id,
      field: "document_request",
      proposedValue: JSON.stringify({ mode: "request", items: ["payroll"], reason: "" }),
      reason: "Request documents",
      authorId: "writer",
    }, lookup));
    const suggestion = await createSuggestion(sql, {
      targetKind: "deal",
      targetId: deal.deal_id,
      field: "document_request",
      proposedValue: JSON.stringify({ mode: "request", items: ["payroll"], reason: "Request documents" }),
      reason: "Request documents",
      ownerId: "reviewer",
      targetOn: "2026-11-20",
      authorId: "writer",
    }, lookup);
    assert.equal(suggestion.status, "open");
    assert.equal(suggestion.ownerId, "reviewer");
    assert.equal(suggestion.field, "document_request");
    const accepted = await decideSuggestion(sql, { id: suggestion.id, status: "accepted", actorId: "reviewer" });
    assert.equal(accepted.status, "accepted");
    assert.equal(deal.stage, "2 Screen");
    const snooze = await sql.query<{ until_date: string }>("SELECT to_char(until_date, 'YYYY-MM-DD') AS until_date FROM queue_snoozes WHERE site_id = $1", [deal.deal_id]);
    assert.equal(snooze.rows[0]?.until_date, "2026-11-20");
  } finally {
    process.env.AUTH_USERS = previous;
  }
});
