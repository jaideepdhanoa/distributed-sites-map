import { isResponse, jsonError, jsonOk, openActions, runWrite } from "@/lib/actions/http";
import { createSuggestion, listSuggestions, reconcileSuggestions } from "@/lib/actions/suggestions";
import { InputError, parseTarget, type TargetKind } from "@/lib/actions/text";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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
  const suggestions = await runWrite(session, { action: "suggestion.list" }, async (sql) => {
    await reconcileSuggestions(sql);
    return listSuggestions(sql, filter);
  });
  if (isResponse(suggestions)) return suggestions;
  return jsonOk({ suggestions });
}

export async function POST(request: Request) {
  const session = await openActions("contributor");
  if (isResponse(session)) return session;
  let body: { targetKind?: string; targetId?: string; field?: string; detail?: string; proposedValue?: string; reason?: string };
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
        proposedValue: String(body.proposedValue || ""),
        reason: String(body.reason || ""),
        authorId: session.u,
      }),
  );
  if (isResponse(suggestion)) return suggestion;
  return jsonOk({ suggestion }, 201);
}
