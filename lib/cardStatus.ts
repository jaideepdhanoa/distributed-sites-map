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

function nearKind(record: AreaRecord | null | undefined): boolean {
  const kind = record?.service_area_class || "";
  return kind === "near_0_5" || kind === "near_5_10";
}

/** R-099 class for the card. Inside, legacy edge, and unknown stay quiet. */
export function serviceAreaChip(record: AreaRecord | null | undefined): string {
  if (nearKind(record)) {
    const shown = shownMiles(record?.service_area_distance_mi);
    return shown ? `${shown} mi outside service area` : "Outside service area";
  }
  if (record?.service_area_class === "outside") return "Outside · knock-out";
  return "";
}

/** Shorter Near label for a phone row. */
export function serviceAreaShort(record: AreaRecord | null | undefined): string {
  if (!nearKind(record)) return serviceAreaChip(record);
  const shown = shownMiles(record?.service_area_distance_mi);
  return shown ? `${shown} mi outside area` : "Outside area";
}

/** Class and distance from fields already on the row. Blank when the class is missing. */
export function serviceAreaColumn(record: AreaRecord | null | undefined): string {
  const kind = record?.service_area_class || "";
  const name = kind === "inside" ? "Inside"
    : kind === "near_0_5" ? "Within 5 mi outside"
    : kind === "near_5_10" ? "Within 10 mi outside"
    : kind === "outside" ? "Outside"
    : kind === "edge_legacy" ? "Edge"
    : kind === "unknown" ? "Unknown"
    : "";
  if (!name) return "";
  const miles = shownMiles(record?.service_area_distance_mi);
  return miles && kind !== "inside" ? `${name} · ${miles} mi` : name;
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
