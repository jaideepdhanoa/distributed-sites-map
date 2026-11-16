import type { Sql } from "./actions/db";
import { isLayoutSurface, sanitizeLayout, type ListLayout, type LayoutSurface } from "./listLayout";

const USER_ID = /^[a-z0-9._-]{1,80}$/;

export function layoutUserId(value: string): string | null {
  const id = value.trim().toLowerCase();
  return USER_ID.test(id) ? id : null;
}

export function missingLayoutTable(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "42P01");
}

export async function loadListLayout(sql: Sql, userId: string, surface: LayoutSurface, allowed: string[]): Promise<ListLayout | null> {
  const id = layoutUserId(userId);
  if (!id || !isLayoutSurface(surface)) return null;
  const result = await sql.query<{ layout: unknown }>(
    "SELECT layout FROM list_layouts WHERE user_id = $1 AND surface = $2",
    [id, surface],
  );
  const row = result.rows[0];
  if (!row) return null;
  return sanitizeLayout(row.layout, allowed);
}

export async function saveListLayout(
  sql: Sql,
  userId: string,
  surface: LayoutSurface,
  layout: ListLayout,
  allowed: string[],
): Promise<ListLayout | null> {
  const id = layoutUserId(userId);
  if (!id || !isLayoutSurface(surface)) return null;
  const clean = sanitizeLayout(layout, allowed);
  const body = JSON.stringify(clean);
  if (body.length > 8000) return null;
  await sql.query(
    `INSERT INTO list_layouts (user_id, surface, layout, updated_at)
     VALUES ($1, $2, $3::jsonb, now())
     ON CONFLICT (user_id, surface)
     DO UPDATE SET layout = EXCLUDED.layout, updated_at = now()`,
    [id, surface, body],
  );
  return clean;
}
