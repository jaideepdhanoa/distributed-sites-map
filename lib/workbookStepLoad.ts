import { actionsEnabled, withSql } from "./actions/db";
import { isExcludedSite } from "./alerts/excluded";
import { loadOpenLoops } from "./openLoopsLoad";
import { workbookNote, workbookStepFor, type WorkbookStep } from "./workbookStep";

export function loadWorkbookStep(id: string): WorkbookStep | null {
  try {
    return workbookStepFor(loadOpenLoops(), id);
  } catch {
    return null;
  }
}

/** The sheet cell, when the snapshot was cut short. Read only. A miss keeps the snapshot. */
export async function fullerWorkbookStep(id: string, snapshot: WorkbookStep | null): Promise<WorkbookStep | null> {
  const current = snapshot?.text || "";
  if (!current.endsWith("…") || !actionsEnabled() || isExcludedSite(id)) return snapshot;
  try {
    const rows = await withSql((sql) =>
      sql.query<{ note: string }>(
        `SELECT COALESCE(NULLIF(sheet->>'Next step', ''), notes) AS note FROM sites WHERE site_id = $1`,
        [id],
      ),
    );
    const fuller = workbookNote(String(rows.rows[0]?.note || ""));
    if (!fuller || fuller.endsWith("…") || fuller.length <= current.length) return snapshot;
    return { text: fuller, owner: snapshot?.owner || "", due: snapshot?.due || "" };
  } catch {
    return snapshot;
  }
}
