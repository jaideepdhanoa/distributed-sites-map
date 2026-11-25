import type { Sql } from "./db";
import { SITE_ID } from "@/lib/changes/vocab";
import { isProtectedId } from "@/lib/protectedSite";
import { InputError, parseTarget, type TargetKind } from "./text";

export type AuditTarget = { targetKind: TargetKind; targetId: string };

/** A partial or empty scope must never fall back to the full audit log. */
export function parseAuditTarget(params: URLSearchParams): AuditTarget | undefined {
  if (!params.has("targetKind") && !params.has("targetId")) return undefined;
  if (params.getAll("targetKind").length !== 1 || params.getAll("targetId").length !== 1) {
    throw new InputError("Choose a site or a deal and its record id.");
  }
  const target = parseTarget(params.get("targetKind"), params.get("targetId"));
  if (isProtectedId(target.targetId)) throw new InputError("Not found", 404);
  return target;
}

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

export async function listAudit(sql: Sql, limit = 100, target?: AuditTarget): Promise<AuditRow[]> {
  const values: unknown[] = [Math.min(Math.max(limit, 1), 200)];
  if (target) values.push(target.targetKind, target.targetId);
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
     FROM audit_log
     WHERE action NOT IN ('view.decision', 'view.decision.review')
     ${target ? "AND target_kind = $2 AND target_id = $3" : ""}
     ORDER BY at DESC, id DESC LIMIT $1`,
    values,
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

export type AuditStage = {
  siteId: string;
  stage: string;
  version: number;
  updatedBy: string;
  updatedAt: string;
};

/** The stored row only: missing stages are not filled from the snapshot. */
export async function readAuditStage(sql: Sql, siteId: string): Promise<AuditStage | null> {
  if (!SITE_ID.test(siteId) || isProtectedId(siteId)) return null;
  const rows = await sql.query<{
    site_id: string;
    stage: string;
    version: number | string;
    updated_by: string;
    updated_at: Date | string;
  }>(
    `SELECT site_id, stage, version, updated_by, updated_at FROM site_stages WHERE site_id = $1`,
    [siteId],
  );
  const row = rows.rows[0];
  return row ? {
    siteId: row.site_id,
    stage: row.stage,
    version: Number(row.version),
    updatedBy: row.updated_by,
    updatedAt: stamp(row.updated_at).replace(/Z$/, "+00:00"),
  } : null;
}

export type AuditStageEvent = {
  id: string;
  stage: string | null;
  previousStage: string | null;
  actor: string;
  source: string;
  createdAt: string;
};

/** Stage history for one deal. Payload details and idempotency keys stay private. */
export async function listAuditStageEvents(sql: Sql, siteId: string): Promise<AuditStageEvent[]> {
  if (!SITE_ID.test(siteId) || isProtectedId(siteId)) return [];
  const rows = await sql.query<{
    id: string;
    stage: string | null;
    previous_stage: string | null;
    actor: string;
    source: string;
    created_at: Date | string;
  }>(
    `SELECT id, payload->>'stage' AS stage, payload->>'previous_stage' AS previous_stage,
            actor, source, created_at
     FROM events WHERE site_id = $1 AND entity_type = 'stage'
     ORDER BY created_at DESC, id DESC LIMIT 100`,
    [siteId],
  );
  return rows.rows.map((row) => ({
    id: row.id,
    stage: row.stage,
    previousStage: row.previous_stage,
    actor: row.actor,
    source: row.source,
    createdAt: stamp(row.created_at).replace(/Z$/, "+00:00"),
  }));
}
