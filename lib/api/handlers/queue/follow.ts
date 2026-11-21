import { isResponse, jsonError, jsonOk, openActions, runWrite } from "@/lib/actions/http";
import { permanentSiteId } from "@/lib/actions/suggestions";
import { setFollow } from "@/lib/queue/load";

const DEAL_ID = /^(PIPE|LAND)-[A-Z]{2,4}-\d{4}$/;

async function canonicalSiteId(raw: string): Promise<string> {
  const id = raw.trim();
  if (!id || DEAL_ID.test(id)) return id;
  return permanentSiteId("site", id);
}

export async function GET(request: Request) {
  const session = await openActions("viewer");
  if (isResponse(session)) return session;
  const requested = new URL(request.url).searchParams.get("siteId") || "";
  const result = await runWrite(session, { action: "queue.follow.read", targetId: requested }, async (sql) => {
    const siteId = await canonicalSiteId(requested);
    const rows = await sql.query<{ site_id: string }>(
      `SELECT site_id FROM queue_follows WHERE user_id = $1 AND site_id = $2`,
      [session.u, siteId],
    );
    return { follow: rows.rows.length > 0 };
  });
  if (isResponse(result)) return result;
  return jsonOk(result);
}

export async function POST(request: Request) {
  const session = await openActions("viewer");
  if (isResponse(session)) return session;
  let body: { siteId?: string; follow?: boolean };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonError("The follow could not be read.", 400);
  }
  const requested = String(body.siteId || "");
  const result = await runWrite(session, { action: "queue.follow", targetId: requested }, async (sql) => {
    const siteId = await canonicalSiteId(requested);
    await setFollow(sql, session.u, siteId, Boolean(body.follow));
  });
  if (isResponse(result)) return result;
  return jsonOk({ ok: true });
}
