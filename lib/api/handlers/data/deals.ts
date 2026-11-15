import { NextResponse } from "next/server";
import { canReadFinancials } from "@/lib/agent/access";
import { attachPackageHrefs } from "@/lib/financials";
import { packageHrefMap } from "@/lib/financialsLoad";
import { isSession, privateHeaders, readGenerated, requireUser } from "@/lib/guard";
import { overlayDeals } from "@/lib/nda";
import { loadNdaSnapshot } from "@/lib/ndaLoad";
import { withPricing } from "@/lib/pricingLoad";
import { overlayDealSites, overlayDealStages, readDeals } from "@/lib/changes/read";
import { overlayStageFile } from "@/lib/stageOverlayLoad";
import { withSuggestedDrops } from "@/lib/suggestedDrop";

export async function GET() {
  const session = await requireUser();
  if (!isSession(session)) return session;
  console.info(JSON.stringify({ event: "data", user: session.u, part: "deals" }));
  const deals = await readDeals();
  const staged = await overlayDealStages(await overlayStageFile(overlayDeals(deals, loadNdaSnapshot()), "deal"));
  const dropped = withSuggestedDrops(staged);
  const features = attachPackageHrefs(dropped.features || [], packageHrefMap(), canReadFinancials(session.actionRole)).map((feature) => withPricing(feature));
  const recorded = await overlayDealSites({ ...dropped, features });
  return NextResponse.json(recorded, { headers: privateHeaders });
}
