export const STATUS_NOTES: { id: string; label: string; note: string }[] = [
  { id: "cleared", label: "Cleared", note: "County records confirm an operating wash with enough spare land on its own parcel." },
  { id: "held", label: "Held", note: "Cleared, but outside the current service area." },
  { id: "possible", label: "Possible", note: "The county check found borderline land. It needs a closer look." },
  { id: "unresolved", label: "Unresolved", note: "County records are incomplete or conflicting." },
  { id: "unchecked", label: "Not yet checked", note: "Satellite imagery suggests the land fits. County records have not been checked." },
  { id: "ruled-out", label: "Ruled out", note: "Closed, not a wash, or no spare land. Shown only at the funnel step where it drops out." },
  { id: "listing", label: "Listing", note: "A site or deal that is on the market." },
  { id: "desk", label: "Desk screen", note: "A first review of the listing or lead." },
  { id: "land", label: "Land site", note: "Land without an operating wash. Hidden until that layer is turned on." },
  { id: "depot", label: "Depot", note: "Existing operating depot." },
  { id: "offmarket", label: "Off-market, other types", note: "Sites we found ourselves that are not in the car-wash census. No broker or listing yet. Choose a category with Business type." },
];

export const FUNNEL_NOTES: Record<string, string> = {
  universe: "One site for each place after duplicate census records are merged.",
  unique: "One site for each place after duplicate census records are merged.",
  in_area: "Inside the current operating area for that city.",
  land: "Room for about 10 or about 4 parking bays on spare land.",
  county: "In-area sites with an L10 or L4 fit that also have a county verdict. The workbook checked 109 sites in all: Pass 13, Maybe 30, Fail 47, Not a car wash 15, Unresolved 4. That full set includes sites outside the service area and sites without an L10 or L4 fit.",
  cleared: "County records confirm an operating wash with enough spare land on its own parcel. The workbook clears 11. Charleston Car Wash and the Chandler Quick Quack stay Possible until review, so the map shows 9.",
  listed: "Sites on this step that are on the market.",
  contacted: "Sites on this step where a conversation with the owner or broker has started.",
  desk: "A first review of the listing or lead.",
  later: "Work past the first conversation. None are in this stage yet.",
  dropped: "The deal is no longer being pursued.",
};

export const BUSINESS_TYPES = [
  "Car wash",
  "Auto repair",
  "Tire and lube",
  "Gas station",
  "Yard or lot",
  "Storage",
  "Land",
  "Other",
] as const;

export const CENSUS_NOTE = "Car washes. Other categories will get their own census. These counts are car washes only.";

export const SUMMARY_NOTES = {
  universe: "Candidates have room for about 10 or about 4 parking bays inside the service area. Cleared sites passed the county check.",
  pipeline: "Broker and agent deals only. Off-market research stays on the universe site. Desk screen is the first step. Dropped deals are no longer pursued.",
};

const STAGE_TITLES: Record<string, string> = {
  desk: "Desk screen",
  contacted: "Contacted",
  later: "Later stages",
  dropped: "Dropped",
};

export function stageTitle(group: string) {
  return STAGE_TITLES[group] || "Deal";
}

export function stageDetail(stage: string, group: string) {
  const name = stageTitle(group);
  const raw = (stage || "").replace(/^(?:dropped|\d+)\b\s*/i, "").trim();
  if (!raw || raw.toLowerCase() === name.toLowerCase()) return name;
  return `${name} (${raw.charAt(0).toLowerCase()}${raw.slice(1)})`;
}

export const AREA_NOTES = {
  current: "The area served today. Las Vegas uses the core and ring 100. Phoenix and Miami use their current boundary.",
  later: "Later expansion. In Las Vegas these are rings 200 and 300. Drawn dashed, with no fill.",
};

export function statusOf(site: { verdict?: string | null; network_status?: string | null; tenure_fail?: boolean; verification?: string }) {
  if (site.tenure_fail || site.verdict === "FAIL" || site.verdict === "NOT_A_WASH") return STATUS_NOTES[5];
  if (site.verdict === "PASS" && site.network_status === "held") return STATUS_NOTES[1];
  if (site.verdict === "PASS") return STATUS_NOTES[0];
  if (site.verdict === "MAYBE") return STATUS_NOTES[2];
  if (site.verdict === "UNRESOLVED") return STATUS_NOTES[3];
  return STATUS_NOTES[4];
}
