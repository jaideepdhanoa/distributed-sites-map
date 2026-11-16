import { NextResponse } from "next/server";
import { canReadFinancials } from "@/lib/agent/access";
import { actionsEnabled, withSql } from "@/lib/actions/db";
import { isSession, privateHeaders, requireUser } from "@/lib/guard";
import { loadFinancialPanel } from "@/lib/financialsLoad";
import { demoStatement } from "@/lib/pnl/demo";
import { linkedPnlIds, loadPnlStatement } from "@/lib/pnl/read";
import { emptyStatement, unavailableStatement } from "@/lib/pnl/statement";
import { loadWorkbookStep } from "@/lib/workbookStepLoad";
import { fileLookup, recordLinks } from "@/lib/actions/records";
import type { DealProps } from "@/lib/types";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireUser();
  if (!isSession(session)) return session;
  if (!canReadFinancials(session.actionRole)) {
    return NextResponse.json({ error: "You do not have permission for that." }, { status: 403, headers: privateHeaders });
  }
  const { id } = await context.params;
  const ids = linkedPnlIds(id, await recordLinks());
  const deal = (await fileLookup())("deal", ids.find((item) => item.startsWith("PIPE-") || item.startsWith("LAND-")) || id) as DealProps | null;
  if (!deal) return NextResponse.json({ error: "Not found" }, { status: 404, headers: privateHeaders });
  const panel = loadFinancialPanel(deal, true);
  const workbookStep = loadWorkbookStep(deal.deal_id);
  let pnl = emptyStatement();
  if (actionsEnabled()) {
    try {
      pnl = await withSql((sql) => loadPnlStatement(sql, ids));
    } catch (error) {
      console.error(JSON.stringify({ event: "pnl_read_error", name: error instanceof Error ? error.name : "error" }));
      pnl = unavailableStatement();
    }
  }
  const demo = pnl.status === "ready" ? null : ids.reduce<ReturnType<typeof demoStatement>>((found, item) => found || demoStatement(item), null);
  if (demo) pnl = demo;
  console.info(JSON.stringify({ event: "data", user: session.u, part: "financials", id }));
  return NextResponse.json({ ...panel, workbookStep, pnl, pnlDemo: Boolean(demo) }, { headers: privateHeaders });
}
