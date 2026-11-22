import { isResponse, jsonError, jsonOk, openActions, runWrite } from "@/lib/actions/http";
import { createNote, listNotes, type ThreadKind } from "@/lib/actions/notes";
import { roleAllows } from "@/lib/actions/roles";
import { InputError, parseTarget } from "@/lib/actions/text";
import { SPACE_ID } from "@/lib/spaces/vocab";

function parseNoteTarget(kind: string | null, id: string): { targetKind: ThreadKind; targetId: string } {
  if (kind === "suggestion") {
    const targetId = id.trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(targetId)) throw new InputError("That record id is not valid.");
    return { targetKind: "suggestion", targetId };
  }
  if (kind === "site_space") {
    const targetId = id.trim();
    if (!SPACE_ID.test(targetId)) throw new InputError("That record id is not valid.");
    return { targetKind: "site_space", targetId };
  }
  if (kind === "nda") {
    const targetId = id.trim().toUpperCase();
    if (!/^NDA-\d{3,}$/.test(targetId)) throw new InputError("That record id is not valid.");
    return { targetKind: "nda", targetId };
  }
  return parseTarget(kind, id);
}

export async function GET(request: Request) {
  const session = await openActions("viewer");
  if (isResponse(session)) return session;
  const url = new URL(request.url);
  let target: { targetKind: ThreadKind; targetId: string };
  try {
    target = parseNoteTarget(url.searchParams.get("targetKind"), String(url.searchParams.get("targetId") || ""));
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Choose a site or a deal.", 400);
  }
  const notes = await runWrite(session, { action: "note.list" }, (sql) => listNotes(sql, target.targetKind, target.targetId));
  if (isResponse(notes)) return notes;
  return jsonOk({ notes });
}

export async function POST(request: Request) {
  const session = await openActions("viewer");
  if (isResponse(session)) return session;
  let body: { targetKind?: string; targetId?: string; body?: string; parentId?: string; mentions?: unknown; recommendationId?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonError("The note could not be read.", 400);
  }
  let target: { targetKind: ThreadKind; targetId: string };
  try {
    target = parseNoteTarget(body.targetKind || "", String(body.targetId || ""));
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Choose a site or a deal.", 400);
  }
  if (target.targetKind !== "site_space" && !roleAllows(session.actionRole, "contributor")) {
    return jsonError("You do not have permission for that.", 403);
  }
  const note = await runWrite(session, { action: "note", targetKind: target.targetKind, targetId: target.targetId }, (sql) =>
    createNote(sql, {
      targetKind: target.targetKind,
      targetId: target.targetId,
      body: String(body.body || ""),
      authorId: session.u,
      parentId: body.parentId,
      mentions: body.mentions,
      recommendationId: body.recommendationId,
    }),
  );
  if (isResponse(note)) return note;
  return jsonOk({ note }, 201);
}
