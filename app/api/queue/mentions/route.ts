import { isResponse, jsonError, jsonOk, openActions, runWrite } from "@/lib/actions/http";
import { clearMentionThread } from "@/lib/actions/mentions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const session = await openActions("viewer");
  if (isResponse(session)) return session;
  let body: { sourceId?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonError("The thread could not be read.", 400);
  }
  const result = await runWrite(session, { action: "queue.mention", targetId: body.sourceId }, (sql) =>
    clearMentionThread(sql, session.u, String(body.sourceId || "")),
  );
  if (isResponse(result)) return result;
  return jsonOk({ ok: true });
}
