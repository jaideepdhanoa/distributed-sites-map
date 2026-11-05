import { isResponse, jsonError, jsonOk, openActions, runWrite } from "@/lib/actions/http";
import { snoozeSite } from "@/lib/queue/load";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const session = await openActions("viewer");
  if (isResponse(session)) return session;
  let body: { siteId?: string; until?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonError("The snooze could not be read.", 400);
  }
  const result = await runWrite(session, { action: "queue.snooze", targetId: body.siteId }, (sql) =>
    snoozeSite(sql, session.u, String(body.siteId || ""), String(body.until || "")),
  );
  if (isResponse(result)) return result;
  return jsonOk({ ok: true });
}
