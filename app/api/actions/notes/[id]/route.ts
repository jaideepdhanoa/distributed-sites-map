import { isResponse, jsonError, jsonOk, openActions, runWrite } from "@/lib/actions/http";
import { deleteNote, editNote } from "@/lib/actions/notes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await openActions("contributor");
  if (isResponse(session)) return session;
  const { id } = await context.params;
  let body: { body?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonError("The note could not be read.", 400);
  }
  const note = await runWrite(session, { action: "note.edit", targetId: id }, (sql) =>
    editNote(sql, { id, body: String(body.body || ""), actorId: session.u }),
  );
  if (isResponse(note)) return note;
  return jsonOk({ note });
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await openActions("contributor");
  if (isResponse(session)) return session;
  const { id } = await context.params;
  const result = await runWrite(session, { action: "note.delete", targetId: id }, (sql) =>
    deleteNote(sql, { id, actorId: session.u }),
  );
  if (isResponse(result)) return result;
  return jsonOk({ ok: true });
}
