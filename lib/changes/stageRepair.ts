import type { Sql } from "@/lib/actions/db";
import type { RecordLookup } from "@/lib/actions/records";
import { fileLookup, recordField } from "@/lib/actions/records";
import { recordAppEvent, type AppEventType } from "@/lib/queue/events";
import { isExcludedSite } from "@/lib/alerts/excluded";
import { stageKey } from "@/lib/stageOverlay";
import { formatZonedTimestamp } from "./schema";
import { writeAcceptedStage } from "./stageDecision";
import { humanDecider, loadHeldStages } from "./heldStage";

export const REPAIR_CONFIRM = "repair-accepted-stages";

export type RepairRow = {
  siteId: string;
  proposalId: string;
  acceptedAt: string;
  acceptedBy: string;
  targetStage: string;
  currentStage: string;
  reason: string;
  field: string;
  detail: string | null;
  proposedValue: string;
  actorId: string;
};

type OpenRow = {
  id: string;
  target_id: string;
  field_name: string;
  detail: string | null;
  proposed_value: string;
  reason: string;
  decision_note: string | null;
  decided_by: string | null;
  decided_at: Date | string | null;
  status: string;
};

const OPEN_SQL = `
  SELECT id, target_id, field_name, detail, proposed_value, reason, decision_note,
         decided_by, decided_at, status
  FROM suggestions
  WHERE status IN ('accepted', 'applied')
    AND (
      field_name = 'stage'
      OR (field_name = 'correction' AND detail IN ('stage', 'pipeline_stage'))
      OR (field_name = 'proposed_next_step' AND detail IN ('stage_move', 'knock_off', 'bring_back'))
    )
  ORDER BY decided_at ASC NULLS LAST, id ASC
`;

export function repairDayLabel(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value || "";
  return `${part("month")} ${part("day")} ${part("year")}`.trim();
}

export function repairActivityLine(input: { appliedOn: string; acceptedAt: string; acceptedBy: string }): string {
  return `applied on ${input.appliedOn} per Jaideep, originally accepted ${input.acceptedAt} by ${input.acceptedBy}`;
}

/** Site id, proposal id, accepted at, accepted by, target stage, current stage. No reasons. */
export function formatStageRepair(rows: RepairRow[]): string {
  const header = ["site_id", "proposal_id", "accepted_at", "accepted_by", "target_stage", "current_stage"].join("\t");
  const lines = rows.map((row) =>
    [row.siteId, row.proposalId, row.acceptedAt, row.acceptedBy, row.targetStage, row.currentStage || "(none)"].join("\t"),
  );
  return [header, ...lines].join("\n");
}

function zoned(value: Date | string | null): string {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return formatZonedTimestamp(date);
}

async function currentStages(sql: Sql): Promise<Map<string, string>> {
  const stored = await sql.query<{ site_id: string; stage: string }>(`SELECT site_id, stage FROM site_stages`);
  return new Map(stored.rows.map((row) => [row.site_id, row.stage]));
}

function snapshotStage(siteId: string, lookup?: RecordLookup): string {
  if (!lookup) return "";
  const deal = lookup("deal", siteId);
  const fromDeal = recordField(deal, "stage", null);
  if (fromDeal) return fromDeal;
  return recordField(lookup("site", siteId), "stage", null);
}

/**
 * Accepted decisions whose site stage is still not the approved stage.
 * An open proposal is not a drop. The quarantined site is left out.
 * A decision with no human accepter is left out. R-097.
 */
export async function planStageRepair(sql: Sql, lookup?: RecordLookup): Promise<RepairRow[]> {
  const resolved = lookup ?? await fileLookup().catch(() => undefined);
  const held = new Map((await loadHeldStages(sql, resolved)).map((row) => [row.siteId, row]));
  const stored = await currentStages(sql);
  const rows = await sql.query<OpenRow>(OPEN_SQL);
  const planned: RepairRow[] = [];
  for (const row of rows.rows) {
    if (!humanDecider(row.decided_by)) continue;
    const latest = [...held.values()].find((item) => item.proposalId === row.id);
    if (!latest || isExcludedSite(latest.siteId)) continue;
    const current = stored.get(latest.siteId) || snapshotStage(latest.siteId, resolved);
    if (stageKey(current) && stageKey(current) === stageKey(latest.stage)) continue;
    planned.push({
      siteId: latest.siteId,
      proposalId: row.id,
      acceptedAt: latest.at || zoned(row.decided_at),
      acceptedBy: latest.approver || String(row.decided_by || ""),
      targetStage: latest.stage,
      currentStage: current,
      reason: latest.reason || String(row.decision_note || row.reason || ""),
      field: row.field_name,
      detail: row.detail,
      proposedValue: row.proposed_value,
      actorId: String(row.decided_by || ""),
    });
  }
  return planned.filter((row) => {
    const winner = held.get(row.siteId);
    return winner?.proposalId === row.proposalId;
  });
}

export async function applyStageRepair(sql: Sql, rows: RepairRow[], now = new Date()): Promise<number> {
  const appliedOn = repairDayLabel(now);
  let written = 0;
  for (const row of rows) {
    if (!humanDecider(row.actorId) || isExcludedSite(row.siteId)) continue;
    if (row.targetStage === "Dropped" && !row.reason.trim()) continue;
    const current = await sql.query<{ stage: string }>(`SELECT stage FROM site_stages WHERE site_id = $1`, [row.siteId]);
    if (stageKey(current.rows[0]?.stage || "") === stageKey(row.targetStage)) continue;
    await sql.exec("BEGIN");
    try {
      const applied = await writeAcceptedStage(sql, {
        id: row.proposalId,
        field: row.field,
        detail: row.detail,
        proposedValue: row.proposedValue,
        reason: row.reason,
        siteId: row.siteId,
        actorId: row.actorId,
      }, { joinTransaction: true, idempotencyKey: `stage-repair-${row.proposalId}` });
      if (applied && !applied.replayed) {
        const summary = repairActivityLine({
          appliedOn,
          acceptedAt: row.acceptedAt,
          acceptedBy: row.acceptedBy,
        });
        const type: AppEventType = row.targetStage === "Dropped" ? "drop" : "stage_repair";
        await recordAppEvent(sql, {
          siteId: row.siteId,
          type,
          summary,
          actorId: "jaideep",
          refId: `stage-repair-${row.proposalId}`,
          max: 2400,
        });
        written += 1;
      }
      await sql.exec("COMMIT");
    } catch (error) {
      try {
        await sql.exec("ROLLBACK");
      } catch {
        // The connection already closed the transaction.
      }
      throw error;
    }
  }
  return written;
}

export function assertStageRepairApply(url: string, confirm: string | undefined): void {
  if ((confirm || "").trim() !== REPAIR_CONFIRM) {
    throw new Error("Refusing to repair stages. Dry run is the default. Set CONFIRM=repair-accepted-stages to apply.");
  }
  if (process.env.VERCEL_ENV === "preview" || process.env.VERCEL_ENV === "production") {
    throw new Error("Refusing to repair stages from Vercel.");
  }
  const ci = process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true";
  const manual = process.env.GITHUB_EVENT_NAME === "workflow_dispatch"
    && process.env.ALLOW_REPAIR_ACCEPTED_STAGES === "1"
    && process.env.GITHUB_REF === "refs/heads/main";
  if (ci && !manual) {
    throw new Error("Refusing to repair stages from CI. Run the workflow by hand on main with the confirm phrase.");
  }
  const host = (url || "").toLowerCase();
  const named = process.env.NEON_PRODUCTION_HOST?.trim().toLowerCase();
  const production = Boolean(named && host.includes(named));
  if (production && process.env.ALLOW_REPAIR_ACCEPTED_STAGES !== "1") {
    throw new Error("Refusing to repair stages on the production database. Set ALLOW_REPAIR_ACCEPTED_STAGES=1 only after the dry-run list is approved.");
  }
}

