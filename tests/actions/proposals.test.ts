import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { listInbox } from "../../lib/agent/inbox";
import { migrate } from "../../lib/actions/migrate";
import type { RecordLookup } from "../../lib/actions/records";
import { createSuggestion, decideSuggestion, listSuggestions } from "../../lib/actions/suggestions";
import { InputError } from "../../lib/actions/text";
import { memorySql } from "../helpers/sql";

const record = {
  deal_id: "PIPE-PHX-0008",
  name: "Sample",
  stage: "1 Desk screen",
  checklist: [
    { id: "payroll", state: "Asked for", since: "2026-11-01", owner: "Broker", why: "", period: "", href: "", receivedOn: "", note: "" },
  ],
};
const lookup: RecordLookup = (kind, id) => (kind === "deal" && id === record.deal_id ? record : null);

async function ready() {
  const sql = await memorySql();
  await migrate(sql);
  return sql;
}

function users() {
  process.env.AUTH_USERS = JSON.stringify([
    { u: "cindel", h: "$2b$08$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ012", role: "user", name: "Cindel" },
    { u: "reviewer", h: "$2b$08$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ012", role: "admin", name: "Reviewer" },
    { u: "jaideep", h: "$2b$08$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ012", role: "admin", name: "Jaideep" },
  ]);
}

test("the outcome migration does not decide existing proposals", async () => {
  const source = readFileSync("db/migrations/007_proposal_outcomes.sql", "utf8");
  assert.doesNotMatch(source, /\bUPDATE\s+/i);
  const sql = await ready();
  await sql.query(
    `INSERT INTO suggestions (id, target_kind, target_id, field_name, proposed_value, reason, status, author_id)
     VALUES ('open-1', 'deal', 'PIPE-PHX-0008', 'proposed_next_step', 'financial', 'Interest', 'open', 'cindel')`,
  );
  await migrate(sql);
  const row = await sql.query<{ status: string }>(`SELECT status FROM suggestions WHERE id = 'open-1'`);
  assert.equal(row.rows[0].status, "open");
});

test("agreed waiting keeps the stage, links blockers, and replies once", async () => {
  const previous = process.env.AUTH_USERS;
  users();
  record.stage = "1 Desk screen";
  record.checklist[0].state = "Asked for";
  const sql = await ready();
  try {
    const request = await createSuggestion(sql, {
      targetKind: "deal",
      targetId: record.deal_id,
      field: "document_request",
      proposedValue: JSON.stringify({ mode: "request", items: ["payroll"], reason: "Request documents" }),
      reason: "Request documents",
      ownerId: "reviewer",
      targetOn: "2026-11-20",
      authorId: "cindel",
    }, lookup);
    const proposal = await createSuggestion(sql, {
      targetKind: "deal",
      targetId: record.deal_id,
      field: "proposed_next_step",
      detail: "stage_move",
      proposedValue: "financial",
      reason: "",
      authorId: "cindel",
    }, lookup);
    assert.equal(proposal.title, "Move to Financial screen");
    assert.equal(proposal.stageAt, "1 Desk screen");
    const waiting = await decideSuggestion(sql, {
      id: proposal.id,
      status: "agreed_waiting",
      actorId: "reviewer",
      reply: "Waiting on the broker for the payroll file.",
    }, lookup);
    assert.equal(waiting.status, "agreed_waiting");
    assert.equal(record.stage, "1 Desk screen");
    assert.equal(waiting.blockers.filter((item) => !item.closed).length >= 2, true);
    assert.equal(waiting.blockers.some((item) => item.kind === "document_request" && item.refId === request.id), true);
    assert.equal(waiting.blockers.some((item) => item.kind === "checklist" && item.refId === "payroll"), true);
    const note = await sql.query<{ body: string }>(
      `SELECT body FROM notes WHERE target_kind = 'suggestion' AND target_id = $1`,
      [proposal.id],
    );
    assert.equal(note.rows[0]?.body, "Waiting on the broker for the payroll file.");
    const feed = await listInbox(sql, { lookup });
    const decision = feed.items.find((item) => item.kind === "decision" && item.proposalId === proposal.id);
    assert.equal(decision?.workbookStage, false);
    assert.equal(decision?.stage, null);
    assert.equal(decision?.proposalOutcome, "agreed_waiting");
    assert.equal(decision?.currentStage, "1 Desk screen");
    assert.equal(decision?.stale, false);
    assert.equal((decision?.openBlockers.length || 0) >= 2, true);
    await assert.rejects(
      () => decideSuggestion(sql, { id: proposal.id, status: "accepted", actorId: "jaideep" }, lookup),
      /waiting on blockers/,
    );

    await decideSuggestion(sql, { id: request.id, status: "accepted", actorId: "reviewer" }, lookup);
    record.checklist[0].state = "On file";
    const settled = await listSuggestions(sql, { targetKind: "deal", targetId: record.deal_id }, lookup);
    const readyRow = settled.find((item) => item.id === proposal.id);
    assert.equal(readyRow?.status, "ready");
    assert.equal(readyRow?.blockers.every((item) => item.closed), true);
    const again = await listInbox(sql, { lookup });
    const readyEvents = again.items.filter((item) => item.kind === "proposal_ready" && item.refId === proposal.id);
    assert.equal(readyEvents.length, 1);
    assert.equal(readyEvents[0].workbookStage, false);
    assert.equal(readyEvents[0].proposalOutcome, "ready");
    const keys = await sql.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM agent_inbox WHERE idempotency_key = $1`,
      [`proposal_ready:${proposal.id}`],
    );
    assert.equal(keys.rows[0].n, "1");
    await listInbox(sql, { lookup });
    const after = await sql.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM agent_inbox WHERE idempotency_key = $1`,
      [`proposal_ready:${proposal.id}`],
    );
    assert.equal(after.rows[0].n, "1");

    record.stage = "Financial screen";
    const stale = await listInbox(sql, { lookup });
    const marked = stale.items.find((item) => item.refId === proposal.id && item.kind === "proposal_ready");
    assert.equal(marked?.stale, true);
    assert.equal(marked?.currentStage, "Financial screen");

    const accepted = await decideSuggestion(sql, {
      id: proposal.id,
      status: "accepted",
      actorId: "jaideep",
      reply: "Blockers are clear.",
    }, lookup);
    assert.equal(accepted.status, "accepted");
    const moved = await listInbox(sql, { lookup });
    const workbook = moved.items.find((item) => item.kind === "decision" && item.proposalId === proposal.id && item.workbookStage);
    assert.equal(workbook?.stage, "financial");
    assert.equal(workbook?.workbookStage, true);
  } finally {
    if (previous === undefined) delete process.env.AUTH_USERS;
    else process.env.AUTH_USERS = previous;
  }
});

test("an open proposal can still be accepted, and overtaken needs a reason", async () => {
  const previous = process.env.AUTH_USERS;
  users();
  const sql = await ready();
  try {
    const open = await createSuggestion(sql, {
      targetKind: "deal",
      targetId: record.deal_id,
      field: "proposed_next_step",
      detail: "work_item",
      title: "Order the survey",
      proposedValue: "Order the survey",
      reason: "",
      authorId: "cindel",
    }, lookup);
    const accepted = await decideSuggestion(sql, { id: open.id, status: "accepted", actorId: "reviewer" }, lookup);
    assert.equal(accepted.status, "accepted");

    const moot = await createSuggestion(sql, {
      targetKind: "deal",
      targetId: record.deal_id,
      field: "proposed_next_step",
      detail: "stage_move",
      proposedValue: "financial",
      reason: "",
      authorId: "cindel",
    }, lookup);
    await assert.rejects(
      () => decideSuggestion(sql, { id: moot.id, status: "overtaken", actorId: "reviewer" }, lookup),
      (error: unknown) => error instanceof InputError && /reason/i.test(error.message),
    );
    const closed = await decideSuggestion(sql, {
      id: moot.id,
      status: "overtaken",
      actorId: "reviewer",
      reply: "The site was already dropped.",
    }, lookup);
    assert.equal(closed.status, "overtaken");
    const feed = await listInbox(sql, { lookup });
    assert.equal(feed.items.filter((item) => item.kind === "proposal_overtaken" && item.refId === moot.id).length, 1);
    await listInbox(sql, { lookup });
    const rows = await sql.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM agent_inbox WHERE idempotency_key = $1`,
      [`proposal_overtaken:${moot.id}`],
    );
    assert.equal(rows.rows[0].n, "1");
  } finally {
    if (previous === undefined) delete process.env.AUTH_USERS;
    else process.env.AUTH_USERS = previous;
  }
});

test("a hold is enough to wait, and clearing it makes the proposal ready", async () => {
  const previous = process.env.AUTH_USERS;
  users();
  record.checklist[0].state = "On file";
  const sql = await ready();
  try {
    const proposal = await createSuggestion(sql, {
      targetKind: "deal",
      targetId: record.deal_id,
      field: "proposed_next_step",
      detail: "stage_move",
      proposedValue: "financial",
      reason: "",
      authorId: "cindel",
    }, lookup);
    await assert.rejects(
      () => decideSuggestion(sql, { id: proposal.id, status: "agreed_waiting", actorId: "reviewer", reply: "Waiting." }, lookup),
      /waiting on/,
    );
    const waiting = await decideSuggestion(sql, {
      id: proposal.id,
      status: "agreed_waiting",
      actorId: "reviewer",
      reply: "Waiting on a signature from counsel.",
      hold: { label: "Signature from counsel", party: "Counsel", askedOn: "2026-11-02", followUpOn: "2026-11-16" },
    }, lookup);
    const hold = waiting.blockers.find((item) => item.kind === "hold");
    assert.ok(hold);
    assert.equal(hold?.party, "Counsel");
    assert.equal(hold?.followUpOn, "2026-11-16");
    const { clearSuggestionBlocker } = await import("../../lib/actions/suggestions");
    const cleared = await clearSuggestionBlocker(sql, { id: proposal.id, blockerId: hold.id, actorId: "reviewer" }, lookup);
    assert.equal(cleared.status, "ready");
  } finally {
    record.checklist[0].state = "Asked for";
    if (previous === undefined) delete process.env.AUTH_USERS;
    else process.env.AUTH_USERS = previous;
  }
});
