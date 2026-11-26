import type { ReviewFocus } from "@/lib/spaces/triage";

export type Inputs = {
  stage: string; segment: string; land: boolean; unavailable: boolean; control: boolean;
  section: string; screen: number | null; recorded: number | null;
};

export type SelectionRow = {
  id: string; name: string; city: string; mapped: boolean; stage: string; mirrorStage: string;
  priority: string; instruction: string; geometry: string; section: string; amount: number | null;
  financeVisible: boolean; option: string; evidenceDate: string; assessed: boolean; quickLube: boolean;
};

export function selectionCheck(city: string, input: Inputs | undefined, focus: ReviewFocus, listingRemoved: boolean) {
  if (!["LAS","MIA","PHX"].includes(city)) return ["Outside mandate", "Confirm a documented market exception before spending on this site."];
  if (input?.land) return ["Land paused", "The acquisition mandate currently covers operating businesses."];
  if (input?.unavailable || listingRemoved) return ["Check disposition", "Reconcile the dated listing with the recorded stage and any subsequent offering."];
  if (input?.control) return ["Resolve site rights", "Read the lease, assignment and possession terms. Document which bays and hours the buyer controls."];
  if (focus === "Resolve parcel or imagery") return ["Resolve parcel", "Match the offered parcels to the plan before measuring an option."];
  if (input?.segment.toLowerCase().includes("lube")) return ["Screen fleet service", "Confirm retained lifts, access, hours and the rights to service vehicles. Evaluate charging separately."];
  if (focus === "Test the fourth stall") return ["Measure fourth stall", "Measure the fourth stall and adjacent aisle under peak operating conditions."];
  if (focus === "Test a conversion") return ["Test conversion", "Measure the replacement footprint and deduct equipment removal, lost contribution and replacement labor."];
  if (!input?.section) return ["Complete first screen", "Establish sale scope, parcel, retained earnings and a usable layout."];
  if (focus === "Obtain an aerial" || focus === "No assessed layout") return ["Obtain usable image", "Locate a parcel-matched aerial or a dimensioned site plan."];
  return [focus, "Compare usable geometry, dated service headroom, retained cash flow and incremental network coverage."];
}
