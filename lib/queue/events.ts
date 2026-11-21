import { randomUUID } from "node:crypto";
import { assertClean, safeSnapshot } from "@/lib/policy/banned";
import type { Sql } from "@/lib/actions/db";
import { stamp } from "@/lib/actions/text";
import { pacificToday } from "./today";

export type AppEventType = "note" | "reply" | "next_proposed" | "next_accepted" | "next_rejected" | "document_request" | "bring_back" | "drop_suggested" | "drop" | "proposal_closed" | "stage_repair";

export async function recordAppEvent(
  sql: Sql,
  input: { siteId: string; type: AppEventType; summary: string; actorId: string; refId?: string; max?: number; eventAt?: string | null },
): Promise<void> {
  const summary = safeSnapshot(input.summary, input.max ?? 240);
  if (!summary) return;
  assertClean(summary);
  const id = randomUUID();
  const values = [id, input.siteId, input.type, summary, input.actorId, input.refId || null, input.eventAt || null];
  try {
    await sql.query(
      `INSERT INTO queue_events (id, site_id, type, summary, actor_id, ref_id, event_at) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      values,
    );
  } catch (error) {
    const missing = error instanceof Error && /event_at/.test(error.message);
    if (!missing) throw error;
    await sql.query(
      `INSERT INTO queue_events (id, site_id, type, summary, actor_id, ref_id) VALUES ($1, $2, $3, $4, $5, $6)`,
      values.slice(0, 6),
    );
  }
}

export async function listAppEvents(sql: Sql): Promise<{ siteId: string; type: string; summary: string; at: string }[]> {
  let rows: { site_id: string; type: string; summary: string; created_at: Date | string; event_at?: Date | string | null }[];
  try {
    const selected = await sql.query<{ site_id: string; type: string; summary: string; created_at: Date | string; event_at: Date | string | null }>(
      `SELECT site_id, type, summary, created_at, event_at FROM queue_events ORDER BY COALESCE(event_at, created_at) ASC`,
    );
    rows = selected.rows;
  } catch (error) {
    const missing = error instanceof Error && /event_at/.test(error.message);
    if (!missing) throw error;
    const selected = await sql.query<{ site_id: string; type: string; summary: string; created_at: Date | string }>(
      `SELECT site_id, type, summary, created_at FROM queue_events ORDER BY created_at ASC`,
    );
    rows = selected.rows;
  }
  return rows.map((row) => ({
    siteId: row.site_id,
    type: row.type,
    summary: safeSnapshot(row.summary, 240),
    at: stamp(row.event_at || row.created_at),
  })).filter((row) => row.summary);
}

export type BringBackHistory = { siteId: string; summary: string; at: string; eventId: string };

function eventDay(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return pacificToday(date);
}

export type RecordedHistory = { siteId: string; type: string; summary: string; at: string; eventId: string };

const HISTORY_TYPES = ["bring_back", "drop", "drop_suggested", "stage_repair"];

export async function listRecordedHistory(sql: Sql, ids: string[], types: string[] = HISTORY_TYPES): Promise<RecordedHistory[]> {
  const wanted = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
  const kinds = [...new Set(types.map((type) => type.trim()).filter((type) => HISTORY_TYPES.includes(type)))];
  if (!wanted.length || !kinds.length) return [];
  const rows = await sql.query<{ id: string; site_id: string; type: string; summary: string; created_at: Date | string }>(
    `SELECT id, site_id, type, summary, created_at
     FROM queue_events
     WHERE type = ANY($2::text[]) AND site_id = ANY($1::text[])
     ORDER BY created_at DESC, id DESC`,
    [wanted, kinds],
  );
  return rows.rows.flatMap((row) => {
    const summary = safeSnapshot(row.summary, 2400);
    const at = eventDay(row.created_at);
    if (!summary || !/^\d{4}-\d{2}-\d{2}$/.test(at)) return [];
    return [{ siteId: row.site_id, type: row.type, summary, at, eventId: row.id }];
  });
}

export async function listBringBackHistory(sql: Sql, ids: string[]): Promise<BringBackHistory[]> {
  const rows = await listRecordedHistory(sql, ids, ["bring_back"]);
  return rows.map(({ siteId, summary, at, eventId }) => ({ siteId, summary, at, eventId }));
}
