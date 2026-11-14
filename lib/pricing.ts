/**
 * Pricing from the workbook, fixed per site.
 * Land comps do not follow the view's reach filter.
 * A missing input stays a dash. Nothing here is estimated from a neighboring figure.
 */

export const PRICING_AS_OF = "2026-11-14";

export type CompSource = {
  id: string;
  source: "land" | "register";
  market: string;
  segment?: string;
  acres: string | number | null;
  price: string | number | null;
  status?: string;
  checked?: string;
  area?: string;
  ko?: string;
  link?: string;
  address?: string;
};

export type QualifiedComp = {
  id: string;
  source: "land" | "register";
  metro: "PHX" | "LAS" | "MIA";
  rank: number;
  acres: number;
  price: number;
  perAcre: number;
  stale: boolean;
};

export type MarketCompSet = {
  metro: "PHX" | "LAS" | "MIA";
  reach: "service" | "plus5" | "plus10" | "metro" | "";
  within: string;
  count: number;
  medianPerAcre: number | null;
  stale: number;
  tip: string;
  /** False when the metro has fewer than 5 qualifying comps. */
  enough: boolean;
};

export type FactRow = {
  id: string;
  figure: string;
  period: string;
  value: string | number | null;
  claim: string;
};

export type SiteInput = {
  id: string;
  market: string;
  segment: string;
  stage?: string;
  acres: string | number | null;
  asking: string | number | null;
  revenue: string | number | null;
  ebitda: string | number | null;
  label?: string;
  claimed: string | number | null;
  normalized: string | number | null;
  financialsStatus?: string;
  countyValue: string | number | null;
  countyBasis?: string;
};

export type PricedSite = {
  stated_revenue: number | null;
  stated_revenue_display: string | null;
  revenue_basis: string;
  revenue_period: string;
  stated_cash_flow: number | null;
  stated_cash_flow_display: string | null;
  cash_flow_label: string;
  earnings_basis: string;
  earnings_period: string;
  county_value: number | null;
  county_value_display: string | null;
  county_value_basis: string;
  land_estimate: number | null;
  land_estimate_display: string | null;
  land_estimate_basis: string;
  land_estimate_tip: string;
  land_estimate_reason: string;
  business_value_reason: string;
  revenue_multiple_reason: string;
  earnings_multiple_reason: string;
  business_multiple_reason: string;
  comp_median_per_acre: number | null;
  comp_median_tip: string;
  comp_count: number | null;
  business_value: number | null;
  business_value_display: string | null;
  revenue_multiple: number | null;
  revenue_multiple_display: string;
  revenue_multiple_basis: string;
  earnings_multiple: number | null;
  earnings_multiple_display: string;
  earnings_multiple_basis: string;
  earnings_multiple_which: string;
  business_multiple: number | null;
  business_multiple_display: string;
  business_multiple_basis: string;
  pricing_eligible: boolean;
};

const PHX = new Set(["phx", "phoenix", "glendale", "laveen", "avondale", "tolleson", "peoria", "mesa", "scottsdale", "tempe", "gilbert", "chandler", "goodyear", "surprise", "buckeye", "el mirage", "sun city", "san tan valley", "apache junction", "cave creek", "fountain hills", "queen creek", "paradise valley"]);
const LAS = new Set(["las", "las vegas", "henderson", "north las vegas", "enterprise", "spring valley", "boulder city"]);
const MIA = new Set(["mia", "miami", "miami beach", "hialeah", "miami gardens", "north miami", "north miami beach", "doral", "homestead", "kendall", "coral gables", "hollywood", "fort lauderdale", "pembroke pines", "miramar", "broward"]);

const BANDS = [
  { reach: "service" as const, max: 0, within: "the service area" },
  { reach: "plus5" as const, max: 1, within: "5 mi of the service area" },
  { reach: "plus10" as const, max: 2, within: "10 mi of the service area" },
  { reach: "metro" as const, max: 3, within: "the metro" },
];

const BASIS_RANK = ["Estimate", "Broker-stated", "Package", "Verified"];

export function metroOf(market: string, label = ""): "PHX" | "LAS" | "MIA" | "" {
  const key = market.trim().toLowerCase().replace(/\s+/g, " ");
  if (PHX.has(key)) return "PHX";
  if (LAS.has(key) || key.includes("vegas")) return "LAS";
  if (MIA.has(key) || key.startsWith("mia") || key.includes("miami") || key.includes("fort laud") || key.includes("homestead")) return "MIA";
  const head = label.trim().slice(0, 3).toUpperCase();
  if (head === "PHX" || head === "LAS" || head === "MIA") return head;
  return "";
}

/** Vacant land and yards. A business segment that merely mentions a yard or "car wash" is not land. */
export function isLandSegment(segment: string, blankOk = false): boolean {
  const text = segment.trim().toLowerCase().replace(/\s+/g, " ");
  if (!text) return blankOk;
  if (/^(car wash|gas station|auto service|medical|truck|office)\b/.test(text)) return false;
  if (text === "land" || text.startsWith("vacant land")) return true;
  return /\byard\b/.test(text);
}

export function pricingEligible(segment: string): boolean {
  const text = segment.trim().toLowerCase();
  if (!text) return false;
  if (/^(car wash|gas station|general auto repair|tire)\b/.test(text)) return true;
  if (text.includes("auto service") && !text.startsWith("auto service building")) return true;
  return false;
}

export function parseNumber(value: string | number | null | undefined): number | null {
  if (typeof value === "number") return Number.isFinite(value) && value !== 0 ? value : null;
  const text = String(value ?? "").trim();
  if (!text) return null;
  const net = text.match(/(\d+(?:\.\d+)?)\s*net\b/i);
  const source = net ? net[1] : text.replace(/,/g, "").replace(/\$/g, "");
  const match = source.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const number = Number(match[0]);
  if (!Number.isFinite(number) || number === 0) return null;
  return number;
}

function excelDay(serial: number): number {
  return Date.UTC(1899, 11, 30) + serial * 86400000;
}

export function datesIn(value: string): number[] {
  const text = value.trim();
  if (/^\d{5}$/.test(text)) return [excelDay(Number(text))];
  const found: number[] = [];
  const pattern = /(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{1,2})(?:,)?\s*(20\d{2})?/gi;
  for (const match of text.matchAll(pattern)) {
    const year = Number(match[3] || PRICING_AS_OF.slice(0, 4));
    const month = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(match[1].slice(0, 3).toLowerCase());
    found.push(Date.UTC(year, month, Number(match[2])));
  }
  return found;
}

function asOfMs(): number {
  const [year, month, day] = PRICING_AS_OF.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

function ageDays(stamp: number, asOf = asOfMs()): number {
  return Math.round((asOf - stamp) / 86400000);
}

function recent(stamp: number): boolean {
  const age = ageDays(stamp);
  return age >= -1 && age <= 90;
}

/** Still listed, or a sale or contract confirmed within 90 days. */
export function listingQualifies(status: string, checked = ""): boolean {
  const text = status || "";
  const found = [...datesIn(text), ...datesIn(checked)];
  const confirmed = found.some(recent);
  const sale = /sold|under contract|\bpsa\b/i.test(text);
  const gone = /gone|withdrawn|delisted|removed|not verified live|no longer/i.test(text);
  if (gone || (sale && !/listed|active/i.test(text))) return sale && confirmed;
  if (/off-market/i.test(text)) return false;
  return /listed|active|live/i.test(text) || text.trim() === "";
}

export function listingStale(status: string): boolean {
  if (!/stale|last updated|on market|listed since|days on market|\bdom\b/i.test(status)) return false;
  return datesIn(status).some((stamp) => ageDays(stamp) > 365);
}

function areaRank(area: string, ko = ""): number | null {
  if (/location|outside service/i.test(ko)) return 3;
  const key = area.trim().toLowerCase();
  if (key === "yes" || key === "inside" || key === "in") return 0;
  if (key === "near 0-5" || key === "near 0 to 5" || key === "edge") return 1;
  if (key === "near 5-10" || key === "near 5 to 10") return 2;
  if (key === "no" || key === "out" || key === "outside") return 3;
  return null;
}

function streetKey(value: string): string {
  const text = value.toLowerCase().replace(/[^a-z0-9\s]/g, " ");
  const match = text.match(/(\d{2,6})\s+(?:n|s|e|w|north|south|east|west)?\s*([a-z0-9]+)/);
  return match ? `${match[1]} ${match[2]}` : "";
}

function linkKey(value: string): string {
  const text = value.toLowerCase();
  const crexi = text.match(/properties\/(\d+)/);
  if (crexi) return `crexi:${crexi[1]}`;
  const id = text.match(/\/(\d{5,})\/?/);
  return id ? `id:${id[1]}` : "";
}

function close(left: number, right: number, acres: boolean): boolean {
  if (acres) return Math.abs(left - right) <= 0.02;
  return Math.abs(left - right) < 1;
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

type Prepared = QualifiedComp & { street: string; link: string; segmentOk: boolean };

function prepare(row: CompSource, source: "land" | "register"): Prepared | null {
  const metro = metroOf(row.market, row.address || "");
  if (!metro) return null;
  const acres = parseNumber(row.acres);
  const price = parseNumber(row.price);
  const segmentOk = source === "land" ? isLandSegment(row.segment || "", true) : true;
  const rank = source === "land" ? areaRank(row.area || "", row.ko || "") : 3;
  return {
    id: row.id,
    source,
    metro,
    rank: rank ?? -1,
    acres: acres ?? 0,
    price: price ?? 0,
    perAcre: acres && price ? price / acres : 0,
    stale: listingStale(row.status || ""),
    street: streetKey(row.address || ""),
    link: linkKey(row.link || ""),
    segmentOk,
  };
}

function samePlace(left: Prepared, right: Prepared): boolean {
  if (left.link && right.link && left.link === right.link) return true;
  if (left.street && right.street && left.street === right.street) return true;
  return left.price > 0 && right.price > 0 && left.acres > 0 && right.acres > 0
    && close(left.price, right.price, false) && close(left.acres, right.acres, true);
}

function sized(row: Prepared): boolean {
  return row.acres >= 0.25 && row.acres <= 5 && row.price > 0;
}

/**
 * Land Sites plus Listings Register land rows.
 * Copies drop out. The narrowest service-area band with 5 comps wins, per metro.
 */
export function landCompSets(land: CompSource[], register: CompSource[]): { comps: QualifiedComp[]; markets: MarketCompSet[] } {
  const landRows = land.map((row) => prepare(row, "land")).filter((row): row is Prepared => row != null);
  const registerRows = register.map((row) => prepare(row, "register")).filter((row): row is Prepared => row != null);
  const comps: QualifiedComp[] = [];
  for (const row of landRows) {
    if (!row.segmentOk || row.rank < 0 || !sized(row)) continue;
    const original = land.find((item) => item.id === row.id);
    if (!listingQualifies(original?.status || "", original?.checked || "")) continue;
    comps.push(row);
  }
  for (const row of registerRows) {
    const original = register.find((item) => item.id === row.id);
    if (!sized(row) || !listingQualifies(original?.status || "", "")) continue;
    const copy = landRows.some((other) => samePlace(row, other));
    if (copy || comps.some((other) => samePlace(row, other as Prepared))) continue;
    comps.push(row);
  }
  const markets: MarketCompSet[] = [];
  for (const metro of ["PHX", "LAS", "MIA"] as const) {
    const widest = comps.filter((row) => row.metro === metro);
    const chosen = BANDS.map((band) => {
      const pool = comps.filter((row) => row.metro === metro && row.rank <= band.max);
      return { band, pool, median: median(pool.map((row) => row.perAcre)) };
    }).find((item) => item.pool.length >= 5);
    if (!chosen || chosen.median == null) {
      markets.push({
        metro,
        reach: "",
        within: "",
        count: widest.length,
        medianPerAcre: null,
        stale: 0,
        tip: "",
        enough: false,
      });
      continue;
    }
    const stale = chosen.pool.filter((row) => row.stale).length;
    const staleNote = stale ? ` ${stale} on the market more than a year.` : "";
    markets.push({
      metro,
      reach: chosen.band.reach,
      within: chosen.band.within,
      count: chosen.pool.length,
      medianPerAcre: chosen.median,
      stale,
      tip: `Estimate. Based on ${chosen.pool.length} land listings within ${chosen.band.within}.${staleNote}`,
      enough: true,
    });
  }
  return { comps, markets };
}

function placeName(metro: "PHX" | "LAS" | "MIA" | ""): string {
  if (metro === "PHX") return "Phoenix";
  if (metro === "LAS") return "Las Vegas";
  if (metro === "MIA") return "Miami";
  return "";
}

function landGap(metro: "PHX" | "LAS" | "MIA" | "", acres: number | null, market: MarketCompSet | null, land: number | null): string {
  if (land != null) return "";
  if (acres == null) return "Needs acres";
  const count = market?.count ?? 0;
  const place = placeName(metro);
  return place ? `Too few land comps (${count} in ${place}, need 5)` : "Too few land comps (need 5)";
}

export function basisBadge(value: string | null | undefined): string {
  const text = (value || "").trim().toLowerCase();
  if (text === "verified") return "Verified";
  if (text === "broker-stated" || text === "broker stated" || text === "claimed") return "Broker-stated";
  if (text === "package" || text === "documented" || text === "normalized") return "Package";
  if (text === "estimate") return "Estimate";
  return "";
}

export function weakerBasis(left: string, right: string): string {
  if (!left || !right) return "";
  const a = BASIS_RANK.indexOf(left);
  const b = BASIS_RANK.indexOf(right);
  if (a < 0 || b < 0) return "";
  return a <= b ? left : right;
}

export function moneyText(value: number | null | undefined): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  const sign = value < 0 ? "-" : "";
  return `${sign}$${Math.abs(Math.round(value)).toLocaleString("en-US")}`;
}

function multipleOf(numerator: number | null, denominator: number | null): number | null {
  if (numerator == null || denominator == null || !(denominator > 0)) return null;
  return Math.round((numerator / denominator) * 10) / 10;
}

function multipleText(value: number | null, words: string): string {
  if (words) return words;
  if (value == null) return "—";
  return `${value.toFixed(1)}x`;
}

function factFor(facts: FactRow[], id: string, figure: string, amount: number | null): FactRow | null {
  const rows = facts.filter((row) => row.id === id && row.figure.toLowerCase() === figure.toLowerCase());
  if (!rows.length) return null;
  if (amount == null) return null;
  const matched = rows.filter((row) => {
    const value = parseNumber(row.value);
    return value != null && Math.abs(value - amount) <= 1;
  });
  return matched.length ? matched[matched.length - 1] : null;
}

function earningsOf(site: SiteInput, facts: FactRow[]): { amount: number | null; label: string; which: string; figure: string } {
  const normalized = parseNumber(site.normalized);
  const claimedAmount = parseNumber(site.claimed);
  const ebitdaAmount = parseNumber(site.ebitda);
  const normalizedFact = normalized == null ? null : factFor(facts, site.id, "Normalized EBITDA", normalized);
  const distinct = normalized != null && (
    normalizedFact != null
    || (claimedAmount != null && Math.abs(normalized - claimedAmount) > 1)
    || (ebitdaAmount != null && Math.abs(normalized - ebitdaAmount) > 1 && claimedAmount == null)
  );
  if (normalized != null && distinct) return { amount: normalized, label: "Normalized EBITDA", which: "normalized EBITDA", figure: "Normalized EBITDA" };
  const claimed = claimedAmount;
  if (claimed != null) {
    const label = (site.label || "").trim();
    if (/normalized/i.test(label)) return { amount: claimed, label: "Normalized EBITDA", which: "normalized EBITDA", figure: "Normalized EBITDA" };
    if (/seller/i.test(label)) return { amount: claimed, label: "Seller's cash flow", which: "seller's cash flow", figure: "Seller's cash flow" };
    if (/ebitda/i.test(label) || !label) return { amount: claimed, label: label || "EBITDA", which: "EBITDA", figure: "EBITDA" };
    return { amount: claimed, label, which: label, figure: "EBITDA" };
  }
  const ebitda = parseNumber(site.ebitda);
  if (ebitda != null) return { amount: ebitda, label: "EBITDA", which: "EBITDA", figure: "EBITDA" };
  return { amount: null, label: "", which: "", figure: "" };
}

export function priceSite(site: SiteInput, facts: FactRow[], market: MarketCompSet | null): PricedSite {
  const asking = parseNumber(site.asking);
  const revenue = parseNumber(site.revenue);
  const earnings = earningsOf(site, facts);
  const acres = parseNumber(site.acres);
  const county = parseNumber(site.countyValue);
  const revenueFact = factFor(facts, site.id, "Revenue", revenue);
  const earningsFact = earnings.amount == null ? null : (
    factFor(facts, site.id, earnings.figure, earnings.amount)
    || factFor(facts, site.id, "EBITDA", earnings.amount)
    || factFor(facts, site.id, "Seller's cash flow", earnings.amount)
  );
  const revenueBasis = basisBadge(revenueFact?.claim || site.financialsStatus || "");
  const earningsBasis = basisBadge(earningsFact?.claim || site.financialsStatus || "");
  const eligible = pricingEligible(site.segment);
  const rate = market?.enough ? market.medianPerAcre : null;
  const usable = rate != null && market?.enough ? market : null;
  const metro = metroOf(site.market, site.id);
  const land = rate != null && acres != null ? Math.round(acres * rate) : null;
  const business = asking != null && land != null ? asking - land : null;
  const landReason = landGap(metro, acres, market, land);
  const revenueMultiple = eligible ? multipleOf(asking, revenue) : null;
  const earningsMultiple = eligible && earnings.amount != null && earnings.amount > 0 ? multipleOf(asking, earnings.amount) : null;
  const earningsWords = eligible && earnings.amount != null && earnings.amount <= 0 ? "Loss-making" : "";
  const businessWords = eligible && earnings.amount != null && earnings.amount <= 0
    ? "Loss-making"
    : eligible && business != null && business <= 0 && earnings.amount != null && earnings.amount > 0
      ? "Land covers asking"
      : "";
  const businessMultiple = businessWords || !eligible ? null : multipleOf(business, earnings.amount);
  const askingBasis = asking != null ? "Broker-stated" : "";
  const ineligible = "Not a car wash, auto service, or gas station";
  const needsEarnings = earnings.amount == null;
  const needsLand = land == null;
  const businessMultipleReason = businessWords || businessMultiple != null
    ? ""
    : !eligible
      ? ineligible
      : needsLand && needsEarnings
        ? "Needs a land estimate and cash flow or EBITDA"
        : needsLand
          ? "Needs a land estimate"
          : needsEarnings
            ? "Needs cash flow or EBITDA"
            : asking == null
              ? "Needs an asking price"
              : "";
  const businessValueReason = business != null
    ? ""
    : asking == null
      ? "Needs an asking price"
      : "Needs a land estimate";
  const revenueReason = revenueMultiple != null
    ? ""
    : !eligible
      ? ineligible
      : revenue == null
        ? "Needs revenue"
        : "Needs an asking price";
  const earningsReason = earningsMultiple != null || earningsWords
    ? ""
    : !eligible
      ? ineligible
      : needsEarnings
        ? "Needs cash flow or EBITDA"
        : "Needs an asking price";
  return {
    stated_revenue: revenue,
    stated_revenue_display: moneyText(revenue),
    revenue_basis: revenue != null ? revenueBasis : "",
    revenue_period: revenueFact?.period || "",
    stated_cash_flow: earnings.amount,
    stated_cash_flow_display: moneyText(earnings.amount),
    cash_flow_label: earnings.label,
    earnings_basis: earnings.amount != null ? earningsBasis : "",
    earnings_period: earningsFact?.period || "",
    county_value: county,
    county_value_display: moneyText(county),
    county_value_basis: county != null ? (site.countyBasis || "").trim() : "",
    land_estimate: land,
    land_estimate_display: moneyText(land),
    land_estimate_basis: land != null ? "Estimate" : "",
    land_estimate_tip: land != null && usable ? `Based on ${usable.count} land listings within ${usable.within}` : "",
    land_estimate_reason: landReason,
    business_value_reason: businessValueReason,
    revenue_multiple_reason: revenueReason,
    earnings_multiple_reason: earningsReason,
    business_multiple_reason: businessMultipleReason,
    comp_median_per_acre: usable?.medianPerAcre ?? null,
    comp_median_tip: usable?.tip || "",
    comp_count: market?.count ?? null,
    business_value: business != null && business > 0 ? business : null,
    business_value_display: business == null ? null : business > 0 ? moneyText(business) : "Land covers asking",
    revenue_multiple: revenueMultiple,
    revenue_multiple_display: eligible ? multipleText(revenueMultiple, "") : "—",
    revenue_multiple_basis: revenueMultiple != null ? weakerBasis(askingBasis, revenueBasis) : "",
    earnings_multiple: earningsMultiple,
    earnings_multiple_display: eligible ? multipleText(earningsMultiple, earningsWords) : "—",
    earnings_multiple_basis: earningsMultiple != null || earningsWords ? weakerBasis(askingBasis, earningsBasis) : "",
    earnings_multiple_which: earnings.which,
    business_multiple: businessMultiple,
    business_multiple_display: eligible ? multipleText(businessMultiple, businessWords) : "—",
    business_multiple_basis: businessMultiple != null ? "Estimate" : "",
    pricing_eligible: eligible,
  };
}

export function priceWorkbook(sites: SiteInput[], facts: FactRow[], markets: MarketCompSet[]): Record<string, PricedSite> {
  const byMetro = new Map(markets.map((market) => [market.metro, market]));
  const out: Record<string, PricedSite> = {};
  for (const site of sites) {
    if (!site.id) continue;
    const metro = metroOf(site.market, site.id);
    out[site.id] = priceSite(site, facts, metro ? byMetro.get(metro) || null : null);
  }
  return out;
}

export type CompMedian = { value: number | null; tip: string };

export function compMedianOf(deals: { city?: string | null; comp_median_per_acre?: number | null; comp_median_tip?: string | null }[]): CompMedian {
  const by = new Map<string, CompMedian>();
  for (const deal of deals) {
    if (deal.comp_median_per_acre == null || !deal.city) continue;
    by.set(deal.city, { value: deal.comp_median_per_acre, tip: deal.comp_median_tip || "Estimate" });
  }
  if (by.size === 1) return [...by.values()][0];
  if (!by.size) return { value: null, tip: "Estimate. No qualifying land comps in this view." };
  return { value: null, tip: [...by.entries()].map(([city, row]) => `${city}: ${row.tip}`).join(" · ") };
}
