export const CITIES = ["PHX", "LAS", "MIA"] as const;
export const STEPS = ["universe", "in_area", "land", "county", "cleared"] as const;
export const PIPE_STEPS = ["desk", "financial", "checks", "close", "dropped"] as const;
export const HOLDS = ["PHX-U180", "LAS-U1516", "PHX-U519"] as const;
const HOLD_SET = new Set<string>(HOLDS);
const ELIMINATED = new Set(["FAIL", "NOT_A_WASH"]);

export const STEP_LABEL: Record<(typeof STEPS)[number], string> = {
  universe: "Universe",
  in_area: "In service area",
  land: "Spare land",
  county: "County-checked",
  cleared: "Cleared",
};

export const PIPE_LABEL: Record<(typeof PIPE_STEPS)[number], string> = {
  desk: "Desk screen",
  financial: "Financial screen",
  checks: "Site checks",
  close: "Offer and close",
  dropped: "Dropped",
};

export type Site = {
  site_id: string;
  city: string;
  origin?: string;
  name?: string;
  also_known_as?: string;
  address?: string;
  apn?: string;
  owner?: string;
  land_tier?: string | null;
  verdict?: string | null;
  listed?: boolean;
  contacted?: boolean;
  business_type?: string;
  land_only?: boolean;
  counts_as_site?: boolean;
  duplicate_of?: string | null;
  in_area?: boolean;
  verification?: string;
  tenure_fail?: boolean;
  network_status?: string | null;
  is_held_fit?: boolean;
};

export type Deal = {
  deal_id: string;
  city: string;
  kind: string;
  name?: string;
  address?: string;
  broker?: string;
  firm?: string;
  universe_id?: string;
  business_type?: string;
  stage?: string;
  stage_group?: string;
};

type Feature<T> = { geometry: unknown; properties: T };

export type Catalog = {
  sites: Feature<Site>[];
  deals: Feature<Deal>[];
};

export function stageGroupFromText(stage: string | undefined): string {
  const text = String(stage || "").trim().toLowerCase();
  if (text.startsWith("dropped")) return "dropped";
  const match = /^\s*(\d+)\b/.exec(String(stage || ""));
  if (!match) return "sourced";
  const number = Number(match[1]);
  if (number <= 0) return "sourced";
  if (number === 1) return "desk";
  if (number === 2) return "financial";
  if (number === 3) return "checks";
  return "close";
}

function present(site: Site): Site {
  if (!HOLD_SET.has(site.site_id)) return site;
  return {
    ...site,
    verdict: "MAYBE",
    network_status: site.network_status === "cleared" ? null : site.network_status,
  };
}

function eliminated(site: Site) {
  return ELIMINATED.has(site.verdict || "") || Boolean(site.tenure_fail);
}

export function inStage(site: Site, stage: string) {
  if (site.land_only || site.origin !== "universe") return false;
  const unique = Boolean(site.counts_as_site) && !site.duplicate_of;
  const inArea = unique && Boolean(site.in_area);
  const land = inArea && (site.land_tier === "L10" || site.land_tier === "L4") && !eliminated(site);
  const county = land && site.verification === "county-checked";
  const cleared = county && site.verdict === "PASS" && site.network_status === "cleared" && !HOLD_SET.has(site.site_id);
  if (stage === "universe") return unique;
  if (stage === "in_area") return inArea;
  if (stage === "land") return land;
  if (stage === "county") return county;
  if (stage === "cleared") return cleared;
  return false;
}

function held(site: Site) {
  return !site.land_only && site.origin === "universe" && Boolean(site.counts_as_site) && !site.duplicate_of && Boolean(site.is_held_fit) && !site.in_area;
}

function blob(site: Site) {
  return `${site.site_id} ${site.name || ""} ${site.also_known_as || ""} ${site.address || ""} ${site.apn || ""} ${site.owner || ""}`.toLowerCase();
}

export type Chips = {
  tier?: string;
  verdict?: string;
  listed?: string;
  types?: string[] | null;
  query?: string;
  land?: boolean;
  extra?: "listed" | "contacted" | "held" | null;
};

function chips(site: Site, options: Chips, loose: boolean) {
  if (options.query && !blob(site).includes(options.query.toLowerCase())) return false;
  if (loose) return true;
  if (options.tier && options.tier !== "any" && site.land_tier !== options.tier) return false;
  if (options.verdict && options.verdict !== "any" && (site.verdict || "none") !== options.verdict) return false;
  if (options.listed === "yes" && !site.listed) return false;
  if (options.types && !(options.types.includes(site.business_type || "Car wash"))) return false;
  return true;
}

export function expectedSites(catalog: Catalog, city: string, stage: string, options: Chips = {}) {
  const rows = catalog.sites
    .filter((feature) => feature.properties.city === city && feature.properties.origin !== "off-market")
    .map((feature) => ({ feature, site: present(feature.properties) }));
  const chosen = rows.filter(({ site }) => {
    if (options.extra === "held") return held(site) && chips(site, options, true);
    if (options.extra === "listed") return inStage(site, stage) && Boolean(site.listed) && chips(site, options, true);
    if (options.extra === "contacted") return inStage(site, stage) && Boolean(site.contacted) && chips(site, options, true);
    return inStage(site, stage) && chips(site, options, false);
  });
  if (options.land && !options.extra) {
    for (const row of rows) {
      if (row.site.land_only && row.site.city === city && chips(row.site, options, true) && !chosen.includes(row)) chosen.push(row);
    }
  }
  const withGeometry = chosen.filter((row) => row.feature.geometry);
  return {
    visible: chosen.length,
    drawn: withGeometry.map((row) => row.site.site_id),
  };
}

export function expectedOffMarket(catalog: Catalog, city: string, stage = "universe", options: Chips = {}) {
  if (options.extra || stage !== "universe") return [];
  return catalog.sites
    .filter((feature) => feature.geometry && feature.properties.origin === "off-market" && feature.properties.city === city)
    .filter((feature) => chips({ ...feature.properties, business_type: feature.properties.business_type || "Other" }, options, false))
    .map((feature) => feature.properties.site_id);
}

function placed(deal: Feature<Deal>, sites: Map<string, Feature<Site>>) {
  if (deal.properties.universe_id) {
    const site = sites.get(deal.properties.universe_id);
    if (site?.geometry) return true;
  }
  return Boolean(deal.geometry);
}

export function expectedSquares(catalog: Catalog, city: string, step: string, options: { types?: string[] | null; query?: string } = {}) {
  const sites = new Map(catalog.sites.map((feature) => [feature.properties.site_id, feature]));
  return catalog.deals
    .filter((feature) => {
      const deal = feature.properties;
      if (deal.kind !== "pipeline" || deal.city !== city || deal.stage_group !== step) return false;
      if (options.types && !options.types.includes(deal.business_type || "Other")) return false;
      if (options.query) {
        const text = `${deal.deal_id} ${deal.name || ""} ${deal.address || ""} ${deal.broker || ""} ${deal.firm || ""} ${deal.universe_id || ""}`.toLowerCase();
        if (!text.includes(options.query.toLowerCase())) return false;
      }
      return placed(feature, sites);
    })
    .map((feature) => feature.properties.deal_id);
}

export function unfilteredCount(catalog: Catalog, city: string, stage: string) {
  return catalog.sites.filter((feature) => feature.properties.city === city && inStage(present(feature.properties), stage)).length;
}
