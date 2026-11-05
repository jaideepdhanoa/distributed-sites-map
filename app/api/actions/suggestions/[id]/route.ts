import { isResponse, jsonError, jsonOk, openActions, runWrite } from "@/lib/actions/http";
import { canDecide } from "@/lib/actions/roles";
import { decideSuggestion, reviseSuggestion } from "@/lib/actions/suggestions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await openActions("reviewer");
  if (isResponse(session)) return session;
  const { id } = await context.params;
  let body: { status?: string; note?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonError("The decision could not be read.", 400);
  }
  if (body.status !== "accepted" && body.status !== "rejected") {
    return jsonError("A reviewer can accept or reject an open suggestion.", 400);
  }
  const suggestion = await runWrite(session, { action: "suggestion.decide", targetId: id }, (sql) =>
    decideSuggestion(sql, { id, status: body.status as "accepted" | "rejected", actorId: session.u, note: body.note }),
  );
  if (isResponse(suggestion)) return suggestion;
  return jsonOk({ suggestion });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await openActions("contributor");
  if (isResponse(session)) return session;
  const { id } = await context.params;
  let body: { title?: string; proposedValue?: string; reason?: string; detail?: string; targetOn?: string; ownerId?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonError("The next step could not be read.", 400);
  }
  const suggestion = await runWrite(session, { action: "suggestion.revise", targetId: id }, (sql) =>
    reviseSuggestion(sql, {
      id,
      actorId: session.u,
      reviewer: canDecide(session.actionRole),
      title: body.title,
      proposedValue: body.proposedValue,
      reason: body.reason,
      detail: body.detail,
      targetOn: body.targetOn,
      ownerId: body.ownerId,
    }),
  );
  if (isResponse(suggestion)) return suggestion;
  return jsonOk({ suggestion });
}
