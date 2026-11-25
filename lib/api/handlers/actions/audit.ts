import { listAudit, listAuditStageEvents, parseAuditTarget, readAuditStage, type AuditTarget } from "@/lib/actions/audit";
import { isResponse, jsonError, jsonOk, openActions, runWrite } from "@/lib/actions/http";
import { InputError } from "@/lib/actions/text";
import { SITE_ID } from "@/lib/changes/vocab";

export async function GET(request: Request) {
  const session = await openActions("reviewer");
  if (isResponse(session)) return session;
  let target: AuditTarget | undefined;
  try {
    target = parseAuditTarget(new URL(request.url).searchParams);
  } catch (error) {
    return jsonError(error instanceof InputError ? error.message : "Choose a site or a deal.", error instanceof InputError ? error.status : 400);
  }
  const payload = await runWrite(session, { action: "audit.list", ...target }, async (sql) => {
    const entries = await listAudit(sql, 100, target);
    if (target?.targetKind === "deal" && SITE_ID.test(target.targetId)) {
      return {
        entries,
        stage: await readAuditStage(sql, target.targetId),
        stageEvents: await listAuditStageEvents(sql, target.targetId),
      };
    }
    return { entries };
  });
  if (isResponse(payload)) return payload;
  return jsonOk(payload);
}
