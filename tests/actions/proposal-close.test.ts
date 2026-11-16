import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { listInbox } from "../../lib/agent/inbox";
import { migrate } from "../../lib/actions/migrate";
import { showCardBringBack } from "../../lib/actions/nextStepTypes";
import {
  assertCloseDroppedApply,
  canCloseProposal,
  CLOSE_DROPPED_CONFIRM,
  closeProposal,
  closeProposalsForStageDrops,
  formatClosePlan,
  missingCloseSchema,
  runCloseDroppedProposals,
} from "../../lib/actions/proposalClose";
import type { RecordLookup } from "../../lib/actions/records";
import { createSuggestion, decideSuggestion } from "../../lib/actions/suggestions";
import { applyBatch } from "../../lib/changes/apply";
import { parseZonedTimestamp, type Actor } from "../../lib/changes/schema";
import { memorySql } from "../helpers/sql";

const reviewer: Actor = { id: "jaideep", kind: "human", role: "reviewer" };
const record = { deal_id: "PIPE-PHX-0081", name: "Sample", stage: "1 Desk screen" };
const lookup: RecordLookup = (kind, id) => (kind === "deal" && id === record.deal_id ? record : null);

function stage(siteId: string, stageName: string, extra: Record<string, unknown> = {}, version = 0) {
  return {
    entity_type: "stage" as const,
    site_id: siteId,
    expected_version: version,
    source: "desk review",
    payload: { stage: stageName, market: "PHX", ...extra },
  };
}

async function ready() {
  const sql = await memorySql();
  await migrate(sql);
  return sql;
}

function users() {
  process.env.AUTH_USERS = JSON.stringify([
    { u: "cindel", h: "$2b$08$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ012", role: "user", name: "Cindel" },
    { u: "jaideep", h: "$2b$08$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ012", role: "admin", name: "Jaideep" },
    { u: "indie", h: "$2b$08$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ012", role: "admin", name: "Indie" },
  ]);
}

async function proposal(sql: Awaited<ReturnType<typeof ready>>, input: { siteId?: string; ownerId?: string; detail?: string; title?: string } = {}) {
  users();
  return createSuggestion(sql, {
    targetKind: "deal",
    targetId: input.siteId || record.deal_id,
    field: "proposed_next_step",
    detail: input.detail || "stage_move",
    title: input.title,
    proposedValue: input.detail === "work_item" ? input.title || "Call the broker" : "financial",
    reason: input.detail === "knock_off" ? "The lot is too small." : "",
    ownerId: input.ownerId || "jaideep",
    authorId: "cindel",
  }, input.siteId && input.siteId !== record.deal_id
    ? (kind, id) => (kind === "deal" && id === input.siteId ? { deal_id: id, stage: "1 Desk screen" } : null)
    : lookup);
}

test("the close migration adds columns and does not rewrite rows", async () => {
  const source = readFileSync("db/migrations/020_proposal_close.sql", "utf8");
  assert.match(source, /'superseded'/);
  assert.match(source, /proposal_closed/);
  assert.doesNotMatch(source, /\bUPDATE\s+/i);
  assert.doesNotMatch(source, /\bDELETE\s+/i);
  const sql = await ready();
  await sql.query(
    `INSERT INTO suggestions (id, target_kind, target_id, field_name, proposed_value, reason, status, author_id)
     VALUES ('open-1', 'deal', 'PIPE-PHX-0081', 'proposed_next_step', 'financial', 'Interest', 'open', 'cindel')`,
  );
  await migrate(sql);
  const row = await sql.query<{ status: string; closed_by: string | null }>(
    `SELECT status, closed_by FROM suggestions WHERE id = 'open-1'`,
  );
  assert.equal(row.rows[0].status, "open");
  assert.equal(row.rows[0].closed_by, null);
});

test("a stage drop closes open proposals and records the drop reason", async () => {
  const sql = await ready();
  const open = await proposal(sql, { title: "Advance to Financial screen" });
  const waiting = await proposal(sql);
  await sql.query(`UPDATE suggestions SET status = 'agreed_waiting' WHERE id = $1`, [waiting.id]);
  const kept = await proposal(sql, { siteId: "PIPE-MIA-0079", detail: "work_item", title: "Call tomorrow" });
  const decided = await proposal(sql, { detail: "work_item", title: "Already decided" });
  await sql.query(`UPDATE suggestions SET status = 'rejected', decided_by = 'jaideep' WHERE id = $1`, [decided.id]);
  const mailBefore = await sql.query<{ n: string }>(`SELECT count(*)::text AS n FROM alert_outbox`);

  await applyBatch(sql, reviewer, "drop-phx", {
    changes: [stage(record.deal_id, "Dropped", { reason: "Lot too small" })],
  });

  const rows = await sql.query<{ id: string; status: string; close_reason: string; closed_by: string; closed_at: string }>(
    `SELECT id, status, close_reason, closed_by, closed_at FROM suggestions WHERE target_id = $1 ORDER BY id`,
    [record.deal_id],
  );
  const byId = new Map(rows.rows.map((row) => [row.id, row]));
  assert.equal(byId.get(open.id)?.status, "superseded");
  assert.equal(byId.get(waiting.id)?.status, "superseded");
  assert.equal(byId.get(decided.id)?.status, "rejected");
  assert.equal(byId.get(open.id)?.close_reason, "Lot too small");
  assert.equal(byId.get(open.id)?.closed_by, "jaideep");
  const stamped = parseZonedTimestamp(byId.get(open.id)?.closed_at || "");
  assert.ok(stamped);
  assert.equal(stamped.iso.endsWith("Z"), false);
  const other = await sql.query<{ status: string }>(`SELECT status FROM suggestions WHERE id = $1`, [kept.id]);
  assert.equal(other.rows[0]?.status, "open");

  const stageRow = await sql.query<{ stage: string }>(`SELECT stage FROM site_stages WHERE site_id = $1`, [record.deal_id]);
  assert.equal(stageRow.rows[0]?.stage, "Dropped");
  const stageEvents = await sql.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM events WHERE entity_type = 'stage' AND site_id = $1`,
    [record.deal_id],
  );
  assert.equal(stageEvents.rows[0]?.n, "1");
  const activity = await sql.query<{ n: string; summary: string }>(
    `SELECT count(*)::text AS n, min(summary) AS summary FROM queue_events WHERE type = 'proposal_closed' AND site_id = $1`,
    [record.deal_id],
  );
  assert.equal(activity.rows[0]?.n, "2");
  assert.equal(activity.rows[0]?.summary, "Proposal closed.");

  const feed = await listInbox(sql, { lookup });
  const notices = feed.items.filter((item) => item.kind === "proposal_closed" && item.proposalId === open.id);
  assert.equal(notices.length, 1);
  assert.match(notices[0]?.text || "", /Closed:/);
  assert.match(notices[0]?.text || "", /Lot too small/);
  const mail = await sql.query<{ n: string }>(`SELECT count(*)::text AS n FROM alert_outbox`);
  assert.equal(mail.rows[0]?.n, mailBefore.rows[0]?.n);

  const again = await closeProposalsForStageDrops(sql, "jaideep", []);
  assert.equal(again, 0);
  const still = await sql.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM agent_inbox WHERE kind = 'proposal_closed' AND ref_id = $1`,
    [open.id],
  );
  assert.equal(still.rows[0]?.n, "1");
});

test("an approved suggested drop closes the other open proposal", async () => {
  const sql = await ready();
  const advance = await proposal(sql, { title: "Advance to Financial screen" });
  const drop = await proposal(sql, { detail: "knock_off" });
  await decideSuggestion(sql, { id: drop.id, status: "accepted", actorId: "jaideep" }, lookup);
  const closed = await sql.query<{ status: string; close_reason: string; closed_by: string }>(
    `SELECT status, close_reason, closed_by FROM suggestions WHERE id = $1`,
    [advance.id],
  );
  assert.equal(closed.rows[0]?.status, "superseded");
  assert.equal(closed.rows[0]?.close_reason, "The lot is too small.");
  assert.equal(closed.rows[0]?.closed_by, "jaideep");
  const kept = await sql.query<{ status: string }>(`SELECT status FROM suggestions WHERE id = $1`, [drop.id]);
  assert.equal(kept.rows[0]?.status, "accepted");
  const stageRow = await sql.query<{ stage: string }>(`SELECT stage FROM site_stages WHERE site_id = $1`, [record.deal_id]);
  assert.equal(stageRow.rows[0]?.stage, "Dropped");
});

test("a drop still commits when the close columns are not on the database yet", async () => {
  const sql = await ready();
  const open = await proposal(sql);
  await sql.exec("ALTER TABLE suggestions DROP COLUMN closed_by");
  await applyBatch(sql, reviewer, "drop-old-schema", {
    changes: [stage(record.deal_id, "Dropped", { reason: "Lot too small" })],
  });
  const stageRow = await sql.query<{ stage: string }>(`SELECT stage FROM site_stages WHERE site_id = $1`, [record.deal_id]);
  assert.equal(stageRow.rows[0]?.stage, "Dropped");
  const row = await sql.query<{ status: string }>(`SELECT status FROM suggestions WHERE id = $1`, [open.id]);
  assert.equal(row.rows[0]?.status, "open");
});

test("a move that is not a drop leaves the proposal open", async () => {
  const sql = await ready();
  const open = await proposal(sql);
  await applyBatch(sql, reviewer, "move-financial", {
    changes: [stage(record.deal_id, "2 Financial screen")],
  });
  const row = await sql.query<{ status: string }>(`SELECT status FROM suggestions WHERE id = $1`, [open.id]);
  assert.equal(row.rows[0]?.status, "open");
});

test("Close is limited to the assignee and admins and does not change Stage", async () => {
  const sql = await ready();
  await applyBatch(sql, reviewer, "desk", { changes: [stage(record.deal_id, "1 Desk screen")] });
  const open = await proposal(sql, { ownerId: "jaideep" });
  const before = await sql.query<{ stage: string; version: number | string }>(
    `SELECT stage, version FROM site_stages WHERE site_id = $1`,
    [record.deal_id],
  );

  await assert.rejects(
    () => closeProposal(sql, { id: open.id, actorId: "cindel", reason: "No longer needed.", admin: false }, lookup),
    /permission/,
  );
  await assert.rejects(
    () => closeProposal(sql, { id: open.id, actorId: "jaideep", reason: "   ", admin: false }, lookup),
    /reason/i,
  );
  const mailBefore = await sql.query<{ n: string }>(`SELECT count(*)::text AS n FROM alert_outbox`);
  const closed = await closeProposal(sql, {
    id: open.id,
    actorId: "jaideep",
    reason: "The screen is no longer the next step.",
    admin: false,
  }, lookup);
  assert.equal(closed.status, "superseded");
  assert.equal(closed.closedBy, "jaideep");
  assert.equal(parseZonedTimestamp(closed.closedAt)?.iso.endsWith("Z"), false);

  const after = await sql.query<{ stage: string; version: number | string }>(
    `SELECT stage, version FROM site_stages WHERE site_id = $1`,
    [record.deal_id],
  );
  assert.equal(after.rows[0]?.stage, before.rows[0]?.stage);
  assert.equal(Number(after.rows[0]?.version), Number(before.rows[0]?.version));
  const stageEvents = await sql.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM events WHERE entity_type = 'stage' AND site_id = $1`,
    [record.deal_id],
  );
  assert.equal(stageEvents.rows[0]?.n, "1");

  const feed = await listInbox(sql, { lookup });
  assert.equal(feed.items.filter((item) => item.kind === "proposal_closed" && item.refId === open.id).length, 1);
  const mail = await sql.query<{ n: string }>(`SELECT count(*)::text AS n FROM alert_outbox`);
  assert.equal(mail.rows[0]?.n, mailBefore.rows[0]?.n);
  const source = readFileSync("lib/actions/proposalClose.ts", "utf8");
  assert.match(source, /ingestProposalEvent/);
  assert.doesNotMatch(source, /enqueueAlert|notifySuggestion|nodemailer|sendMail/);
  const handler = readFileSync("lib/api/handlers/actions/suggestions-id.ts", "utf8");
  assert.match(handler, /cookieWriteAllowed/);
  assert.match(handler, /status === "superseded"/);

  const admin = await proposal(sql, { ownerId: "cindel", detail: "work_item", title: "Order the survey" });
  const byAdmin = await closeProposal(sql, { id: admin.id, actorId: "indie", reason: "Done another way.", admin: true }, lookup);
  assert.equal(byAdmin.closedBy, "indie");
  assert.equal(canCloseProposal({ actorId: "jaideep", ownerId: "jaideep", admin: false }), true);
  assert.equal(canCloseProposal({ actorId: "cindel", ownerId: "jaideep", admin: false }), false);
  assert.equal(canCloseProposal({ actorId: "", ownerId: null, admin: true }), false);
});

test("Bring back stays off the open proposal and on the empty dropped card", () => {
  assert.equal(showCardBringBack({
    stageGroup: "dropped",
    openProposal: true,
    composingBringBack: false,
  }), false);
  assert.equal(showCardBringBack({
    stageGroup: "dropped",
    openProposal: false,
    composingBringBack: false,
  }), true);
  assert.equal(showCardBringBack({
    stageGroup: "desk",
    openProposal: false,
    composingBringBack: false,
  }), false);
  const card = readFileSync("components/actions/NextStepCard.tsx", "utf8");
  const focusBlock = card.slice(card.indexOf("if (!open && focus)"), card.indexOf("} else if (!open && approved)"));
  assert.match(focusBlock, /close-proposal/);
  assert.doesNotMatch(focusBlock, /bring-back-dropped|Bring back/);
  assert.match(card, /bring-back-dropped/);
  assert.doesNotMatch(card, /proposalClose/);
  assert.doesNotMatch(readFileSync("components/FinancialsPanel.tsx", "utf8"), /proposalClose/);
});

test("dry-run lists ids only and writes nothing, and apply without the phrase refuses", async () => {
  const sql = await ready();
  const secret = "Broker asked $3,999,000 https://example.com gmail 18fabc";
  await sql.query(
    `INSERT INTO site_stages (site_id, market, stage, service_area_class, reason, version, updated_by)
     VALUES ('PIPE-PHX-0081', 'PHX', 'Dropped', '', $1, 1, 'jaideep')`,
    [secret],
  );
  await sql.query(
    `INSERT INTO suggestions (id, target_kind, target_id, field_name, detail, title, proposed_value, reason, status, author_id, owner_id)
     VALUES ('prop-1', 'deal', 'PIPE-PHX-0081', 'proposed_next_step', 'stage_move', 'Advance to Financial screen', 'financial', 'Interest', 'open', 'cindel', 'jaideep')`,
  );
  const preview = await runCloseDroppedProposals(sql, { apply: false });
  assert.equal(preview.mode, "dry-run");
  assert.equal(preview.closed, 0);
  assert.deepEqual(preview.proposals, [{ id: "prop-1", siteId: "PIPE-PHX-0081" }]);
  const printed = formatClosePlan(preview.proposals, "dry-run");
  assert.doesNotMatch(printed, /Broker|\$|https:|gmail|18fabc|Interest|Financial/);
  const still = await sql.query<{ status: string }>(`SELECT status FROM suggestions WHERE id = 'prop-1'`);
  assert.equal(still.rows[0]?.status, "open");
  const quiet = await sql.query<{ n: string }>(`SELECT count(*)::text AS n FROM queue_events`);
  assert.equal(quiet.rows[0]?.n, "0");

  await assert.rejects(() => runCloseDroppedProposals(sql, { apply: true, confirm: "" }), /confirm phrase|CONFIRM/);
  await assert.rejects(() => runCloseDroppedProposals(sql, { apply: true, confirm: "close-dropped" }), /CONFIRM/);
  const untouched = await sql.query<{ status: string }>(`SELECT status FROM suggestions WHERE id = 'prop-1'`);
  assert.equal(untouched.rows[0]?.status, "open");

  const applied = await runCloseDroppedProposals(sql, { apply: true, confirm: CLOSE_DROPPED_CONFIRM });
  assert.equal(applied.closed, 1);
  const closed = await sql.query<{ status: string; close_reason: string; closed_by: string; closed_at: string }>(
    `SELECT status, close_reason, closed_by, closed_at FROM suggestions WHERE id = 'prop-1'`,
  );
  assert.equal(closed.rows[0]?.status, "superseded");
  assert.equal(closed.rows[0]?.closed_by, "jaideep");
  assert.equal(closed.rows[0]?.close_reason, `Site already Dropped: ${secret}`);
  assert.equal(parseZonedTimestamp(closed.rows[0]?.closed_at || "")?.iso.endsWith("Z"), false);
  const second = await runCloseDroppedProposals(sql, { apply: true, confirm: CLOSE_DROPPED_CONFIRM });
  assert.equal(second.closed, 0);
  assert.deepEqual(second.proposals, []);
  const notices = await sql.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM agent_inbox WHERE kind = 'proposal_closed' AND ref_id = 'prop-1'`,
  );
  assert.equal(notices.rows[0]?.n, "1");
});

test("a preview and an unconfirmed production write are refused", () => {
  const saved = {
    vercel: process.env.VERCEL_ENV,
    ci: process.env.CI,
    actions: process.env.GITHUB_ACTIONS,
    event: process.env.GITHUB_EVENT_NAME,
    ref: process.env.GITHUB_REF,
    allow: process.env.ALLOW_CLOSE_DROPPED_PROPOSALS,
    host: process.env.NEON_PRODUCTION_HOST,
    neon: process.env.NEON_DATABASE_URL,
  };
  try {
    process.env.VERCEL_ENV = "preview";
    assert.throws(() => assertCloseDroppedApply("postgres://example", CLOSE_DROPPED_CONFIRM), /Vercel/);
    delete process.env.VERCEL_ENV;
    process.env.CI = "true";
    assert.throws(() => assertCloseDroppedApply("postgres://example", CLOSE_DROPPED_CONFIRM), /CI/);
    delete process.env.CI;
    delete process.env.GITHUB_ACTIONS;
    process.env.NEON_PRODUCTION_HOST = "prod.example";
    assert.throws(
      () => assertCloseDroppedApply("postgres://prod.example/db", CLOSE_DROPPED_CONFIRM),
      /production database/,
    );
    assert.throws(() => assertCloseDroppedApply("postgres://other.example/db", "nope"), /CONFIRM/);
    assert.equal(missingCloseSchema({ code: "23514", message: "suggestions_status_check" }), true);
    assert.equal(missingCloseSchema(new Error("permission")), false);
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      const name = {
        vercel: "VERCEL_ENV",
        ci: "CI",
        actions: "GITHUB_ACTIONS",
        event: "GITHUB_EVENT_NAME",
        ref: "GITHUB_REF",
        allow: "ALLOW_CLOSE_DROPPED_PROPOSALS",
        host: "NEON_PRODUCTION_HOST",
        neon: "NEON_DATABASE_URL",
      }[key];
      if (!name) continue;
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
