import { audit } from "@/lib/actions/audit";
import { withSql } from "@/lib/actions/db";
import { isResponse, jsonError, jsonOk, openActions } from "@/lib/actions/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const session = await openActions("viewer");
  if (isResponse(session)) return session;
  let body: { kind?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonError("The export could not be read.", 400);
  }
  if (body.kind !== "table") return jsonError("Unknown export.", 400);
  try {
    await withSql((sql) => audit(sql, { actorId: session.u, action: "export", after: { kind: "table" } }));
  } catch {
    return jsonError("The export could not be recorded.", 500);
  }
  return jsonOk({ ok: true });
}
