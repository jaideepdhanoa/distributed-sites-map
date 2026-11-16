import { InputError } from "@/lib/actions/text";
import type { Sql } from "@/lib/actions/db";
import type { ConflictSource, ConflictStatus, ConflictSubject, DataConflict } from "./view";

type ConflictRow = {
  entity_id: string;
  site_id: string;
  subject: ConflictSubject;
  field_key: string;
  period_key: string;
  source_a_value: string;
  source_a_document: string;
  source_a_page: string;
  source_b_value: string;
  source_b_document: string;
  source_b_page: string;
  value_in_use: string;
  status: ConflictStatus;
  resolution_note: string;
  created_by: string;
  updated_by: string;
  created_at_iso: string;
  updated_at_iso: string;
  version: number;
};

export type ConflictWrite = {
  siteId: string;
  subject: ConflictSubject;
  field: string;
  period: string;
  sources: [ConflictSource, ConflictSource];
  valueInUse: string;
  status: ConflictStatus;
  resolutionNote: string;
  actor: string;
  at: string;
};

const READ = `SELECT entity_id, site_id, subject, field_key, period_key,
  source_a_value, source_a_document, source_a_page,
  source_b_value, source_b_document, source_b_page,
  value_in_use, status, resolution_note, created_by, updated_by,
  created_at_iso, updated_at_iso, version
  FROM data_conflicts`;

function view(row: ConflictRow): DataConflict {
  return {
    id: row.entity_id,
    siteId: row.site_id,
    subject: row.subject,
    field: row.field_key,
    period: row.period_key,
    sources: [
      { value: row.source_a_value, document: row.source_a_document, page: row.source_a_page },
      { value: row.source_b_value, document: row.source_b_document, page: row.source_b_page },
    ],
    valueInUse: row.value_in_use,
    status: row.status,
    resolutionNote: row.resolution_note,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: row.created_at_iso,
    updatedAt: row.updated_at_iso,
    version: Number(row.version),
  };
}

async function queryRows(sql: Sql, text: string, params: unknown[]): Promise<DataConflict[]> {
  try {
    const rows = await sql.query<ConflictRow>(text, params);
    return rows.rows.map(view);
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "42P01") return [];
    throw error;
  }
}

export async function loadConflicts(sql: Sql, siteIds: string[]): Promise<DataConflict[]> {
  if (!siteIds.length) return [];
  return queryRows(sql, `${READ} WHERE site_id = ANY($1::text[]) ORDER BY created_at ASC, entity_id ASC`, [siteIds]);
}

export async function loadOpenConflicts(sql: Sql): Promise<DataConflict[]> {
  return queryRows(
    sql,
    `${READ} WHERE status IN ('open', 'asked_broker') ORDER BY created_at ASC, entity_id ASC`,
    [],
  );
}

export async function countOpenConflicts(sql: Sql): Promise<number> {
  try {
    const rows = await sql.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM data_conflicts WHERE status IN ('open', 'asked_broker')`,
    );
    return Number(rows.rows[0]?.count ?? 0);
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "42P01") return 0;
    throw error;
  }
}

export async function readConflict(sql: Sql, entityId: string): Promise<DataConflict | null> {
  const rows = await queryRows(sql, `${READ} WHERE entity_id = $1`, [entityId]);
  return rows[0] ?? null;
}

async function openOther(
  sql: Sql,
  input: ConflictWrite,
  entityId: string,
): Promise<{ id: string; version: number } | null> {
  const open = await sql.query<{ entity_id: string; version: number }>(
    `SELECT entity_id, version FROM data_conflicts
     WHERE site_id = $1 AND subject = $2 AND field_key = $3 AND period_key = $4
       AND status <> 'resolved' AND entity_id <> $5`,
    [input.siteId, input.subject, input.field, input.period, entityId],
  );
  const row = open.rows[0];
  return row ? { id: row.entity_id, version: Number(row.version) } : null;
}

export async function storeConflict(
  sql: Sql,
  entityId: string,
  input: ConflictWrite,
  expectedVersion: number,
): Promise<{ record: DataConflict } | { conflict: { id: string; version: number } }> {
  const other = await openOther(sql, input, entityId);
  if (other) return { conflict: other };

  if (expectedVersion === 0) {
    try {
      await sql.query(
        `INSERT INTO data_conflicts (
           entity_id, site_id, subject, field_key, period_key,
           source_a_value, source_a_document, source_a_page,
           source_b_value, source_b_document, source_b_page,
           value_in_use, status, resolution_note,
           created_by, updated_by, created_at_iso, updated_at_iso, version
         ) VALUES (
           $1, $2, $3, $4, $5,
           $6, $7, $8,
           $9, $10, $11,
           $12, $13, $14,
           $15, $15, $16, $16, 1
         )`,
        [
          entityId, input.siteId, input.subject, input.field, input.period,
          input.sources[0].value, input.sources[0].document, input.sources[0].page,
          input.sources[1].value, input.sources[1].document, input.sources[1].page,
          input.valueInUse, input.status, input.resolutionNote,
          input.actor, input.at,
        ],
      );
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code !== "23505") throw error;
      const raced = await openOther(sql, input, entityId);
      if (raced) return { conflict: raced };
      throw error;
    }
    const record = await readConflict(sql, entityId);
    if (!record) throw new Error("Conflict was not stored.");
    return { record };
  }

  const current = await sql.query<{ site_id: string; version: number }>(
    `SELECT site_id, version FROM data_conflicts WHERE entity_id = $1`,
    [entityId],
  );
  if (!current.rows.length) throw new InputError(`Unknown data_conflict ${entityId}.`, 404, "entity_id");
  if (current.rows[0]!.site_id !== input.siteId) {
    throw new InputError("A conflict stays on the site it was opened for.", 400, "site_id");
  }
  const updated = await sql.query<{ entity_id: string }>(
    `UPDATE data_conflicts SET
       source_a_value = $3, source_a_document = $4, source_a_page = $5,
       source_b_value = $6, source_b_document = $7, source_b_page = $8,
       value_in_use = $9, status = $10, resolution_note = $11,
       updated_by = $12, updated_at = now(), updated_at_iso = $13,
       version = version + 1
     WHERE entity_id = $1 AND version = $2
     RETURNING entity_id`,
    [
      entityId, expectedVersion,
      input.sources[0].value, input.sources[0].document, input.sources[0].page,
      input.sources[1].value, input.sources[1].document, input.sources[1].page,
      input.valueInUse, input.status, input.resolutionNote,
      input.actor, input.at,
    ],
  );
  if (!updated.rows.length) return { conflict: { id: entityId, version: Number(current.rows[0]!.version) } };
  const record = await readConflict(sql, entityId);
  if (!record) throw new Error("Conflict was not stored.");
  return { record };
}
