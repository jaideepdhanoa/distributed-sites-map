import { countYear, fullMoney, growthText, trafficRoad } from "./keyNumbers";
import { parseOverlays, type OverlayId } from "./overlays";
import type { DealProps, SiteProps } from "./types";

export type MarketMetric = OverlayId;
export const marketMeasures = {
  traffic: { title: "Road traffic", unit: "vehicles/day", cuts: [10000, 25000, 40000], bands: ["<10k", "10–<25k", "25–<40k", "40k+"] },
  washes: { title: "Nearby washes", unit: "within 1 mi", cuts: [1, 3, 6], bands: ["0", "1–2", "3–5", "6+"] },
  population: { title: "Population", unit: "people within 3 mi", cuts: [50000, 100000, 150000], bands: ["<50k", "50–<100k", "100–<150k", "150k+"] },
  growth: { title: "Population growth", unit: "within 3 mi", cuts: [0, 5, 10], bands: ["<0%", "0–<5%", "5–<10%", "10%+"] },
  income: { title: "Household income", unit: "median within 3 mi", cuts: [50000, 75000, 100000], bands: ["<$50k", "$50–<75k", "$75–<100k", "$100k+"] },
} as const;
export const marketColors = ["#a6d5ce", "#65aea7", "#237c84", "#154e68"];
export const missingColor = "#8d877e";
export const workbookSource = "Workbook trade area";

export function readMarketMetric(params: {get(name: string): string | null}): MarketMetric | null {
  const value = params.get("marketMetric");
  if (value && Object.hasOwn(marketMeasures, value)) return value as MarketMetric;
  return parseOverlays(params.get("overlay"))[0] || null;
}

function numeric(value?: number | string | null) {
  if (value == null || String(value).trim() === "") return null;
  const n = Number(String(value).replaceAll(",", ""));
  return Number.isFinite(n) ? n : null;
}

export function marketEvidence(deal?: DealProps | null, site?: SiteProps | null) {
  const workbook = numeric(deal?.trade_aadt);
  const linkedCount = numeric(site?.aadt_count);
  const traffic = workbook ?? linkedCount;
  const workbookRoad = trafficRoad(deal?.trade_aadt_road);
  const road = workbook == null ? site?.aadt_road : workbookRoad.headline || (workbookRoad.segment && "Segment " + workbookRoad.segment);
  const year = workbook == null ? countYear(site?.aadt_year) : "";
  const trafficSource = traffic == null ? "" : workbook != null ? workbookSource : site?.aadt_source?.trim() || "Site traffic record";
  const growth = growthText(deal?.trade_growth);
  return {
    traffic, washes: numeric(deal?.trade_washes_1mi), population: numeric(deal?.trade_population),
    income: numeric(deal?.trade_income), growth: growth ? numeric(growth.replace("%", "")) : null,
    washes3: numeric(deal?.trade_washes_3mi), maximum: numeric(deal?.trade_aadt_max),
    trafficNote: traffic == null ? "" : [road, workbook != null && deal?.trade_aadt_m != null ? Math.round(deal.trade_aadt_m) + " m to segment" : "", year || "Count year unavailable", trafficSource].filter(Boolean).join(" · "),
    linkedNote: workbook != null && linkedCount != null && (workbook !== linkedCount || site?.aadt_source || site?.aadt_year)
      ? [linkedCount.toLocaleString("en-US") + " vehicles/day", site?.aadt_road, countYear(site?.aadt_year) || "Count year unavailable", site?.aadt_source || "Site traffic record"].filter(Boolean).join(" · ") : "",
    trafficBasis: workbook != null ? "Nearest counted road" : traffic != null ? "Site traffic record" : "",
  };
}
export type MarketEvidence = ReturnType<typeof marketEvidence>;
export type MarketRow = { id: string; name: string; city: string; point: [number, number]; evidence: MarketEvidence };

export function formatMarket(value: number | null, metric: MarketMetric) {
  if (value == null) return "—";
  if (metric === "income") return fullMoney(value);
  return value.toLocaleString("en-US", { maximumFractionDigits: 2 }) + (metric === "growth" ? "%" : "");
}
export function marketColor(metric: MarketMetric, value: number | null) {
  if (value == null) return missingColor;
  return marketColors[marketMeasures[metric].cuts.filter(cut => value >= cut).length];
}
export function sortMarketRows(rows: MarketRow[], key: MarketMetric, descending: boolean) {
  return [...rows].sort((a,b) => {
    const x = a.evidence[key], y = b.evidence[key];
    if (x == null && y != null) return 1;
    if (x != null && y == null) return -1;
    return (descending ? -1 : 1) * ((x ?? 0) - (y ?? 0)) || a.id.localeCompare(b.id);
  });
}

export const marketLabels = ["Traffic", "Busiest road within 800 m", "Washes within 1 mile", "Washes within 3 miles", "3-mile population", "3-mile population growth", "3-mile median household income"] as const;

export function marketComparisonRows(e: MarketEvidence) {
  const values = [e.traffic,e.maximum,e.washes,e.washes3,e.population,e.growth,e.income];
  const metrics: MarketMetric[] = ["traffic","traffic","washes","washes","population","growth","income"];
  return marketLabels.map((label,i) => {
    const key = values[i];
    const source = i === 0 ? e.trafficNote : i === 5 ? workbookSource + " · Period unavailable" : workbookSource;
    const unit = i < 2 ? " vehicles/day" : "";
    return {label, key, source, value: key == null ? "—" : formatMarket(key,metrics[i]) + unit + " · " + source, basis: i === 0 ? e.trafficBasis : undefined};
  });
}
