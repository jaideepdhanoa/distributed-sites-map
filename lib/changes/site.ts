import { BUSINESS_TYPES, MARKETS, SERVICE_AREA_CLASSES, SITE_ID } from "./vocab";

export type SiteIssue = { id: string; field: string; value: string };

/** Fields compared, imported, and stored. Names are the database columns. */
export const SITE_FIELDS = [
  "name",
  "address",
  "market",
  "lat",
  "lng",
  "category",
  "broker",
  "firm",
  "listing_url",
  "asking_price",
  "acreage",
  "apn",
  "land_value",
  "improvement_value",
  "county_value",
  "county_value_basis",
  "service_area_class",
  "service_area_distance_mi",
  "service_area_polygon",
  "miles_to_depot",
  "notes",
  "photo_refs",
  "photo_status",
  "photo_diligence_count",
  "photo_listing_count",
  "photos_checked",
  "photo_notes",
  "universe_id",
  "listing_status",
  "score",
  "location_points",
] as const;

export type SiteField = (typeof SITE_FIELDS)[number];

export type SiteRow = { site_id: string } & Record<SiteField, string>;

/** Numeric facts a content write must name a source for. Score is not writable. */
export const SITE_NUMERIC_FIELDS = [
  "lat",
  "lng",
  "asking_price",
  "acreage",
  "land_value",
  "improvement_value",
  "county_value",
  "service_area_distance_mi",
  "miles_to_depot",
] as const;

export type SiteNumericField = (typeof SITE_NUMERIC_FIELDS)[number];

export type PhotoRef = {
  role: string;
  source: string;
  file_id: string;
  view_url: string;
  as_of: string;
  caption: string;
  attribution: string;
  visibility: string;
};

const PHOTO_KEYS = ["role", "source", "file_id", "view_url", "as_of", "caption", "attribution", "visibility"] as const;

/** Sheet labels for the stored service-area token. An unknown token is left as written. */
const CLASS_LABEL: Record<string, string> = {
  inside: "Inside",
  near_0_5: "Near 0-5",
  near_5_10: "Near 5-10",
  outside: "Outside",
  unknown: "Unknown",
  edge_legacy: "Edge",
};

/**
 * Workbook headers, matched by name. Column order is not assumed.
 * Site, Broker, Segment, Stage, and Folder are intentionally absent.
 */
export const SITE_MIRROR_FIELDS: { headers: string[]; key: string }[] = [
  { headers: ["site id"], key: "id" },
  { headers: ["name"], key: "name" },
  { headers: ["address"], key: "address" },
  { headers: ["market"], key: "market" },
  { headers: ["lat"], key: "lat" },
  { headers: ["lng", "lon"], key: "lng" },
  { headers: ["business type"], key: "category" },
  { headers: ["listing link"], key: "listing_url" },
  { headers: ["listing status"], key: "listing_status" },
  { headers: ["asking price ($)"], key: "asking_price" },
  { headers: ["land (acres)"], key: "acreage" },
  { headers: ["apn or folio", "apn"], key: "apn" },
  { headers: ["land value ($)"], key: "land_value" },
  { headers: ["improvement value ($)"], key: "improvement_value" },
  { headers: ["county value ($)"], key: "county_value" },
  { headers: ["value basis"], key: "county_value_basis" },
  { headers: ["inside the service area", "service area"], key: "service_area_class" },
  { headers: ["distance to service area (mi)"], key: "service_area_distance_mi" },
  { headers: ["service area polygon"], key: "service_area_polygon" },
  { headers: ["next step"], key: "notes" },
  { headers: ["photo status"], key: "photo_status" },
  { headers: ["diligence photo count"], key: "photo_diligence_count" },
  { headers: ["listing photo count"], key: "photo_listing_count" },
  { headers: ["photos checked"], key: "photos_checked" },
  { headers: ["photo notes"], key: "photo_notes" },
  { headers: ["score (of 100)"], key: "score" },
  { headers: ["location points"], key: "location_points" },
];

const PASSING_CLASSES = new Set(["inside", "near_0_5", "near_5_10", "edge_legacy"]);

export function canonicalFact(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "";
    if (Object.is(value, -0)) return "0";
    return String(value);
  }
  if (typeof value === "boolean") return "";
  return String(value).trim();
}

export function emptySiteFields(): Record<SiteField, string> {
  const fields = {} as Record<SiteField, string>;
  for (const field of SITE_FIELDS) fields[field] = "";
  return fields;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

export function photosFromUnknown(value: unknown): PhotoRef[] {
  const list = Array.isArray(value) ? value : [];
  return list.map((item) => {
    const row = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    const photo = {} as PhotoRef;
    for (const key of PHOTO_KEYS) photo[key] = text(row[key]);
    return photo;
  });
}

export function photoCanonical(photos: PhotoRef[]): string {
  const stable = photos.map((photo) => {
    const out: Record<string, string> = {};
    for (const key of PHOTO_KEYS) {
      if (photo[key]) out[key] = photo[key];
    }
    return out;
  });
  stable.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return JSON.stringify(stable);
}

export function photosFromCanonical(value: string): PhotoRef[] {
  if (!value || value === "[]") return [];
  try {
    return photosFromUnknown(JSON.parse(value));
  } catch {
    return [];
  }
}

export function mirrorClassLabel(stored: string): string {
  if (!stored) return "";
  return CLASS_LABEL[stored] || stored;
}

/** True when a known class passes the location gate. An unknown token does not decide. */
export function passingClass(stored: string): boolean | null {
  if (!stored || !SERVICE_AREA_CLASSES.includes(stored as (typeof SERVICE_AREA_CLASSES)[number])) return null;
  return PASSING_CLASSES.has(stored);
}

export function siteIssues(rows: SiteRow[]): SiteIssue[] {
  const issues: SiteIssue[] = [];
  for (const row of rows) {
    if (!SITE_ID.test(row.site_id)) issues.push({ id: row.site_id, field: "site_id", value: row.site_id });
    if (!row.market || !MARKETS.includes(row.market as (typeof MARKETS)[number])) {
      issues.push({ id: row.site_id, field: "market", value: row.market });
    }
    if (row.category && !BUSINESS_TYPES.includes(row.category as (typeof BUSINESS_TYPES)[number])) {
      issues.push({ id: row.site_id, field: "category", value: row.category });
    }
    if (row.service_area_class && !SERVICE_AREA_CLASSES.includes(row.service_area_class as (typeof SERVICE_AREA_CLASSES)[number])) {
      issues.push({ id: row.site_id, field: "service_area_class", value: row.service_area_class });
    }
  }
  return issues;
}

type DealFeature = {
  geometry?: { type?: string; coordinates?: unknown } | null;
  properties?: Record<string, unknown>;
};

type PricingFile = {
  deals?: Record<string, { county_value?: unknown; county_value_basis?: unknown; land_value?: unknown; improvement_value?: unknown }>;
};

function coordinates(feature: DealFeature): { lat: string; lng: string } {
  const coords = feature.geometry?.coordinates;
  if (!Array.isArray(coords) || coords.length < 2) return { lat: "", lng: "" };
  return { lng: canonicalFact(coords[0]), lat: canonicalFact(coords[1]) };
}

function listingStatus(props: Record<string, unknown>): string {
  if (props.listing_removed === true) return "Removed";
  if (props.listed === true) return "Listed";
  return "";
}

export function sitesFromFiles(dealsJson: string, pricingJson = ""): SiteRow[] {
  const deals = JSON.parse(dealsJson) as { features?: DealFeature[] };
  let pricing: PricingFile = {};
  if (pricingJson.trim()) {
    try {
      pricing = JSON.parse(pricingJson) as PricingFile;
    } catch {
      pricing = {};
    }
  }
  const priced = pricing.deals || {};
  const map = new Map<string, SiteRow>();
  for (const feature of deals.features || []) {
    const props = feature.properties || {};
    const siteId = text(props.deal_id);
    if (!siteId) continue;
    const point = coordinates(feature);
    const county = priced[siteId] || {};
    const picture = photosFromUnknown(props.photos);
    const row: SiteRow = {
      site_id: siteId,
      ...emptySiteFields(),
      name: text(props.name),
      address: text(props.address),
      market: text(props.city),
      lat: point.lat,
      lng: point.lng,
      category: text(props.business_type),
      broker: text(props.broker),
      firm: text(props.firm),
      listing_url: text(props.listing_url),
      asking_price: canonicalFact(props.asking_price),
      acreage: canonicalFact(props.land_acres),
      apn: text(props.apn),
      land_value: canonicalFact(props.land_value ?? county.land_value),
      improvement_value: canonicalFact(props.improvement_value ?? county.improvement_value),
      county_value: canonicalFact(county.county_value),
      county_value_basis: text(county.county_value_basis),
      service_area_class: text(props.service_area_class || props.service_area),
      service_area_distance_mi: canonicalFact(props.service_area_distance_mi),
      service_area_polygon: text(props.service_area_polygon),
      miles_to_depot: canonicalFact(props.miles_to_depot),
      notes: text(props.next_step),
      photo_refs: photoCanonical(picture),
      photo_status: text(props.photo_status),
      photo_diligence_count: canonicalFact(props.photo_diligence_count),
      photo_listing_count: canonicalFact(props.photo_listing_count),
      photos_checked: text(props.photos_checked),
      photo_notes: text(props.photo_notes),
      universe_id: text(props.universe_id),
      listing_status: listingStatus(props),
      score: canonicalFact(props.score),
      location_points: canonicalFact(props.location_points),
    };
    map.set(siteId, row);
  }
  return [...map.values()];
}

export function fieldsOf(row: SiteRow): Record<SiteField, string> {
  const fields = emptySiteFields();
  for (const field of SITE_FIELDS) fields[field] = row[field] || "";
  if (!fields.photo_refs) fields.photo_refs = "[]";
  return fields;
}
