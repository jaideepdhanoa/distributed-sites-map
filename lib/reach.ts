/**
 * R-099 reach is a view. It does not drop or hide a site in the workbook.
 * A blank class stays in every view. Legacy edge still passes the location gate.
 * A universe row with no class and a stored false gate stays out. Those were
 * outside before the four classes existed.
 *
 * The snapshot published before this change stamped a blank cell as "unknown"
 * and did not record where that class came from. A class of "unknown" with no
 * source, or with source "blank", stays in view. Source "label" is the word
 * Unknown. Outside, and that explicit Unknown, stay out of the working set.
 * The Dropped step still lists them. Unrecognized text is left unset, so it
 * stays in view and the build warning names it.
 */

export type Reach = "inside" | "within5" | "within10";

export const REACH_DEFAULT: Reach = "within10";

export type ServiceClass = "inside" | "near_0_5" | "near_5_10" | "outside" | "edge_legacy" | "unknown";

const CLASSES = new Set<ServiceClass>(["inside", "near_0_5", "near_5_10", "outside", "edge_legacy", "unknown"]);

export type AreaInput = {
  service_area_class?: string | null;
  /** blank, label, or unrecognized. Absent on a snapshot that stamped blanks as unknown. */
  service_area_source?: string | null;
  in_area?: boolean | null;
  stage_group?: string | null;
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

/** Explicit Outside, or Unknown that a build marked as a real label or unrecognized text. */
export function workingSetKnockout(record: AreaInput | null | undefined): boolean {
  const kind = explicitClass(record);
  if (kind === "outside") return true;
  if (kind !== "unknown") return false;
  const source = record?.service_area_source;
  return source === "label" || source === "unrecognized";
}

export function inReach(record: AreaInput | null | undefined, reach: Reach = REACH_DEFAULT): boolean {
  const kind = explicitClass(record);
  if (kind === "inside" || kind === "edge_legacy") return true;
  if (kind === "near_0_5") return reach === "within5" || reach === "within10";
  if (kind === "near_5_10") return reach === "within10";
  if (workingSetKnockout(record)) return false;
  if (kind === "unknown") return true;
  if (record?.in_area === false) return false;
  return true;
}

/**
 * One pipeline step. Explicit Unknown and Outside are hidden on the working
 * steps and listed on Dropped, including when their stage is not Dropped.
 * A blank class uses its stage.
 */
export function dealOnPipeStep(record: AreaInput | null | undefined, step: string, reach: Reach = REACH_DEFAULT): boolean {
  if (!record) return false;
  if (step === "dropped" && workingSetKnockout(record)) return true;
  if (record.stage_group !== step) return false;
  return inReach(record, reach);
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
  if (reach !== "inside") parts.push(`Near, under 5 mi ${counts.near_0_5.toLocaleString("en-US")}`);
  if (reach === "within10") parts.push(`Near, 5 to 10 mi ${counts.near_5_10.toLocaleString("en-US")}`);
  if (counts.edge_legacy) parts.push(`Edge ${counts.edge_legacy.toLocaleString("en-US")}`);
  return parts.join(" · ");
}
