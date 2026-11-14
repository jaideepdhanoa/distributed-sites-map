import { actionsEnabled, withSql } from "@/lib/actions/db";
import { recordLinks } from "@/lib/actions/records";
import { stamp, type TargetKind } from "@/lib/actions/text";
import { getUsers } from "@/lib/users";
import { applyStageOverlay, type StageDecision, type StageKind } from "@/lib/stageOverlay";

type DecisionRow = {
  id: string;
  target_kind: TargetKind;
  target_id: string;
  field_name: string;
  detail: string | null;
  current_value: string;
  proposed_value: string;
  reason: string;
  status: string;
  author_id: string;
  decided_by: string | null;
  decided_at: Date | string | null;
  created_at: Date | string;
  stage_at: string | null;
};

function actorName(id: string | null): string {
  if (!id) return "";
  const account = getUsers().find((user) => user.u === id);
  return account?.displayName || id;
}

export async function loadAcceptedStageDecisions(): Promise<StageDecision[]> {
  if (!actionsEnabled()) return [];
  const rows = await withSql((sql) =>
    sql.query<DecisionRow>(
      `SELECT id, target_kind, target_id, field_name, detail, current_value, proposed_value, reason,
              status, author_id, decided_by, decided_at, created_at, stage_at
       FROM suggestions
       WHERE status = 'accepted'
         AND (
           field_name = 'stage'
           OR (field_name = 'correction' AND detail IN ('stage', 'pipeline_stage'))
           OR (field_name = 'proposed_next_step' AND detail IN ('stage_move', 'knock_off', 'bring_back'))
         )`,
    ),
  );
  return rows.rows.map((row) => ({
    id: row.id,
    targetKind: row.target_kind,
    targetId: row.target_id,
    field: row.field_name,
    detail: row.detail,
    currentValue: row.current_value || "",
    proposedValue: row.proposed_value || "",
    reason: row.reason || "",
    status: row.status,
    actorName: actorName(row.decided_by || row.author_id),
    decidedAt: row.decided_at ? stamp(row.decided_at) : null,
    createdAt: stamp(row.created_at),
    stageAt: row.stage_at,
  }));
}

/**
 * Draw accepted stage decisions over a generated collection.
 * Names are included for a signed-in response. A failure leaves the generated stage in place.
 * This does not write the database, the workbook, or the generated files.
 */
export async function overlayStageFile<T extends { features?: { properties?: Record<string, unknown> }[] }>(
  file: T,
  kind: StageKind,
  includeNames = true,
): Promise<T> {
  try {
    const decisions = await loadAcceptedStageDecisions();
    if (!decisions.length) return file;
    return applyStageOverlay(file, decisions, { kind, links: recordLinks(), includeNames });
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code || "") : "";
    if (code !== "42P01") console.error(JSON.stringify({ event: "stage_overlay_unavailable", code: code || "unknown" }));
    return file;
  }
}
