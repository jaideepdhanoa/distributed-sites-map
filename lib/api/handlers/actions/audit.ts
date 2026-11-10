import { listAudit } from "@/lib/actions/audit";
import { isResponse, jsonOk, openActions, runWrite } from "@/lib/actions/http";

export async function GET() {
  const session = await openActions("reviewer");
  if (isResponse(session)) return session;
  const entries = await runWrite(session, { action: "audit.list" }, (sql) => listAudit(sql, 100));
  if (isResponse(entries)) return entries;
  return jsonOk({ entries });
}
