import { listOpenNeeds } from "@/lib/actions/blockers";
import { isResponse, jsonError, jsonOk, openActions, runWrite } from "@/lib/actions/http";
import { createSuggestion, listSuggestions, reconcileSuggestions } from "@/lib/actions/suggestions";
import { InputError, parseTarget, type TargetKind } from "@/lib/actions/text";

function targetFilter(url: URL): { targetKind?: TargetKind; targetId?: string } {
  const kind = url.searchParams.get("targetKind");
  const id = url.searchParams.get("targetId");
  if (!kind && !id) return {};
  return parseTarget(kind, id);
}

export async function GET(request: Request) {
  const session = await openActions("viewer");
  if (isResponse(session)) return session;
  let filter: { targetKind?: TargetKind; targetId?: string } = {};
  try {
    filter = targetFilter(new URL(request.url));
  } catch (error) {
    return jsonError(error instanceof InputError ? error.message : "Choose a site or a deal.", 400);
  }
  const payload = await runWrite(session, { action: "suggestion.list" }, async (sql) => {
    await reconcileSuggestions(sql);
    const suggestions = await listSuggestions(sql, filter);
    const needs = filter.targetKind && filter.targetId ? await listOpenNeeds(sql, filter.targetKind, filter.targetId) : [];
    return { suggestions, needs };
  });
  if (isResponse(payload)) return payload;
  return jsonOk(payload);
}

export async function POST(request: Request) {
  const session = await openActions("contributor");
  if (isResponse(session)) return session;
  let body: { targetKind?: string; targetId?: string; field?: string; detail?: string; proposedValue?: string; reason?: string; title?: string; targetOn?: string; ownerId?: string; mentions?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonError("The suggestion could not be read.", 400);
  }
  const suggestion = await runWrite(
    session,
    { action: "suggestion", targetKind: body.targetKind, targetId: body.targetId },
    (sql) =>
      createSuggestion(sql, {
        targetKind: body.targetKind as "site",
        targetId: String(body.targetId || ""),
        field: String(body.field || ""),
        detail: body.detail,
        proposedValue: String(body.proposedValue || body.title || ""),
        reason: String(body.reason || ""),
        authorId: session.u,
        title: body.title,
        targetOn: body.targetOn,
        ownerId: body.ownerId,
        mentions: body.mentions,
      }),
  );
  if (isResponse(suggestion)) return suggestion;
  return jsonOk({ suggestion }, 201);
}
