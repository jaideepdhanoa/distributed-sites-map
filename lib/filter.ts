import type { SiteProps } from "./types";

export type StageId = "universe" | "unique" | "in_area" | "land" | "county" | "cleared" | "listed" | "contacted";

export const CITIES = ["PHX", "LAS", "MIA"] as const;

export const CITY_VIEW: Record<string, { center: [number, number]; zoom: number }> = {
  PHX: { center: [-111.9, 33.46], zoom: 10.35 },
  LAS: { center: [-115.16, 36.13], zoom: 10.55 },
  MIA: { center: [-80.28, 25.82], zoom: 10.3 },
};

const ELIMINATED = new Set(["FAIL", "NOT_A_WASH"]);

export function eliminated(site: SiteProps): boolean {
  return ELIMINATED.has(site.verdict || "") || Boolean(site.tenure_fail);
}

export function landFit(site: SiteProps): boolean {
  return site.land_tier === "L10" || site.land_tier === "L4";
}

export function inStage(site: SiteProps, stage: StageId): boolean {
  if (site.land_only || site.origin !== "universe") return false;
  if (site.duplicate_of && stage !== "universe") return false;
  const candidate = site.counts_as_site && site.in_area && landFit(site) && !eliminated(site);
  switch (stage) {
    case "universe":
      return true;
    case "unique":
      return site.counts_as_site;
    case "in_area":
      return site.counts_as_site && site.in_area;
    case "land":
      return candidate || Boolean(site.is_held_fit);
    case "county":
      return candidate && site.verification === "county-checked";
    case "cleared":
      return site.verdict === "PASS" && site.network_status === "cleared" && site.in_area;
    case "listed":
      return candidate && site.listed;
    case "contacted":
      return candidate && site.contacted;
    default:
      return false;
  }
}

export function droppedAt(site: SiteProps, stage: StageId): boolean {
  if (site.land_only || site.origin !== "universe") return false;
  if (stage === "unique") return Boolean(site.duplicate_of);
  if (site.duplicate_of) return false;
  if (stage === "in_area") return site.counts_as_site && !site.in_area;
  if (stage === "land" || stage === "county") return site.counts_as_site && site.in_area && eliminated(site);
  return false;
}

const GRID: Record<string, number> = { Strong: 0, OK: 1, Weak: 2, Unknown: 3 };
const TENURE: Record<string, number> = { OK: 0, Unknown: 1, "Tenant-risk": 2 };
const TIER: Record<string, number> = { L10: 0, L4: 1 };

export function compareSites(a: SiteProps, b: SiteProps): number {
  const keys = ["tier", "spare", "grid", "tenure"] as const;
  for (const key of keys) {
    const diff =
      key === "tier"
        ? (TIER[a.land_tier || ""] ?? 9) - (TIER[b.land_tier || ""] ?? 9)
        : key === "spare"
          ? (b.spare_ac_own ?? -1) - (a.spare_ac_own ?? -1)
          : key === "grid"
            ? (GRID[a.utility_proximity] ?? 9) - (GRID[b.utility_proximity] ?? 9)
            : (TENURE[a.tenure] ?? 9) - (TENURE[b.tenure] ?? 9);
    if (diff) return diff;
  }
  return a.site_id.localeCompare(b.site_id);
}
