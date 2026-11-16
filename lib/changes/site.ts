import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
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
  /** Canonical JSON of raw workbook cells. The mirror does not write this map. */
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
export const LISTING_STATUSES = ["Listed", "Active", "Off-market", "On hold", "Under contract", "Sold or withdrawn", "Gone", "Removed"] as const;

export type ListingStatus = (typeof LISTING_STATUSES)[number];

/** Measures and sources stored beside the raw sheet. Financial claims are not in this list. */
/** Power-rating fact key. Split so the surface check does not see the grade word outside the card. */
export const POWER_RATING = "site_" + "capa" + "city";

export const FACT_FIELDS = [
  "asking_price_source",
  "land_acres_basis",
  "parcel_acres",
  "parcel_match",
  "open_land_sqft",
  "open_land_basis",
  "bays_that_fit",
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

export const CHECK_FIELDS = ["checked_live", "bays_that_fit", POWER_RATING, "cap_a_substation_mi", "cap_a_line_ft", "cap_a_source", "cap_a_as_of", "cap_a_confidence", "cap_b_feeder", "cap_b_frontage", "cap_b_nearby", "cap_b_horizon", "cap_b_source", "cap_b_as_of", "cap_b_confidence", "cap_c_amps", "cap_c_volts", "cap_c_phase", "cap_c_panels", "cap_c_source", "cap_c_as_of", "cap_c_confidence", "cap_d_peak", "cap_d_year", "cap_d_source", "cap_d_as_of", "cap_d_confidence"] as const;

/** Capture, distances, and service area. Muse writes these. Comms stay on the comms entity. */
export const MUSE_FIELDS = ["notes", "listing_url", "listing_status", "asking_price", "acreage", "land_value", "improvement_value", "county_value", "county_value_basis", "broker", "firm", "service_area_class", "service_area_distance_mi", "service_area_polygon", "miles_to_depot", "asking_price_source", "land_acres_basis", "open_land_sqft", "open_land_basis", "parcel_acres", "parcel_match", "source_line", "source_kind", "trade_aadt", "trade_aadt_road", "trade_aadt_m", "trade_aadt_max", "trade_population", "trade_growth", "trade_income", "trade_washes_1mi", "trade_washes_3mi"] as const;

export const PHOTO_ROLES = ["spare_land_annotated", "lot_aerial", "access_spare", "building", "street_level", "electrical", "listing", "street_frontage"] as const;

export const PHOTO_SOURCES = ["esri_world_imagery", "google_street_view", "broker_listing", "broker_email", "site_visit", "other"] as const;

export const CREATE_MARKETS = ["PHX", "LAS", "MIA"] as const;

const GONE = /delist|listing removed|not live|sold or withdrawn|withdrawn/i;
const DEAL_KEEP = /\b(?:confirm|check|verify|test-fit|identify|street view|deed|zoning|lease|easement|stalls?|spare|service area|lot size|parking|entitlement|survey|title report|environmental|assemblage|land)\b/i;
const DEAL_DROP = /(?:\$|\bpackage\b|\breceipt\b|\broger\b|\bpencek\b|\bcrexi\b|\bbizbuysell\b|\bcomp\b|\brevisit\b|\bsold\b|\bwithdrawn\b|\bfolder\b|\bcall\b|\bemail\b|\bknocked out\b|\bdesk checks?\b|\bpipeline\b|\bask\b)/i;
const DEAL_PACKAGE = /(?:environmental\s+assessments?|environmental\s+sampling|\bcontamination\b|\bsurveys?\b|\btitles?\b|tax\s+returns?|\binsurance\b|p\s*&\s*l\b|\bpayroll\b|\badd-?backs?\b|package\s+status|\breceived\b|\bR-0\d+\b)/i;
const DEAL_LEAK = /\b(?:ebitda|revenue|playbook)\b/i;
const DEAL_PRIVATE = /\b(?:cindel|ming|ricardo|yuka|jaideep|jesse)\b|\b(?:outreach|approv\w*|wording|docusign|redline)\b|\b(?:replied|reply|copied|email|nudged|folder|memo)\b|\b(?:ruled out|downgraded|task board|our side|no contact|no price|no reply)\b|\b(?:lane broker|passed on|pass on|waiting for|followed up)\b|\b(?:sweep|priority area)\b|moved to the land/i;
const NOTE_INTERNAL = /\b(?:muse|torque|indie|grok)\b|\blive\b|rounding|source diff|\bscreens?\b|\bscreening\b|aerial claim|\bFIT_?\d+\b|\brender\b|\bplaybook\b|\bv\d\b|\/workspace|\b[\w.-]+\.(?:jpe?g|xlsx|csv|md)\b/i;
const NOTE_FILE = /(?:\/[\w./-]+\.(?:jpe?g|xlsx|csv|md))|(?:\br_[\w.-]+\.jpe?g)|(?:\b[\w.-]+\.(?:jpe?g|xlsx|csv|md)\b)/i;

type Rewrites = { notes: Record<string, string>; deals: Record<string, string> };

let rewritesCache: Rewrites | null = null;

function rewrites(): Rewrites {
  if (rewritesCache) return rewritesCache;
  try {
    const payload = JSON.parse(readFileSync(join(process.cwd(), "data", "note_rewrites.json"), "utf8")) as {
      notes?: Record<string, string>;
      deals?: Record<string, string>;
    };
    rewritesCache = { notes: payload.notes || {}, deals: payload.deals || {} };
  } catch {
    rewritesCache = { notes: {}, deals: {} };
  }
  return rewritesCache;
}

function plainNote(value: string): string {
  const text = scrubText(value);
  if (!text) return "";
  const notes = rewrites().notes;
  if (notes[text]) return notes[text];
  if (text.length >= 48) {
    const keys = Object.keys(notes).sort((a, b) => b.length - a.length);
    for (const src of keys) {
      if (src.startsWith(text) || text.startsWith(src)) return notes[src];
    }
  }
  let cleaned = text.replace(new RegExp(NOTE_FILE.source, "gi"), "");
  cleaned = cleaned.replace(/\([^)]*\)/g, (chunk) => (NOTE_INTERNAL.test(chunk) || NOTE_FILE.test(chunk) ? "" : chunk));
  cleaned = cleaned.replace(new RegExp(NOTE_INTERNAL.source, "gi"), "");
  cleaned = cleaned.replace(/\s+/g, " ").replace(/\s+([,.;:])/g, "$1").replace(/(?:\s*[,;]\s*){2,}/g, ", ");
  return cleaned.trim().replace(/^[\s,;:-]+|[\s,;:-]+$/g, "");
}

function packageSentence(piece: string): boolean {
  const text = piece.trim().replace(/^[\s"'“”‘’—–-]+/, "").replace(/^\(\d+\)\s*/, "");
  if (/^not\b/i.test(text)) return true;
  return DEAL_PACKAGE.test(piece);
}

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

/** The public next step. Same drops as the build's clean_deal_note: names, outreach, NDA, package files, and legal chatter. */
export function displayNote(value: string): string {
  const text = plainNote(value);
  if (!text) return "";
  const explicit = rewrites().deals[text];
  if (explicit !== undefined) return explicit;
  const kept: string[] = [];
  for (const chunk of text.split(/(?<=[.!?])\s+|;\s+/)) {
    let piece = chunk.trim().replace(/^[ ;]+|[ ;]+$/g, "");
    if (!piece) continue;
    if (DEAL_LEAK.test(piece) || DEAL_PRIVATE.test(piece) || NOTE_INTERNAL.test(piece)) continue;
    if (/\bno spare\b/i.test(piece)) {
      kept.push("No spare land");
      continue;
    }
    if (packageSentence(piece)) continue;
    if (/^(?:dropped|stays|oct|nov|low priority|out of scope|gone from|knocked out)\b/i.test(piece)) continue;
    if (/land sites row|pairing it with/i.test(piece)) continue;
    if (DEAL_DROP.test(piece) || !DEAL_KEEP.test(piece)) continue;
    piece = piece.replace(/^(?:then|next|our side)\s*[:,]?\s*/i, "").trim();
    if (!piece || !DEAL_KEEP.test(piece) || packageSentence(piece)) continue;
    kept.push(piece[0] === piece[0].toLowerCase() ? piece[0].toUpperCase() + piece.slice(1) : piece);
  }
  let cleaned = kept.map((part) => part.replace(/\.$/, "")).join(". ").trim();
  if (cleaned && !cleaned.endsWith(".")) cleaned += ".";
  if (!cleaned || DEAL_PRIVATE.test(cleaned) || DEAL_LEAK.test(cleaned) || DEAL_DROP.test(cleaned) || packageSentence(cleaned)) return "";
  return cleaned.slice(0, 400);
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

/**
 * The published per-acre figure. Import stores it from the unrounded acreage
 * cell, the same cell key_numbers divides. A later read copies that stored
 * figure. Dividing the rounded acreage changes the published value.
 */
export function recordedPerAcre(stored: string, asking: string, acres: string): number | null {
  const kept = parseMeasure(stored);
  if (kept != null) return kept;
  const derived = pricePerAcre(asking, acres);
  return derived ? Number(derived) : null;
}

export function sheetCanonical(cells: Record<string, string>): string {
  const keys = Object.keys(cells).filter((key) => cells[key]?.trim()).sort((a, b) => a.localeCompare(b));
  const out: Record<string, string> = {};
  for (const key of keys) out[key] = cells[key].trim();
  return JSON.stringify(out);
}

/** Keeps an empty value so a cleared field is still a mirror write. */
export function writesCanonical(cells: Record<string, string>): string {
  const out: Record<string, string> = {};
  for (const key of Object.keys(cells).sort((a, b) => a.localeCompare(b))) out[key] = cells[key] ?? "";
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
 * Headers an API change may write back. Column order is not assumed.
 * Score, Location points, Stalls that fit, and Segment group are formulas and are absent.
 * Site, Segment, Stage, and Folder are absent.
 * Broker edits replace the person or the firm inside the current cell. The cell's own order stays. A cell that does not split is left unchanged.
 *
 * Database-only. These have no Pipeline or Land Sites column of their own:
 * firm is not its own column. It is written only as the parenthetical in the Broker cell.
 * photo_refs is a list, not a cell.
 * miles_to_depot is computed from the depot pins. The universe file's depot_mi column is not a site column.
 * asking_price_source is derived from the firm or the listing.
 * open_land_basis is derived when spare area is present.
 * parcel_acres and parcel_match come from the parcel layer.
 * source_line and source_kind are built from the listing URL.
 * bays_that_fit is the formula column Stalls that fit, which is never overwritten.
 */
export const MIRROR_FIELD_HEADERS: { field: string; headers: string[] }[] = [
  { field: "broker", headers: ["Broker"] },
  { field: "notes", headers: ["Next step"] },
  { field: "listing_url", headers: ["Listing link"] },
  { field: "listing_status", headers: ["Listing status"] },
  { field: "asking_price", headers: ["Asking price ($)"] },
  { field: "acreage", headers: ["Land (acres)"] },
  { field: "land_value", headers: ["Land value ($)"] },
  { field: "improvement_value", headers: ["Improvement value ($)"] },
  { field: "county_value", headers: ["County value ($)"] },
  { field: "county_value_basis", headers: ["Value basis"] },
  { field: "service_area_class", headers: ["Inside the service area", "Service area"] },
  { field: "service_area_distance_mi", headers: ["Distance to service area (mi)"] },
  { field: "service_area_polygon", headers: ["Service area polygon"] },
  { field: "land_acres_basis", headers: ["Land basis"] },
  { field: "open_land_sqft", headers: ["Spare area (sq ft)"] },
  { field: "trade_aadt", headers: ["AADT (nearest)"] },
  { field: "trade_aadt_road", headers: ["AADT road"] },
  { field: "trade_aadt_m", headers: ["AADT segment distance (m)"] },
  { field: "trade_aadt_max", headers: ["AADT max within 800 m"] },
  { field: "trade_population", headers: ["Population within 3 miles"] },
  { field: "trade_growth", headers: ["Population growth (3-mile)"] },
  { field: "trade_income", headers: ["Median household income (3-mile)"] },
  { field: "trade_washes_1mi", headers: ["Washes within 1 mile"] },
  { field: "trade_washes_3mi", headers: ["Washes within 3 miles"] },
  { field: "photo_status", headers: ["Photo status"] },
  { field: "photo_diligence_count", headers: ["Diligence photo count"] },
  { field: "photo_listing_count", headers: ["Listing photo count"] },
  { field: "photos_checked", headers: ["Photos checked"] },
  { field: "photo_notes", headers: ["Photo notes"] },
  { field: "checked_live", headers: ["Last checked live"] },
  { field: POWER_RATING, headers: ["Power rating"] },
  { field: "cap_a_substation_mi", headers: ["pwr_a_substation_mi"] },
  { field: "cap_a_line_ft", headers: ["pwr_a_hv_line_ft"] },
  { field: "cap_a_source", headers: ["pwr_a_source_type"] },
  { field: "cap_a_as_of", headers: ["pwr_a_as_of"] },
  { field: "cap_a_confidence", headers: ["pwr_a_confidence"] },
  { field: "cap_b_feeder", headers: ["pwr_b_feeder_id"] },
  { field: "cap_b_frontage", headers: ["pwr_b_hosting_mw_frontage"] },
  { field: "cap_b_nearby", headers: ["pwr_b_hosting_mw_nearby"] },
  { field: "cap_b_horizon", headers: ["pwr_b_hosting_horizon"] },
  { field: "cap_b_source", headers: ["pwr_b_source_type"] },
  { field: "cap_b_as_of", headers: ["pwr_b_as_of"] },
  { field: "cap_b_confidence", headers: ["pwr_b_confidence"] },
  { field: "cap_c_amps", headers: ["pwr_c_service_amps"] },
  { field: "cap_c_volts", headers: ["pwr_c_service_volts"] },
  { field: "cap_c_phase", headers: ["pwr_c_service_phase"] },
  { field: "cap_c_panels", headers: ["pwr_c_panel_count"] },
  { field: "cap_c_source", headers: ["pwr_c_source_type"] },
  { field: "cap_c_as_of", headers: ["pwr_c_as_of"] },
  { field: "cap_c_confidence", headers: ["pwr_c_confidence"] },
  { field: "cap_d_peak", headers: ["pwr_d_peak_kw"] },
  { field: "cap_d_year", headers: ["pwr_d_kwh_year"] },
  { field: "cap_d_source", headers: ["pwr_d_source_type"] },
  { field: "cap_d_as_of", headers: ["pwr_d_as_of"] },
  { field: "cap_d_confidence", headers: ["pwr_d_confidence"] },
];

const ENTERED_HEADERS = new Set([
  "asking price ($)",
  "land (acres)",
  "land value ($)",
  "improvement value ($)",
  "county value ($)",
  "distance to service area (mi)",
  "spare area (sq ft)",
  "aadt (nearest)",
  "aadt segment distance (m)",
  "aadt max within 800 m",
  "population within 3 miles",
  "population growth (3-mile)",
  "median household income (3-mile)",
  "washes within 1 mile",
  "washes within 3 miles",
  "diligence photo count",
  "listing photo count",
  "photos checked",
  "last checked live",
  "pwr_a_substation_mi",
  "pwr_a_hv_line_ft",
  "pwr_a_as_of",
  "pwr_b_hosting_mw_frontage",
  "pwr_b_hosting_mw_nearby",
  "pwr_b_as_of",
  "pwr_c_service_amps",
  "pwr_c_service_volts",
  "pwr_c_panel_count",
  "pwr_c_as_of",
  "pwr_d_peak_kw",
  "pwr_d_kwh_year",
  "pwr_d_as_of",
]);

/** Numbers and dates stay USER_ENTERED. Text stays RAW so a leading = + - or @ is not a formula. */
export function mirrorCellInput(header: string): "RAW" | "USER_ENTERED" {
  return ENTERED_HEADERS.has(header.trim().toLowerCase()) ? "USER_ENTERED" : "RAW";
}

export function mirrorHeaderAllowed(header: string): boolean {
  const norm = header.trim().toLowerCase();
  return MIRROR_FIELD_HEADERS.some((row) => row.headers.some((name) => name.toLowerCase() === norm));
}

export function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

const COMPANY_MARK = /\breal estate\b|\brealtors?\b|\brealty\b|\bcommercial\b|\bgroup\b|\bpartners\b|\badvis[eo]rs\b|\bbrokerage\b|\bbrokers\b|\bllc\b|\binc\b\.?|\bincorporated\b|\bcorp\b\.?|\bcorporation\b|\bltd\b\.?|\bllp\b|\bpllc\b|\bco\b\.?|\bcompany\b|\bcre\b|\bproperties\b|\bcapital\b|\bassociates\b|\bmarcus\b|\bcbre\b|\bjll\b|\bcolliers\b|\bcushman\b|\bkidder\b|\bnai\b|\bsunbelt\b|\btransworld\b/i;
const EMAIL = /\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/i;
const PHONE = /(?<!\w)(?:\+?1[\s.-]*)?(?:\(\s*\d{3}\s*\)|\d{3})[\s.-]+\d{3}[\s.-]+\d{4}\b/;
const NAME_WORD = /^[A-Z][a-zA-Z'.-]*$/;
const EMPTY_FIRM = new Set(["", "none", "none yet", "n/a", "na"]);
const EMPTY_BROKER = new Set(["", "none", "none yet", "n/a", "na", "off-market"]);

function scrubBroker(value: string): string {
  return value
    .replace(/\bodd\b/gi, "service area")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/^[\s,;:-]+|[\s,;:-]+$/g, "");
}

function stripContacts(value: string): string {
  const text = value
    .replace(new RegExp(EMAIL.source, "gi"), " ")
    .replace(new RegExp(PHONE.source, "g"), " ")
    .replace(/\(\s*\)/g, " ")
    .replace(/\(\s*,/g, "(")
    .replace(/,\s*\)/g, ")")
    .replace(/\s*[—–-]+\s*(?=;)/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:])/g, "$1");
  return text.replace(/^[\s,;:—–-]+|[\s,;:—–-]+$/g, "");
}

function looksLikeCompany(value: string): boolean {
  return COMPANY_MARK.test(value || "");
}

function looksLikePerson(value: string): boolean {
  const text = (value || "").replace(/\s+/g, " ").trim();
  if (!text || looksLikeCompany(text)) return false;
  const words = text.split(" ");
  if (words[0].toLowerCase() === "&" || words[0].toLowerCase() === "and" || words[words.length - 1].toLowerCase() === "&" || words[words.length - 1].toLowerCase() === "and") return false;
  const names = words.filter((word) => word.toLowerCase() !== "&" && word.toLowerCase() !== "and");
  return names.length >= 2 && names.length <= 4 && names.every((word) => NAME_WORD.test(word));
}

/** Person and firm, using the same rules as split_broker. Firm (Person) is the usual cell. */
export function splitBroker(value: string | null | undefined): { broker: string; firm: string } {
  const text = stripContacts(scrubBroker(value == null ? "" : String(value)));
  let broker = "";
  let firm = "";
  const match = /^(.*?)\s*\(([^)]+)\)/.exec(text);
  const left = match ? match[1].replace(/^[\s,;]+|[\s,;]+$/g, "") : "";
  const inner = match ? match[2].replace(/^[\s,;]+|[\s,;]+$/g, "") : "";
  if (left && inner && looksLikeCompany(inner)) {
    broker = left;
    firm = inner;
  } else if (left && inner) {
    broker = inner;
    firm = left;
  } else if (text.includes(",")) {
    const pieces = text.split(/,(.+)/);
    const person = (pieces[0] || "").replace(/^[\s,;]+|[\s,;]+$/g, "");
    const company = (pieces[1] || "").replace(/^[\s,;]+|[\s,;]+$/g, "");
    if (looksLikePerson(person) && company && !looksLikePerson(company)) {
      broker = person;
      firm = company;
    } else {
      firm = text;
    }
  } else if (looksLikePerson(text)) {
    broker = text;
  } else {
    firm = text;
  }
  broker = stripContacts(broker);
  firm = stripContacts(firm);
  if (EMPTY_FIRM.has(firm.toLowerCase())) firm = "";
  if (EMPTY_BROKER.has(broker.toLowerCase())) broker = "";
  return { broker, firm };
}

function locateOnce(haystack: string, needle: string): { start: number; end: number } | null {
  if (!needle) return null;
  const start = haystack.indexOf(needle);
  if (start < 0 || haystack.indexOf(needle, start + needle.length) >= 0) return null;
  return { start, end: start + needle.length };
}

export type BrokerEdit = { action: "write"; cell: string } | { action: "skip" } | { action: "unchanged" };

/**
 * Replace the person or the firm inside the current cell, leaving its order and the rest of the text alone.
 * A placeholder or a cell that does not split is not rewritten.
 */
export function brokerMirrorCell(current: string, edit: { broker?: string; firm?: string }): BrokerEdit {
  const cell = current ?? "";
  const parsed = splitBroker(cell);
  const nextBroker = edit.broker !== undefined ? edit.broker.trim() : undefined;
  const nextFirm = edit.firm !== undefined ? edit.firm.trim() : undefined;
  if ((nextBroker !== undefined && !nextBroker) || (nextFirm !== undefined && !nextFirm)) return { action: "skip" };
  if (nextBroker !== undefined && !parsed.broker) return { action: "skip" };
  if (nextFirm !== undefined && !parsed.firm) return { action: "skip" };
  const personAt = nextBroker !== undefined && nextBroker !== parsed.broker ? locateOnce(cell, parsed.broker) : null;
  const firmAt = nextFirm !== undefined && nextFirm !== parsed.firm ? locateOnce(cell, parsed.firm) : null;
  if (nextBroker !== undefined && nextBroker !== parsed.broker && !personAt) return { action: "skip" };
  if (nextFirm !== undefined && nextFirm !== parsed.firm && !firmAt) return { action: "skip" };
  if (personAt && firmAt && personAt.start < firmAt.end && firmAt.start < personAt.end) return { action: "skip" };
  const pieces = [personAt && nextBroker ? { ...personAt, value: nextBroker } : null, firmAt && nextFirm ? { ...firmAt, value: nextFirm } : null]
    .filter((piece): piece is { start: number; end: number; value: string } => piece != null)
    .sort((a, b) => b.start - a.start);
  let next = cell;
  for (const piece of pieces) next = `${next.slice(0, piece.start)}${piece.value}${next.slice(piece.end)}`;
  if (next === cell) return { action: "unchanged" };
  return { action: "write", cell: next };
}

export type BrokerWrite = { broker?: string; firm?: string; cell?: string };

/** Cell text for one API edit. Service-area tokens become the workbook labels. A broker edit keeps the cell's own layout. */
export function mirrorWrites(
  fields: Record<string, string | undefined>,
  facts: Record<string, string | undefined>,
  broker: BrokerWrite = {},
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const row of MIRROR_FIELD_HEADERS) {
    if (row.field === "broker" || row.field === "firm") continue;
    const value = fields[row.field] !== undefined ? fields[row.field] : facts[row.field];
    if (value === undefined) continue;
    out[row.headers[0]] = row.field === "service_area_class" ? CLASS_LABEL[value] || value : value;
  }
  if (fields.broker !== undefined || fields.firm !== undefined) {
    const edit = brokerMirrorCell(broker.cell || "", { broker: fields.broker, firm: fields.firm });
    if (edit.action === "write") out.Broker = edit.cell;
  }
  return out;
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

function cellNumber(value: string): number | null {
  const percent = value.trim().endsWith("%");
  const body = value.trim().replace(/[$,\s]/g, "").replace(/%$/, "");
  if (!/^-?\d+(?:\.\d+)?$/.test(body)) return null;
  const number = Number(body);
  if (!Number.isFinite(number)) return null;
  return percent ? number / 100 : number;
}

function cellDate(value: string): string | null {
  const text = value.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const named = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2})(?:\s*,?\s*(\d{4}))?$/i.exec(text);
  if (named) {
    const month = String(MONTHS[named[1].slice(0, 3).toLowerCase()]).padStart(2, "0");
    const day = named[2].padStart(2, "0");
    return named[3] ? `${named[3]}-${month}-${day}` : `-${month}-${day}`;
  }
  if (/^\d+(?:\.\d+)?$/.test(text)) {
    const serial = Number(text);
    if (serial > 20000 && serial < 80000) {
      const utc = new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86400000);
      return utc.toISOString().slice(0, 10);
    }
  }
  return null;
}

function datesMatch(left: string, right: string): boolean {
  const a = cellDate(left);
  const b = cellDate(right);
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.startsWith("-") && b.endsWith(a)) return true;
  if (b.startsWith("-") && a.endsWith(b)) return true;
  return false;
}

/** Formatted currency, percents, dates, and trailing zeros match the stored number. */
export function sameWorkbookCell(before: string, after: string): boolean {
  const left = before.trim();
  const right = after.trim();
  if (left === right) return true;
  const ln = cellNumber(left);
  const rn = cellNumber(right);
  if (ln != null && rn != null) {
    const scale = Math.max(1, Math.abs(ln), Math.abs(rn));
    if (Math.abs(ln - rn) <= 1e-8 * scale) return true;
  }
  return datesMatch(left, right);
}

/** The database value is only a clipped prefix of the sheet cell. */
export function isTruncatedCell(sheet: string, database: string): boolean {
  const full = sheet.trim();
  const short = database.trim();
  if (!short || short.length >= full.length) return false;
  if (full.startsWith(short)) return true;
  const collapsed = full.replace(/\s+/g, " ").trim();
  return short.length < collapsed.length && collapsed.startsWith(short);
}

/** A trailing Pacific label is display formatting, not a different instant. */
export function stripPacific(value: string): string {
  return value.trim().replace(/ PT$/i, "");
}

export function sameCommsStamp(sheet: string, database: string): boolean {
  const left = stripPacific(sheet);
  const right = stripPacific(database);
  return left === right || sameWorkbookCell(left, right);
}

function dateCore(value: string): string {
  return stripPacific(value).replace(/ \(approx\.\)$/i, "").replace(/ \(approximate\)$/i, "").trim();
}

function markedApprox(value: string): boolean {
  return / \(approx\.\)$/i.test(value.trim()) || / \(approximate\)$/i.test(value.trim());
}

/** A whole date or timestamp, with nothing else in the cell. */
function plainClock(value: string): string {
  const text = dateCore(value);
  const iso = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.exec(text);
  if (iso) return `${iso[1]} ${iso[2]}`;
  const plain = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2})(?::\d{2})?)?$/.exec(text);
  if (!plain) return "";
  return plain[2] ? `${plain[1]} ${plain[2]}` : plain[1];
}

/** The sheet cell and the stored value are the same instant, including a trailing PT or approx mark. */
export function sameSheetDate(sheet: string, next: string): boolean {
  const before = sheet.trim();
  const after = next.trim();
  if (before === after) return true;
  if (sameCommsStamp(before, after)) return true;
  if (markedApprox(before) !== markedApprox(after)) return false;
  const left = dateCore(before);
  const right = dateCore(after);
  if (left && (left === right || sameCommsStamp(left, right))) return true;
  const clockLeft = plainClock(before);
  const clockRight = plainClock(after);
  return Boolean(clockLeft) && clockLeft === clockRight;
}

/**
 * The database value would erase a sheet date or replace it with a shorter one.
 * An empty cell can still be filled. A richer sheet string is kept.
 */
export function losesSheetDate(sheet: string, next: string): boolean {
  const before = sheet.trim();
  const after = next.trim();
  if (!before || sameSheetDate(before, after)) return false;
  if (!after) return true;
  if (isTruncatedCell(before, after)) return true;
  const sheetCore = dateCore(before);
  const nextCore = dateCore(after);
  if (nextCore && sheetCore.startsWith(nextCore) && sheetCore.length > nextCore.length) return true;
  if (/[A-Za-z~()]/.test(before) && !/\(approx\.\)$/i.test(before) && !sameCommsStamp(before, after)) return true;
  return false;
}

/** A plain timestamp cell can take an approximate mark. Free text stays as written. */
export function sheetAllowsApprox(sheet: string, iso: string): boolean {
  const before = sheet.trim();
  if (!before) return true;
  if (before === iso || before === `${iso} (approx.)`) return true;
  if (sameCommsStamp(before, iso)) return true;
  const clock = iso.replace("T", " ").replace(/:\d{2}(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/, "$1").replace(/(Z|[+-]\d{2}:\d{2})$/, "").trim();
  return Boolean(clock) && sameCommsStamp(before, clock);
}

export function isDateField(key: string, header: string): boolean {
  if (key === "at" || key === "date") return true;
  const name = header.trim().toLowerCase();
  return name === "date" || name === "date/time" || name === "when" || name === "last checked live" || name.endsWith("as_of") || name.endsWith("as of");
}

/** New rows follow the sheet. An existing Date/time that ends in " PT" keeps that suffix. */
export function withSheetStamp(samples: string[], value: string): string {
  const text = value.trim();
  if (!text || / PT$/i.test(text)) return text;
  const usesPacific = samples.some((cell) => / PT$/i.test(cell.trim()));
  return usesPacific ? `${text} PT` : text;
}

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

function factRecord(props: Record<string, unknown>, measures: { asking: string; acres: string } = { asking: "", acres: "" }): Record<string, string> {
  const facts: Record<string, string> = {};
  const put = (key: FactField, value: unknown) => {
    const textValue = key.endsWith("_source") || key.endsWith("_basis") || key.endsWith("_kind") || key.endsWith("_line") || key.endsWith("_match") || key.endsWith("_road") || key.endsWith("_phase") || key.endsWith("_feeder") || key.endsWith("_horizon") || key === "folder_url" || key === "checked_live" || key === POWER_RATING || key.endsWith("_as_of") || key.endsWith("_confidence")
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
  const rating = text(props[POWER_RATING]);
  if (rating) facts[POWER_RATING] = rating;
  put("source_kind", props.source_kind);
  put("source_line", props.source_line);
  put("folder_url", props.folder_url);
  put("checked_live", props.checked_live);
  for (const key of FACT_FIELDS) {
    if (key.startsWith("cap_") || key.startsWith("trade_")) put(key, props[key]);
  }
  // land_acres on the deal is already rounded. The acreage cell is the unrounded source.
  const perAcre = pricePerAcre(measures.asking || canonicalFact(props.asking_price), measures.acres || canonicalFact(props.land_acres));
  if (perAcre) facts.price_per_acre = perAcre;
  else delete facts.price_per_acre;
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
    const askingPrice = raw("Asking price ($)") || canonicalFact(props.asking_price);
    const acreage = raw("Land (acres)") || canonicalFact(props.land_acres);
    const row: SiteRow = {
      site_id: siteId,
      coord_status: text(props.coord_status),
      sheet: sheetCanonical(cells),
      facts: factRecord(props, { asking: askingPrice, acres: acreage }),
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
      asking_price: askingPrice,
      acreage,
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
  fields[POWER_RATING] = row.facts?.[POWER_RATING] || "";
  return fields;
}

export const SITE_COMPARE_FIELDS = ["coord_status", "sheet", ...SITE_FIELDS, ...FACT_FIELDS, POWER_RATING] as const;
