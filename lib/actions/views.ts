import { randomUUID } from "node:crypto";
import { assertClean, safeSnapshot } from "@/lib/policy/banned";
import { audit } from "./audit";
import type { Sql } from "./db";
import { cleanQuery, InputError, parseBody, stamp } from "./text";

export type SavedView = {
  id: string;
  name: string;
  query: string;
  ownerId: string;
  scope: "personal" | "team";
  createdAt: string;
  updatedAt: string;
};

type ViewRow = {
  id: string;
  name: string;
  url_query: string;
  owner_id: string;
  scope: "personal" | "team";
  created_at: Date | string;
  updated_at: Date | string;
};

function present(row: ViewRow): SavedView | null {
  const name = safeSnapshot(row.name);
  if (!name) return null;
  return {
    id: row.id,
    name,
    query: row.url_query,
    ownerId: row.owner_id,
    scope: row.scope,
    createdAt: stamp(row.created_at),
    updatedAt: stamp(row.updated_at),
  };
}

export async function listViews(sql: Sql, ownerId: string): Promise<SavedView[]> {
  const rows = await sql.query<ViewRow>(
    `SELECT id, name, url_query, owner_id, scope, created_at, updated_at
     FROM saved_views WHERE owner_id = $1 OR scope = 'team'
     ORDER BY name ASC, created_at ASC`,
    [ownerId],
  );
  return rows.rows.map(present).filter((row): row is SavedView => Boolean(row));
}

export async function createView(
  sql: Sql,
  input: { name: string; query: string; ownerId: string; scope: "personal" | "team"; allowTeam: boolean },
): Promise<SavedView> {
  const scope = input.scope === "team" ? "team" : "personal";
  if (scope === "team" && !input.allowTeam) throw new InputError("You do not have permission for that.", 403);
  const name = parseBody(input.name, "name", 80);
  assertClean(name);
  const query = cleanQuery(input.query);
  const id = randomUUID();
  await sql.query(
    `INSERT INTO saved_views (id, name, url_query, owner_id, scope) VALUES ($1, $2, $3, $4, $5)`,
    [id, name, query, input.ownerId, scope],
  );
  await audit(sql, {
    actorId: input.ownerId,
    action: "view.create",
    targetKind: "view",
    targetId: id,
    after: { id, name, query, scope },
  });
  const saved = await sql.query<ViewRow>(
    `SELECT id, name, url_query, owner_id, scope, created_at, updated_at FROM saved_views WHERE id = $1`,
    [id],
  );
  const view = present(saved.rows[0]);
  if (!view) throw new InputError("That view could not be saved.");
  return view;
}

export async function deleteView(sql: Sql, input: { id: string; actorId: string; canModerate: boolean }): Promise<void> {
  const existing = await sql.query<ViewRow>(
    `SELECT id, name, url_query, owner_id, scope, created_at, updated_at FROM saved_views WHERE id = $1`,
    [input.id],
  );
  const row = existing.rows[0];
  if (!row) throw new InputError("That view is not saved.", 404);
  const own = row.owner_id === input.actorId;
  if (!own && !(row.scope === "team" && input.canModerate)) {
    throw new InputError("You do not have permission for that.", 403);
  }
  await sql.query(`DELETE FROM saved_views WHERE id = $1`, [input.id]);
  await audit(sql, {
    actorId: input.actorId,
    action: "view.delete",
    targetKind: "view",
    targetId: input.id,
    before: { id: row.id, name: safeSnapshot(row.name), scope: row.scope, ownerId: row.owner_id },
  });
}
