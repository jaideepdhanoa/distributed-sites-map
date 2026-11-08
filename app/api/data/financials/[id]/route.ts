import { NextResponse } from "next/server";
import { isSession, privateHeaders, requireUser } from "@/lib/guard";
import { loadFinancialPanel } from "@/lib/financialsLoad";
import { fileLookup } from "@/lib/actions/records";
import type { DealProps } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireUser();
  if (!isSession(session)) return session;
  const { id } = await context.params;
  const deal = fileLookup()("deal", id) as DealProps | null;
  if (!deal) return NextResponse.json({ error: "Not found" }, { status: 404, headers: privateHeaders });
  const panel = loadFinancialPanel(deal, true);
  console.info(JSON.stringify({ event: "data", user: session.u, part: "financials", id }));
  return NextResponse.json(panel, { headers: privateHeaders });
}
