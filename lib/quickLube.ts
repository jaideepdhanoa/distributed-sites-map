import { chipLabelProblem } from "./chips";
import { isQuickLube, QUICK_LUBE_LABEL } from "./labels";
import { inReach } from "./reach";
import type { SiteFeature, SiteProps } from "./types";

/** Short chips. A blank field stays unknown. Nothing here is guessed. */
export const BRAND_TYPES = ["Independent", "Local chain", "National chain"] as const;
export const OWNER_VERDICTS = ["Same", "Different", "Unknown"] as const;

export const QUICK_LUBE_FIELDS = [
  "brand_type",
  "brand_note",
  "bay_count",
  "lift_count",
  "lot_sqft",
  "outside_sqft",
  "outside_note",
  "owner_of_record",
  "owner_verdict",
  "listing_source",
  "source_tag",
] as const;

export type QuickLubeField = (typeof QUICK_LUBE_FIELDS)[number];

/**
 * Census categories a universe create may write.
 * Quick lube is open. Add "Car wash" here to open that category on the same create.
 */
export const UNIVERSE_CREATE_CATEGORIES = ["Quick lube"] as const;

export const QUICK_LUBE_NUMERIC = ["bay_count", "lift_count", "lot_sqft", "outside_sqft"] as const;

const AREA_INPUT: Record<string, string> = {
  inside: "inside",
  "near 0-5": "near_0_5",
  "near 0–5": "near_0_5",
  near_0_5: "near_0_5",
  "near 5-10": "near_5_10",
  "near 5–10": "near_5_10",
  near_5_10: "near_5_10",
  outside: "outside",
  unclassified: "",
  unknown: "unknown",
  edge_legacy: "edge_legacy",
};

/** R-099 token. A blank or Unclassified label stays blank. */
export function serviceAreaToken(value: string | null | undefined): string | null {
  const text = (value || "").trim().toLowerCase();
  if (!text) return "";
  if (!Object.prototype.hasOwnProperty.call(AREA_INPUT, text)) return null;
  return AREA_INPUT[text];
}

export function normalizeAddress(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** True when the candidate names a place already stored. A blank address does not match. */
export function addressConflict(candidate: string, existing: readonly string[]): boolean {
  const needle = normalizeAddress(candidate);
  if (!needle) return false;
  return existing.some((item) => normalizeAddress(item) === needle);
}

export function quickLubeValueProblem(field: string, value: string): string {
  if (!value) return "";
  if (field === "brand_type" && !BRAND_TYPES.includes(value as (typeof BRAND_TYPES)[number])) {
    return "Brand type must be Independent, Local chain, or National chain.";
  }
  if (field === "owner_verdict" && !OWNER_VERDICTS.includes(value as (typeof OWNER_VERDICTS)[number])) {
    return "Owner verdict must be Same, Different, or Unknown.";
  }
  if ((QUICK_LUBE_NUMERIC as readonly string[]).includes(field)) {
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) return "That count must be a number.";
  }
  if (field === "brand_type" || field === "owner_verdict") {
    const problem = chipLabelProblem(value);
    if (problem) return problem;
  }
  return "";
}

export type CensusRow = {
  universeId: string;
  siteId: string;
  market: string;
  name: string;
  address: string;
  category: string;
  lat?: string;
  lng?: string;
  serviceArea?: string;
  miles?: string;
  listingStatus?: string;
  facts?: Record<string, string>;
};

function numberOrBlank(value: string | undefined): number | null {
  if (!value) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/** A census Universe row. Quick lube is counted the same way a car-wash census row is counted. */
export function quickLubeCensusSite(row: CensusRow): SiteProps | null {
  const category = (row.category || "").trim();
  if (!(UNIVERSE_CREATE_CATEGORIES as readonly string[]).includes(category)) return null;
  const id = row.universeId || row.siteId;
  if (!id) return null;
  const area = row.serviceArea || "";
  const facts = row.facts || {};
  const lat = numberOrBlank(row.lat);
  const lng = numberOrBlank(row.lng);
  const site = {
    site_id: id,
    city: row.market,
    name: row.name,
    address: row.address,
    apn: "",
    coord_status: lat != null && lng != null ? "geocoded" : "",
    site_class: "",
    in_area: area !== "outside",
    service_area_class: area || undefined,
    service_ring: "",
    expansion_horizon: false,
    duplicate_of: null,
    counts_as_site: true,
    lot_ac: null,
    owner: facts.owner_of_record || "",
    tenure: "",
    spare_ac_own: null,
    spare_ac_own_text: "",
    spare_ac_adjoining: null,
    spare_ac_adjoining_text: "",
    verdict: null,
    land_tier: null,
    land_control: "",
    network_status: null,
    reconciliation_tier: "",
    second_review_verdict: null,
    verdict_disagreement: false,
    acreage_note: "",
    scale_note: "",
    confidence: "",
    listed: /^listed$/i.test(row.listingStatus || ""),
    contacted: false,
    asking_price: null,
    asking_price_display: null,
    asking_price_source: facts.listing_source || "",
    asking_price_url: "",
    asking_price_date: "",
    asking_price_status: null,
    pipeline_stage: null,
    pipeline_id: null,
    land_only: false,
    on_land_tab: false,
    quarantine: false,
    flood_zone: "",
    zoning: "",
    tank_status: "",
    utility_proximity: "",
    aerial_fit: "",
    verification: "",
    elimination_reason: "",
    tenure_fail: false,
    is_held_fit: false,
    tier_from_adjoining: false,
    is_candidate: true,
    miles_to_depot: numberOrBlank(row.miles),
    linked_deal_id: row.siteId && row.siteId !== id ? row.siteId : undefined,
    business_type: isQuickLube(category) ? QUICK_LUBE_LABEL : category,
    evidence: "",
    operating: "",
    agreement: "",
    county_url: "",
    street_view_url: "",
    why_stopped: "",
    fields: {},
    reviews: [],
    origin: "universe",
    brand_type: facts.brand_type || "",
    brand_note: facts.brand_note || "",
    bay_count: numberOrBlank(facts.bay_count),
    lift_count: numberOrBlank(facts.lift_count),
    lot_sqft: numberOrBlank(facts.lot_sqft),
    outside_sqft: numberOrBlank(facts.outside_sqft),
    outside_note: facts.outside_note || "",
    owner_of_record: facts.owner_of_record || "",
    owner_verdict: facts.owner_verdict || "",
    listing_source: facts.listing_source || "",
    source_tag: facts.source_tag || "",
    listing_status: row.listingStatus || "",
  } as SiteProps;
  site.in_area = inReach(site);
  return site;
}

export function quickLubeCensusFeature(row: CensusRow): SiteFeature | null {
  const properties = quickLubeCensusSite(row);
  if (!properties) return null;
  const lat = numberOrBlank(row.lat);
  const lng = numberOrBlank(row.lng);
  return {
    type: "Feature",
    geometry: lat != null && lng != null ? { type: "Point", coordinates: [lng, lat] } : null,
    properties,
  };
}

export function mergeQuickLubeCensus<T extends { features?: SiteFeature[] }>(file: T, rows: readonly CensusRow[]): T {
  const features = [...(file.features || [])];
  const ids = new Set(features.map((feature) => feature.properties.site_id));
  const addresses = new Set(features.map((feature) => normalizeAddress(feature.properties.address || "")).filter(Boolean));
  for (const row of rows) {
    const feature = quickLubeCensusFeature(row);
    if (!feature) continue;
    const address = normalizeAddress(feature.properties.address || "");
    if (ids.has(feature.properties.site_id) || (address && addresses.has(address))) continue;
    features.push(feature);
    ids.add(feature.properties.site_id);
    if (address) addresses.add(address);
  }
  return { ...file, features };
}
