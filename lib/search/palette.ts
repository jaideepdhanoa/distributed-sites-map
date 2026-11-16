import { isAutoBusinessType, isPipelineStore } from "@/lib/labels";
import { isProtectedId } from "@/lib/protectedSite";
import { collectSearchHits, foldSearch, type SearchHit, type SearchOptions } from "@/lib/search";

export type PaletteHit = { id: string; title: string; path: string; url: string };
export type PaletteGroups = { sites: PaletteHit[]; brokers: PaletteHit[]; conversations: PaletteHit[] };

type DealSource = Parameters<typeof collectSearchHits>[1][number];
type SiteSource = Parameters<typeof collectSearchHits>[2][number];

const EMPTY: PaletteGroups = { sites: [], brokers: [], conversations: [] };

function sitePath(id: string): string {
  return `/?site=${encodeURIComponent(id)}`;
}

function hit(id: string, title: string): PaletteHit {
  const path = sitePath(id);
  return { id, title, path, url: `https://distributedsites.com${path}` };
}

function nameHit(query: string, value: string | undefined): boolean {
  const needle = foldSearch(query);
  const name = foldSearch(value);
  if (needle.length < 2 || name.length < 2) return false;
  return name === needle || name.includes(needle) || (name.length >= 8 && needle.includes(name));
}

function hiddenDeal(deal: DealSource, options: SearchOptions): boolean {
  if (isProtectedId(deal.deal_id) || isProtectedId(deal.universe_id)) return true;
  const store = deal.is_c_store === true || isPipelineStore(deal);
  if (options.cStores !== true && store) return true;
  if (options.land !== true && deal.kind === "land") return true;
  if (options.auto === false && deal.kind === "pipeline" && isAutoBusinessType(deal.business_type)) return true;
  return false;
}

/** Group the map's own rows when the search index is empty. Conversations stay empty until the index has them. */
export function paletteGroups(query: string, deals: DealSource[], sites: SiteSource[], options: SearchOptions = {}): PaletteGroups {
  const needle = query.trim();
  if (needle.length < 2) return EMPTY;
  const sitesGroup = collectSearchHits(needle, deals, sites, () => "", options)
    .filter((item: SearchHit) => !isProtectedId(item.id))
    .map((item) => hit(item.id, item.title || item.id));
  const brokers = new Map<string, PaletteHit>();
  for (const deal of deals) {
    if (hiddenDeal(deal, options)) continue;
    const firm = String(deal.firm || "").trim();
    const broker = String(deal.broker || "").trim();
    const name = nameHit(needle, firm) ? firm : nameHit(needle, broker) ? broker : "";
    if (!name) continue;
    const key = foldSearch(name);
    if (!key || brokers.has(key)) continue;
    brokers.set(key, hit(deal.deal_id, name));
  }
  return {
    sites: sitesGroup,
    brokers: [...brokers.values()].slice(0, 8),
    conversations: [],
  };
}
