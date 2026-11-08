import type { DealProps, SiteProps } from "./types";

function shortRoad(value?: string | null) {
  let text = (value || "").trim().replace(/\s+/g, " ").replace(/^07\s+/, "");
  if (!text) return "";
  text = text.replace(/\(([^)]*)\)/g, (_, inner: string) => {
    const parts = inner.split(/\s+to\s+/i);
    const kept = parts.map((part) => part.trim()).filter((part) => part && !/^n\/a$/i.test(part));
    if (!kept.length) return "";
    if (kept.length < parts.length) return ` (${kept.join(" to ")})`;
    return ` (${inner.trim()})`;
  }).replace(/\s+/g, " ").trim();
  if (!text) return "";
  text = text.replace(/\bI\s+0*(\d+)\b/i, (_, number) => `I-${Number(number)}`);
  text = text.replace(/\bSR\s*0*(\d+)\b/i, (_, number) => `SR-${Number(number)}`);
  return text.split(" ").map((word) => {
    const upper = word.toUpperCase();
    if (upper === "AVE") return "Ave";
    if (upper === "ST") return "St";
    if (upper === "RD") return "Rd";
    if (upper === "DR") return "Dr";
    if (upper === "BLVD") return "Blvd";
    if (upper === "HWY") return "Hwy";
    if (["N", "S", "E", "W", "NE", "NW", "SE", "SW"].includes(upper)) return upper;
    if (/^\d+(?:ST|ND|RD|TH)$/i.test(word)) return word.toLowerCase();
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  }).join(" ");
}

export const PIPELINE_COLUMNS = [
  { id: "site", label: "Site" },
  { id: "stage", label: "Stage" },
  { id: "asking", label: "Asking · source" },
  { id: "acres", label: "Acres" },
  { id: "perAcre", label: "Per acre" },
  { id: "openLand", label: "Open land" },
  { id: "capacity", label: "Site capacity" },
  { id: "traffic", label: "Traffic count" },
  { id: "cashFlow", label: "Cash flow" },
  { id: "depot", label: "Depot mi" },
  { id: "checked", label: "Checked" },
] as const;

export type PipelineColumnId = (typeof PIPELINE_COLUMNS)[number]["id"];
export type PinLabel = "none" | "asking" | "acres" | "peracre";

export type RangeFilter = {
  askMin: number | null;
  askMax: number | null;
  acMin: number | null;
  acMax: number | null;
  paMin: number | null;
  paMax: number | null;
  olMin: number | null;
  olMax: number | null;
};

const RANGE_KEYS = ["amin", "amax", "cmin", "cmax", "pmin", "pmax", "omin", "omax"] as const;

/** Map pins omit site-capacity facts and photo lists. */
export function publicDeal<T extends Record<string, unknown>>(props: T): T {
  const copy = { ...props };
  for (const key of Object.keys(copy)) {
    if (key === "site_capacity" || key === "photos" || key.startsWith("cap_")) delete copy[key];
  }
  return copy;
}

export type CapacityFact = { id: "a" | "b" | "c" | "d"; lines: string[]; basis: string };

export type CapacityRecord = {
  cap_a_substation_mi?: number | null;
  cap_a_line_ft?: number | null;
  cap_a_source?: string | null;
  cap_a_as_of?: string | null;
  cap_a_confidence?: string | null;
  cap_b_feeder?: string | null;
  cap_b_frontage?: number | null;
  cap_b_nearby?: number | null;
  cap_b_horizon?: string | null;
  cap_b_source?: string | null;
  cap_b_as_of?: string | null;
  cap_b_confidence?: string | null;
  cap_c_amps?: number | null;
  cap_c_volts?: number | null;
  cap_c_phase?: string | null;
  cap_c_panels?: number | null;
  cap_c_source?: string | null;
  cap_c_as_of?: string | null;
  cap_c_confidence?: string | null;
  cap_d_peak?: number | null;
  cap_d_year?: number | null;
  cap_d_source?: string | null;
  cap_d_as_of?: string | null;
  cap_d_confidence?: string | null;
};

function factNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function factText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function factCount(value: number, digits = 2): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function factBasis(source?: string | null, confidence?: string | null, asOf?: string | null): string {
  return [source, confidence, asOf].map((item) => (item || "").trim()).filter(Boolean).join(" · ");
}

/** Typed fact layers only. A blank layer is omitted. No grade is inferred. */
export function capacityFacts(row: CapacityRecord | null | undefined, scope: "site" | "deal"): CapacityFact[] {
  const record = row || {};
  const facts: CapacityFact[] = [];
  const proximity: string[] = [];
  const substation = factNumber(record.cap_a_substation_mi);
  const line = factNumber(record.cap_a_line_ft);
  if (substation != null) proximity.push(`Substation ${factCount(substation)} mi`);
  if (line != null) proximity.push(`Line ${Math.round(line).toLocaleString()} ft`);
  if (proximity.length) {
    facts.push({ id: "a", lines: proximity, basis: factBasis(record.cap_a_source, record.cap_a_confidence, record.cap_a_as_of) });
  }
  const hosting: string[] = [];
  if (factText(record.cap_b_feeder)) hosting.push(`Feeder ${factText(record.cap_b_feeder)}`);
  const frontage = factNumber(record.cap_b_frontage);
  const nearby = factNumber(record.cap_b_nearby);
  if (frontage != null) hosting.push(`Frontage hosting ${factCount(frontage)}`);
  if (nearby != null) hosting.push(`Nearby hosting ${factCount(nearby)}`);
  if (factText(record.cap_b_horizon)) hosting.push(`Horizon ${factText(record.cap_b_horizon)}`);
  if (hosting.length) {
    facts.push({ id: "b", lines: hosting, basis: factBasis(record.cap_b_source, record.cap_b_confidence, record.cap_b_as_of) });
  }
  if (scope === "site") return facts;
  const service: string[] = [];
  const amps = factNumber(record.cap_c_amps);
  const volts = factNumber(record.cap_c_volts);
  const panels = factNumber(record.cap_c_panels);
  if (amps != null) service.push(`${Math.round(amps).toLocaleString()} amps`);
  if (volts != null) service.push(`${Math.round(volts).toLocaleString()} volts`);
  if (factText(record.cap_c_phase)) service.push(`Phase ${factText(record.cap_c_phase)}`);
  if (panels != null) service.push(`${Math.round(panels).toLocaleString()} panels`);
  if (service.length) {
    facts.push({ id: "c", lines: service, basis: factBasis(record.cap_c_source, record.cap_c_confidence, record.cap_c_as_of) });
  }
  const load: string[] = [];
  const peak = factNumber(record.cap_d_peak);
  const year = factNumber(record.cap_d_year);
  const peakUnit = "k" + "W";
  const yearUnit = "k" + "Wh/year";
  if (peak != null) load.push(`Peak load ${factCount(peak, 0)} ${peakUnit}`);
  if (year != null) load.push(`Year load ${Math.round(year).toLocaleString()} ${yearUnit}`);
  if (load.length) {
    facts.push({ id: "d", lines: load, basis: factBasis(record.cap_d_source, record.cap_d_confidence, record.cap_d_as_of) });
  }
  return facts;
}

export function factsForDeal(deal: CapacityRecord | null | undefined): CapacityFact[] {
  return capacityFacts(deal, "deal");
}

export function factsForSite(site: CapacityRecord | null | undefined, deal?: CapacityRecord | null): CapacityFact[] {
  const own = capacityFacts(site, "site");
  if (own.length || !deal) return own;
  return capacityFacts(deal, "site");
}

export function capacitySummary(facts: CapacityFact[]): string {
  if (!facts.length) return "Not on file";
  return facts.map((fact) => fact.lines.join(", ")).join("; ");
}

export function basisLabel(basis?: string | null) {
  if (!basis) return "";
  if (basis === "Unknown") return "Unverified";
  return basis;
}

export function compactMoney(value?: number | null) {
  if (value == null || Number.isNaN(value)) return "";
  const sign = value < 0 ? "-" : "";
  const number = Math.abs(value);
  if (number >= 1_000_000) {
    const shown = number / 1_000_000;
    let text = shown.toFixed(2);
    if (text.endsWith("00")) text = shown.toFixed(0);
    else if (text.endsWith("0")) text = shown.toFixed(1);
    return `${sign}$${text}M`;
  }
  if (number >= 1_000) return `${sign}$${Math.round(number / 1000)}K`;
  return `${sign}$${Math.round(number).toLocaleString()}`;
}

export function fullMoney(value?: number | null) {
  if (value == null || Number.isNaN(value)) return "";
  const sign = value < 0 ? "-" : "";
  return `${sign}$${Math.abs(Math.round(value)).toLocaleString()}`;
}

/** Short figure for a tile. The exact text stays in the tooltip and the overview. */
export function tileAmount(amount?: number | null, exact?: string | null) {
  const full = (exact || "").trim();
  if (amount == null || !Number.isFinite(amount) || !full) {
    return { text: full || "Not provided", title: full || "Not provided" };
  }
  if (Math.abs(amount) >= 10_000) {
    return { text: compactMoney(amount), title: full };
  }
  return { text: full, title: full };
}

export function acresText(value?: number | null) {
  if (value == null) return "";
  return `${value} ac`;
}

export function acresTotal(value: number) {
  if (!value) return "0 ac";
  const text = value >= 10 ? value.toFixed(1) : value.toFixed(2);
  return `${text.replace(/\.0$/, "").replace(/(\.\d)0$/, "$1")} ac`;
}

export function openLandText(value?: number | null) {
  if (value == null) return "";
  return `${Math.round(value).toLocaleString()} sq ft`;
}

function daySpan(iso: string, today: Date) {
  const then = new Date(`${iso.slice(0, 10)}T00:00:00`);
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (Number.isNaN(then.getTime())) return null;
  return Math.round((start.getTime() - then.getTime()) / 86_400_000);
}

export function checkedPhrase(iso?: string | null, today = new Date()) {
  if (!iso) return "";
  const days = daySpan(iso, today);
  if (days == null) return "";
  if (days <= 0) return "Checked live today";
  if (days === 1) return "Checked live yesterday";
  return `Checked live ${days} days ago`;
}

export function checkedShort(iso?: string | null, today = new Date()) {
  if (!iso) return "";
  const days = daySpan(iso, today);
  if (days == null) return "";
  if (days <= 0) return "today";
  if (days === 1) return "1d";
  return `${days}d`;
}

export function depotLine(miles?: number | null, hasPin = true) {
  if (!hasPin) return "No pin yet";
  if (miles == null) return "Not provided";
  return `${miles.toFixed(1)} mi`;
}

export function pillText(deal: DealProps, mode: PinLabel) {
  if (mode === "asking") return compactMoney(deal.asking_price);
  if (mode === "acres") return acresText(deal.land_acres);
  if (mode === "peracre") return deal.price_per_acre != null ? compactMoney(deal.price_per_acre) : "";
  return "";
}

/** Label features for the pin-text layer. Per acre never falls back to an acre string. */
export function dealLabelFeatures<T extends { geometry: { type: string; coordinates: number[] } | null; properties: DealProps }>(
  deals: T[],
  mode: PinLabel,
) {
  return deals.flatMap((feature) => {
    if (!feature.geometry) return [];
    const pill = pillText(feature.properties, mode);
    if (!pill || /\bac\b/.test(pill) && mode === "peracre") return [];
    if (!pill) return [];
    return [{
      type: "Feature" as const,
      properties: { pill },
      geometry: feature.geometry,
    }];
  });
}

export const DEAL_LABEL_FIELD = ["get", "pill"] as const;

function readNumber(params: { get(name: string): string | null }, key: string) {
  const raw = params.get(key);
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

export function rangesFromSearch(params: { get(name: string): string | null }): RangeFilter {
  return {
    askMin: readNumber(params, "amin"),
    askMax: readNumber(params, "amax"),
    acMin: readNumber(params, "cmin"),
    acMax: readNumber(params, "cmax"),
    paMin: readNumber(params, "pmin"),
    paMax: readNumber(params, "pmax"),
    olMin: readNumber(params, "omin"),
    olMax: readNumber(params, "omax"),
  };
}

export function rangeQuery(filter: RangeFilter): Record<(typeof RANGE_KEYS)[number], string | null> {
  const pair = (min: number | null, max: number | null, minKey: (typeof RANGE_KEYS)[number], maxKey: (typeof RANGE_KEYS)[number]) => ({
    [minKey]: min == null ? null : String(min),
    [maxKey]: max == null ? null : String(max),
  });
  return {
    ...pair(filter.askMin, filter.askMax, "amin", "amax"),
    ...pair(filter.acMin, filter.acMax, "cmin", "cmax"),
    ...pair(filter.paMin, filter.paMax, "pmin", "pmax"),
    ...pair(filter.olMin, filter.olMax, "omin", "omax"),
  } as Record<(typeof RANGE_KEYS)[number], string | null>;
}

function within(value: number | null | undefined, min: number | null, max: number | null) {
  if (min == null && max == null) return true;
  if (value == null) return false;
  if (min != null && value < min) return false;
  if (max != null && value > max) return false;
  return true;
}

export function inRange(deal: DealProps, filter: RangeFilter) {
  return within(deal.asking_price, filter.askMin, filter.askMax)
    && within(deal.land_acres, filter.acMin, filter.acMax)
    && within(deal.price_per_acre, filter.paMin, filter.paMax)
    && within(deal.open_land_sqft, filter.olMin, filter.olMax);
}

export function rangesActive(filter: RangeFilter) {
  return Object.values(filter).some((value) => value != null);
}

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

export function summaryOf(deals: DealProps[]) {
  const asking = deals.map((deal) => deal.asking_price).filter((value): value is number => value != null);
  const acres = deals.map((deal) => deal.land_acres).filter((value): value is number => value != null);
  const perAcre = deals.map((deal) => deal.price_per_acre).filter((value): value is number => value != null);
  return {
    count: deals.length,
    withAsking: asking.length,
    medianAsking: median(asking),
    totalAcres: acres.reduce((sum, value) => sum + value, 0),
    medianPerAcre: median(perAcre),
  };
}

const CITY = { PHX: "Phoenix", LAS: "Las Vegas", MIA: "Miami" } as const;

function ordinal(value: number) {
  const mod = value % 100;
  const suffix = mod >= 11 && mod <= 13 ? "th" : (["th", "st", "nd", "rd"][value % 10] || "th");
  return `${value}${suffix}`;
}

export function peerNote(deal: DealProps, peers: DealProps[]) {
  const ranked = peers
    .filter((item) => item.price_per_acre != null && item.city === deal.city && item.kind === deal.kind && item.stage_group !== "dropped")
    .sort((a, b) => (a.price_per_acre || 0) - (b.price_per_acre || 0));
  if (deal.price_per_acre == null || ranked.length < 2) return null;
  const index = ranked.findIndex((item) => item.deal_id === deal.deal_id);
  if (index < 0) return null;
  const place = CITY[deal.city as keyof typeof CITY] || deal.city;
  const noun = deal.kind === "land" ? "land" : "pipeline";
  return {
    label: `${ordinal(index + 1)} lowest of ${ranked.length} ${place} ${noun}`,
    pct: ranked.length === 1 ? 0 : index / (ranked.length - 1),
  };
}

export function cashTile(deal: DealProps) {
  if (deal.stated_cash_flow_display || deal.stated_cash_flow != null) {
    const note = [deal.cash_flow_label, deal.package_status ? `Package ${deal.package_status}` : ""].filter(Boolean).join(" · ");
    return {
      value: deal.stated_cash_flow_display || fullMoney(deal.stated_cash_flow),
      note: note || deal.figures_source || "Seller-stated",
      basis: deal.figures_basis || "",
      extra: deal.package_status ? "" : (deal.cash_multiple_display || ""),
    };
  }
  if (deal.figures_status === "withheld") {
    return { value: "Package figures not shown", note: "Seller package", basis: "", extra: "" };
  }
  if (deal.figures_status === "vacant" || deal.kind === "land" && !deal.stated_cash_flow_display && !deal.stated_revenue_display) {
    return { value: "Vacant land, no business", note: "Nothing to show", basis: "", extra: "" };
  }
  if (deal.stated_cash_flow_display) {
    return {
      value: deal.stated_cash_flow_display,
      note: deal.figures_source || "Seller-stated",
      basis: "Claimed",
      extra: deal.cash_multiple_display || "",
    };
  }
  if (deal.stated_revenue_display) {
    return {
      value: deal.stated_revenue_display,
      note: deal.figures_source || "Seller-stated",
      basis: "Claimed",
      extra: "",
    };
  }
  return { value: "Not provided", note: "", basis: "", extra: "" };
}

export function growthText(value?: number | null) {
  if (value == null || Number.isNaN(value)) return "";
  const shown = Math.abs(value) <= 2 ? value * 100 : value;
  const text = shown.toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
  return `${text}%`;
}

export function workbookTrafficLine(deal: DealProps) {
  if (deal.trade_aadt == null) return "";
  const road = shortRoad(deal.trade_aadt_road);
  const distance = deal.trade_aadt_m != null ? `${Math.round(deal.trade_aadt_m)} m` : "";
  const place = [road ? `on ${road}` : "", distance ? `(${distance})` : ""].filter(Boolean).join(" ");
  const max = deal.trade_aadt_max != null ? `max ${Math.round(deal.trade_aadt_max).toLocaleString()}` : "";
  return [`${Math.round(deal.trade_aadt).toLocaleString()} vehicles/day`, place, max, "Workbook trade area"].filter(Boolean).join(" · ");
}

export function tradeAreaLines(deal: DealProps) {
  const lines: string[] = [];
  if (deal.trade_population != null) lines.push(`3-mile population ${Math.round(deal.trade_population).toLocaleString()}`);
  const growth = growthText(deal.trade_growth);
  if (growth) lines.push(`Growth ${growth}`);
  if (deal.trade_income != null) lines.push(`Income ${fullMoney(deal.trade_income)}`);
  if (deal.trade_washes_1mi != null || deal.trade_washes_3mi != null) {
    const one = deal.trade_washes_1mi != null ? `${deal.trade_washes_1mi} within 1 mile` : "";
    const three = deal.trade_washes_3mi != null ? `${deal.trade_washes_3mi} within 3 miles` : "";
    lines.push(`Washes ${[one, three].filter(Boolean).join(" · ")}`);
  }
  return lines;
}

export function baysLine(deal: DealProps) {
  if (deal.bays_that_fit == null) return "";
  return `Bays that fit ${Math.round(deal.bays_that_fit).toLocaleString()}`;
}

export function universeTrafficLine(site?: Pick<SiteProps, "aadt_count" | "aadt_road" | "aadt_year" | "aadt_source"> | null) {
  if (!site?.aadt_count) return "";
  const road = shortRoad(site.aadt_road);
  const source = site.aadt_source || "";
  const year = (source.match(/\b(20\d{2})\b/) || [site.aadt_year || ""])[0] || site.aadt_year || "";
  let method = "";
  if (/150\s*m/i.test(source)) {
    const agency = /adot/i.test(source) ? "ADOT" : (source.split(",")[0] || "").replace(/average annual daily traffic/i, "").trim();
    method = [agency, year].filter(Boolean).join(" ");
    method = method ? `${method}, nearest within 150 m` : "Nearest within 150 m";
  } else if (source) {
    method = source.split(".")[0].trim();
  }
  return [`${site.aadt_count}${road ? ` on ${road}` : ""}`, method].filter(Boolean).join(" · ");
}

export function acreUnit(value?: number | null, text?: string | null) {
  const raw = (text || "").trim();
  if (raw && /\b(ac|acre|sq)/i.test(raw)) return raw;
  if (value == null && !raw) return "";
  if (value == null) return raw;
  const shown = raw && !Number.isNaN(Number(raw)) ? raw : String(value);
  return `${shown} ac`;
}

export function parseColumns(value: string | null): PipelineColumnId[] {
  const known = new Set(PIPELINE_COLUMNS.map((column) => column.id));
  const picked = (value || "").split(",").filter((id): id is PipelineColumnId => known.has(id as PipelineColumnId));
  if (!picked.length || !picked.includes("site")) return PIPELINE_COLUMNS.map((column) => column.id);
  return picked;
}
