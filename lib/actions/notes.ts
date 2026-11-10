import { randomUUID } from "node:crypto";
import { assertClean, safeSnapshot } from "@/lib/policy/banned";
import { audit } from "./audit";
import type { Sql } from "./db";
import { mentionsBySource, parseMentionIds, replaceMentions, type Mention } from "./mentions";
import { attachRecommendation } from "@/lib/agent/recommend";
import { notifyNote } from "@/lib/alerts/notify";
import { recordAppEvent } from "@/lib/queue/events";
import { fileLookup, type RecordLookup } from "./records";
import { permanentSiteId } from "./suggestions";
import { InputError, parseBody, parseTarget, stamp, type TargetKind } from "./text";

export type ThreadKind = TargetKind | "suggestion";

export type Note = {
  id: string;
  targetKind: ThreadKind;
  targetId: string;
  parentId: string | null;
  body: string;
  authorId: string;
  createdAt: string;
  updatedAt: string | null;
  deleted: boolean;
  resolvedAt: string | null;
  resolvedBy: string | null;
  mentions: Mention[];
};

type NoteRow = {
  id: string;
  target_kind: ThreadKind;
  target_id: string;
  parent_id: string | null;
  body: string;
  author_id: string;
  created_at: Date | string;
  updated_at: Date | string | null;
  deleted_at: Date | string | null;
  resolved_at: Date | string | null;
  resolved_by: string | null;
};

const SELECT = `id, target_kind, target_id, parent_id, body, author_id, created_at, updated_at, deleted_at, resolved_at, resolved_by`;

function present(row: NoteRow): Note | null {
  const deleted = Boolean(row.deleted_at);
  const body = deleted ? "" : safeSnapshot(row.body);
  if (!deleted && !body) return null;
  return {
    id: row.id,
    targetKind: row.target_kind,
    targetId: row.target_id,
    parentId: row.parent_id,
    body,
    authorId: row.author_id,
    createdAt: stamp(row.created_at),
    updatedAt: row.updated_at ? stamp(row.updated_at) : null,
    deleted,
    resolvedAt: row.resolved_at ? stamp(row.resolved_at) : null,
    resolvedBy: row.resolved_by,
    mentions: [],
  };
}

async function withMentions(sql: Sql, notes: Note[]): Promise<Note[]> {
  const map = await mentionsBySource(sql, "note", notes.map((note) => note.id));
  return notes.map((note) => ({ ...note, mentions: map.get(note.id) || [] }));
}

async function queueSiteId(sql: Sql, targetKind: ThreadKind, targetId: string): Promise<string> {
  if (targetKind === "suggestion") {
    const found = await sql.query<{ target_kind: "site" | "deal"; target_id: string }>(
      `SELECT target_kind, target_id FROM suggestions WHERE id = $1`,
      [targetId],
    );
    const row = found.rows[0];
    if (!row) return targetId;
    return permanentSiteId(row.target_kind, row.target_id);
  }
  return permanentSiteId(targetKind, targetId);
}

async function loadNote(sql: Sql, id: string): Promise<NoteRow | null> {
  const rows = await sql.query<NoteRow>(`SELECT ${SELECT} FROM notes WHERE id = $1`, [id]);
  return rows.rows[0] || null;
}

export async function listNotes(sql: Sql, targetKind: ThreadKind, targetId: string): Promise<Note[]> {
  const rows = await sql.query<NoteRow>(
    `SELECT ${SELECT} FROM notes WHERE target_kind = $1 AND target_id = $2 ORDER BY created_at ASC, id ASC`,
    [targetKind, targetId],
  );
  const notes = rows.rows.map(present).filter((row): row is Note => Boolean(row));
  return withMentions(sql, notes);
}

export async function createNote(
  sql: Sql,
  input: { targetKind: ThreadKind; targetId: string; body: string; authorId: string; parentId?: string | null; mentions?: unknown; recommendationId?: string | null },
  lookup: RecordLookup = fileLookup(),
): Promise<Note> {
  const parentId = input.parentId?.trim() || null;
  let targetKind = input.targetKind;
  let targetId = input.targetId;
  if (targetKind === "suggestion") {
    const target = String(targetId || "").trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(target)) throw new InputError("That record id is not valid.");
    const found = await sql.query(`SELECT id FROM suggestions WHERE id = $1`, [target]);
    if (!found.rows.length) throw new InputError("That proposal is not in the queue.", 404);
    if (parentId) throw new InputError("Replies on a proposal stay one level deep.");
    targetId = target;
  } else {
    const target = parseTarget(targetKind, targetId);
    if (!lookup(target.targetKind, target.targetId)) throw new InputError("That site or deal is not on the map.", 404);
    targetKind = target.targetKind;
    targetId = target.targetId;
  }
  if (parentId) {
    const parent = await loadNote(sql, parentId);
    if (!parent || parent.deleted_at) throw new InputError("That note is not available.", 404);
    if (parent.parent_id) throw new InputError("Replies stay one level deep.");
    if (parent.target_kind !== targetKind || parent.target_id !== targetId) {
      throw new InputError("A reply stays on the same record.");
    }
  }
  const body = parseBody(input.body, "note", 2000);
  assertClean(body);
  const mentionIds = parseMentionIds(input.mentions);
  const attached = await attachRecommendation(sql, {
    recommendationId: input.recommendationId,
    actorId: input.authorId,
    kind: "reply",
  });
  const id = randomUUID();
  await sql.query(
    `INSERT INTO notes (id, target_kind, target_id, parent_id, body, author_id, recommendation_id, drafted_by_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [id, targetKind, targetId, parentId, body, input.authorId, attached.recommendationId, attached.draftedByAgent],
  );
  await audit(sql, {
    actorId: input.authorId,
    action: parentId ? "note.reply" : "note.create",
    targetKind,
    targetId,
    after: { id, parentId, body, mentions: mentionIds, recommendationId: attached.recommendationId, draftedByAgent: attached.draftedByAgent },
  });
  const siteId = await queueSiteId(sql, targetKind, targetId);
  await replaceMentions(sql, { userIds: mentionIds, siteId, sourceKind: "note", sourceId: id });
  await recordAppEvent(sql, {
    siteId,
    type: parentId ? "reply" : "note",
    summary: parentId ? "New reply." : "New note.",
    actorId: input.authorId,
    refId: id,
  });
  await notifyNote(sql, {
    noteId: id,
    siteId,
    recordId: targetId,
    body,
    authorId: input.authorId,
    parentId,
    mentionIds,
  });
  const saved = await loadNote(sql, id);
  const note = saved ? present(saved) : null;
  if (!note) throw new InputError("That note could not be saved.");
  return (await withMentions(sql, [note]))[0];
}

export async function editNote(sql: Sql, input: { id: string; body: string; actorId: string; mentions?: unknown }): Promise<Note> {
  const row = await loadNote(sql, input.id);
  if (!row || row.deleted_at) throw new InputError("That note is not available.", 404);
  if (row.author_id !== input.actorId) throw new InputError("You do not have permission for that.", 403);
  const body = parseBody(input.body, "note", 2000);
  assertClean(body);
  const mentionIds = input.mentions === undefined ? null : parseMentionIds(input.mentions);
  await sql.query(`UPDATE notes SET body = $2, updated_at = now() WHERE id = $1`, [input.id, body]);
  if (mentionIds) {
    const siteId = await queueSiteId(sql, row.target_kind, row.target_id);
    await replaceMentions(sql, { userIds: mentionIds, siteId, sourceKind: "note", sourceId: row.id });
    await notifyNote(sql, {
      noteId: row.id,
      siteId,
      recordId: row.target_id,
      body,
      authorId: input.actorId,
      parentId: row.parent_id,
      mentionIds,
    });
  }
  await audit(sql, {
    actorId: input.actorId,
    action: "note.edit",
    targetKind: row.target_kind,
    targetId: row.target_id,
    before: { id: row.id, body: safeSnapshot(row.body) },
    after: { id: row.id, body },
  });
  const saved = await loadNote(sql, input.id);
  const note = saved ? present(saved) : null;
  if (!note) throw new InputError("That note could not be saved.");
  return (await withMentions(sql, [note]))[0];
}

export async function deleteNote(sql: Sql, input: { id: string; actorId: string }): Promise<void> {
  const row = await loadNote(sql, input.id);
  if (!row || row.deleted_at) throw new InputError("That note is not available.", 404);
  if (row.author_id !== input.actorId) throw new InputError("You do not have permission for that.", 403);
  await sql.query(`UPDATE notes SET deleted_at = now() WHERE id = $1`, [input.id]);
  await audit(sql, {
    actorId: input.actorId,
    action: "note.delete",
    targetKind: row.target_kind,
    targetId: row.target_id,
    before: { id: row.id, body: safeSnapshot(row.body) },
    after: { id: row.id, deleted: true },
  });
}

export async function resolveNote(sql: Sql, input: { id: string; actorId: string }): Promise<Note> {
  const row = await loadNote(sql, input.id);
  if (!row || row.deleted_at) throw new InputError("That note is not available.", 404);
  if (row.parent_id) throw new InputError("Resolve the thread, not a reply.");
  if (row.resolved_at) throw new InputError("That thread is already resolved.");
  await sql.query(`UPDATE notes SET resolved_at = now(), resolved_by = $2 WHERE id = $1`, [input.id, input.actorId]);
  await audit(sql, {
    actorId: input.actorId,
    action: "note.resolve",
    targetKind: row.target_kind,
    targetId: row.target_id,
    before: { id: row.id, resolved: false },
    after: { id: row.id, resolved: true },
  });
  const saved = await loadNote(sql, input.id);
  const note = saved ? present(saved) : null;
  if (!note) throw new InputError("That thread could not be resolved.");
  return (await withMentions(sql, [note]))[0];
}

export async function reopenNote(sql: Sql, input: { id: string; actorId: string }): Promise<Note> {
  const row = await loadNote(sql, input.id);
  if (!row || row.deleted_at) throw new InputError("That note is not available.", 404);
  if (row.parent_id) throw new InputError("Reopen the thread, not a reply.");
  if (!row.resolved_at) throw new InputError("That thread is already open.");
  await sql.query(`UPDATE notes SET resolved_at = NULL, resolved_by = NULL WHERE id = $1`, [input.id]);
  await audit(sql, {
    actorId: input.actorId,
    action: "note.reopen",
    targetKind: row.target_kind,
    targetId: row.target_id,
    before: { id: row.id, resolved: true },
    after: { id: row.id, resolved: false },
  });
  const saved = await loadNote(sql, input.id);
  const note = saved ? present(saved) : null;
  if (!note) throw new InputError("That thread could not be reopened.");
  return (await withMentions(sql, [note]))[0];
}
