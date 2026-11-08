import { randomUUID } from "node:crypto";
import { assertClean, safeSnapshot } from "@/lib/policy/banned";
import type { Sql } from "@/lib/actions/db";
import { stamp } from "@/lib/actions/text";

export async function recordAppEvent(
  sql: Sql,
  input: { siteId: string; type: "note" | "reply" | "next_proposed" | "next_accepted" | "next_rejected" | "document_request"; summary: string; actorId: string; refId?: string },
): Promise<void> {
  const summary = safeSnapshot(input.summary, 240);
  if (!summary) return;
  assertClean(summary);
  await sql.query(
    `INSERT INTO queue_events (id, site_id, type, summary, actor_id, ref_id) VALUES ($1, $2, $3, $4, $5, $6)`,
    [randomUUID(), input.siteId, input.type, summary, input.actorId, input.refId || null],
  );
}

export async function listAppEvents(sql: Sql): Promise<{ siteId: string; type: string; summary: string; at: string }[]> {
  const rows = await sql.query<{ site_id: string; type: string; summary: string; created_at: Date | string }>(
    `SELECT site_id, type, summary, created_at FROM queue_events ORDER BY created_at ASC`,
  );
  return rows.rows.map((row) => ({
    siteId: row.site_id,
    type: row.type,
    summary: safeSnapshot(row.summary, 240),
    at: stamp(row.created_at),
  })).filter((row) => row.summary);
}
