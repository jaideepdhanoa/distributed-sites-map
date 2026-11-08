import type { GeoFeature, SiteProps } from "./types";

export type PipeId = "sourced" | "desk" | "financial" | "checks" | "close" | "contacted" | "later" | "dropped";

export function nearestDepot(lng: number, lat: number, depots: GeoFeature[]) {
  let best: { miles: number; label: string } | null = null;
  for (const depot of depots) {
    const coords = depot.geometry && depot.geometry.type === "Point" ? (depot.geometry.coordinates as number[]) : null;
    if (!coords) continue;
    const miles = haversineMiles(lng, lat, coords[0], coords[1]);
    const label = String(depot.properties.id || depot.properties.address || "Depot");
    if (!best || miles < best.miles) best = { miles, label };
  }
  return best;
}

function haversineMiles(lon1: number, lat1: number, lon2: number, lat2: number) {
  const radius = 3958.8;
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const dphi = ((lat2 - lat1) * Math.PI) / 180;
  const dlambda = ((lon2 - lon1) * Math.PI) / 180;
  const arc = Math.sin(dphi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dlambda / 2) ** 2;
  return 2 * radius * Math.asin(Math.sqrt(arc));
}

export type StageId = "universe" | "unique" | "in_area" | "land" | "county" | "cleared" | "listed" | "contacted";

export const CITIES = ["PHX", "LAS", "MIA"] as const;

export const CITY_VIEW: Record<string, { center: [number, number]; zoom: number }> = {
  PHX: { center: [-111.9, 33.46], zoom: 10.35 },
  LAS: { center: [-115.16, 36.13], zoom: 10.55 },
  MIA: { center: [-80.28, 25.82], zoom: 10.3 },
};

const ELIMINATED = new Set(["FAIL", "NOT_A_WASH"]);

/** Sites a reviewer is still looking at. They stay Possible and are never shown as Cleared. */
export const REVIEW_HOLDS = new Set(["PHX-U180", "LAS-U1516", "PHX-U519"]);

export function presentSite<T extends SiteProps>(site: T): T {
  if (!REVIEW_HOLDS.has(site.site_id)) return site;
  const summary =
    site.site_id === "PHX-U180"
      ? "County records show about 0.38 ac of spare land; the aerial review could not confirm it, so it is held for a closer look."
      : site.summary_why;
  return {
    ...site,
    verdict: "MAYBE",
    network_status: site.network_status === "cleared" ? null : site.network_status,
    summary_why: summary,
  };
}

export function eliminated(site: SiteProps): boolean {
  return ELIMINATED.has(site.verdict || "") || Boolean(site.tenure_fail);
}

export function landFit(site: SiteProps): boolean {
  return site.land_tier === "L10" || site.land_tier === "L4";
}

const SQFT_PER_ACRE = 43560;

/** Spare square feet from the acre figure the list shows. Blank stays unmatched. */
export function spareTier(site: { spare_ac_own?: number | null }): "L10" | "L4" | null {
  if (site.spare_ac_own == null || !Number.isFinite(site.spare_ac_own)) return null;
  const sqft = site.spare_ac_own * SQFT_PER_ACRE;
  if (sqft + 1e-6 >= 10_000) return "L10";
  if (sqft + 1e-6 >= 4_000) return "L4";
  return null;
}

export function matchesLandTier(site: { spare_ac_own?: number | null }, tier: string): boolean {
  if (!tier || tier === "any") return true;
  return spareTier(site) === tier;
}

// Universe funnel. The first step is one pin per place after census records are merged.
// Each later step is a subset of the one before it:
// Universe > In service area > L10/L4 > County-checked > Cleared.
// Held fits sit outside the operative service area (the Las Vegas 200/300 rings). They are
// excluded from In service area and every later step, and are offered only as a separate note
// on L10/L4. Listed is a count on each step, not a step of its own.
// Live broker outreach is a deal count on the Universe step, not a census-site flag.
export function inStage(site: SiteProps, stage: StageId): boolean {
  if (site.land_only || site.origin !== "universe") return false;
  const unique = Boolean(site.counts_as_site) && !site.duplicate_of;
  const inArea = unique && Boolean(site.in_area);
  const land = inArea && landFit(site) && !eliminated(site);
  const county = land && site.verification === "county-checked";
  const cleared = county && site.verdict === "PASS" && site.network_status === "cleared" && !REVIEW_HOLDS.has(site.site_id);
  const listed = cleared && Boolean(site.listed);
  const contacted = listed && Boolean(site.contacted);
  switch (stage) {
    case "universe":
    case "unique":
      return unique;
    case "in_area":
      return inArea;
    case "land":
      return land;
    case "county":
      return county;
    case "cleared":
      return cleared;
    case "listed":
      return listed;
    case "contacted":
      return contacted;
    default:
      return false;
  }
}

export function heldOutside(site: SiteProps): boolean {
  return !site.land_only && site.origin === "universe" && Boolean(site.counts_as_site) && !site.duplicate_of && Boolean(site.is_held_fit) && !site.in_area;
}

export function listedEarlier(site: SiteProps): boolean {
  return inStage(site, "land") && Boolean(site.listed) && !inStage(site, "cleared");
}

export function contactedEarlier(site: SiteProps): boolean {
  return inStage(site, "land") && Boolean(site.contacted) && !inStage(site, "contacted");
}

/** Pipeline or Land deal with broker outreach that is still being pursued. Dropped deals stay out. */
export function isLiveContactedDeal(deal: { kind?: string; stage_group?: string; broker_contacted?: boolean }): boolean {
  if (deal.kind !== "pipeline" && deal.kind !== "land") return false;
  if (deal.stage_group === "dropped") return false;
  return Boolean(deal.broker_contacted);
}

export function droppedAt(site: SiteProps, stage: StageId): boolean {
  if (site.land_only || site.origin !== "universe") return false;
  if (stage === "unique") return Boolean(site.duplicate_of);
  if (site.duplicate_of) return false;
  if (stage === "in_area") return site.counts_as_site && !site.in_area;
  if (stage === "land" || stage === "county") return site.counts_as_site && site.in_area && eliminated(site);
  return false;
}

const TENURE: Record<string, number> = { OK: 0, Unknown: 1, "Tenant-risk": 2 };
const TIER: Record<string, number> = { L10: 0, L4: 1 };

export function compareSites(a: SiteProps, b: SiteProps): number {
  const tier = (TIER[a.land_tier || ""] ?? 9) - (TIER[b.land_tier || ""] ?? 9);
  if (tier) return tier;
  const spare = (b.spare_ac_own ?? -1) - (a.spare_ac_own ?? -1);
  if (spare) return spare;
  const tenure = (TENURE[a.tenure] ?? 9) - (TENURE[b.tenure] ?? 9);
  if (tenure) return tenure;
  return a.site_id.localeCompare(b.site_id);
}
