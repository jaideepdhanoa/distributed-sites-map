import { listVisibleRecommendations } from "@/lib/agent/recommend";
import { isResponse, jsonError, jsonOk, openActions, runWrite } from "@/lib/actions/http";

export async function GET(request: Request) {
  const session = await openActions("viewer");
  if (isResponse(session)) return session;
  const recordId = new URL(request.url).searchParams.get("recordId")?.trim() || "";
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(recordId)) return jsonError("Choose a site or a deal.", 400);
  const recommendations = await runWrite(session, { action: "recommendation.list", targetId: recordId }, (sql) =>
    listVisibleRecommendations(sql, session.u, recordId),
  );
  if (isResponse(recommendations)) return recommendations;
  return jsonOk({ recommendations });
}
