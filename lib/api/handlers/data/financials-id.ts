import { NextResponse } from "next/server";
import { canReadFinancials } from "@/lib/agent/access";
import { isSession, privateHeaders, requireUser } from "@/lib/guard";
import { loadFinancialPanel } from "@/lib/financialsLoad";
import { loadWorkbookStep } from "@/lib/workbookStepLoad";
import { fileLookup } from "@/lib/actions/records";
import type { DealProps } from "@/lib/types";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireUser();
  if (!isSession(session)) return session;
  if (!canReadFinancials(session.actionRole)) {
    return NextResponse.json({ error: "You do not have permission for that." }, { status: 403, headers: privateHeaders });
  }
  const { id } = await context.params;
  const deal = fileLookup()("deal", id) as DealProps | null;
  if (!deal) return NextResponse.json({ error: "Not found" }, { status: 404, headers: privateHeaders });
  const panel = loadFinancialPanel(deal, true);
  const workbookStep = loadWorkbookStep(id);
  console.info(JSON.stringify({ event: "data", user: session.u, part: "financials", id }));
  return NextResponse.json({ ...panel, workbookStep }, { headers: privateHeaders });
}
