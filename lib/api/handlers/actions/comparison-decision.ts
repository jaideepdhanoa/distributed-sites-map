import { openActions, isResponse, jsonOk, jsonError, runWrite } from "@/lib/actions/http";
import { createWithReceipt } from "@/lib/actions/createReceipt";
import { readDecision, saveDecision } from "@/lib/actions/viewDecision";
export async function GET(request: Request) {
  const session = await openActions("viewer");
  if (isResponse(session)) return session;
  const id = new URL(request.url).searchParams.get("view") || "";
  const result = await runWrite(session, { action: "view.decision.read" }, sql => readDecision(sql, id, session.u, session.actionRole !== "viewer"));
  return isResponse(result) ? result : jsonOk(result);
}
export async function POST(request: Request) {
  const session = await openActions("contributor");
  if (isResponse(session)) return session;
  const body = await request.json().catch(() => null);
  if (!body || typeof body.view !== "string" || !request.headers.get("Idempotency-Key")) return jsonError("Invalid decision or save reference.", 400);
  const result = await runWrite(session, { action: "view.decision" }, sql =>
    createWithReceipt(sql, request, session.u, body, tx => saveDecision(tx, body.view, session.u, body.decision, body.version || "")));
  return isResponse(result) ? result : jsonOk(result);
}
