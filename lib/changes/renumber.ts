import type { Sql } from "@/lib/actions/db";
import { formatEntityId, insertEvent, numericSuffix, raiseIdFloor } from "./apply";
import { importedFromWorkbook } from "./mirror";

/** The two API rows that reused Activity tab ids. A dry run is required before these move. */
export const COLLIDING_ACTIVITY_IDS = ["A-000272", "A-000273"] as const;

export type ActivityMove = { from: string; to: string };

export type RenumberPlan = {
  moves: ActivityMove[];
  skipped: { id: string; reason: string }[];
  nextFloor: number;
};

type ActivityHit = { entity_id: string; site_id: string; source: string | null };

async function activityHits(sql: Sql, ids: string[]): Promise<Map<string, ActivityHit>> {
  if (!ids.length) return new Map();
  const rows = await sql.query<{ entity_id: string; site_id: string }>(
    `SELECT entity_id, site_id FROM activities WHERE entity_id = ANY($1::text[])`,
    [ids],
  );
  const origins = await sql.query<{ entity_id: string; source: string }>(
    `SELECT DISTINCT ON (entity_id) entity_id, source
     FROM events
     WHERE entity_type = 'activity' AND entity_id = ANY($1::text[])
     ORDER BY entity_id, created_at ASC, id ASC`,
    [ids],
  );
  const sourceOf = new Map(origins.rows.map((row) => [row.entity_id, row.source]));
  return new Map(
    rows.rows.map((row) => [row.entity_id, { entity_id: row.entity_id, site_id: row.site_id, source: sourceOf.get(row.entity_id) || null }]),
  );
}

async function occupiedFloor(sql: Sql, workbookFloor: number): Promise<number> {
  const counter = await sql.query<{ value: number | string }>(`SELECT value FROM id_counters WHERE name = 'activity'`);
  const rows = await sql.query<{ entity_id: string }>(`SELECT entity_id FROM activities`);
  let floor = Math.max(workbookFloor, Number(counter.rows[0]?.value || 0));
  for (const row of rows.rows) floor = Math.max(floor, numericSuffix("A-", row.entity_id));
  return floor;
}

/**
 * New ids sit above the database and above the workbook floor. Imported rows
 * are left where they are. The plan contains ids only.
 */
export async function planActivityRenumber(sql: Sql, workbookFloor = 0, ids: readonly string[] = COLLIDING_ACTIVITY_IDS): Promise<RenumberPlan> {
  const wanted = [...ids];
  const hits = await activityHits(sql, wanted);
  const skipped: { id: string; reason: string }[] = [];
  const moving: ActivityHit[] = [];
  for (const id of wanted) {
    const hit = hits.get(id);
    if (!hit) {
      skipped.push({ id, reason: "not in the database" });
      continue;
    }
    if (hit.source == null) {
      skipped.push({ id, reason: "no creating event" });
      continue;
    }
    if (importedFromWorkbook(hit.source)) {
      skipped.push({ id, reason: "imported from the workbook" });
      continue;
    }
    moving.push(hit);
  }
  let floor = await occupiedFloor(sql, workbookFloor);
  const moves: ActivityMove[] = [];
  for (const hit of moving) {
    floor += 1;
    moves.push({ from: hit.entity_id, to: formatEntityId("activity", floor) });
  }
  return { moves, skipped, nextFloor: floor };
}

export function formatRenumberPlan(plan: RenumberPlan): string {
  const lines = ["activity renumber"];
  for (const move of plan.moves) lines.push(`${move.from} -> ${move.to}`);
  for (const skip of plan.skipped) lines.push(`skipped ${skip.id} ${skip.reason}`);
  if (!plan.moves.length) lines.push("No rows to re-number.");
  lines.push(`next floor ${plan.nextFloor}`);
  return lines.join("\n");
}

/** Moves the projection and appends an event. Old events stay, because that log is append-only. */
export async function applyActivityRenumber(sql: Sql, workbookFloor = 0, ids: readonly string[] = COLLIDING_ACTIVITY_IDS): Promise<RenumberPlan> {
  await sql.exec("BEGIN");
  try {
    await sql.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, ["activity:new"]);
    const plan = await planActivityRenumber(sql, workbookFloor, ids);
    for (const move of plan.moves) {
      const updated = await sql.query<{ entity_id: string; site_id: string }>(
        `UPDATE activities SET entity_id = $2, updated_at = clock_timestamp() WHERE entity_id = $1 RETURNING entity_id, site_id`,
        [move.from, move.to],
      );
      const row = updated.rows[0];
      if (!row) throw new Error(`Activity ${move.from} was not updated.`);
      await sql.query(
        `UPDATE change_receipts
         SET response = replace(response::text, $1, $2)::jsonb
         WHERE position($1 in response::text) > 0`,
        [`"entity_id":"${move.from}"`, `"entity_id":"${move.to}"`],
      );
      await insertEvent(sql, {
        entityType: "activity",
        entityId: move.to,
        siteId: row.site_id,
        payload: { renumbered_from: move.from },
        source: "activity id renumber",
        actor: "workbook-mirror",
        idempotencyKey: `renumber-${move.from}-${move.to}`,
        runId: null,
      });
    }
    if (plan.nextFloor > 0) await raiseIdFloor(sql, "activity", plan.nextFloor);
    await sql.exec("COMMIT");
    return plan;
  } catch (error) {
    try {
      await sql.exec("ROLLBACK");
    } catch {
      // The connection already closed the transaction.
    }
    throw error;
  }
}
