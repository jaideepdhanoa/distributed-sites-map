import type { TriageRow, ReviewFocus } from "@/lib/spaces/triage";

export type Inputs = {
  stage: string; segment: string; land: boolean; unavailable: boolean; control: boolean;
  hurdle?: number | null; operating?: boolean; outside?: boolean; section: string; screen: number | null; recorded: number | null;
};

export function chargingHold(input:Inputs|undefined) {
  if(input?.unavailable)return "Verify current seller availability before further underwriting.";
  if(input?.control)return "Resolve the tenant lease and operating rights for this footprint.";
  if(input?.outside)return "Verify a service-area exception for this parcel.";
  if(input?.operating===false)return "Verify a continuing operating business and the offered assets.";
}

export type SelectionRow = {
  id: string; name: string; city: string; mapped: boolean; hasRecord?: boolean; stage: string; mirrorStage: string;
  priority: string; instruction: string; geometry: string; section: string; amount: number | null;
  asking?: string;
  chargingSpace?: import("../spaces/pipelineFit").PipelineFit;
  pendingDrop?: boolean;
  charging?: import("../charging/summary").ChargingSummary;
  review?: import("./opportunity").OpportunitySite;
  research?: import("./research").SelectionResearch;
  readiness: string; financeVisible: boolean; option: string; evidenceDate: string; assessed: boolean; quickLube: boolean;
};

export function investmentScreen(input: Inputs | undefined, financeVisible: boolean) {
  if (!financeVisible || input?.screen == null) return "Investment case unverified";
  return input.screen>=0 ? "Workbook reaches depot parity · verify inputs" : "Workbook above depot cost";
}

export function selectionCheck(city: string, input: Inputs | undefined, focus: ReviewFocus, listingRemoved: boolean) {
  if (!["LAS","MIA","PHX"].includes(city)) return ["Outside mandate", "Confirm a documented market exception before spending on this site."];
  if (input?.land) return ["Land paused", "The acquisition mandate currently covers operating businesses."];
  if (input?.unavailable || listingRemoved) return ["Check disposition", "Reconcile the dated listing with the recorded stage and any subsequent offering."];
  if (input?.control) return ["Resolve site rights", "Read the lease, assignment and possession terms. Document which bays and hours the buyer controls."];
  if (input?.outside) return ["Check service area", "Match the parcel to the current operating polygon and document any service-area exception."];
  if (input?.operating === false) return ["Confirm operating business", "Check the existing offering, licenses and lease for a continuing business."];
  if (focus === "Resolve parcel or imagery") return ["Resolve parcel", "Match the offered parcels to the plan before measuring an option."];
  if (input?.segment.toLowerCase().includes("lube")) return ["Screen fleet service", "Confirm retained lifts, access, hours and the rights to service vehicles. Evaluate charging separately."];
  if (focus === "Test the fourth stall") return ["Measure fourth stall", "Measure the fourth stall and adjacent aisle under peak operating conditions."];
  if (focus === "Test a conversion") return ["Test conversion", "Measure the replacement footprint and deduct equipment removal, lost contribution and replacement labor."];
  if (!input?.section) return ["Complete first screen", "Establish sale scope, parcel, retained earnings and a usable layout."];
  if (focus === "Obtain an aerial" || focus === "No assessed layout") return ["Obtain usable image", "Locate a parcel-matched aerial or a dimensioned site plan."];
  return [focus, "Compare usable geometry, dated service headroom, retained cash flow and incremental network coverage."];
}

export type ScreenSummary = {
  priority: string; instruction: string; origin: string; fit?: string; layoutCheck: boolean;
};

export function screenSummary(city: string, input: Inputs | undefined, view: Pick<TriageRow,"focus"|"fit">,
  record: {listing_removed?: unknown; stage_blocker?: unknown; next_step?: unknown}): ScreenSummary {
  const [priority,instruction] = selectionCheck(city,input,view.focus,record.listing_removed === true);
  return currentScreen({priority,instruction,origin:"Suggested check",fit:view.fit,
    layoutCheck:["Test conversion","Measure fourth stall","Measure the footprint","Resolve parcel","Obtain usable image","Screen fleet service","Revisit site evidence"].includes(priority)}, record);
}

export function currentScreen(screen: ScreenSummary, record: {stage_blocker?: unknown; next_step?: unknown}): ScreenSummary {
  const recorded = (v:unknown) => typeof v === "string" && v.trim() && !/^(?:—|-|unknown|not on file|n\/a)$/i.test(v.trim()) ? v.trim() : "";
  const blocker = recorded(record.stage_blocker);
  const next = recorded(record.next_step);
  const mandate = screen.priority === "Land paused" || screen.priority === "Outside mandate";
  if (!mandate && (blocker || (next && screen.priority !== "Resolve site rights"))) {
    return {priority:blocker ? "Resolve recorded blocker" : "Recorded next action",instruction:blocker || next,
      origin:blocker ? "Recorded blocker" : "Recorded next action",fit:screen.fit,layoutCheck:false};
  }
  return screen;
}
