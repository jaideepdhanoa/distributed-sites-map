import type { Sql } from "./db";

export type AuditEntry = {
  actorId: string;
  action: string;
  targetKind?: string | null;
  targetId?: string | null;
  before?: unknown;
  after?: unknown;
};

export async function audit(sql: Sql, entry: AuditEntry): Promise<void> {
  await sql.query(
    `INSERT INTO audit_log (actor_id, action, target_kind, target_id, before_json, after_json)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb)`,
    [
      entry.actorId,
      entry.action,
      entry.targetKind ?? null,
      entry.targetId ?? null,
      JSON.stringify(entry.before ?? null),
      JSON.stringify(entry.after ?? null),
    ],
  );
}

export type AuditRow = {
  id: string;
  at: string;
  actorId: string;
  action: string;
  targetKind: string | null;
  targetId: string | null;
  before: unknown;
  after: unknown;
};

function stamp(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return value == null ? "" : String(value);
}

export async function listAudit(sql: Sql, limit = 100): Promise<AuditRow[]> {
  const rows = await sql.query<{
    id: string | number;
    at: Date | string;
    actor_id: string;
    action: string;
    target_kind: string | null;
    target_id: string | null;
    before_json: unknown;
    after_json: unknown;
  }>(
    `SELECT id, at, actor_id, action, target_kind, target_id, before_json, after_json
     FROM audit_log ORDER BY at DESC, id DESC LIMIT $1`,
    [Math.min(Math.max(limit, 1), 200)],
  );
  return rows.rows.map((row) => ({
    id: String(row.id),
    at: stamp(row.at),
    actorId: row.actor_id,
    action: row.action,
    targetKind: row.target_kind,
    targetId: row.target_id,
    before: row.before_json,
    after: row.after_json,
  }));
}
