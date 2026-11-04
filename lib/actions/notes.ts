import { randomUUID } from "node:crypto";
import { assertClean, safeSnapshot } from "@/lib/policy/banned";
import { audit } from "./audit";
import type { Sql } from "./db";
import { fileLookup, recordField, type RecordLookup } from "./records";
import { InputError, parseBody, parseTarget, stamp, type TargetKind } from "./text";

export type Note = {
  id: string;
  targetKind: TargetKind;
  targetId: string;
  body: string;
  authorId: string;
  createdAt: string;
};

type NoteRow = {
  id: string;
  target_kind: TargetKind;
  target_id: string;
  body: string;
  author_id: string;
  created_at: Date | string;
};

function present(row: NoteRow): Note | null {
  const body = safeSnapshot(row.body);
  if (!body) return null;
  return {
    id: row.id,
    targetKind: row.target_kind,
    targetId: row.target_id,
    body,
    authorId: row.author_id,
    createdAt: stamp(row.created_at),
  };
}

export async function listNotes(sql: Sql, targetKind: TargetKind, targetId: string): Promise<Note[]> {
  const rows = await sql.query<NoteRow>(
    `SELECT id, target_kind, target_id, body, author_id, created_at
     FROM notes WHERE target_kind = $1 AND target_id = $2 ORDER BY created_at ASC, id ASC`,
    [targetKind, targetId],
  );
  return rows.rows.map(present).filter((row): row is Note => Boolean(row));
}

export async function createNote(
  sql: Sql,
  input: { targetKind: TargetKind; targetId: string; body: string; authorId: string },
  lookup: RecordLookup = fileLookup(),
): Promise<Note> {
  const target = parseTarget(input.targetKind, input.targetId);
  if (!lookup(target.targetKind, target.targetId)) throw new InputError("That site or deal is not on the map.", 404);
  const body = parseBody(input.body, "note", 2000);
  assertClean(body);
  const id = randomUUID();
  await sql.query(
    `INSERT INTO notes (id, target_kind, target_id, body, author_id) VALUES ($1, $2, $3, $4, $5)`,
    [id, target.targetKind, target.targetId, body, input.authorId],
  );
  await audit(sql, {
    actorId: input.authorId,
    action: "note.create",
    targetKind: target.targetKind,
    targetId: target.targetId,
    after: { id, body },
  });
  const saved = await sql.query<NoteRow>(
    `SELECT id, target_kind, target_id, body, author_id, created_at FROM notes WHERE id = $1`,
    [id],
  );
  const note = present(saved.rows[0]);
  if (!note) throw new InputError("That note could not be saved.");
  return note;
}
