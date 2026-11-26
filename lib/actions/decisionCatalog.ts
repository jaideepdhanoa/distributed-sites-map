import { readScenario, scenarioFigure } from "@/lib/purchaseReview";
import { showsFinancials } from "@/lib/keyNumbers";
import { linkedPnlIds, loadPnlStatement } from "@/lib/pnl/read";
import { demoStatement } from "@/lib/pnl/demo";
import { isStatementMeasure, statementFigures } from "@/lib/pnl/citation";
import type { CitedFigure } from "@/lib/comparisonDecision";
import type { Sql } from "./db";
import type { PnlStatement } from "@/lib/pnl/statement";
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
  const statements = new Map<string,{pnl:PnlStatement;sample:boolean}>();
  const links = [...deals.map(d => ({dealId:d.deal_id,siteId:d.universe_id || ""})),
    ...sites.map(s => ({dealId:s.linked_deal_id || "",siteId:s.site_id}))];
  function financialDeal(c: EvidenceTarget) {
    return c.targetKind === "deal" ? byDeal.get(c.targetId) :
      deals.find(d => d.deal_id === bySite.get(c.targetId)?.linked_deal_id || d.universe_id === c.targetId);
  }
  async function prepareStatements(sql:Sql,citations:EvidenceTarget[]) {
    const ids = new Set(citations.filter(c => isStatementMeasure(c.measure)).map(financialDeal)
      .filter(d => d && showsFinancials(d)).map(d => d!.deal_id));
    for (const id of ids) {
      if (statements.has(id)) continue;
      const related = linkedPnlIds(id,links);
      const loaded = await loadPnlStatement(sql,related);
      const sample = loaded.status === "ready" ? null : related.map(demoStatement).find(Boolean);
      statements.set(id,{pnl:sample || loaded,sample:Boolean(sample)});
    }
  }
  function resolve(c: EvidenceTarget & {anchor?: string}) {
    const site = c.targetKind === "site" ? bySite.get(c.targetId) : undefined;
    const deal = site ? deals.find(d => d.deal_id === site.linked_deal_id || d.universe_id === site.site_id) : byDeal.get(c.targetId);
    if (!site && (!deal || c.targetKind !== "deal")) return null;
    if (c.measure==="purchase_case") {
      const scenario=readScenario(c.anchor || "");
      if (!scenario || !deal) return null;
      const current=scenarioFigure(deal,scenario);
      return current ? {...c,...current} : {...c,value:MISSING,period:c.period,basis:"Inputs or footprint changed",source:"Pipeline workbook"};
    }
    if (isStatementMeasure(c.measure)) {
      const entry = deal && statements.get(deal.deal_id);
      if (!entry || entry.pnl.status === "unavailable") return null;
      const line = statementFigures(entry.pnl,entry.sample,c.anchor).find(f => f.measure === c.measure);
      return line ? {...c,...line} : {...c,value:MISSING,source:"Financial statement"};
    }
    const linked = site || bySite.get(deal?.universe_id || "");
    const rows = site ? siteRows(site, deal ? [deal] : [], true) : dealRows(deal!, linked ? [linked] : [], true);
    const label = evidenceMeasures[c.measure];
    const row = rows.find(r => r.label === label);
    const target = evidenceTarget(c.targetKind, c.targetId, label, deal)!;
    let source = row?.source || "";
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
  function figure(c: EvidenceTarget & Pick<CitedFigure,"anchor">) {
    const key = [c.targetKind, c.targetId, c.measure,c.anchor || ""].join("|");
    if (!figures.has(key)) figures.set(key, resolve(c));
    return figures.get(key) || null;
  }
  return { name, figure, prepareStatements };
}

export async function loadDecisionCatalog(role: ActionRole) {
  const [sites, deals] = await Promise.all([loadMapSites(null), loadMapDeals(role)]);
  return decisionCatalog(sites.features.map(f => f.properties as SiteProps), deals.features.map(f => f.properties as DealProps));
}
