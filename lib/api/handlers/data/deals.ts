import { NextResponse } from "next/server";
import { canReadFinancials } from "@/lib/agent/access";
import { attachPackageHrefs } from "@/lib/financials";
import { packageHrefMap } from "@/lib/financialsLoad";
import { isSession, requireUser, snapshotCacheHeaders } from "@/lib/guard";
import { currentSnapshotMeta, snapshotGeneration } from "@/lib/snapshot/read";
import { overlayDeals } from "@/lib/nda";
import { loadNdaSnapshot } from "@/lib/ndaLoad";
import { withPricing } from "@/lib/pricingLoad";
import { overlayHeldStages } from "@/lib/changes/heldStage";
import { overlayDealStages, readDeals } from "@/lib/changes/read";
import { overlayStageFile } from "@/lib/stageOverlayLoad";
import { omitProtectedDeals } from "@/lib/protectedSite";
import { withSuggestedDrops } from "@/lib/suggestedDrop";
import { redactGmailPayload } from "@/lib/displayText";
import { overlayDealChips } from "@/lib/tags/read";

export async function GET() {
  const session = await requireUser();
  if (!isSession(session)) return session;
  console.info(JSON.stringify({ event: "data", user: session.u, part: "deals" }));
  const deals = await readDeals();
  const staged = await overlayHeldStages(await overlayDealStages(await overlayStageFile(overlayDeals(deals, loadNdaSnapshot()), "deal")), "deal");
  const dropped = withSuggestedDrops(staged);
  const chipped = await overlayDealChips(dropped, true);
  const features = omitProtectedDeals(attachPackageHrefs(chipped.features || [], packageHrefMap(), canReadFinancials(session.actionRole)).map((feature) => withPricing(feature)));
  const version = currentSnapshotMeta()?.id || `files-${snapshotGeneration()}`;
  return NextResponse.json(redactGmailPayload({ ...dropped, features }), { headers: snapshotCacheHeaders(version) });
}
