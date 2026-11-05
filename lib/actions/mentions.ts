import { randomUUID } from "node:crypto";
import { safeSnapshot } from "@/lib/policy/banned";
import { getUsers } from "@/lib/users";
import type { Sql } from "./db";
import { InputError } from "./text";

export type Mention = { id: string; name: string };

export function parseMentionIds(value: unknown): string[] {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new InputError("Choose an account from the list.");
  const known = new Set(getUsers().map((user) => user.u));
  const ids: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") throw new InputError("Choose an account from the list.");
    const id = item.trim().toLowerCase();
    if (!id) continue;
    if (!known.has(id)) throw new InputError("Choose an account from the list.");
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

export function mentionName(id: string): string {
  const account = getUsers().find((user) => user.u === id);
  const named = safeSnapshot(account?.displayName || id, 80);
  return named || id;
}

export async function replaceMentions(
  sql: Sql,
  input: { userIds: string[]; siteId: string; sourceKind: "note" | "suggestion"; sourceId: string },
): Promise<void> {
  await sql.query(`DELETE FROM mentions WHERE source_kind = $1 AND source_id = $2`, [input.sourceKind, input.sourceId]);
  for (const userId of input.userIds) {
    await sql.query(
      `INSERT INTO mentions (id, user_id, site_id, source_kind, source_id) VALUES ($1, $2, $3, $4, $5)`,
      [randomUUID(), userId, input.siteId, input.sourceKind, input.sourceId],
    );
  }
}

export async function mentionsBySource(
  sql: Sql,
  sourceKind: "note" | "suggestion",
  sourceIds: string[],
): Promise<Map<string, Mention[]>> {
  const map = new Map<string, Mention[]>();
  if (!sourceIds.length) return map;
  const placeholders = sourceIds.map((_, index) => `$${index + 2}`).join(", ");
  const rows = await sql.query<{ source_id: string; user_id: string }>(
    `SELECT source_id, user_id FROM mentions WHERE source_kind = $1 AND source_id IN (${placeholders}) ORDER BY created_at ASC, id ASC`,
    [sourceKind, ...sourceIds],
  );
  for (const row of rows.rows) {
    const list = map.get(row.source_id) || [];
    list.push({ id: row.user_id, name: mentionName(row.user_id) });
    map.set(row.source_id, list);
  }
  return map;
}

export async function openMentions(sql: Sql, userId: string): Promise<{ siteId: string; at: Date | string }[]> {
  const rows = await sql.query<{ site_id: string; created_at: Date | string }>(
    `SELECT site_id, MAX(created_at) AS created_at FROM mentions
     WHERE user_id = $1 AND cleared_at IS NULL GROUP BY site_id`,
    [userId],
  );
  return rows.rows.map((row) => ({ siteId: row.site_id, at: row.created_at }));
}

export async function clearMentionsForSite(sql: Sql, userId: string, siteId: string): Promise<void> {
  await sql.query(
    `UPDATE mentions SET cleared_at = now() WHERE user_id = $1 AND site_id = $2 AND cleared_at IS NULL`,
    [userId, siteId],
  );
}

export async function clearMentionThread(sql: Sql, userId: string, sourceId: string): Promise<void> {
  const id = String(sourceId || "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(id)) throw new InputError("That record id is not valid.");
  await sql.query(
    `UPDATE mentions SET cleared_at = now()
     WHERE user_id = $1 AND cleared_at IS NULL AND (
       source_id = $2 OR source_id IN (SELECT id FROM notes WHERE parent_id = $2)
     )`,
    [userId, id],
  );
}
