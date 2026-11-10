import { dismissRecommendation } from "@/lib/agent/recommend";
import { isResponse, jsonOk, openActions, runWrite } from "@/lib/actions/http";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await openActions("viewer");
  if (isResponse(session)) return session;
  const { id } = await context.params;
  const result = await runWrite(session, { action: "recommendation.dismiss", targetId: id }, async (sql) => {
    await dismissRecommendation(sql, session.u, id);
    return { ok: true };
  });
  if (isResponse(result)) return result;
  return jsonOk(result);
}
