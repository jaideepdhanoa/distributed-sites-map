import { assertClean } from "@/lib/policy/banned";
import { ingestProposalEvent } from "@/lib/agent/inbox";
import { isExcludedSite } from "@/lib/alerts/excluded";
import { formatZonedTimestamp } from "@/lib/changes/schema";
import { isProductionDatabase } from "@/lib/changes/guard";
import { audit } from "./audit";
import type { Sql } from "./db";
import { permanentSiteId } from "./suggestions";
import { recordAppEvent } from "@/lib/queue/events";
import type { RecordLookup } from "./records";
import { canCloseProposal } from "./proposalAccess";
import { InputError, parseBody, type TargetKind } from "./text";

export { canCloseProposal };

/** Statuses that still need a person. Accepted, rejected, applied, and overtaken are already decided. */
export const OPEN_PROPOSAL_STATUSES = ["open", "agreed_waiting", "ready"] as const;

export const CLOSE_DROPPED_CONFIRM = "close-dropped-proposals";

const ACTIVITY_SUMMARY = "Proposal closed.";

export type ClosedProposal = {
  id: string;
  targetKind: TargetKind;
  targetId: string;
  status: "superseded";
  closedBy: string;
  closedAt: string;
  closeReason: string;
};

type OpenRow = {
  id: string;
  target_kind: TargetKind;
  target_id: string;
  field_name: string;
  detail: string | null;
  title: string | null;
  proposed_value: string;
  reason: string;
  author_id: string;
  owner_id: string | null;
  status: string;
};

function asObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return {};
}

export function droppedCloseReason(dropReason: string): string {
  return `Site already Dropped: ${dropReason.trim()}`;
}

/** A failed statement aborts the transaction. Only a missing close schema is skipped, and only from a savepoint. */
export function missingCloseSchema(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const row = error as { code?: unknown; message?: unknown };
  const code = typeof row.code === "string" ? row.code : "";
  const message = typeof row.message === "string" ? row.message : "";
  if (code === "42703" && /closed_by|closed_at|close_reason/.test(message)) return true;
  if (code === "23514" && /suggestions_status_check|agent_inbox_kind_check/.test(message)) return true;
  return false;
}

async function loadOpen(sql: Sql, id: string): Promise<OpenRow | null> {
  const rows = await sql.query<OpenRow>(
    `SELECT id, target_kind, target_id, field_name, detail, title, proposed_value, reason, author_id, owner_id, status
     FROM suggestions WHERE id = $1`,
    [id],
  );
  return rows.rows[0] || null;
}

async function writeClose(
  sql: Sql,
  row: OpenRow,
  input: { actorId: string; reason: string; siteId: string; lookup?: RecordLookup },
): Promise<ClosedProposal> {
  const closedAt = formatZonedTimestamp();
  const updated = await sql.query<{ id: string }>(
    `UPDATE suggestions
     SET status = 'superseded',
         closed_by = $2,
         closed_at = $3,
         close_reason = $4,
         decided_by = $2,
         decided_at = clock_timestamp(),
         decision_note = $4
     WHERE id = $1 AND status = ANY($5::text[])
     RETURNING id`,
    [row.id, input.actorId, closedAt, input.reason, OPEN_PROPOSAL_STATUSES],
  );
  if (!updated.rows.length) throw new InputError("Only an open proposal can be closed.");
  await audit(sql, {
    actorId: input.actorId,
    action: "suggestion.close",
    targetKind: row.target_kind,
    targetId: row.target_id,
    before: { id: row.id, status: row.status },
    after: { id: row.id, status: "superseded", closedBy: input.actorId, closedAt, closeReason: input.reason },
  });
  const siteId = input.siteId || await permanentSiteId(row.target_kind, row.target_id, input.lookup);
  await ingestProposalEvent(sql, {
    kind: "proposal_closed",
    id: row.id,
    actorId: input.actorId,
    note: input.reason,
    siteId,
    recordId: row.target_id,
    field: row.field_name,
    detail: row.detail,
    title: row.title,
    proposedValue: row.proposed_value,
    reason: row.reason,
  });
  await recordAppEvent(sql, {
    siteId,
    type: "proposal_closed",
    summary: ACTIVITY_SUMMARY,
    actorId: input.actorId,
    refId: row.id,
  });
  return {
    id: row.id,
    targetKind: row.target_kind,
    targetId: row.target_id,
    status: "superseded",
    closedBy: input.actorId,
    closedAt,
    closeReason: input.reason,
  };
}

/** Signed-in assignee or admin. Does not write Stage. */
export async function closeProposal(
  sql: Sql,
  input: { id: string; actorId: string; reason: string; admin: boolean; lookup?: RecordLookup },
): Promise<ClosedProposal> {
  const reason = parseBody(input.reason, "reason", 200);
  assertClean(reason);
  const row = await loadOpen(sql, input.id);
  if (!row) throw new InputError("That proposal is not in the queue.", 404);
  if (!OPEN_PROPOSAL_STATUSES.includes(row.status as (typeof OPEN_PROPOSAL_STATUSES)[number])) {
    throw new InputError("Only an open proposal can be closed.");
  }
  if (!canCloseProposal({ actorId: input.actorId, ownerId: row.owner_id, admin: input.admin })) {
    throw new InputError("You do not have permission for that.", 403);
  }
  const siteId = await permanentSiteId(row.target_kind, row.target_id, input.lookup);
  return writeClose(sql, row, { actorId: input.actorId, reason, siteId, lookup: input.lookup });
}

type StageResult = { entity_type: string; site_id: string; event_id: string };

/**
 * After a stage write lands on Dropped, close every still-open proposal on that site.
 * A batch whose last stage for the site is not Dropped does not close them.
 * The quarantined site is left untouched.
 */
export async function closeProposalsForStageDrops(sql: Sql, actorId: string, results: StageResult[]): Promise<number> {
  const latest = new Map<string, Record<string, unknown>>();
  for (const result of results) {
    if (result.entity_type !== "stage" || !result.site_id || isExcludedSite(result.site_id)) continue;
    const event = await sql.query<{ payload: unknown }>(`SELECT payload FROM events WHERE id = $1`, [result.event_id]);
    latest.set(result.site_id, asObject(event.rows[0]?.payload));
  }
  let closed = 0;
  for (const [siteId, payload] of latest) {
    if (String(payload.stage || "") !== "Dropped") continue;
    if (String(payload.previous_stage || "") === "Dropped") continue;
    const reason = typeof payload.reason === "string" ? payload.reason.trim() : "";
    closed += await supersedeOpenOnSite(sql, { siteId, actorId, reason });
  }
  return closed;
}

async function supersedeOpenOnSite(
  sql: Sql,
  input: { siteId: string; actorId: string; reason: string },
): Promise<number> {
  const rows = await sql.query<OpenRow>(
    `SELECT id, target_kind, target_id, field_name, detail, title, proposed_value, reason, author_id, owner_id, status
     FROM suggestions
     WHERE target_id = $1 AND status = ANY($2::text[])
     ORDER BY created_at ASC, id ASC`,
    [input.siteId, OPEN_PROPOSAL_STATUSES],
  );
  let closed = 0;
  for (const row of rows.rows) {
    const saved = await sql.query<{ id: string }>(
      `SELECT id FROM suggestions WHERE id = $1 AND status = ANY($2::text[])`,
      [row.id, OPEN_PROPOSAL_STATUSES],
    );
    if (!saved.rows.length) continue;
    await writeClose(sql, row, { actorId: input.actorId, reason: input.reason, siteId: input.siteId });
    closed += 1;
  }
  return closed;
}

export type DroppedOpenProposal = {
  id: string;
  siteId: string;
  reason: string;
  closedBy: string;
};

/** Ids only. Drop reasons and actor names stay off this list. */
export function publicClosePlan(rows: { id: string; siteId: string }[]): { id: string; siteId: string }[] {
  return rows.map((row) => ({ id: row.id, siteId: row.siteId }));
}

export function formatClosePlan(rows: { id: string; siteId: string }[], mode: "dry-run" | "apply"): string {
  return JSON.stringify({ mode, proposals: publicClosePlan(rows) });
}

export async function loadDroppedOpenProposals(sql: Sql): Promise<DroppedOpenProposal[]> {
  const rows = await sql.query<{ id: string; site_id: string; reason: string; updated_by: string }>(
    `SELECT s.id, st.site_id, st.reason, st.updated_by
     FROM suggestions s
     JOIN site_stages st ON st.site_id = s.target_id
     WHERE st.stage = 'Dropped'
       AND s.status = ANY($1::text[])
       AND upper(s.target_id) <> $2
     ORDER BY st.site_id ASC, s.id ASC`,
    [OPEN_PROPOSAL_STATUSES, "PIPE-PHX-0006"],
  );
  return rows.rows
    .filter((row) => !isExcludedSite(row.site_id))
    .map((row) => ({
      id: row.id,
      siteId: row.site_id,
      reason: row.reason || "",
      closedBy: (row.updated_by || "").trim() || "system",
    }));
}

/**
 * Dry run lists ids and writes nothing. Apply without the confirm phrase throws
 * before any update. A second apply finds nothing left open.
 */
export async function runCloseDroppedProposals(
  sql: Sql,
  input: { apply: boolean; confirm?: string },
): Promise<{ mode: "dry-run" | "apply"; proposals: { id: string; siteId: string }[]; closed: number }> {
  if (input.apply && (input.confirm || "").trim() !== CLOSE_DROPPED_CONFIRM) {
    throw new Error("Refusing to close proposals. Dry run is the default. Set CONFIRM=close-dropped-proposals to apply.");
  }
  const found = await loadDroppedOpenProposals(sql);
  const proposals = publicClosePlan(found);
  if (!input.apply) return { mode: "dry-run", proposals, closed: 0 };
  let closed = 0;
  for (const row of found) {
    const open = await loadOpen(sql, row.id);
    if (!open || !OPEN_PROPOSAL_STATUSES.includes(open.status as (typeof OPEN_PROPOSAL_STATUSES)[number])) continue;
    if (open.target_id !== row.siteId) continue;
    await writeClose(sql, open, {
      actorId: row.closedBy,
      reason: droppedCloseReason(row.reason),
      siteId: row.siteId,
    });
    closed += 1;
  }
  return { mode: "apply", proposals, closed };
}

/** Preview, CI, and an unconfirmed production write are refused. A dry run does not call this. */
export function assertCloseDroppedApply(url: string, confirm: string | undefined): void {
  if ((confirm || "").trim() !== CLOSE_DROPPED_CONFIRM) {
    throw new Error("Refusing to close proposals. Dry run is the default. Set CONFIRM=close-dropped-proposals to apply.");
  }
  if (process.env.VERCEL_ENV === "preview" || process.env.VERCEL_ENV === "production") {
    throw new Error("Refusing to close proposals from Vercel. Previews share the production database.");
  }
  const ci = process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true";
  const manual = process.env.GITHUB_EVENT_NAME === "workflow_dispatch"
    && process.env.ALLOW_CLOSE_DROPPED_PROPOSALS === "1"
    && process.env.GITHUB_REF === "refs/heads/main";
  if (ci && !manual) {
    throw new Error("Refusing to close proposals from CI. Run the workflow by hand on main with the confirm phrase.");
  }
  if (isProductionDatabase(url) && process.env.ALLOW_CLOSE_DROPPED_PROPOSALS !== "1") {
    throw new Error("Refusing to close proposals on the production database. Set ALLOW_CLOSE_DROPPED_PROPOSALS=1 only after the dry-run list is approved.");
  }
}
