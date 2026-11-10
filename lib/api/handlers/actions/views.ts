import { isResponse, jsonError, jsonOk, openActions, runWrite } from "@/lib/actions/http";
import { canDecide } from "@/lib/actions/roles";
import { createView, listViews } from "@/lib/actions/views";

export async function GET() {
  const session = await openActions("viewer");
  if (isResponse(session)) return session;
  const views = await runWrite(session, { action: "view.list" }, (sql) => listViews(sql, session.u));
  if (isResponse(views)) return views;
  return jsonOk({ views });
}

export async function POST(request: Request) {
  const session = await openActions("viewer");
  if (isResponse(session)) return session;
  let body: { name?: string; query?: string; scope?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonError("The view could not be read.", 400);
  }
  const view = await runWrite(session, { action: "view" }, (sql) =>
    createView(sql, {
      name: String(body.name || ""),
      query: String(body.query || ""),
      ownerId: session.u,
      scope: body.scope === "team" ? "team" : "personal",
      allowTeam: canDecide(session.actionRole),
    }),
  );
  if (isResponse(view)) return view;
  return jsonOk({ view }, 201);
}
