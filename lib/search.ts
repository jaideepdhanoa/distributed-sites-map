/** Search text for the map. "&" and "and" are the same word, and punctuation does not hide a name. */

export function foldSearch(value: string | null | undefined): string {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function matchesQuery(query: string, parts: Array<string | null | undefined>): boolean {
  const needle = foldSearch(query);
  if (!needle) return true;
  return foldSearch(parts.filter(Boolean).join(" ")).includes(needle);
}

export function siteSearchParts(site: {
  site_id?: string;
  name?: string;
  also_known_as?: string;
  address?: string;
  apn?: string;
  owner?: string;
}) {
  return [site.site_id, site.name, site.also_known_as, site.address, site.apn, site.owner];
}

export function dealSearchParts(deal: {
  deal_id?: string;
  name?: string;
  address?: string;
  broker?: string;
  firm?: string;
  universe_id?: string;
}) {
  return [deal.deal_id, deal.name, deal.address, deal.broker, deal.firm, deal.universe_id];
}

/** A broker or firm filter. The full name matches, and so does a distinctive part of it. */
export function partyMatch(query: string, broker: string | null | undefined, firm: string | null | undefined): boolean {
  const needle = foldSearch(query);
  if (!needle) return true;
  const people = [foldSearch(broker), foldSearch(firm)].filter(Boolean);
  return people.some((name) => name === needle || name.includes(needle));
}

export type SearchHit = {
  id: string;
  kind: "deal" | "site";
  title: string;
  address: string;
  city: string;
  stage: string;
};

type DealHitSource = {
  deal_id: string;
  kind?: string;
  name?: string;
  address?: string;
  city?: string;
  stage_group?: string;
  broker?: string;
  firm?: string;
  universe_id?: string;
  is_c_store?: boolean;
};

export type SearchOptions = {
  /** C-store deals stay out of suggestions until that filter is on. */
  cStores?: boolean;
};

type SiteHitSource = {
  site_id: string;
  name?: string;
  also_known_as?: string;
  address?: string;
  apn?: string;
  owner?: string;
  city?: string;
  linked_deal_id?: string;
};

function score(title: string, address: string, id: string, needle: string) {
  const foldedTitle = foldSearch(title);
  if (foldedTitle === needle) return 0;
  if (foldedTitle.includes(needle)) return 1;
  if (foldSearch(address).includes(needle)) return 2;
  if (foldSearch(id).includes(needle)) return 3;
  return 4;
}

/** Matches across every stage and market. The linked universe site stays next to its deal. */
export function collectSearchHits(
  query: string,
  deals: DealHitSource[],
  sites: SiteHitSource[],
  siteStage: (site: SiteHitSource) => string = () => "universe",
  options: SearchOptions = {},
): SearchHit[] {
  const needle = foldSearch(query);
  if (needle.length < 2) return [];
  const cStores = options.cStores === true;
  const visibleDeals = deals.filter((deal) => cStores || deal.is_c_store !== true);
  const hiddenCStoreIds = new Set(
    cStores ? [] : deals.filter((deal) => deal.is_c_store === true).flatMap((deal) => [deal.deal_id, deal.universe_id || ""]).filter(Boolean),
  );
  const byDeal = new Map(visibleDeals.map((deal) => [deal.deal_id, deal]));
  const byUniverse = new Map<string, DealHitSource>();
  for (const deal of visibleDeals) {
    if (deal.universe_id) byUniverse.set(deal.universe_id, deal);
  }
  const hits: SearchHit[] = [];
  for (const deal of visibleDeals) {
    if (!matchesQuery(query, dealSearchParts(deal))) continue;
    hits.push({
      id: deal.deal_id,
      kind: "deal",
      title: deal.name || deal.address || deal.deal_id,
      address: deal.address || "",
      city: deal.city || "",
      stage: deal.stage_group || "",
    });
  }
  const linkedUniverse = new Set(hits.filter((hit) => hit.kind === "deal").map((hit) => byDeal.get(hit.id)?.universe_id || "").filter(Boolean));
  for (const id of linkedUniverse) {
    if (sites.some((site) => site.site_id === id)) continue;
    const deal = visibleDeals.find((item) => item.universe_id === id);
    if (!deal) continue;
    hits.push({
      id,
      kind: "site",
      title: deal.name || id,
      address: deal.address || "",
      city: deal.city || "",
      stage: "universe",
    });
  }
  for (const site of sites) {
    const linked = (site.linked_deal_id && byDeal.get(site.linked_deal_id)) || byUniverse.get(site.site_id);
    const parts = [
      ...siteSearchParts(site),
      linked?.broker,
      linked?.firm,
      linked?.deal_id,
      linked?.name,
    ];
    if (hiddenCStoreIds.has(site.site_id) || (site.linked_deal_id && hiddenCStoreIds.has(site.linked_deal_id))) continue;
    if (!matchesQuery(query, parts)) continue;
    hits.push({
      id: site.site_id,
      kind: "site",
      title: site.name || site.address || site.site_id,
      address: site.address || "",
      city: site.city || "",
      stage: siteStage(site),
    });
  }
  hits.sort((a, b) => {
    const rank = score(a.title, a.address, a.id, needle) - score(b.title, b.address, b.id, needle);
    if (rank) return rank;
    const boost = (hit: SearchHit) => (hit.kind === "deal" || linkedUniverse.has(hit.id) ? 0 : 1);
    const preferred = boost(a) - boost(b);
    if (preferred) return preferred;
    if (a.kind !== b.kind) return a.kind === "deal" ? -1 : 1;
    return a.id.localeCompare(b.id);
  });
  return hits.slice(0, 8);
}
