import type { DealProps, SiteProps } from "./types";

const LISTING_SITES = /\b(bizbuysell|loopnet|crexi|realmo|carwashbrokers|matthews)\b/i;

export function formatRecordedDate(value?: string | null) {
  const text = (value || "").trim();
  const compact = text.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;
  return text;
}

/** A removed name can leave a bare "'s" in a note. */
export function cleanNote(value?: string | null) {
  return (value || "").replace(/(?<![A-Za-z])'s\b/g, "").replace(/\s{2,}/g, " ").trim();
}

export function isListingSite(value?: string | null) {
  return LISTING_SITES.test(value || "");
}

export function shownBroker(deal: DealProps) {
  if (!deal.broker || isListingSite(deal.broker)) return "";
  return deal.broker;
}

export function shownFirm(deal: DealProps) {
  if (!deal.firm || /^not shown$/i.test(deal.firm)) return "";
  if (isListingSite(deal.firm) && !deal.broker) return "";
  return deal.firm;
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

/** Turn a traffic-count label such as "07 MCDOWELL RD" or "S 101" into a plain road name. */
export function plainRoad(value?: string | null) {
  let text = (value || "").trim().replace(/\s+/g, " ");
  if (!text) return "";
  text = text.replace(/^07\s+/, "");
  text = text.replace(/^\d{5,}\s+/, "");
  text = text.replace(/^S\s+0*(\d{2,3})$/i, (_, number) => `SR-${Number(number)}`);
  text = text.replace(/^I\s+0*(\d{1,3})$/i, (_, number) => `I-${Number(number)}`);
  const suffix = ["AVE", "BLVD", "BLV", "RD", "ST", "DR", "HWY", "PKWY", "PKWYW", "WAY", "LN", "CT", "PL", "CIR", AVENUE_SHORT].join("|");
  text = text.replace(new RegExp(`\\b(?:PHX|TMP|GIL|CHN)\\s+(?=(?:${suffix})\\b)`, "gi"), "");
  return text.split(/\s+/).map(roadWord).join(" ").replace(/\s+/g, " ").trim();
}

const LISTING_HOSTS: Record<string, string> = {
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

function hostLabel(url?: string | null) {
  const host = (url || "").replace(/^https?:\/\/(?:www\.)?/i, "").split("/")[0].toLowerCase();
  return LISTING_HOSTS[host] || "";
}

/** A public listing name. Internal scan labels are not a source. */
export function publicListingSource(value?: string | null) {
  const text = (value || "").trim();
  if (!text) return "";
  if (/listings_v2|fresh scan|re-scan|signed-in|not shown|our own research|^broker$/i.test(text)) return "";
  return text.split("—")[0].trim();
}

function offMarketLead(value?: string | null) {
  return /off[\s-]*market|own research|no lead/i.test(value || "");
}

/**
 * Off-market only when the workbook lead source says so.
 * Otherwise a listing source, a broker whose name is hidden, or the census.
 */
export function leadSourceLine(site: SiteProps, deal?: DealProps | null) {
  const kind = (deal?.source_kind || "").toLowerCase();
  const dealLead = deal?.lead_source || "";
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
  const source = (deal.asking_price_source || "").trim();
  if (source && !/^not shown$/i.test(source)) return source;
  if (deal.source_line && !/^not shown$/i.test(deal.source_line)) return deal.source_line;
  if (isListingSite(deal.broker)) return deal.broker;
  if (shownFirm(deal)) return shownFirm(deal);
  return "";
}
