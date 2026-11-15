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

export type SiteRow = {
  site_id: string;
  coord_status: string;
  /** Canonical JSON of raw workbook cells. The mirror writes only this map. */
  sheet: string;
  facts: Record<string, string>;
} & Record<SiteField, string>;

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

/** Workbook Listing status values the read path understands. Annotated cells keep the same first token. */
export const LISTING_STATUSES = ["Listed", "Active", "Off-market", "Under contract", "Sold or withdrawn", "Gone", "Removed"] as const;

export type ListingStatus = (typeof LISTING_STATUSES)[number];

/** Measures and sources stored beside the raw sheet. Financial claims are not in this list. */
export const FACT_FIELDS = [
  "asking_price_source",
  "land_acres_basis",
  "parcel_acres",
  "parcel_match",
  "open_land_sqft",
  "open_land_basis",
  "bays_that_fit",
  "site_capacity",
  "source_kind",
  "source_line",
  "folder_url",
  "checked_live",
  "price_per_acre",
  "cap_a_substation_mi",
  "cap_a_line_ft",
  "cap_a_source",
  "cap_a_as_of",
  "cap_a_confidence",
  "cap_b_feeder",
  "cap_b_frontage",
  "cap_b_nearby",
  "cap_b_horizon",
  "cap_b_source",
  "cap_b_as_of",
  "cap_b_confidence",
  "cap_c_amps",
  "cap_c_volts",
  "cap_c_phase",
  "cap_c_panels",
  "cap_c_source",
  "cap_c_as_of",
  "cap_c_confidence",
  "cap_d_peak",
  "cap_d_year",
  "cap_d_source",
  "cap_d_as_of",
  "cap_d_confidence",
  "trade_aadt",
  "trade_aadt_road",
  "trade_aadt_m",
  "trade_aadt_max",
  "trade_population",
  "trade_growth",
  "trade_income",
  "trade_washes_1mi",
  "trade_washes_3mi",
] as const;

export type FactField = (typeof FACT_FIELDS)[number];

export const NUMERIC_FACT_FIELDS = [
  ...SITE_NUMERIC_FIELDS,
  "parcel_acres",
  "open_land_sqft",
  "bays_that_fit",
  "cap_a_substation_mi",
  "cap_a_line_ft",
  "cap_b_frontage",
  "cap_b_nearby",
  "cap_c_amps",
  "cap_c_volts",
  "cap_c_panels",
  "cap_d_peak",
  "cap_d_year",
  "trade_aadt",
  "trade_aadt_m",
  "trade_aadt_max",
  "trade_population",
  "trade_growth",
  "trade_income",
  "trade_washes_1mi",
  "trade_washes_3mi",
] as const;

export type NumericFactField = (typeof NUMERIC_FACT_FIELDS)[number];

/** Identity fields. Agents do not write these. */
export const SCHEMA_FIELDS = ["name", "address", "market", "category", "apn", "universe_id", "lat", "lng", "folder_url"] as const;

export const PHOTO_FIELDS = ["photo_refs", "photo_status", "photo_diligence_count", "photo_listing_count", "photos_checked", "photo_notes"] as const;

export const CHECK_FIELDS = ["checked_live", "bays_that_fit", "site_capacity", "cap_a_substation_mi", "cap_a_line_ft", "cap_a_source", "cap_a_as_of", "cap_a_confidence", "cap_b_feeder", "cap_b_frontage", "cap_b_nearby", "cap_b_horizon", "cap_b_source", "cap_b_as_of", "cap_b_confidence", "cap_c_amps", "cap_c_volts", "cap_c_phase", "cap_c_panels", "cap_c_source", "cap_c_as_of", "cap_c_confidence", "cap_d_peak", "cap_d_year", "cap_d_source", "cap_d_as_of", "cap_d_confidence"] as const;

/** Capture, distances, and service area. Muse writes these. Comms stay on the comms entity. */
export const MUSE_FIELDS = ["notes", "listing_url", "listing_status", "asking_price", "acreage", "land_value", "improvement_value", "county_value", "county_value_basis", "broker", "firm", "service_area_class", "service_area_distance_mi", "service_area_polygon", "miles_to_depot", "asking_price_source", "land_acres_basis", "open_land_sqft", "open_land_basis", "parcel_acres", "parcel_match", "source_line", "source_kind", "trade_aadt", "trade_aadt_road", "trade_aadt_m", "trade_aadt_max", "trade_population", "trade_growth", "trade_income", "trade_washes_1mi", "trade_washes_3mi"] as const;

export const PHOTO_ROLES = ["spare_land_annotated", "lot_aerial", "access_spare", "building", "street_level", "electrical", "listing", "street_frontage"] as const;

export const PHOTO_SOURCES = ["esri_world_imagery", "google_street_view", "broker_listing", "broker_email", "site_visit", "other"] as const;

export const CREATE_MARKETS = ["PHX", "LAS", "MIA"] as const;

const AGENT_NAME = /\b(?:muse|torque|indie|grok)\b/i;
const GONE = /delist|listing removed|not live|sold or withdrawn|withdrawn/i;

export function listingToken(value: string): ListingStatus | "" {
  const text = value.trim();
  if (!text) return "";
  const found = LISTING_STATUSES.find((status) => text === status || text.startsWith(`${status} `) || text.startsWith(`${status}—`) || text.startsWith(`${status}-`) || text.startsWith(`${status}(`));
  return found || "";
}

export function listingKnown(value: string): boolean {
  return value.trim() === "" || listingToken(value) !== "";
}

/** Same gate the build uses for Listed, plus the annotated cells and the gone regex. */
export function listingFlags(value: string): { listed: boolean; removed: boolean } {
  const token = listingToken(value);
  const removed = GONE.test(value) || token === "Gone" || token === "Removed" || token === "Sold or withdrawn";
  return { listed: token === "Listed" && !removed, removed };
}

export function scrubText(value: string): string {
  return value
    .replace(/\bodd\b/gi, "service area")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/^[\s,;:-]+|[\s,;:-]+$/g, "");
}

/** Drop sentences that name an agent, then cap the public note. */
export function displayNote(value: string): string {
  const text = scrubText(value);
  if (!text) return "";
  const kept = text
    .split(/(?<=[.!?])\s+|;\s+/)
    .map((part) => part.trim())
    .filter((part) => part && !AGENT_NAME.test(part));
  return kept.join(". ").slice(0, 400);
}

export function parseMeasure(value: string): number | null {
  if (!value.trim()) return null;
  const match = value.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const number = Number(match[0]);
  return Number.isFinite(number) ? number : null;
}

export function pricePerAcre(asking: string, acres: string): string {
  const price = parseMeasure(asking);
  const land = parseMeasure(acres);
  if (price == null || land == null || land === 0) return "";
  return String(Math.round((price / land) * 100) / 100);
}

export function sheetCanonical(cells: Record<string, string>): string {
  const keys = Object.keys(cells).filter((key) => cells[key]?.trim()).sort((a, b) => a.localeCompare(b));
  const out: Record<string, string> = {};
  for (const key of keys) out[key] = cells[key].trim();
  return JSON.stringify(out);
}

export function parseSheet(value: string): Record<string, string> {
  if (!value || value === "{}") return {};
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const [key, cell] of Object.entries(parsed)) out[key] = text(cell);
    return out;
  } catch {
    return {};
  }
}

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
    if (!listingKnown(row.listing_status)) issues.push({ id: row.site_id, field: "listing_status", value: row.listing_status });
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

function factRecord(props: Record<string, unknown>): Record<string, string> {
  const facts: Record<string, string> = {};
  const put = (key: FactField, value: unknown) => {
    const textValue = key.endsWith("_source") || key.endsWith("_basis") || key.endsWith("_kind") || key.endsWith("_line") || key.endsWith("_match") || key.endsWith("_road") || key.endsWith("_phase") || key.endsWith("_feeder") || key.endsWith("_horizon") || key === "folder_url" || key === "checked_live" || key === "site_capacity" || key.endsWith("_as_of") || key.endsWith("_confidence")
      ? text(value)
      : canonicalFact(value);
    if (textValue) facts[key] = textValue;
  };
  put("asking_price_source", props.asking_price_source);
  put("land_acres_basis", props.land_acres_basis);
  put("parcel_acres", props.parcel_acres);
  put("parcel_match", props.parcel_match);
  put("open_land_sqft", props.open_land_sqft);
  put("open_land_basis", props.open_land_basis);
  put("bays_that_fit", props.bays_that_fit);
  put("site_capacity", props.site_capacity);
  put("source_kind", props.source_kind);
  put("source_line", props.source_line);
  put("folder_url", props.folder_url);
  put("checked_live", props.checked_live);
  for (const key of FACT_FIELDS) {
    if (key.startsWith("cap_") || key.startsWith("trade_")) put(key, props[key]);
  }
  if (!facts.price_per_acre) facts.price_per_acre = pricePerAcre(canonicalFact(props.asking_price), canonicalFact(props.land_acres));
  if (!facts.price_per_acre) delete facts.price_per_acre;
  return facts;
}

function sheetById(sheetJson: string): Map<string, Record<string, string>> {
  const map = new Map<string, Record<string, string>>();
  if (!sheetJson.trim()) return map;
  try {
    const parsed = JSON.parse(sheetJson) as { rows?: { site_id?: string; cells?: Record<string, unknown> }[] };
    for (const row of parsed.rows || []) {
      const id = text(row.site_id);
      if (!id || !row.cells) continue;
      const cells: Record<string, string> = {};
      for (const [key, value] of Object.entries(row.cells)) {
        const cell = text(value);
        if (cell) cells[key] = cell;
      }
      map.set(id, cells);
    }
  } catch {
    return map;
  }
  return map;
}

export function sitesFromFiles(dealsJson: string, pricingJson = "", sheetJson = ""): SiteRow[] {
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
  const sheets = sheetById(sheetJson);
  const map = new Map<string, SiteRow>();
  for (const feature of deals.features || []) {
    const props = feature.properties || {};
    const siteId = text(props.deal_id);
    if (!siteId) continue;
    const point = coordinates(feature);
    const county = priced[siteId] || {};
    const picture = photosFromUnknown(props.photos);
    const cells = sheets.get(siteId) || {};
    const raw = (header: string): string => cells[header] || "";
    const row: SiteRow = {
      site_id: siteId,
      coord_status: text(props.coord_status),
      sheet: sheetCanonical(cells),
      facts: factRecord(props),
      ...emptySiteFields(),
      name: raw("Name") || text(props.name),
      address: raw("Address") || raw("Site") || text(props.address),
      market: raw("Market") || text(props.city),
      lat: point.lat,
      lng: point.lng,
      category: text(props.business_type),
      broker: text(props.broker),
      firm: text(props.firm),
      listing_url: raw("Listing link") || text(props.listing_url),
      asking_price: raw("Asking price ($)") || canonicalFact(props.asking_price),
      acreage: raw("Land (acres)") || canonicalFact(props.land_acres),
      apn: raw("APN or folio") || raw("APN") || text(props.apn),
      land_value: canonicalFact(props.land_value ?? county.land_value),
      improvement_value: canonicalFact(props.improvement_value ?? county.improvement_value),
      county_value: canonicalFact(county.county_value),
      county_value_basis: text(county.county_value_basis),
      service_area_class: text(props.service_area_class || props.service_area),
      service_area_distance_mi: canonicalFact(props.service_area_distance_mi),
      service_area_polygon: text(props.service_area_polygon),
      miles_to_depot: canonicalFact(props.miles_to_depot),
      notes: raw("Next step") || text(props.next_step),
      photo_refs: photoCanonical(picture),
      photo_status: text(props.photo_status),
      photo_diligence_count: canonicalFact(props.photo_diligence_count),
      photo_listing_count: canonicalFact(props.photo_listing_count),
      photos_checked: text(props.photos_checked),
      photo_notes: text(props.photo_notes),
      universe_id: text(props.universe_id),
      listing_status: raw("Listing status") || listingStatus(props),
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

/** Diff and import compare raw cells plus the stored measures. Display text is not the comparison. */
export function siteComparable(row: SiteRow): Record<string, string> {
  const fields: Record<string, string> = { ...fieldsOf(row), coord_status: row.coord_status || "", sheet: row.sheet || "{}" };
  for (const field of FACT_FIELDS) fields[field] = row.facts?.[field] || "";
  return fields;
}

export const SITE_COMPARE_FIELDS = ["coord_status", "sheet", ...SITE_FIELDS, ...FACT_FIELDS] as const;
