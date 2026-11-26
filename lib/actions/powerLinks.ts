import { isExcludedSite } from "@/lib/alerts/excluded";
import { readGenerated, snapshotGeneration } from "@/lib/snapshot/read";
import type { TargetKind } from "./text";

type Target = { targetKind: TargetKind; targetId: string };
type Collection = { features: { properties: Record<string, string> }[] };

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

let cache: { generation: ReturnType<typeof snapshotGeneration>; links: ReturnType<typeof indexPowerLinks> } | undefined;
export function linkedPowerRecord(target: Target) {
  const generation = snapshotGeneration();
  if (!cache || cache.generation !== generation) {
    const deals = readGenerated("deals.geojson") as Collection;
    const sites = readGenerated("sites.geojson") as Collection;
    cache = { generation, links: indexPowerLinks([
      ...deals.features.map(({ properties: p }): [string, string] => [p.deal_id, p.universe_id]),
      ...sites.features.map(({ properties: p }): [string, string] => [p.linked_deal_id, p.site_id]),
    ]) };
  }
  return cache.links.get(target.targetKind + ":" + target.targetId);
}
