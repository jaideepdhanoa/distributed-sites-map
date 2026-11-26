import type { ActionRole } from "@/lib/actions/roles";
import { NextResponse } from "next/server";
import type { DealProps } from "@/lib/types";
import { actionsEnabled, withSql } from "@/lib/actions/db";
import { createHash } from "node:crypto";
import { mapCatalog } from "@/lib/spaces/mapCatalogLoad";
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

export async function loadMapDeals(role: ActionRole, includePurchase = true) {
  const deals = await readDeals();
  const staged = await overlayHeldStages(await overlayDealStages(await overlayStageFile(overlayDeals(deals, loadNdaSnapshot()), "deal")), "deal");
  const dropped = withSuggestedDrops(staged);
  const chipped = await overlayDealChips(dropped, true);
  const features = omitProtectedDeals(attachPackageHrefs(chipped.features || [], packageHrefMap(), canReadFinancials(role)).map((feature) => withPricing(feature)));
  const purchase = includePurchase && canReadFinancials(role) ? purchaseFile() : null;
  const allowed = includePurchase && canReadFinancials(role);
  const captured = allowed && actionsEnabled() ? await withSql(async sql => {
    const result = await sql.query<{site_id:string}>("SELECT DISTINCT site_id FROM pnl_lines WHERE deleted_at IS NULL AND amount IS NOT NULL AND updated_by <> 'fixture'");
    return new Set(result.rows.map(row => row.site_id));
  }).catch(() => null) : null;
  // Use the reviewed outlines, including edits made on the main map. A changed
  // shape invalidates the scenario that referred to the previous footprint.
  const outlines = purchase ? await mapCatalog(features) : null;
  const layouts = new Map(outlines?.reviewsAvailable ? outlines.sites.map(site => {
    const zones = site.zones.filter(zone => zone.kind !== "clear");
    const revision = createHash("sha256").update(JSON.stringify([site.revision, site.frame.id,
      zones.map(zone => [zone.kind, zone.label, zone.points])])).digest("hex").slice(0,12);
    return [site.id, { revision, zones: zones.map(zone => zone.label) }] as const;
  }) : []);
  const enriched = features.map(feature => {
    const d = feature.properties as DealProps;
    const inputs = purchase?.sites[d.deal_id];
    if (!allowed || d.kind !== "pipeline") return feature;
    const statementCoverage = !captured ? "unavailable" : captured.has(d.deal_id) || captured.has(d.universe_id || "") ? "present" : "empty";
    return {...feature,properties:{...d,statementCoverage,...(inputs && purchase ? {purchase:{inputs,assumptions:purchase.assumptions,
      layout:layouts.get(d.deal_id)}} : {})}};
  });
  // Live decisions can change while the published workbook snapshot stays the same.
  return redactGmailPayload({ ...dropped, features: enriched });
}
