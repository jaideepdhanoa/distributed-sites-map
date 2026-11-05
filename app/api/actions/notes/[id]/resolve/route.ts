import { isResponse, jsonOk, openActions, runWrite } from "@/lib/actions/http";
import { resolveNote } from "@/lib/actions/notes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await openActions("reviewer");
  if (isResponse(session)) return session;
  const { id } = await context.params;
  const note = await runWrite(session, { action: "note.resolve", targetId: id }, (sql) =>
    resolveNote(sql, { id, actorId: session.u }),
  );
  if (isResponse(note)) return note;
  return jsonOk({ note });
}
