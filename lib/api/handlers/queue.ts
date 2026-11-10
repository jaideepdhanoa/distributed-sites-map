import { isResponse, jsonError, jsonOk, openActions, runWrite } from "@/lib/actions/http";
import { canDecide } from "@/lib/actions/roles";
import { InputError } from "@/lib/actions/text";
import { loadQueue, markAllReviewed, markReviewed, undoReview } from "@/lib/queue/load";
import type { QueueFilters } from "@/lib/queue/order";

function filtersFrom(url: URL): QueueFilters {
  return {
    market: url.searchParams.get("market") || "all",
    stage: url.searchParams.get("stage") || "any",
    viable: url.searchParams.get("viable") !== "0",
    freshOnly: url.searchParams.get("fresh") === "1",
    flaggedOnly: url.searchParams.get("flagged") === "1",
    approvalOnly: url.searchParams.get("approve") === "1",
    mentionsOnly: url.searchParams.get("mentions") === "1",
    assignedOnly: url.searchParams.get("assigned") === "1",
  };
}

export async function GET(request: Request) {
  const session = await openActions("viewer");
  if (isResponse(session)) return session;
  try {
    const queue = await runWrite(session, { action: "queue.list" }, (sql) =>
      loadQueue(sql, session.u, filtersFrom(new URL(request.url)), canDecide(session.actionRole)),
    );
    if (isResponse(queue)) return queue;
    return jsonOk(queue);
  } catch {
    return jsonError("The queue could not be loaded.", 500);
  }
}

export async function POST(request: Request) {
  const session = await openActions("viewer");
  if (isResponse(session)) return session;
  let body: { all?: boolean; undo?: boolean; previous?: string | null; siteId?: string; market?: string; stage?: string; viable?: boolean; fresh?: boolean; flagged?: boolean; approve?: boolean; mentions?: boolean; assigned?: boolean };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonError("The review could not be read.", 400);
  }
  const result = await runWrite(session, { action: "queue.review", targetId: body.siteId }, async (sql) => {
    if (body.all) {
      const queue = await loadQueue(sql, session.u, {
        market: body.market || "all",
        stage: body.stage || "any",
        viable: body.viable !== false,
        freshOnly: Boolean(body.fresh),
        flaggedOnly: Boolean(body.flagged),
        approvalOnly: Boolean(body.approve),
        mentionsOnly: Boolean(body.mentions),
        assignedOnly: Boolean(body.assigned),
      }, canDecide(session.actionRole));
      const count = await markAllReviewed(sql, session.u, queue.items.map((item) => item.siteId));
      return { count };
    }
    const siteId = String(body.siteId || "").trim();
    if (!siteId) throw new InputError("Choose a site.");
    if (body.undo) {
      await undoReview(sql, session.u, siteId, body.previous ?? null);
      return { previous: null };
    }
    const previous = await markReviewed(sql, session.u, siteId);
    return { previous };
  });
  if (isResponse(result)) return result;
  return jsonOk({ ok: true, ...result });
}
