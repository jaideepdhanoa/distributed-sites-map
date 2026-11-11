export const STATUS_NOTES: { id: string; label: string; note: string }[] = [
  { id: "cleared", label: "Cleared", note: "County records confirm an operating wash with enough spare land on its own parcel." },
  { id: "held", label: "Held", note: "Cleared, but outside the current service area." },
  { id: "possible", label: "Possible", note: "The county check found borderline land. It needs a closer look." },
  { id: "unresolved", label: "Unresolved", note: "County records are incomplete or conflicting." },
  { id: "unchecked", label: "County record not reviewed", note: "The county parcel record has not been reviewed. The aerial result is separate and does not fill in the county record." },
  { id: "ruled-out", label: "Ruled out", note: "Closed, not a wash, or no spare land. Shown only at the funnel step where it drops out." },
  { id: "listing", label: "Listing", note: "A site or deal that is on the market." },
  { id: "desk", label: "Desk screen", note: "A first review of the listing or lead." },
  { id: "land", label: "Land site", note: "A vacant parcel, such as LAND-PHX. It stays off until the Land category is on. Spare land on a wash is separate." },
  { id: "cstore", label: "C-store", note: "A fuel or convenience store. Hidden until the C-stores category is on." },
  { id: "depot", label: "Depot", note: "Existing operating depot." },
  { id: "offmarket", label: "Off-market, other types", note: "Sites we found ourselves that are not in the car-wash census. No broker or listing yet. Choose a category with Business type." },
];

export const FUNNEL_NOTES: Record<string, string> = {
  universe: "One site for each place after duplicate census records are merged.",
  unique: "One site for each place after duplicate census records are merged.",
  in_area: "Inside the current operating area for that city.",
  land: "Enough spare land for a larger layout, about 10,000 sq ft, or a smaller one, about 4,000 sq ft.",
  county: "In-area sites with enough spare land that also have a county verdict. The workbook checked 110 sites in all: 14 cleared, 30 possible, 47 ruled out, 15 not a car wash, and 4 unresolved. That full set includes sites outside the service area and sites without enough spare land.",
  cleared: "County records confirm an operating wash with enough spare land on its own parcel. The workbook clears 12. Charleston Car Wash and the Chandler Quick Quack stay Possible until review, so the map shows 10.",
  listed: "Sites on this step that are on the market.",
  contacted: "Deals in this city, in the categories you have on, with an outbound email or call to the broker on file. Dropped deals stay out. Census sites are a separate count.",
  desk: "A first review of the listing or lead.",
  financial: "The workbook's financial screen.",
  checks: "The workbook's site checks.",
  close: "The workbook's offer and close work.",
  later: "The workbook's offer and close work.",
  dropped: "The deal is no longer being pursued.",
};

const STORE_TYPE = new Set(["gas station", "convenience store", "fuel", "service station"]);
const STORE_TEXT = /\b(?:gas|fuel|convenience|service station|c[\s-]*stores?|shell|sinclair|arco|chevron|circle\s*k|76|valero|quik\s*trip|ampm|am\s*\/\s*pm)\b/i;

/**
 * Pipeline fuel and c-store deals stay out of the map, list, search, and Review.
 * A car wash stays, including one whose name is Chevron or Circle K. Land listings stay.
 */
export function isPipelineStore(record: {
  kind?: string | null;
  business_type?: string | null;
  name?: string | null;
  description?: string | null;
  source_line?: string | null;
}) {
  if (record.kind !== "pipeline") return false;
  const type = (record.business_type || "").trim().toLowerCase();
  if (type === "car wash") return false;
  if (STORE_TYPE.has(type)) return true;
  const text = [record.name, record.description, record.source_line].filter(Boolean).join(" ");
  if (/\bcar wash\b/i.test(text) && !/\b(?:gas|fuel|convenience|service station|c[\s-]*stores?)\b/i.test(text)) return false;
  return STORE_TEXT.test(text);
}

export const BUSINESS_TYPES = [
  "Car wash",
  "Auto repair",
  "Tire and lube",
  "Gas station",
  "Yard or lot",
  "Storage",
  "Land",
  "Other",
] as const;

export const CENSUS_NOTE = "Car washes. Land parcels and c-stores stay off until you turn those categories on.";

export const CATEGORY_NOTES = {
  wash: "Operating car washes. This is the usual view.",
  land: "Vacant parcels, such as LAND-PHX. Not spare land on a wash.",
  store: "Fuel and convenience stores. Off until you turn them on.",
} as const;

export const SPARE_LAND_NOTE = "Leftover land on an operating wash. This does not turn on vacant land parcels.";

export const SUMMARY_NOTES = {
  universe: "Candidates have spare land inside the service area. Cleared sites passed the county check.",
  pipeline: "Deals in the categories you have on. Car washes are the usual view. Land parcels and c-stores stay off until you turn them on. Desk screen is the first step. Dropped deals are no longer pursued. Deals contacted means an outbound email or call is on file. It is not a stage.",
};

const STAGE_TITLES: Record<string, string> = {
  desk: "Desk screen",
  financial: "Financial screen",
  checks: "Site checks",
  close: "Offer and close",
  contacted: "Financial screen",
  later: "Offer and close",
  dropped: "Dropped",
};

export function stageTitle(group: string) {
  return STAGE_TITLES[group] || "Deal";
}

function unwrapReason(value: string) {
  let text = value.trim();
  while (text.startsWith("(") && text.endsWith(")") && text.length > 2) {
    const inner = text.slice(1, -1).trim();
    if (!inner) break;
    text = inner;
  }
  return text;
}

export function stageDetail(stage: string, group: string) {
  const name = stageTitle(group);
  // Stage 3's workbook label is shortened so the private term in that label never reaches the screen.
  if (group === "checks") return "Site checks";
  const stripped = (stage || "").replace(/^(?:dropped|\d+)\b\s*/i, "").trim();
  const raw = unwrapReason(stripped);
  if (/^financial screen$/i.test(raw)) return "Financial screen";
  if (!raw || raw.toLowerCase() === name.toLowerCase()) return name;
  return `${name} (${raw.charAt(0).toLowerCase()}${raw.slice(1)})`;
}

export function stageTone(deal: { kind?: string; stage_group?: string }) {
  if (deal.stage_group === "dropped") return "sand";
  if (deal.kind === "land") return "sky";
  if (deal.stage_group === "desk") return "brass";
  return "pine";
}

export const AREA_NOTES = {
  current: "The area served today. Las Vegas uses the core and ring 100. Phoenix and Miami use their current boundary.",
  later: "Later expansion. In Las Vegas these are rings 200 and 300. Drawn dashed, with no fill.",
};

export const AREA_KIND_LABEL = {
  current: "Current area",
  later: "Later expansion",
} as const;

/** Hover text for the Layers panel. */
export const LAYER_TITLES = {
  universe: "Universe sites. The car-wash census for this market.",
  pipeline: "Pipeline deals.",
  land: "Vacant land parcels, such as LAND-PHX. Off until the Land category is on. A chosen stage then includes the parcels at that stage.",
  cstore: "Fuel and convenience stores. Off until the C-stores category is on.",
  dropped: "Deals that are no longer being pursued.",
  unscreened: "Listings that have not been screened yet.",
  traffic: "Workbook traffic count on each pin.",
  population: "Workbook population on each pin.",
  washes: "Washes nearby. Counts on each pin. With one site open, census washes within 3 miles are drawn.",
  growth: "Workbook growth on each pin.",
  income: "Workbook income on each pin.",
  areas: "Service areas. Current is solid. Later expansion is dashed.",
  depots: "Existing operating depots.",
  rings: "5- and 10-mile rings around each depot. Depots stay on the map while rings are on.",
  pinOff: "No price or acre label on the pins.",
  pinPrice: "Asking price on each pin.",
  pinAcres: "Acreage on each pin.",
  pinPerAcre: "Asking price per acre on each pin.",
} as const;

export const TIER_NOTES: Record<string, { label: string; note: string }> = {
  L10: {
    label: "Larger site (10,000+ sq ft spare)",
    note: "At least 10,000 sq ft of spare land on the parcel, or on adjoining land with the same owner.",
  },
  L4: {
    label: "Smaller site (4,000+ sq ft spare)",
    note: "At least 4,000 sq ft of spare land, and less than 10,000.",
  },
};

export function tierLabel(tier?: string | null) {
  return TIER_NOTES[tier || ""]?.label || "";
}

export function plainVerdict(verdict?: string | null) {
  if (verdict === "PASS") return "Cleared";
  if (verdict === "MAYBE") return "Possible";
  if (verdict === "FAIL") return "Ruled out";
  if (verdict === "NOT_A_WASH") return "Not a wash";
  if (verdict === "UNRESOLVED") return "Unresolved";
  return "Not reviewed";
}

export function uncheckedNote(aerial?: string | null) {
  const text = (aerial || "").toUpperCase();
  if (text === "FIT_10" || text === "FIT_4") return "Aerial review shows room; county parcel record not reviewed yet";
  if (text === "NO_FIT" || text === "NOT_A_WASH") return "Aerial review found too little spare land; county parcel record not reviewed";
  if (text === "MARGINAL" || text === "CANNOT_TELL") return "Aerial review is not conclusive; county parcel record not reviewed";
  return "County parcel record not reviewed";
}

export function nextStepText(site: { verdict?: string | null; network_status?: string | null; land_tier?: string | null }) {
  if (site.verdict === "PASS" && site.network_status === "held") return "Hold until the service area grows.";
  if (site.verdict === "PASS") return "Ready for a closer look.";
  if (site.verdict === "MAYBE") return "Needs a closer look before a decision.";
  if (site.verdict === "UNRESOLVED") return "A missing fact still blocks a decision.";
  if (site.verdict === "FAIL" || site.verdict === "NOT_A_WASH") return "No further work on this site.";
  if (site.land_tier) return "County parcel record not reviewed.";
  return "Not screened yet.";
}

export function statusOf(site: { verdict?: string | null; network_status?: string | null; tenure_fail?: boolean; verification?: string; aerial_fit?: string | null }) {
  if (site.tenure_fail || site.verdict === "FAIL" || site.verdict === "NOT_A_WASH") return STATUS_NOTES[5];
  if (site.verdict === "PASS" && site.network_status === "held") return STATUS_NOTES[1];
  if (site.verdict === "PASS") return STATUS_NOTES[0];
  if (site.verdict === "MAYBE") return STATUS_NOTES[2];
  if (site.verdict === "UNRESOLVED") return STATUS_NOTES[3];
  return { ...STATUS_NOTES[4], note: uncheckedNote(site.aerial_fit) };
}
