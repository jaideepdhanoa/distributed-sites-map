import { randomUUID } from "node:crypto";
import type { Sql } from "@/lib/actions/db";
import { insertEvent, numericSuffix, raiseIdFloor } from "./apply";
import { COMMS_FIELDS } from "./vocab";
import type { ActivityRow, CommsRow, StageRow, WorkbookSlice } from "./workbook";

export type BackfillCounts = {
  run_id: string;
  inserted: { stage: number; activity: number; comms: number };
  skipped: { stage: number; activity: number; comms: number };
};

const SOURCE = "workbook-snapshot";
const ACTOR = "workbook";

function shadowKey(entity: "stage" | "activity" | "comms", id: string): string {
  return `shadow:v1:${entity}:${id}`;
}

async function existingKeys(sql: Sql): Promise<Set<string>> {
  const result = await sql.query<{ idempotency_key: string }>(
    `SELECT idempotency_key FROM events WHERE idempotency_key LIKE 'shadow:v1:%'`,
  );
  return new Set(result.rows.map((row) => row.idempotency_key));
}

async function hasStage(sql: Sql, siteId: string): Promise<boolean> {
  const result = await sql.query<{ site_id: string }>(`SELECT site_id FROM site_stages WHERE site_id = $1`, [siteId]);
  return result.rows.length > 0;
}

async function hasEntity(sql: Sql, table: "activities" | "comms_entries", entityId: string): Promise<boolean> {
  const result = await sql.query<{ entity_id: string }>(`SELECT entity_id FROM ${table} WHERE entity_id = $1`, [entityId]);
  return result.rows.length > 0;
}

async function insertStage(sql: Sql, row: StageRow, runId: string): Promise<void> {
  await sql.query(
    `INSERT INTO site_stages (site_id, market, stage, service_area_class, reason, version, updated_by)
     VALUES ($1, $2, $3, $4, $5, 1, $6)`,
    [row.site_id, row.market, row.stage, row.service_area_class, row.reason, ACTOR],
  );
  await insertEvent(sql, {
    entityType: "stage",
    entityId: row.site_id,
    siteId: row.site_id,
    payload: {
      stage: row.stage,
      market: row.market,
      service_area_class: row.service_area_class,
      reason: row.reason,
    },
    source: SOURCE,
    actor: ACTOR,
    idempotencyKey: shadowKey("stage", row.site_id),
    runId,
  });
}

async function insertActivity(sql: Sql, row: ActivityRow, runId: string): Promise<void> {
  const payload = {
    date: row.date,
    type: row.type,
    summary: row.summary,
    source_link: row.source_link,
  };
  await sql.query(
    `INSERT INTO activities (entity_id, site_id, payload, version, updated_by) VALUES ($1, $2, $3::jsonb, 1, $4)`,
    [row.entity_id, row.site_id, JSON.stringify(payload), ACTOR],
  );
  await insertEvent(sql, {
    entityType: "activity",
    entityId: row.entity_id,
    siteId: row.site_id,
    payload,
    source: SOURCE,
    actor: ACTOR,
    idempotencyKey: shadowKey("activity", row.entity_id),
    runId,
  });
}

async function insertComms(sql: Sql, row: CommsRow, runId: string): Promise<void> {
  const payload: Record<string, string> = {};
  for (const field of COMMS_FIELDS) payload[field] = row[field];
  await sql.query(
    `INSERT INTO comms_entries (entity_id, site_id, payload, version, updated_by) VALUES ($1, $2, $3::jsonb, 1, $4)`,
    [row.entity_id, row.site_id, JSON.stringify(payload), ACTOR],
  );
  await insertEvent(sql, {
    entityType: "comms",
    entityId: row.entity_id,
    siteId: row.site_id,
    payload,
    source: SOURCE,
    actor: ACTOR,
    idempotencyKey: shadowKey("comms", row.entity_id),
    runId,
  });
}

/**
 * One-time copy of the workbook slice into events. A second run inserts nothing.
 * Rows already present from the API are left in place so this job does not
 * overwrite a version the write API owns. Re-running does not refresh a row
 * when the workbook later changes; the daily diff reports that drift.
 */
export async function importShadow(sql: Sql, slice: WorkbookSlice, label: string): Promise<BackfillCounts> {
  const counts: BackfillCounts = {
    run_id: "",
    inserted: { stage: 0, activity: 0, comms: 0 },
    skipped: { stage: 0, activity: 0, comms: 0 },
  };
  await sql.exec("BEGIN");
  try {
    const runId = `run_${randomUUID().replaceAll("-", "")}`;
    counts.run_id = runId;
    await sql.query(
      `INSERT INTO runs (id, actor, status, counts, notes) VALUES ($1, $2, 'running', '{}'::jsonb, $3)`,
      [runId, ACTOR, label.slice(0, 500)],
    );
    const keys = await existingKeys(sql);
    for (const row of slice.stages) {
      const key = shadowKey("stage", row.site_id);
      if (keys.has(key) || (await hasStage(sql, row.site_id))) {
        counts.skipped.stage += 1;
        continue;
      }
      await insertStage(sql, row, runId);
      counts.inserted.stage += 1;
    }
    for (const row of slice.activities) {
      const key = shadowKey("activity", row.entity_id);
      if (keys.has(key) || (await hasEntity(sql, "activities", row.entity_id))) {
        counts.skipped.activity += 1;
        continue;
      }
      await insertActivity(sql, row, runId);
      counts.inserted.activity += 1;
    }
    for (const row of slice.comms) {
      const key = shadowKey("comms", row.entity_id);
      if (keys.has(key) || (await hasEntity(sql, "comms_entries", row.entity_id))) {
        counts.skipped.comms += 1;
        continue;
      }
      await insertComms(sql, row, runId);
      counts.inserted.comms += 1;
    }
    const activityFloor = Math.max(
      0,
      ...slice.activities.map((row) => numericSuffix("A-", row.entity_id)),
    );
    const commsFloor = Math.max(0, ...slice.comms.map((row) => numericSuffix("CM-", row.entity_id)));
    await raiseIdFloor(sql, "activity", activityFloor);
    await raiseIdFloor(sql, "comms", commsFloor);
    await sql.query(
      `UPDATE runs SET status = 'succeeded', finished_at = clock_timestamp(), counts = $2::jsonb, notes = $3 WHERE id = $1`,
      [runId, JSON.stringify({ inserted: counts.inserted, skipped: counts.skipped }), label.slice(0, 500)],
    );
    await sql.exec("COMMIT");
    return counts;
  } catch (error) {
    try {
      await sql.exec("ROLLBACK");
    } catch {
      // The connection already closed the transaction.
    }
    throw error;
  }
}
