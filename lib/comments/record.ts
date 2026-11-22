import { audit } from "@/lib/actions/audit";
import type { Sql } from "@/lib/actions/db";
import { replaceMentions } from "@/lib/actions/mentions";
import { InputError, parseBody } from "@/lib/actions/text";
import { isExcludedSite } from "@/lib/alerts/excluded";
import { notifyNote } from "@/lib/alerts/notify";
import { recordAppEvent } from "@/lib/queue/events";
import { SPACE_ID, spaceTypeLabel, type SpaceType } from "@/lib/spaces/vocab";
import { isCommentLine, suggestBrokerQuestion, type CommentAnchor, type CommentTag, type OpenPnlComment } from "./anchor";

export type CommentWrite = {
  siteId: string;
  parentId: string | null;
  anchor: CommentAnchor | null;
  body: string | null;
  tag: CommentTag | null;
  mentions: string[] | null;
  resolved: boolean | null;
  actor: string;
  at: string;
};

export type StoredComment = {
  ok: true;
  id: string;
  version: number;
  anchor: CommentAnchor;
  tag: CommentTag | "";
  resolved: boolean;
};

type NoteRow = {
  id: string;
  target_id: string;
  parent_id: string | null;
  body: string;
  author_id: string;
  anchor_type: CommentAnchor["type"] | null;
  anchor_line: string;
  anchor_period: string;
  anchor_space_id: string;
  anchor_label: string;
  tag: string;
  version: number | string | null;
  resolved_at: Date | string | null;
  deleted_at: Date | string | null;
  created_at_iso: string;
};

const MIGRATION = "Comment threads are not on this database yet. Production migrations run from the Production migrations workflow.";

export function missingCommentColumn(error: unknown): boolean {
  const code = (error as { code?: string }).code;
  return code === "42703" || code === "42P01";
}

function anchorFrom(row: Pick<NoteRow, "target_id" | "anchor_type" | "anchor_line" | "anchor_period" | "anchor_space_id" | "anchor_label">): CommentAnchor | null {
  if (row.anchor_type !== "pnl_cell" && row.anchor_type !== "pnl_line" && row.anchor_type !== "space" && row.anchor_type !== "nda") return null;
  return {
    type: row.anchor_type,
    siteId: row.target_id,
    line: row.anchor_line || "",
    period: row.anchor_period || "",
    spaceId: row.anchor_space_id || "",
    label: row.anchor_label || "",
  };
}

async function readRow(sql: Sql, id: string): Promise<NoteRow | null> {
  const rows = await sql.query<NoteRow>(
    `SELECT id, target_id, parent_id, body, author_id, anchor_type, anchor_line, anchor_period,
            anchor_space_id, anchor_label, tag, version, resolved_at, deleted_at, created_at_iso
     FROM notes WHERE id = $1`,
    [id],
  );
  return rows.rows[0] || null;
}

async function spaceLabel(sql: Sql, siteId: string, spaceId: string): Promise<string> {
  if (!SPACE_ID.test(spaceId)) throw new InputError("That lot is not on the map.", 404, "space_id");
  const rows = await sql.query<{ site_id: string; type: SpaceType }>(
    `SELECT site_id, type FROM site_spaces WHERE id = $1 AND deleted_at IS NULL`,
    [spaceId],
  );
  const row = rows.rows[0];
  if (!row || row.site_id !== siteId) throw new InputError("That lot is not on this site.", 404, "space_id");
  return spaceTypeLabel(row.type);
}

export async function storeComment(
  sql: Sql,
  entityId: string,
  input: CommentWrite,
  expectedVersion: number,
): Promise<StoredComment | { ok: false; id: string; version: number }> {
  if (isExcludedSite(input.siteId)) throw new InputError("That site is not written here.", 403, "site_id");
  try {
    if (expectedVersion === 0) return await insertComment(sql, entityId, input);
    return await updateComment(sql, entityId, input, expectedVersion);
  } catch (error) {
    if (missingCommentColumn(error)) throw new InputError(MIGRATION, 503);
    throw error;
  }
}

async function insertComment(sql: Sql, entityId: string, input: CommentWrite): Promise<StoredComment> {
  if (input.resolved) throw new InputError("Resolve the thread after it exists.", 400, "resolved");
  const body = parseBody(input.body, "comment", 2000);
  const mentions = input.mentions || [];
  let anchor: CommentAnchor;
  let tag: CommentTag | "" = "";
  let parentId: string | null = null;
  if (input.parentId) {
    const parent = await readRow(sql, input.parentId);
    if (!parent || parent.deleted_at) throw new InputError("That thread is not available.", 404, "parent_id");
    if (parent.parent_id) throw new InputError("Replies stay one level deep.", 400, "parent_id");
    if (parent.target_id !== input.siteId) throw new InputError("A reply stays on the same record.", 400, "site_id");
    const parentAnchor = anchorFrom(parent);
    if (!parentAnchor) throw new InputError("A reply stays on the same thread.", 400, "parent_id");
    anchor = parentAnchor;
    parentId = parent.id;
  } else {
    if (!input.anchor) throw new InputError("A comment needs a P&L cell, a P&L line, a lot, or an NDA.", 400, "anchor");
    anchor = await checkedAnchor(sql, input.siteId, input.anchor);
    tag = input.tag || "investigate";
  }
  await sql.query(
    `INSERT INTO notes (
       id, entity_id, target_kind, target_id, parent_id, body, author_id,
       anchor_type, anchor_line, anchor_period, anchor_space_id, anchor_label, tag,
       version, created_at, created_at_iso, updated_at_iso
     ) VALUES (
       $1, $1, 'site', $2, $3, $4, $5,
       $6, $7, $8, $9, $10, $11,
       1, $12::timestamptz, $13, $13
     )`,
    [
      entityId, input.siteId, parentId, body, input.actor,
      anchor.type, anchor.line, anchor.period, anchor.spaceId, anchor.label, tag, input.at, input.at,
    ],
  );
  await replaceMentions(sql, { userIds: mentions, siteId: input.siteId, sourceKind: "note", sourceId: entityId });
  await audit(sql, {
    actorId: input.actor,
    action: parentId ? "note.reply" : "note.create",
    targetKind: "site",
    targetId: input.siteId,
    after: { id: entityId, parentId, anchor, tag, mentions },
  });
  await recordAppEvent(sql, {
    siteId: input.siteId,
    type: parentId ? "reply" : "note",
    summary: parentId ? "New reply." : "New note.",
    actorId: input.actor,
    refId: entityId,
  });
  const { autoFollow } = await import("@/lib/queue/follow");
  await autoFollow(sql, input.actor, input.siteId);
  await notifyNote(sql, {
    noteId: entityId,
    siteId: input.siteId,
    recordId: anchor.type === "space" ? anchor.spaceId : input.siteId,
    body,
    authorId: input.actor,
    parentId,
    mentionIds: mentions,
  });
  return { ok: true, id: entityId, version: 1, anchor, tag, resolved: false };
}

async function checkedAnchor(sql: Sql, siteId: string, anchor: CommentAnchor): Promise<CommentAnchor> {
  if (anchor.type === "nda") {
    const id = anchor.line.trim().toUpperCase();
    if (!/^NDA-\d{3,}$/.test(id) || siteId.toUpperCase() !== id) {
      throw new InputError("An NDA comment stays on that agreement.", 400, "line");
    }
    return { type: "nda", siteId: id, line: id, period: "", spaceId: "", label: id };
  }
  if (anchor.type === "space") {
    const label = await spaceLabel(sql, siteId, anchor.spaceId);
    return { type: "space", siteId, line: "", period: "", spaceId: anchor.spaceId, label };
  }
  if (!isCommentLine(anchor.line)) throw new InputError("That line is not in the chart of accounts.", 400, "line");
  if (anchor.type === "pnl_line") return { type: "pnl_line", siteId, line: anchor.line, period: "", spaceId: "", label: "" };
  if (!anchor.period.trim()) throw new InputError("A cell comment needs a period.", 400, "period");
  return { type: "pnl_cell", siteId, line: anchor.line, period: anchor.period.trim(), spaceId: "", label: "" };
}

async function updateComment(
  sql: Sql,
  entityId: string,
  input: CommentWrite,
  expectedVersion: number,
): Promise<StoredComment | { ok: false; id: string; version: number }> {
  const current = await readRow(sql, entityId);
  if (!current || current.deleted_at) throw new InputError(`Unknown comment ${entityId}.`, 404, "entity_id");
  if (current.target_id !== input.siteId) throw new InputError("A comment stays on the site it was opened for.", 400, "site_id");
  const anchor = anchorFrom(current);
  if (!anchor) throw new InputError("That note is not an anchored thread.", 400, "entity_id");
  if (Number(current.version) !== expectedVersion) return { ok: false, id: entityId, version: Number(current.version) };
  if (current.parent_id && (input.tag || input.resolved != null)) {
    throw new InputError("Tag and resolve apply to the thread, not a reply.", 400, "parent_id");
  }
  const body = input.body == null ? current.body : parseBody(input.body, "comment", 2000);
  const tag = (input.tag || current.tag || "") as CommentTag | "";
  const resolved = input.resolved == null ? Boolean(current.resolved_at) : input.resolved;
  const updated = await sql.query<{ id: string }>(
    `UPDATE notes SET
       body = $3,
       tag = $4,
       resolved_at = CASE WHEN $5 THEN $6::timestamptz ELSE NULL END,
       resolved_by = CASE WHEN $5 THEN $7 ELSE NULL END,
       updated_at = $6::timestamptz,
       updated_at_iso = $8,
       version = version + 1
     WHERE id = $1 AND version = $2 AND deleted_at IS NULL
     RETURNING id`,
    [entityId, expectedVersion, body, tag, resolved, input.at, input.actor, input.at],
  );
  if (!updated.rows.length) {
    const again = await readRow(sql, entityId);
    return { ok: false, id: entityId, version: Number(again?.version || expectedVersion) };
  }
  if (input.mentions) {
    await replaceMentions(sql, { userIds: input.mentions, siteId: input.siteId, sourceKind: "note", sourceId: entityId });
  }
  await audit(sql, {
    actorId: input.actor,
    action: input.resolved == null ? "note.edit" : input.resolved ? "note.resolve" : "note.reopen",
    targetKind: "site",
    targetId: input.siteId,
    before: { id: entityId, tag: current.tag, resolved: Boolean(current.resolved_at) },
    after: { id: entityId, tag, resolved },
  });
  return { ok: true, id: entityId, version: expectedVersion + 1, anchor, tag, resolved };
}

export async function loadOpenPnlComments(sql: Sql, siteIds: string[]): Promise<OpenPnlComment[]> {
  if (!siteIds.length) return [];
  try {
    const rows = await sql.query<{ anchor_type: "pnl_cell" | "pnl_line"; anchor_line: string; anchor_period: string }>(
      `SELECT anchor_type, anchor_line, anchor_period
       FROM notes
       WHERE target_id = ANY($1::text[])
         AND anchor_type IN ('pnl_cell', 'pnl_line')
         AND parent_id IS NULL
         AND deleted_at IS NULL
         AND resolved_at IS NULL
       ORDER BY created_at ASC, id ASC`,
      [siteIds],
    );
    return rows.rows.map((row) => ({ type: row.anchor_type, line: row.anchor_line, period: row.anchor_period }));
  } catch (error) {
    if (missingCommentColumn(error)) return [];
    throw error;
  }
}

export async function loadOpenSpaceIds(sql: Sql): Promise<string[]> {
  try {
    const rows = await sql.query<{ anchor_space_id: string }>(
      `SELECT DISTINCT anchor_space_id
       FROM notes
       WHERE anchor_type = 'space'
         AND parent_id IS NULL
         AND deleted_at IS NULL
         AND resolved_at IS NULL
         AND anchor_space_id <> ''`,
    );
    return rows.rows.map((row) => row.anchor_space_id);
  } catch (error) {
    if (missingCommentColumn(error)) return [];
    throw error;
  }
}

export async function countOpenThreads(sql: Sql): Promise<number> {
  try {
    const rows = await sql.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM notes
       WHERE anchor_type IS NOT NULL
         AND parent_id IS NULL
         AND deleted_at IS NULL
         AND resolved_at IS NULL`,
    );
    return Number(rows.rows[0]?.count ?? 0);
  } catch (error) {
    if (missingCommentColumn(error)) return 0;
    throw error;
  }
}

export type OpenThreadRow = {
  id: string;
  siteId: string;
  anchor: CommentAnchor;
  tag: string;
  createdAt: string;
};

export async function loadOpenThreads(sql: Sql): Promise<OpenThreadRow[]> {
  try {
    const rows = await sql.query<NoteRow & { created_at_iso: string }>(
      `SELECT id, target_id, parent_id, body, author_id, anchor_type, anchor_line, anchor_period,
              anchor_space_id, anchor_label, tag, version, resolved_at, deleted_at, created_at_iso
       FROM notes
       WHERE anchor_type IS NOT NULL
         AND parent_id IS NULL
         AND deleted_at IS NULL
         AND resolved_at IS NULL
       ORDER BY created_at ASC, id ASC`,
    );
    return rows.rows.flatMap((row) => {
      const anchor = anchorFrom(row);
      if (!anchor) return [];
      return [{ id: row.id, siteId: row.target_id, anchor, tag: row.tag, createdAt: row.created_at_iso }];
    });
  } catch (error) {
    if (missingCommentColumn(error)) return [];
    throw error;
  }
}
