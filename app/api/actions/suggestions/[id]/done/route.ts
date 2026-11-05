import { isResponse, jsonError, jsonOk, openActions, runWrite } from "@/lib/actions/http";
import { canDecide } from "@/lib/actions/roles";
import { completeSuggestion } from "@/lib/actions/suggestions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await openActions("viewer");
  if (isResponse(session)) return session;
  const { id } = await context.params;
  const suggestion = await runWrite(session, { action: "suggestion.done", targetId: id }, (sql) =>
    completeSuggestion(sql, { id, actorId: session.u, reviewer: canDecide(session.actionRole) }),
  );
  if (isResponse(suggestion)) return suggestion;
  return jsonOk({ suggestion });
}
