import type { SiteProps } from "./types";

export type StageId =
  | "candidates"
  | "census"
  | "unique"
  | "in_area"
  | "land_tier"
  | "verified"
  | "verdict"
  | "listed"
  | "contacted";

export type Filters = {
  stage: StageId;
  cities: string[];
  verdict: string;
  landTier: string;
  listed: string;
  contacted: string;
  verification: string;
  query: string;
  landSites: boolean;
  showHeld: boolean;
  showStops: boolean;
};

export const CITIES = ["LAS", "PHX", "MIA"];

export function matches(site: SiteProps, filters: Filters): boolean {
  if (site.duplicate_of && filters.stage !== "census") return false;
  if (!CITIES.includes(site.city)) return false;
  if (!filters.cities.includes(site.city)) return false;
  if (filters.query) {
    const blob = `${site.site_id} ${site.name} ${site.address} ${site.apn} ${site.owner}`.toLowerCase();
    if (!blob.includes(filters.query.toLowerCase())) return false;
  }
  if (filters.verdict !== "any" && (site.verdict || "none") !== filters.verdict) return false;
  if (filters.landTier !== "any" && site.land_tier !== filters.landTier) return false;
  if (filters.listed === "yes" && !site.listed) return false;
  if (filters.listed === "no" && site.listed) return false;
  if (filters.contacted === "yes" && !site.contacted) return false;
  if (filters.contacted === "no" && site.contacted) return false;
  if (filters.verification !== "any" && site.verification !== filters.verification) return false;
  if (site.land_only && !filters.landSites) return false;

  const universe = site.origin === "universe" && site.counts_as_site;
  switch (filters.stage) {
    case "candidates":
      if (site.is_candidate) return true;
      if (filters.showHeld && site.is_held_fit) return true;
      return filters.landSites && site.land_only;
    case "census":
      return site.origin === "universe";
    case "unique":
      return universe;
    case "in_area":
      return universe && (filters.showStops || site.in_area);
    case "land_tier":
      if (!universe || !site.in_area) return Boolean(filters.showStops && universe);
      if (site.land_tier === "L10" || site.land_tier === "L4") return true;
      if (site.verdict === "NOT_A_WASH") return true;
      return filters.showStops;
    case "verified":
      return universe && site.in_area && (site.land_tier === "L10" || site.land_tier === "L4");
    case "verdict":
      return (
        universe &&
        site.in_area &&
        (site.land_tier === "L10" || site.land_tier === "L4") &&
        site.verification === "county-checked"
      );
    case "listed":
      if (!site.is_candidate && !(filters.showHeld && site.is_held_fit)) return false;
      return filters.showStops || site.listed;
    case "contacted":
      if (!site.is_candidate && !(filters.showHeld && site.is_held_fit)) return false;
      return filters.showStops || site.contacted;
    default:
      return false;
  }
}

const GRID: Record<string, number> = { Strong: 0, OK: 1, Weak: 2, Unknown: 3 };
const TENURE: Record<string, number> = { OK: 0, Unknown: 1, "Tenant-risk": 2 };
const TIER: Record<string, number> = { L10: 0, L4: 1 };

function rank(site: SiteProps, key: string): number {
  if (key === "group") return site.is_held_fit ? 1 : 0;
  if (key === "tier") return TIER[site.land_tier || ""] ?? 9;
  if (key === "spare") return -(site.spare_ac_own ?? -1);
  if (key === "grid") return GRID[site.grid_proxy] ?? 9;
  return TENURE[site.tenure] ?? 9;
}

export function compareSites(a: SiteProps, b: SiteProps, sort: string): number {
  const order =
    sort === "spare"
      ? ["spare", "tier", "grid", "tenure"]
      : sort === "grid"
        ? ["grid", "tier", "spare", "tenure"]
        : sort === "tenure"
          ? ["tenure", "tier", "spare", "grid"]
          : ["group", "tier", "spare", "grid", "tenure"];
  for (const key of order) {
    const diff = rank(a, key) - rank(b, key);
    if (diff) return diff;
  }
  return a.site_id.localeCompare(b.site_id);
}

export const SORT_LABELS: Record<string, string> = {
  tier: "Land tier, then own-parcel spare, then grid proxy, then tenure",
  spare: "Own-parcel spare land, then tier, grid proxy, tenure",
  grid: "Grid proxy (Strong, then OK, then Weak), then the other signals",
  tenure: "Tenure (OK, then Unknown, then Tenant-risk), then the other signals",
};
