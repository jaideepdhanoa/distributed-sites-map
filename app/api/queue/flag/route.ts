import { isResponse, jsonError, jsonOk, openActions, runWrite } from "@/lib/actions/http";
import { flagSite } from "@/lib/queue/load";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const session = await openActions("viewer");
  if (isResponse(session)) return session;
  let body: { siteId?: string; toUser?: string; note?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonError("The flag could not be read.", 400);
  }
  const result = await runWrite(session, { action: "queue.flag", targetId: body.siteId }, (sql) =>
    flagSite(sql, {
      fromUser: session.u,
      toUser: String(body.toUser || ""),
      siteId: String(body.siteId || ""),
      note: String(body.note || ""),
    }),
  );
  if (isResponse(result)) return result;
  return jsonOk({ ok: true });
}
