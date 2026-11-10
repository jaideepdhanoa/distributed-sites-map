import { isResponse, jsonError, jsonOk, openActions } from "@/lib/actions/http";
import { loadPreferences, savePreferences } from "@/lib/alerts/preferences";
import { accountEmail } from "@/lib/alerts/recipients";

export async function GET() {
  const session = await openActions("viewer");
  if (isResponse(session)) return session;
  const result = await (await import("@/lib/actions/db")).withSql((sql) => loadPreferences(sql, session.u));
  if (!result) return jsonError("That account is not available.", 404);
  return jsonOk({ preferences: result, email: accountEmail(session.u) || "" });
}

export async function PUT(request: Request) {
  const session = await openActions("viewer");
  if (isResponse(session)) return session;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Those settings could not be read.", 400);
  }
  const { withSql } = await import("@/lib/actions/db");
  const saved = await withSql((sql) => savePreferences(sql, session.u, body));
  if (!saved) return jsonError("That account is not available.", 404);
  return jsonOk({ preferences: saved, email: accountEmail(session.u) || "" });
}
