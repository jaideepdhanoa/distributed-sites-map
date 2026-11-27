import type { ActionRole } from "@/lib/actions/roles";
import { NextResponse } from "next/server";
import type { DealProps } from "@/lib/types";
import { actionsEnabled, withSql } from "@/lib/actions/db";
import { createHash } from "node:crypto";
import { assessedLayouts } from "@/lib/spaces/assessmentLoad";
import { triage } from "@/lib/spaces/triage";
import { chargingHold,screenSummary, type Inputs } from "@/lib/selection/screen";
import { readGeneratedOptional } from "@/lib/snapshot/read";
import { mapCatalog } from "@/lib/spaces/mapCatalogLoad";
import { reviewAtStage } from "@/lib/selection/opportunity";
import { opportunityRegister } from "@/lib/selection/opportunityLoad";
import { selectionResearch } from "@/lib/selection/researchLoad";
import { purchaseFile } from "@/lib/purchaseReviewLoad";
import { selectedCases,sourceRevision } from "@/lib/charging/source";
import { summarize } from "@/lib/charging/summary";
import { pipelineFit } from "@/lib/spaces/pipelineFit";
import { checkSpaceFit } from "@/lib/spaces/fitCheck";
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
  const saved = allowed ? await selectedCases() : null;
  const reviews = allowed ? opportunityRegister()?.sites : undefined;
  const research = allowed ? selectionResearch() : null;
  const captured = allowed && actionsEnabled() ? await withSql(async sql => {
    const result = await sql.query<{site_id:string}>("SELECT DISTINCT site_id FROM pnl_lines WHERE deleted_at IS NULL AND amount IS NOT NULL AND updated_by <> 'fixture'");
    return new Set(result.rows.map(row => row.site_id));
  }).catch(() => null) : null;
  // Use the reviewed outlines, including edits made on the main map. A changed
  // shape invalidates the scenario that referred to the previous footprint.
  const assessments = new Map(assessedLayouts());
  const outlines = await mapCatalog(features, [...assessments]);
  const bySite = new Map(outlines.sites.map(site => [site.id,site]));
  const selection = readGeneratedOptional("selection-inputs.json") as Record<string,Inputs> | undefined;
  const layouts = new Map(outlines?.reviewsAvailable ? outlines.sites.map(site => {
    const zones = site.zones.filter(zone => zone.kind !== "clear");
    const revision = createHash("sha256").update(JSON.stringify([site.revision, site.frame.id,
      zones.map(zone => [zone.kind, zone.label, zone.points])])).digest("hex").slice(0,12);
    return [site.id, { revision, zones: zones.map(zone => zone.label), stalls:zones.map(zone=>{const fit=checkSpaceFit(zone,site.frame);return ["interior","footprint","measure"].includes(fit.check)?null:fit.inside?.[0]??null;}) }] as const;
  }) : []);
  const enriched = features.map(feature => {
    const d = feature.properties as DealProps;
    const inputs = purchase?.sites[d.deal_id];
    if (d.kind !== "pipeline") return feature;
    const row = assessments.get(d.deal_id);
    const current = bySite.get(d.deal_id);
    const view = triage(current && row ? {...row,zones:current.zones} : row);
    if (current && !outlines.reviewsAvailable) view.fit = "Current outline needs verification";
    const active = d.stage_group !== "dropped" && !/off[ -]?market/i.test(d.stage || "");
    const screening = active && (row || selection?.[d.deal_id]) ? screenSummary(d.city,selection?.[d.deal_id],view,d) : undefined;
    if (!allowed) return {...feature, properties:{...d,screening}};
    const statementCoverage = !captured ? "unavailable" : captured.has(d.deal_id) || captured.has(d.universe_id || "") ? "present" : "empty";
    const chargingSpace = pipelineFit(current, row, outlines.reviewsAvailable, inputs?.fit ?? d.bays_that_fit);
    const record:DealProps={...d,chargingSpace,chargingHold:chargingHold(selection?.[d.deal_id]),screening,statementCoverage,opportunityReview:reviewAtStage(reviews?.[d.deal_id], d.stage, d.decision_reason || d.chips?.find(c => c.family === "drop_reason")?.label),selectionResearch:research?.get(d.deal_id),...(inputs && purchase ? {purchase:{inputs,assumptions:purchase.assumptions,
      layout:layouts.get(d.deal_id)}} : {})};
    if (active && !/^dropped/i.test(d.stage || "") && record.opportunityReview?.primary.disposition === "Suggest drop") {
      record.suggested_drop = record.opportunityReview.primary.rationale;
    }
    if(active && ["MIA","PHX","LAS"].includes(d.city) && !selection?.[d.deal_id]?.land) record.charging=summarize(record,sourceRevision(record),saved?.get(d.deal_id));
    return {...feature,properties:record};
  });
  // Live decisions can change while the published workbook snapshot stays the same.
  return redactGmailPayload({ ...dropped, features: enriched });
}
