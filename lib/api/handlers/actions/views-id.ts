import { isResponse, jsonOk, openActions, runWrite } from "@/lib/actions/http";
import { canDecide } from "@/lib/actions/roles";
import { deleteView } from "@/lib/actions/views";

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await openActions("viewer");
  if (isResponse(session)) return session;
  const { id } = await context.params;
  const result = await runWrite(session, { action: "view.delete", targetKind: "view", targetId: id }, (sql) =>
    deleteView(sql, { id, actorId: session.u, canModerate: canDecide(session.actionRole) }),
  );
  if (isResponse(result)) return result;
  return jsonOk({ ok: true });
}
