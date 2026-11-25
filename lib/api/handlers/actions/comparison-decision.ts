import { openActions, isResponse, jsonOk, jsonError, runWrite } from "@/lib/actions/http";
import { createWithReceipt } from "@/lib/actions/createReceipt";
import { readDecision, saveDecision } from "@/lib/actions/viewDecision";
import { decisionReviews, keepDecision, verifyDecisionReview } from "@/lib/actions/decisionReview";
import { loadDecisionCatalog } from "@/lib/actions/decisionCatalog";
import { isStatementMeasure } from "@/lib/pnl/citation";
import { evidenceChanged } from "@/lib/comparisonDecision";
import { InputError } from "@/lib/actions/text";
import type { CitedFigure } from "@/lib/comparisonDecision";

export async function GET(request: Request) {
  const session = await openActions("viewer");
  if (isResponse(session)) return session;
  const params = new URL(request.url).searchParams;
  const view = params.get("view") || "";
  const queue = params.get("queue") === "1";
  const access = await runWrite(session, { action:"view.decision.read" }, async sql => {
    if (!queue) return readDecision(sql, view, session.u, session.actionRole !== "viewer");
    const result = await sql.query<{ found:boolean }>(
      `SELECT EXISTS(SELECT 1 FROM saved_views v JOIN audit_log a ON a.target_id=v.id AND a.target_kind='view'
       AND a.action='view.decision' WHERE v.owner_id=$1 OR v.scope='team') AS found`, [session.u]);
    return { found:result.rows[0].found };
  });
  if (isResponse(access)) return access;
  if ("found" in access ? !access.found : !access.decision) return jsonOk(queue ? { items:[] } : { ...access, reviews:[] });
  // Map reads use the same small SQL pool. Release it before loading the catalog.
  const catalog = await loadDecisionCatalog(session.actionRole).catch(() => null);
  if (!catalog) return jsonError("Current decision evidence is unavailable.", 503);
  const reviews = await runWrite(session, { action:"view.decision.read" }, sql => decisionReviews(sql, session.u, async () => catalog, queue ? "" : view));
  if (isResponse(reviews)) return reviews;
  if ("decision" in access && reviews.some(item => item.version !== access.decision?.version))
    return jsonError("This decision changed. Reload it to see the latest review.", 409);
  return jsonOk(queue ? { items:reviews.filter(item => item.reason) } : { ...access, reviews });
}

export async function POST(request: Request) {
  const session = await openActions("contributor");
  if (isResponse(session)) return session;
  const body = await request.json().catch(() => null);
  if (!body || typeof body.view !== "string" || !request.headers.get("Idempotency-Key")) return jsonError("Invalid decision or save reference.", 400);
  const draft = body.decision?.citations;
  const financial = (c:CitedFigure) => isStatementMeasure(c?.measure) || (Boolean(c?.source) && ["cash_flow","revenue","ebitda"].includes(c?.measure));
  const hasFinancial = Array.isArray(draft) && draft.some(financial);
  if (hasFinancial && draft.length > 6) return jsonError("Cite one to six figures.",400);
  const catalog = body.review || body.keep || hasFinancial ? await loadDecisionCatalog(session.actionRole).catch(() => null) : undefined;
  if (catalog === null) return jsonError("Current decision evidence is unavailable.", 503);
  const result = await runWrite(session, { action:"view.decision" }, sql =>
    createWithReceipt(sql, request, session.u, body, async tx => {
      if (catalog && hasFinancial) {
        if (draft.some(c => !c || typeof c.measure !== "string")) throw new InputError("Invalid citation.");
        await catalog.prepareStatements(tx,draft);
        for (const c of draft.filter(financial)) {
          const live = catalog.figure(c);
          const wrongPeriod = isStatementMeasure(c.measure) && (!live || !("anchor" in live) || !c.anchor || c.anchor !== live.anchor || c.value === "—");
          if (!live || wrongPeriod || c.source !== (live.source || "Deal record") || evidenceChanged(c,live))
            throw new InputError("The financial figure changed. Reload the comparison.",409);
        }
      }
      if (catalog && (body.review || body.keep)) {
        if (typeof body.review?.key !== "string" || typeof body.review?.token !== "string") throw new InputError("Choose a change to review.");
        const item = await verifyDecisionReview(tx, session.u, body.view, body.review.key, body.review.token, async () => catalog);
        if (body.keep) {
          await keepDecision(tx, session.u, item, body.version);
          return readDecision(tx, body.view, session.u, true);
        }
        if (!Array.isArray(body.decision?.citations) || !body.decision.citations.length || body.decision.citations.length > 6)
          throw new InputError("Cite one to six figures.");
        for (const c of body.decision.citations as CitedFigure[]) {
          if (!c || [c.value,c.period,c.basis].some(value => typeof value !== "string")) throw new InputError("Invalid cited figure.");
          const live = catalog.figure(c);
          if (!live || evidenceChanged(c, live)) throw new InputError("A cited figure changed. Refresh before revising.", 409);
        }
        return saveDecision(tx, body.view, session.u, body.decision, body.version || "", item);
      }
      return saveDecision(tx, body.view, session.u, body.decision, body.version || "");
    }));
  return isResponse(result) ? result : jsonOk(result);
}
