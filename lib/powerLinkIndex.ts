import { isExcludedSite } from "./alerts/excluded";
import type { TargetKind } from "./actions/text";
import type { DealProps, SiteProps } from "./types";
export type PowerRecords = { deal?: DealProps | null; site?: SiteProps | null };
type Target = { targetKind: TargetKind; targetId: string };

/** Only an unambiguous catalog link can share a power request. */
export function indexPowerLinks(pairs: [string, string][]) {
  const byDeal = new Map<string, Set<string>>();
  const bySite = new Map<string, Set<string>>();
  for (const [deal, site] of pairs) {
    if (!deal || !site || isExcludedSite(deal) || isExcludedSite(site)) continue;
    if (!byDeal.has(deal)) byDeal.set(deal, new Set());
    if (!bySite.has(site)) bySite.set(site, new Set());
    byDeal.get(deal)!.add(site);
    bySite.get(site)!.add(deal);
  }
  const links = new Map<string, Target>();
  for (const [deal, sites] of byDeal) {
    const [site] = sites;
    if (sites.size !== 1 || bySite.get(site)?.size !== 1) continue;
    links.set("site:" + site, { targetKind: "deal", targetId: deal });
    links.set("deal:" + deal, { targetKind: "site", targetId: site });
  }
  return links;
}


/** Join only uniquely linked records, including links recorded on the site alone. */
export function catalogPowerRecords(sites: SiteProps[], deals: DealProps[]) {
  const byDeal = new Map(deals.map(deal => [deal.deal_id, deal]));
  const bySite = new Map(sites.map(site => [site.site_id, site]));
  const pairs: [string, string][] = deals.map(deal => [deal.deal_id, deal.universe_id]);
  for (const site of sites) {
    for (const id of [site.linked_deal_id, ...(site.linked_deal_ids || [])]) {
      if (id) pairs.push([id, site.site_id]);
    }
  }
  const links = indexPowerLinks(pairs);
  return {
    dealFor(site: SiteProps) { return byDeal.get(links.get("site:" + site.site_id)?.targetId || ""); },
    siteFor(deal: DealProps) { return bySite.get(links.get("deal:" + deal.deal_id)?.targetId || ""); },
  };
}
