import { edgeFitRange, fitRange, kinds, outlineDimensions, recordedFit, type Assessment } from "./options";

export type ReviewFocus = "Test the fourth stall" | "Test a conversion" | "Measure the footprint" | "Resolve parcel or imagery" | "Obtain an aerial" | "Revisit site evidence" | "No assessed layout";
export const focusOrder: ReviewFocus[] = ["Test the fourth stall", "Test a conversion", "Measure the footprint", "Resolve parcel or imagery", "Obtain an aerial", "Revisit site evidence", "No assessed layout"];
export type TriageRow = {
  id: string; mapped: boolean; city: string; name: string; stage: string; cohort: Assessment["cohort"]; focus: ReviewFocus;
  baseline: string; options: string[]; kinds: string[]; finding: string; next: string;
};

export function triage(row: Assessment | undefined): Pick<TriageRow, "focus" | "baseline" | "options" | "kinds" | "finding" | "next"> {
  const zones = row?.status === "reviewed" ? row.zones.filter(zone => zone.kind !== "clear") : [];
  const ranges = zones.map(zone => {
    const dims = outlineDimensions(zone, row?.image?.bounds, row?.image);
    return dims && fitRange(dims[0], dims[1], Math.min(6, dims[1]), "stalls_90");
  });
  const scenario = zones.find((_, i) => ranges[i] && ranges[i][0] < 4 && ranges[i][1] >= 4);
  const edge = zones.find((zone, i) => {
    if (!ranges[i] || ranges[i][1] >= 4) return false;
    const dims = outlineDimensions(zone, row?.image?.bounds, row?.image);
    return dims && (edgeFitRange(dims[0], dims[1], Math.min(6, dims[1]), 24, "stalls_90")?.[1] || 0) >= 4;
  });
  const plausible = zones.filter((_, i) => !ranges[i] || ranges[i][1] >= 4);
  const conversion = plausible.find(zone => kinds[zone.kind].option !== "retain");
  const priority = scenario || edge || conversion || plausible[0];
  let focus: ReviewFocus = "No assessed layout";
  if (row) {
    if (row.status === "hold") focus = "Resolve parcel or imagery";
    else if (row.status === "needs-image") focus = "Obtain an aerial";
    else if (scenario || edge) focus = "Test the fourth stall";
    else if (conversion && (row.recorded === null || row.recorded < 4)) focus = "Test a conversion";
    else focus = priority ? "Measure the footprint" : "Revisit site evidence";
  }
  return {
    focus, baseline: row ? recordedFit(row) : "Assessment needed",
    options: [...new Set(zones.flatMap(zone => kinds[zone.kind].option || []))],
    kinds: [...new Set(zones.map(zone => kinds[zone.kind].label))],
    finding: priority?.label || zones[0]?.label || "", next: priority && priority === edge ? "Measure the adjacent aisle and confirm peak access. Four stalls depend on a continuous usable 24 ft lane outside this footprint." : priority?.check || (priority && kinds[priority.kind].check) || (zones.length ? "The scaled footprint tests below four with its aisle inside the outline. Revisit if a dimensioned plan establishes a different approach." : row?.summary) || "Obtain a parcel-matched aerial or dimensioned site plan.",
  };
}
