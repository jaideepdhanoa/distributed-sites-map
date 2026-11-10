import { isResponse, jsonError, jsonOk, openActions, runWrite } from "@/lib/actions/http";
import { canDecide } from "@/lib/actions/roles";
import { clearSuggestionBlocker, decideSuggestion, reviseSuggestion } from "@/lib/actions/suggestions";

const OUTCOMES = ["accepted", "rejected", "agreed_waiting", "overtaken"] as const;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await openActions("reviewer");
  if (isResponse(session)) return session;
  const { id } = await context.params;
  let body: { status?: string; note?: string; reply?: string; recommendationId?: string; hold?: unknown; clearBlockerId?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonError("The decision could not be read.", 400);
  }
  if (body.clearBlockerId) {
    const suggestion = await runWrite(session, { action: "suggestion.blocker_clear", targetId: id }, (sql) =>
      clearSuggestionBlocker(sql, { id, blockerId: String(body.clearBlockerId), actorId: session.u }),
    );
    if (isResponse(suggestion)) return suggestion;
    return jsonOk({ suggestion });
  }
  if (!OUTCOMES.includes(body.status as (typeof OUTCOMES)[number])) {
    return jsonError("Choose accept, reject, agreed and waiting, or closed as overtaken.", 400);
  }
  const status = body.status as (typeof OUTCOMES)[number];
  const suggestion = await runWrite(session, { action: "suggestion.decide", targetId: id }, (sql) =>
    decideSuggestion(sql, { id, status, actorId: session.u, note: body.note, reply: body.reply, recommendationId: body.recommendationId, hold: body.hold }),
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
