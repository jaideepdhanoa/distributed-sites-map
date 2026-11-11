import { NextResponse } from "next/server";
import { isSession, privateHeaders, readGenerated, requireUser } from "@/lib/guard";
import { overlayDeals } from "@/lib/nda";
import { loadNdaSnapshot } from "@/lib/ndaLoad";

export async function GET() {
  const session = await requireUser();
  if (!isSession(session)) return session;
  console.info(JSON.stringify({ event: "data", user: session.u, part: "deals" }));
  const deals = readGenerated("deals.geojson") as { features?: { properties?: Record<string, unknown> }[] };
  return NextResponse.json(overlayDeals(deals, loadNdaSnapshot()), { headers: privateHeaders });
}
