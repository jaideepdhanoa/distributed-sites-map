import { actionsEnabled, withSql } from "@/lib/actions/db";
import { presentQueue, type NdaAgreement, type NdaQueueItem, type NdaStateRow } from "@/lib/nda";

function missingRelation(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as { code?: string }).code === "42P01");
}

/** Overlay saved NDA writes onto the register. A database without the table keeps the snapshot. */
export async function loadNdaQueue(register: NdaAgreement[]): Promise<NdaQueueItem[]> {
  if (!actionsEnabled()) return presentQueue(register, [], [], new Date().toISOString().slice(0, 10));
  try {
    return await withSql(async (sql) => {
      const states = await sql.query<NdaStateRow>(
        `SELECT nda_id, status, waiting_on, owner, next_step, last_action, last_action_date, version,
                stage, court, court_detail,
                to_char(court_since AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS court_since,
                to_char(next_step_due, 'YYYY-MM-DD') AS next_step_due,
                document_url, document_kind, contact_name, contact_email, contact_phone,
                gmail_thread_ids, covered_refs, source_ref
         FROM nda_state`,
      );
      const history = await sql.query<{ nda_id: string; status: string; note: string; actor: string; at: string }>(
        `SELECT nda_id, status, note, actor, to_char(at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS at
         FROM nda_history ORDER BY at ASC, id ASC`,
      );
      return presentQueue(register, states.rows, history.rows, new Date().toISOString().slice(0, 10));
    });
  } catch (error) {
    if (!missingRelation(error)) {
      console.error(JSON.stringify({ event: "nda_overlay_error", name: error instanceof Error ? error.name : "error" }));
    }
    return presentQueue(register);
  }
}
