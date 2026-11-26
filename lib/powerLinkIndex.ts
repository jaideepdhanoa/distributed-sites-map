import { isExcludedSite } from "./alerts/excluded";
import type { TargetKind } from "./actions/text";
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

