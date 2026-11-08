import type { DealProps } from "./types";

function money(value: number) {
  const sign = value < 0 ? "-" : "";
  return `${sign}$${Math.abs(Math.round(value)).toLocaleString()}`;
}

function growthLabel(value?: number | null) {
  if (value == null || Number.isNaN(value)) return "";
  const shown = Math.abs(value) <= 2 ? value * 100 : value;
  const text = shown.toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
  return `${text}%`;
}

function roadLabel(value?: string | null) {
  let text = (value || "").trim().replace(/\s+/g, " ").replace(/^07\s+/, "");
  text = text.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
  text = text.replace(/\bI\s+0*(\d+)\b/i, (_, number: string) => `I-${Number(number)}`);
  if (!text || /^\d{5,}$/.test(text)) return { name: "", freeway: false };
  const freeway = /\b(I-\d+|US-\d+|SR-\d+)\b/.test(text) || /\bfreeway\b/i.test(text);
  return { name: text, freeway };
}

export const OVERLAYS = [
  { id: "traffic", label: "Nearest traffic" },
  { id: "trafficMax", label: "Max traffic" },
  { id: "population", label: "3-mile population" },
  { id: "washes", label: "Nearby washes" },
  { id: "growth", label: "Growth" },
  { id: "income", label: "Income" },
] as const;

export type OverlayId = (typeof OVERLAYS)[number]["id"];

export function parseOverlays(value: string | null): OverlayId[] {
  const known = new Set(OVERLAYS.map((item) => item.id));
  const picked = (value || "").split("|").filter((id): id is OverlayId => known.has(id as OverlayId));
  return [...new Set(picked)];
}

type Pointed = { geometry: { type: string; coordinates: number[] } | null; properties: DealProps };

/** One label per pin, built only from workbook numbers that are actually filled. */
export function overlayFeatures(deals: Pointed[], active: OverlayId[]) {
  if (!active.length) return [];
  return deals.flatMap((feature) => {
    if (!feature.geometry) return [];
    const deal = feature.properties;
    const parts: string[] = [];
    if (active.includes("traffic") && deal.trade_aadt != null) {
      const road = roadLabel(deal.trade_aadt_road);
      const count = Math.round(deal.trade_aadt).toLocaleString();
      parts.push(road.name ? `${count} on ${road.name}${road.freeway ? " freeway" : ""}` : `${count} vehicles/day`);
    }
    if (active.includes("trafficMax") && deal.trade_aadt_max != null) {
      parts.push(`max ${Math.round(deal.trade_aadt_max).toLocaleString()}`);
    }
    if (active.includes("population") && deal.trade_population != null) {
      parts.push(`${Math.round(deal.trade_population).toLocaleString()} people`);
    }
    if (active.includes("washes") && (deal.trade_washes_1mi != null || deal.trade_washes_3mi != null)) {
      const one = deal.trade_washes_1mi != null ? `${deal.trade_washes_1mi} in 1 mi` : "";
      const three = deal.trade_washes_3mi != null ? `${deal.trade_washes_3mi} in 3 mi` : "";
      parts.push(`washes ${[one, three].filter(Boolean).join(", ")}`);
    }
    if (active.includes("growth")) {
      const growth = growthLabel(deal.trade_growth);
      if (growth) parts.push(`growth ${growth}`);
    }
    if (active.includes("income") && deal.trade_income != null) {
      parts.push(`income ${money(deal.trade_income)}`);
    }
    if (!parts.length) return [];
    return [{
      type: "Feature" as const,
      properties: { label: parts.join(" · ") },
      geometry: feature.geometry,
    }];
  });
}

export function overlayQuery(active: OverlayId[]) {
  return { overlay: active.length ? active.join("|") : null };
}
