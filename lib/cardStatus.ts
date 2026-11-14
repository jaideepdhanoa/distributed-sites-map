import type { DealProps, SiteProps } from "./types";

export type AreaRecord = {
  service_area_class?: DealProps["service_area_class"] | SiteProps["service_area_class"];
  service_area_distance_mi?: number | null;
};

/** R-099 class for the card. Inside, legacy edge, and unknown stay quiet. */
export function serviceAreaChip(record: AreaRecord | null | undefined): string {
  const kind = record?.service_area_class || "";
  if (kind === "near_0_5" || kind === "near_5_10") {
    const miles = record?.service_area_distance_mi;
    if (miles == null || !Number.isFinite(miles)) return "Near";
    const rounded = Math.round(miles * 10) / 10;
    const shown = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
    return `Near · ${shown} mi`;
  }
  if (kind === "outside") return "Outside · knock-out";
  return "";
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
