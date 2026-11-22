import { actionsEnabled, withSql } from "@/lib/actions/db";
import { presentQueue, type NdaAgreement, type NdaQueueItem, type NdaStateRow } from "@/lib/nda";

function missingRelation(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as { code?: string }).code === "42P01");
}

/** Overlay saved NDA writes onto the register. A database without the table keeps the snapshot. */
export async function loadNdaQueue(register: NdaAgreement[]): Promise<NdaQueueItem[]> {
  if (!actionsEnabled()) return presentQueue(register);
  try {
    return await withSql(async (sql) => {
      const states = await sql.query<NdaStateRow>(
        `SELECT nda_id, status, waiting_on, owner, next_step, last_action, last_action_date, version FROM nda_state`,
      );
      const history = await sql.query<{ nda_id: string; status: string; note: string; actor: string; at: string }>(
        `SELECT nda_id, status, note, actor, to_char(at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS at
         FROM nda_history ORDER BY at ASC, id ASC`,
      );
      return presentQueue(register, states.rows, history.rows);
    });
  } catch (error) {
    if (!missingRelation(error)) {
      console.error(JSON.stringify({ event: "nda_overlay_error", name: error instanceof Error ? error.name : "error" }));
    }
    return presentQueue(register);
  }
}
