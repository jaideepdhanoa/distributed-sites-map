import type { DealProps, SiteProps } from "./types";

/** A site field is a string on the snapshot. A number must not throw on .trim. */
function asText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

const LISTING_SITES = /\b(bizbuysell|loopnet|crexi|realmo|carwashbrokers|matthews)\b/i;

const LISTING_HOSTS: Array<[string, string]> = [
  ["loopnet.com", "LoopNet"],
  ["bizbuysell.com", "BizBuySell"],
  ["crexi.com", "Crexi"],
  ["matthews.com", "Matthews"],
  ["carwashesforsale.com", "Car Washes For Sale"],
  ["linkedin.com", "LinkedIn"],
  ["carwashbrokers.com", "Car Wash Brokers"],
  ["realmo.com", "Realmo"],
  ["brevitas.com", "Brevitas"],
  ["ppirfl.com", "Listing"],
];

export function listingHost(url: unknown) {
  try {
    const host = new URL(asText(url)).hostname.replace(/^www\./, "").toLowerCase();
    return LISTING_HOSTS.find(([name]) => host === name || host.endsWith(`.${name}`))?.[1] || host;
  } catch {
    return "the listing";
  }
}

const FOLDER_URL = /^https:\/\/drive\.google\.com\/drive\/folders\/[A-Za-z0-9_-]+$/;

/** A Drive folder link, or blank when the cell is not one. */
export function folderHref(value?: unknown) {
  const url = asText(value).trim().split("?")[0];
  return FOLDER_URL.test(url) ? url : "";
}

/** An http listing page, or blank. */
export function listingHref(value?: unknown) {
  const url = asText(value).trim();
  return /^https?:\/\//i.test(url) ? url : "";
}

/** Host label for the original listing, or a muted note when none is on file. */
export function listingCue(record: { listing_url?: unknown; listing_removed?: boolean | null }) {
  const url = asText(record.listing_url).trim();
  const note = record.listing_removed ? " (may be removed)" : "";
  if (!url) return { url: "", label: `No listing page on file${note}` };
  return { url, label: `View on ${listingHost(url)} ↗${note}` };
}

export function formatRecordedDate(value?: unknown) {
  const text = asText(value).trim();
  const compact = text.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;
  return text;
}

/** A removed name can leave a bare "'s" in a note. */
export function cleanNote(value?: unknown) {
  return asText(value).replace(/(?<![A-Za-z])'s\b/g, "").replace(/\s{2,}/g, " ").trim();
}

export function isListingSite(value?: unknown) {
  return LISTING_SITES.test(asText(value));
}

export function shownBroker(deal: DealProps) {
  const broker = asText(deal.broker);
  if (!broker || isListingSite(broker)) return "";
  return broker;
}

export function shownFirm(deal: DealProps) {
  const firm = asText(deal.firm);
  if (!firm || /^not shown$/i.test(firm)) return "";
  if (isListingSite(firm) && !asText(deal.broker)) return "";
  return firm;
}

const ROAD_SUFFIX: Record<string, string> = {
  AVE: "Ave", BLVD: "Blvd", BLV: "Blvd", RD: "Rd", ST: "St", DR: "Dr",
  HWY: "Hwy", PKWY: "Pkwy", PKWYW: "Pkwy", WAY: "Way", LN: "Ln", CT: "Ct", PL: "Pl", CIR: "Cir",
};
const AVENUE_SHORT = ["A", "V"].join("");
const ROAD_DIR = new Set(["N", "S", "E", "W", "NE", "NW", "SE", "SW", "NB", "SB", "EB", "WB"]);

function roadWord(word: string, index: number) {
  const bare = word.replace(/\.$/, "");
  const upper = bare.toUpperCase();
  if (upper === AVENUE_SHORT) return "Ave";
  if (ROAD_SUFFIX[upper]) return ROAD_SUFFIX[upper];
  if (ROAD_DIR.has(upper)) return upper;
  if (/^(?:to|of|and|from)$/i.test(bare) && index > 0) return bare.toLowerCase();
  if (/^(?:on|off)$/i.test(bare)) return `${bare.charAt(0).toUpperCase()}${bare.slice(1).toLowerCase()}`;
  const ordinal = bare.match(/^(\d+)(ST|ND|RD|TH)$/i);
  if (ordinal) return `${ordinal[1]}${ordinal[2].toLowerCase()}`;
  const shield = bare.match(/^(I|US|SR)[-\s]?0*(\d+)(.*)$/i);
  if (shield) return `${shield[1].toUpperCase()}-${Number(shield[2])}${shield[3]}`;
  const lower = bare.toLowerCase();
  if (lower.startsWith("mc") && lower.length > 2) return `Mc${lower.charAt(2).toUpperCase()}${lower.slice(3)}`;
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/** Show an address in title case without dropping or inventing any part of it. */
export function displayAddress(value?: unknown) {
  const text = asText(value).trim().replace(/\s+/g, " ");
  if (!text) return "";
  return text.split(" ").map((word, index) => (/^\d+$/.test(word) ? word : roadWord(word, index))).join(" ");
}

/** Turn a traffic-count label such as "07 MCDOWELL RD" or "S 101" into a plain road name. */
export function plainRoad(value?: unknown) {
  let text = asText(value).trim().replace(/\s+/g, " ");
  if (!text) return "";
  text = text.replace(/^07\s+/, "");
  text = text.replace(/^\d{5,}\s+/, "");
  text = text.replace(/^S\s+0*(\d{2,3})$/i, (_, number) => `SR-${Number(number)}`);
  text = text.replace(/^I\s+0*(\d{1,3})$/i, (_, number) => `I-${Number(number)}`);
  const suffix = ["AVE", "BLVD", "BLV", "RD", "ST", "DR", "HWY", "PKWY", "PKWYW", "WAY", "LN", "CT", "PL", "CIR", AVENUE_SHORT].join("|");
  text = text.replace(new RegExp(`\\b(?:PHX|TMP|GIL|CHN)\\s+(?=(?:${suffix})\\b)`, "gi"), "");
  return text.split(/\s+/).map(roadWord).join(" ").replace(/\s+/g, " ").trim();
}

const SOURCE_HOSTS: Record<string, string> = {
  "loopnet.com": "LoopNet",
  "crexi.com": "Crexi",
  "bizbuysell.com": "BizBuySell",
  "matthews.com": "Matthews",
  "carwashbrokers.com": "Car Wash Brokers",
  "realmo.com": "Realmo",
  "carwashesforsale.com": "carwashesforsale.com",
  "brevitas.com": "Brevitas",
  "ppirfl.com": "Listing",
};

function hostLabel(url?: unknown) {
  const host = asText(url).replace(/^https?:\/\/(?:www\.)?/i, "").split("/")[0].toLowerCase();
  return SOURCE_HOSTS[host] || "";
}

/** A public listing name. Internal scan labels are not a source. */
export function publicListingSource(value?: unknown) {
  const text = asText(value).trim();
  if (!text) return "";
  if (/listings_v2|fresh scan|re-scan|signed-in|not shown|our own research|^broker$/i.test(text)) return "";
  return text.split("—")[0].trim();
}

function offMarketLead(value?: unknown) {
  return /off[\s-]*market|own research|no lead/i.test(asText(value));
}

/**
 * Off-market only when the workbook lead source says so.
 * Otherwise a listing source, a broker whose name is hidden, or the census.
 */
export function leadSourceLine(site: SiteProps, deal?: DealProps | null) {
  const kind = asText(deal?.source_kind).toLowerCase();
  const dealLead = asText(deal?.lead_source);
  if (kind === "off-market" || offMarketLead(dealLead)) return "Off-market";
  if (deal && (kind.includes("broker") || kind.includes("listing") || /^(broker|listing)$/i.test(dealLead))) {
    const firm = shownFirm(deal);
    if (firm) return firm;
    const listing = hostLabel(deal.listing_url)
      || (isListingSite(deal.broker) ? deal.broker : "")
      || (isListingSite(deal.firm) ? deal.firm : "")
      || publicListingSource(deal.source_line);
    if (listing) return listing;
    return "Broker (name not shown)";
  }
  if (site.origin === "off-market" || offMarketLead(site.lead_source)) return "Off-market";
  const listing = hostLabel(site.listing_url) || publicListingSource(site.asking_price_source);
  if (site.listed && listing) return listing;
  if (!site.listed && site.research_sources) return "Off-market";
  return "Census site";
}

export function shownPriceSource(deal: DealProps) {
  const source = asText(deal.asking_price_source).trim();
  if (source && !/^not shown$/i.test(source)) return source;
  const line = asText(deal.source_line).trim();
  if (line && !/^not shown$/i.test(line)) return line;
  const broker = asText(deal.broker);
  if (isListingSite(broker)) return broker;
  if (shownFirm(deal)) return shownFirm(deal);
  return "";
}
