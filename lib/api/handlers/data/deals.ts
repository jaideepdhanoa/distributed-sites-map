import type { ActionRole } from "@/lib/actions/roles";
import { NextResponse } from "next/server";
import type { DealProps } from "@/lib/types";
import { actionsEnabled, withSql } from "@/lib/actions/db";
import { layoutAssessment } from "@/lib/spaces/assessmentLoad";
import { purchaseFile } from "@/lib/purchaseReviewLoad";
import { canReadFinancials } from "@/lib/agent/access";
import { attachPackageHrefs } from "@/lib/financials";
import { packageHrefMap } from "@/lib/financialsLoad";
import { isSession, privateHeaders, requireUser } from "@/lib/guard";
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
  return NextResponse.json(await loadMapDeals(session.actionRole), { headers: privateHeaders });
}

export async function loadMapDeals(role: ActionRole) {
  const deals = await readDeals();
  const staged = await overlayHeldStages(await overlayDealStages(await overlayStageFile(overlayDeals(deals, loadNdaSnapshot()), "deal")), "deal");
  const dropped = withSuggestedDrops(staged);
  const chipped = await overlayDealChips(dropped, true);
  const features = omitProtectedDeals(attachPackageHrefs(chipped.features || [], packageHrefMap(), canReadFinancials(role)).map((feature) => withPricing(feature)));
  const purchase = canReadFinancials(role) ? purchaseFile() : null;
  const allowed = canReadFinancials(role);
  const captured = allowed && actionsEnabled() ? await withSql(async sql => {
    const result = await sql.query<{site_id:string}>("SELECT DISTINCT site_id FROM pnl_lines WHERE deleted_at IS NULL AND amount IS NOT NULL AND updated_by <> 'fixture'");
    return new Set(result.rows.map(row => row.site_id));
  }).catch(() => null) : null;
  const enriched = features.map(feature => {
    const d = feature.properties as DealProps;
    const inputs = purchase?.sites[d.deal_id];
    if (!allowed || d.kind !== "pipeline") return feature;
    const layout = inputs ? layoutAssessment(d.deal_id)?.row : null;
    const statementCoverage = !captured ? "unavailable" : captured.has(d.deal_id) || captured.has(d.universe_id || "") ? "present" : "empty";
    return {...feature,properties:{...d,statementCoverage,...(inputs && purchase ? {purchase:{inputs,assumptions:purchase.assumptions,
      layout:layout ? {revision:layout.revision,zones:layout.zones.filter(z=>z.kind!=="clear").map(z=>z.label)} : undefined}} : {})}};
  });
  // Live decisions can change while the published workbook snapshot stays the same.
  return redactGmailPayload({ ...dropped, features: enriched });
}
