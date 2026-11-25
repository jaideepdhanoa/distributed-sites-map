import { loadMapDeals } from "@/lib/api/handlers/data/deals";
import { loadMapSites } from "@/lib/api/handlers/data/sites";
import { dealRows, siteRows, MISSING } from "@/lib/comparison";
import { factsForDeal, factsForSite } from "@/lib/keyNumbers";
import type { DealProps, SiteProps } from "@/lib/types";
import { evidenceMeasures, evidenceTarget, type EvidenceTarget } from "./comparisonEvidence";
import type { ActionRole } from "./roles";

export function decisionCatalog(sites: SiteProps[], deals: DealProps[]) {
  const bySite = new Map(sites.map(site => [site.site_id, site]));
  const byDeal = new Map(deals.map(deal => [deal.deal_id, deal]));

  function name(id: string) {
    const row = bySite.get(id) || byDeal.get(id);
    return row?.name || row?.address || id;
  }
  function resolve(c: EvidenceTarget) {
    const site = c.targetKind === "site" ? bySite.get(c.targetId) : undefined;
    const deal = site ? deals.find(d => d.deal_id === site.linked_deal_id || d.universe_id === site.site_id) : byDeal.get(c.targetId);
    if (!site && (!deal || c.targetKind !== "deal")) return null;
    const linked = site || bySite.get(deal?.universe_id || "");
    const rows = site ? siteRows(site, deal ? [deal] : [], true) : dealRows(deal!, linked ? [linked] : [], true);
    const label = evidenceMeasures[c.measure];
    const row = rows.find(r => r.label === label);
    const target = evidenceTarget(c.targetKind, c.targetId, label, deal)!;
    let source = "";
    switch (c.measure) {
      case "power": source = (site ? factsForSite(site, deal) : factsForDeal(deal)).map(f => f.basis).filter(Boolean).join(" · "); break;
      case "asking": source = (site || deal)?.asking_price_source || ""; break;
      case "traffic": source = linked?.aadt_source || ""; break;
      case "zoning": source = linked?.zoning_source || ""; break;
      case "land": source = linked?.lot_ac_source || ""; break;
      case "revenue": case "ebitda": case "cash_flow": case "figure_basis": case "reporting_period": source = deal?.figures_source || ""; break;
    }
    if (c.measure === "open_land") {
      const measurement = rows.find(r => r.label === "Land measurement")?.value;
      if (measurement && measurement !== MISSING) source = measurement;
    }
    return { ...target, value: row?.value || MISSING, source };
  }
  const figures = new Map<string, ReturnType<typeof resolve>>();
  function figure(c: EvidenceTarget) {
    const key = [c.targetKind, c.targetId, c.measure].join("|");
    if (!figures.has(key)) figures.set(key, resolve(c));
    return figures.get(key) || null;
  }
  return { name, figure };
}

export async function loadDecisionCatalog(role: ActionRole) {
  const [sites, deals] = await Promise.all([loadMapSites(null), loadMapDeals(role)]);
  return decisionCatalog(sites.features.map(f => f.properties as SiteProps), deals.features.map(f => f.properties as DealProps));
}
