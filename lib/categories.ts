import { isAutoBusinessType, isPipelineStore } from "./labels";

export const CATEGORY_IDS = ["wash", "auto", "land", "store"] as const;

export type CategoryId = (typeof CATEGORY_IDS)[number];

export type Categories = Record<CategoryId, boolean>;

/**
 * Car washes and auto service are the working set. Land parcels and c-stores stay
 * off until a link or the Filters panel turns them on.
 *
 * `cats` is the shareable choice (`cats=wash|auto`). A missing `cats` is car washes
 * and auto service. Older links still opt in: `landlayer=1` turns Land on, and
 * `cstore=1` turns C-stores on. Nothing was stored locally for the old "a chosen
 * stage includes land" rule, so there is no preference to migrate the way pin
 * labels needed.
 */
export function parseCategories(input: {
  cats?: string | null;
  landlayer?: string | null;
  cstore?: string | null;
}): Categories {
  if (input.cats == null || input.cats === "") {
    return {
      wash: true,
      auto: true,
      land: input.landlayer === "1",
      store: input.cstore === "1",
    };
  }
  if (input.cats === "none") return { wash: false, auto: false, land: false, store: false };
  const on = new Set(input.cats.split("|"));
  return {
    wash: on.has("wash"),
    auto: on.has("auto"),
    land: on.has("land"),
    store: on.has("store"),
  };
}

export function defaultCategories(): Categories {
  return { wash: true, auto: true, land: false, store: false };
}

/** Null when the choice is the default, so the URL stays clean. `none` means every category is off. */
export function categoriesParam(value: Categories): string | null {
  const base = defaultCategories();
  if (CATEGORY_IDS.every((id) => value[id] === base[id])) return null;
  const on = CATEGORY_IDS.filter((id) => value[id]);
  return on.length ? on.join("|") : "none";
}

/** One write clears the legacy land and c-store params so the URL has a single source. */
export function categorySearch(next: Categories): Record<string, string | null> {
  return { cats: categoriesParam(next), landlayer: null, cstore: null };
}

export type LandLinks = { dealIds: Set<string>; siteIds: Set<string> };

export function landLinks(deals: { deal_id?: string | null; kind?: string | null; universe_id?: string | null }[]): LandLinks {
  const dealIds = new Set<string>();
  const siteIds = new Set<string>();
  for (const deal of deals) {
    if (deal.kind !== "land" || !deal.deal_id) continue;
    dealIds.add(deal.deal_id);
    if (deal.universe_id) siteIds.add(deal.universe_id);
  }
  return { dealIds, siteIds };
}

/** A universe row that is the parcel behind a LAND- deal, not spare land on a wash. */
export function isLandParcelSite(
  site: { site_id?: string | null; linked_deal_id?: string | null },
  links: LandLinks,
): boolean {
  if (site.site_id && links.siteIds.has(site.site_id)) return true;
  if (site.linked_deal_id && links.dealIds.has(site.linked_deal_id)) return true;
  return false;
}

export function siteCategory(
  site: { site_id?: string | null; linked_deal_id?: string | null },
  links: LandLinks,
): "wash" | "land" {
  return isLandParcelSite(site, links) ? "land" : "wash";
}

export function siteInCategories(
  site: { site_id?: string | null; linked_deal_id?: string | null },
  links: LandLinks,
  categories: Categories,
): boolean {
  return categories[siteCategory(site, links)];
}

type DealLike = {
  kind?: string | null;
  is_c_store?: boolean | null;
  business_type?: string | null;
  name?: string | null;
  description?: string | null;
  source_line?: string | null;
};

/**
 * Land deals are the Land category, including a parcel whose business type says auto repair or gas station.
 * Pipeline auto repair, tire and lube, and auto service are the Auto service category.
 * Pipeline fuel and c-stores are the C-stores category. Every other pipeline deal stays with car washes.
 */
export function dealCategory(deal: DealLike): CategoryId | null {
  if (deal.kind === "land") return "land";
  if (deal.kind !== "pipeline") return null;
  if (isAutoBusinessType(deal.business_type)) return "auto";
  if (deal.is_c_store || isPipelineStore(deal)) return "store";
  return "wash";
}

export function dealInCategories(deal: DealLike, categories: Categories): boolean {
  const category = dealCategory(deal);
  return category != null && categories[category];
}
