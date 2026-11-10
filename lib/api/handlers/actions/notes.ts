import { isResponse, jsonError, jsonOk, openActions, runWrite } from "@/lib/actions/http";
import { createNote, listNotes } from "@/lib/actions/notes";
import { parseTarget } from "@/lib/actions/text";

export async function GET(request: Request) {
  const session = await openActions("viewer");
  if (isResponse(session)) return session;
  const url = new URL(request.url);
  let target: { targetKind: "site" | "deal" | "suggestion"; targetId: string };
  try {
    const kind = url.searchParams.get("targetKind");
    const id = String(url.searchParams.get("targetId") || "");
    target = kind === "suggestion"
      ? { targetKind: "suggestion", targetId: id }
      : parseTarget(kind, id);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Choose a site or a deal.", 400);
  }
  const notes = await runWrite(session, { action: "note.list" }, (sql) => listNotes(sql, target.targetKind, target.targetId));
  if (isResponse(notes)) return notes;
  return jsonOk({ notes });
}

export async function POST(request: Request) {
  const session = await openActions("contributor");
  if (isResponse(session)) return session;
  let body: { targetKind?: string; targetId?: string; body?: string; parentId?: string; mentions?: unknown; recommendationId?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonError("The note could not be read.", 400);
  }
  const note = await runWrite(session, { action: "note", targetKind: body.targetKind, targetId: body.targetId }, (sql) =>
    createNote(sql, {
      targetKind: (body.targetKind === "suggestion" ? "suggestion" : body.targetKind) as "site",
      targetId: String(body.targetId || ""),
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
