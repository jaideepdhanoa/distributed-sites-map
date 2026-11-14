/**
 * R-099 reach is a view. It does not drop or hide a site in the workbook.
 * Outside (more than 10 miles) is a knock-out and stays out of every option.
 * Legacy edge still passes the location gate, so it stays in every option.
 * A row with no class yet stays in view, except a universe row whose stored
 * gate is already false. Those were outside before the four classes existed.
 */

export type Reach = "inside" | "within5" | "within10";

export const REACH_DEFAULT: Reach = "within10";

export type ServiceClass = "inside" | "near_0_5" | "near_5_10" | "outside" | "edge_legacy" | "unknown";

const CLASSES = new Set<ServiceClass>(["inside", "near_0_5", "near_5_10", "outside", "edge_legacy", "unknown"]);

export type AreaInput = {
  service_area_class?: string | null;
  in_area?: boolean | null;
};

export function parseReach(value: string | null | undefined): Reach {
  if (value === "inside" || value === "within5" || value === "within10") return value;
  return REACH_DEFAULT;
}

/** Null when the choice is the default, so the URL stays clean. */
export function reachParam(value: Reach): string | null {
  return value === REACH_DEFAULT ? null : value;
}

export function reachLabel(value: Reach): string {
  if (value === "inside") return "Service area only";
  if (value === "within5") return "Service area + 5 mi";
  return "Service area + 10 mi";
}

export function explicitClass(record: AreaInput | null | undefined): ServiceClass | null {
  const raw = record?.service_area_class;
  if (raw && CLASSES.has(raw as ServiceClass)) return raw as ServiceClass;
  return null;
}

/** Class used on a chip and in the funnel split. A stored pass with no class reads as Inside. */
export function shownClass(record: AreaInput | null | undefined): ServiceClass | "unclassified" {
  const explicit = explicitClass(record);
  if (explicit) return explicit;
  if (record?.in_area === true) return "inside";
  if (record?.in_area === false) return "outside";
  return "unclassified";
}

export function inReach(record: AreaInput | null | undefined, reach: Reach = REACH_DEFAULT): boolean {
  const kind = explicitClass(record);
  if (kind === "inside" || kind === "edge_legacy") return true;
  if (kind === "near_0_5") return reach === "within5" || reach === "within10";
  if (kind === "near_5_10") return reach === "within10";
  if (kind === "outside" || kind === "unknown") return false;
  if (record?.in_area === false) return false;
  return true;
}

export type AreaCounts = {
  inside: number;
  near_0_5: number;
  near_5_10: number;
  edge_legacy: number;
  total: number;
};

export function areaCounts(records: AreaInput[], reach: Reach = REACH_DEFAULT): AreaCounts {
  const counts: AreaCounts = { inside: 0, near_0_5: 0, near_5_10: 0, edge_legacy: 0, total: 0 };
  for (const record of records) {
    if (!inReach(record, reach)) continue;
    counts.total += 1;
    const kind = shownClass(record);
    if (kind === "inside" || kind === "near_0_5" || kind === "near_5_10" || kind === "edge_legacy") counts[kind] += 1;
  }
  return counts;
}

/** Passing classes for the current reach. The numbers add up to the Service area step. */
export function serviceAreaSplit(records: AreaInput[], reach: Reach = REACH_DEFAULT): string {
  const counts = areaCounts(records, reach);
  const parts = [`Inside ${counts.inside.toLocaleString("en-US")}`];
  if (reach !== "inside") parts.push(`Within 5 mi outside ${counts.near_0_5.toLocaleString("en-US")}`);
  if (reach === "within10") parts.push(`Within 10 mi outside ${counts.near_5_10.toLocaleString("en-US")}`);
  if (counts.edge_legacy) parts.push(`Edge ${counts.edge_legacy.toLocaleString("en-US")}`);
  return parts.join(" · ");
}
