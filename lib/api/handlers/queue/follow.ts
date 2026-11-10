import { isResponse, jsonError, jsonOk, openActions, runWrite } from "@/lib/actions/http";
import { setFollow } from "@/lib/queue/load";

export async function POST(request: Request) {
  const session = await openActions("viewer");
  if (isResponse(session)) return session;
  let body: { siteId?: string; follow?: boolean };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonError("The follow could not be read.", 400);
  }
  const result = await runWrite(session, { action: "queue.follow", targetId: body.siteId }, (sql) =>
    setFollow(sql, session.u, String(body.siteId || ""), Boolean(body.follow)),
  );
  if (isResponse(result)) return result;
  return jsonOk({ ok: true });
}
