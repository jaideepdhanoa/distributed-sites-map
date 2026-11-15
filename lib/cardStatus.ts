import type { DealProps, SiteProps } from "./types";

export type AreaRecord = {
  service_area_class?: DealProps["service_area_class"] | SiteProps["service_area_class"];
  service_area_distance_mi?: number | null;
};

/** Near is outside the service area, within the miles shown. */
export const NEAR_TIP = "Near means outside the service area, within the miles shown. More than 10 miles is a knock-out.";

function shownMiles(miles: number | null | undefined): string {
  if (miles == null || !Number.isFinite(miles)) return "";
  const rounded = Math.round(miles * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/** One name for each service-area class. Inside, edge, and unknown stay off the chip. */
export function serviceAreaLabel(record: AreaRecord | null | undefined): string {
  const kind = record?.service_area_class || "";
  const shown = shownMiles(record?.service_area_distance_mi);
  if (kind === "inside") return "Inside";
  if (kind === "near_0_5") return shown ? `Near, ${shown} mi` : "Near, under 5 mi";
  if (kind === "near_5_10") return shown ? `Near, ${shown} mi` : "Near, 5 to 10 mi";
  if (kind === "outside") return "Outside";
  if (kind === "edge_legacy") return "Edge";
  return "";
}

export function serviceAreaChip(record: AreaRecord | null | undefined): string {
  const kind = record?.service_area_class || "";
  if (!kind || kind === "inside" || kind === "edge_legacy" || kind === "unknown") return "";
  return serviceAreaLabel(record);
}

/** Same words as the chip. A phone row does not invent a second phrase. */
export function serviceAreaShort(record: AreaRecord | null | undefined): string {
  return serviceAreaChip(record);
}

/** Class and distance from fields already on the row. Blank when the class is missing. */
export function serviceAreaColumn(record: AreaRecord | null | undefined): string {
  return serviceAreaLabel(record);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** A workbook date as "Nov 6". Any other text is kept. */
export function contactDate(value: string | null | undefined): string {
  const text = String(value || "").trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (!match) return text;
  const month = MONTHS[Number(match[2]) - 1];
  if (!month) return text;
  return `${month} ${Number(match[3])}`;
}
