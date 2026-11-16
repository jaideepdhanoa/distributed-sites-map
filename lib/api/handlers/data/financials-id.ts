import { NextResponse } from "next/server";
import { canReadFinancials } from "@/lib/agent/access";
import { actionsEnabled, withSql, type Sql } from "@/lib/actions/db";
import { isSession, privateHeaders, requireUser } from "@/lib/guard";
import { loadFinancialPanel } from "@/lib/financialsLoad";
import { demoStatement } from "@/lib/pnl/demo";
import { loadConflicts } from "@/lib/conflicts/record";
import type { DataConflict } from "@/lib/conflicts/view";
import { linkedPnlIds, loadPnlStatement } from "@/lib/pnl/read";
import { emptyStatement, unavailableStatement, type PnlStatement } from "@/lib/pnl/statement";
import { loadWorkbookStep } from "@/lib/workbookStepLoad";
import { fileLookup, recordLinks } from "@/lib/actions/records";
import type { DealProps } from "@/lib/types";

/** This response is computed per request. A cached copy must not stand in for it. */
export function financialsHeaders(): Record<string, string> {
  const sha = process.env.VERCEL_GIT_COMMIT_SHA?.trim() || "";
  return {
    ...privateHeaders,
    "Cache-Control": "private, no-store, max-age=0, must-revalidate",
    "CDN-Cache-Control": "no-store",
    "Vercel-CDN-Cache-Control": "no-store",
    ...(sha ? { "x-build-sha": sha } : {}),
  };
}

/** The pnl object GET /api/data/financials/:id returns after the session check. */
export async function loadFinancialsPayload(
  sql: Sql,
  id: string,
  links: { dealId: string; siteId: string }[],
): Promise<{ pnl: PnlStatement; conflicts: DataConflict[]; pnlDemo: boolean }> {
  const ids = linkedPnlIds(id, links);
  const [pnlResult, conflictResult] = await Promise.all([
    loadPnlStatement(sql, ids).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    ),
    loadConflicts(sql, ids).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    ),
  ]);
  let pnl = pnlResult.ok ? pnlResult.value : unavailableStatement();
  const conflicts = conflictResult.ok ? conflictResult.value : [];
  const demo = pnl.status === "ready" ? null : ids.reduce<ReturnType<typeof demoStatement>>((found, item) => found || demoStatement(item), null);
  if (demo) pnl = demo;
  return { pnl, conflicts, pnlDemo: Boolean(demo) };
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireUser();
  if (!isSession(session)) return session;
  if (!canReadFinancials(session.actionRole)) {
    return NextResponse.json({ error: "You do not have permission for that." }, { status: 403, headers: privateHeaders });
  }
  const { id } = await context.params;
  const links = await recordLinks();
  const ids = linkedPnlIds(id, links);
  const deal = (await fileLookup())("deal", ids.find((item) => item.startsWith("PIPE-") || item.startsWith("LAND-")) || id) as DealProps | null;
  if (!deal) return NextResponse.json({ error: "Not found" }, { status: 404, headers: financialsHeaders() });
  const panel = loadFinancialPanel(deal, true);
  const workbookStep = loadWorkbookStep(deal.deal_id);
  const loaded = actionsEnabled()
    ? await withSql((sql) => loadFinancialsPayload(sql, id, links)).catch((error: unknown) => {
      console.error(JSON.stringify({ event: "pnl_read_error", name: error instanceof Error ? error.name : "error" }));
      return { pnl: unavailableStatement(), conflicts: [] as DataConflict[], pnlDemo: false };
    })
    : { pnl: emptyStatement(), conflicts: [] as DataConflict[], pnlDemo: false };
  console.info(JSON.stringify({ event: "data", user: session.u, part: "financials", id }));
  return NextResponse.json({ ...panel, workbookStep, ...loaded }, { headers: financialsHeaders() });
}
