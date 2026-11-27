import type { Opportunity } from "./opportunity";

const labels: Record<Opportunity["disposition"], string> = {
  Shortlist: "Acquisition shortlist",
  "Service diligence": "Review for fleet service",
  Reserve: "Keep as a backup",
  "Suggest drop": "Proposed removal",
  Hold: "Pause work",
  "Watch availability": "Wait for availability",
  "Archive listing": "Set this listing aside",
  "Outside mandate": "Outside buying criteria",
  Conditional: "Proceed if conditions are met",
  "Off-market prospect": "No active listing",
  Dropped: "Closed opportunity",
};

export function recommendation(option: Opportunity) {
  const rank = option.rank;
  if (rank != null && option.disposition === "Shortlist") return "Acquisition priority #" + rank;
  if (rank != null && option.disposition === "Service diligence") return "Fleet service priority #" + rank;
  return labels[option.disposition];
}

export function recommendationNote(option: Opportunity) {
  switch (option.disposition) {
    case "Watch availability": return "Before pursuing this site, confirm it is still available, what the price includes and when the buyer could take possession.";
    case "Hold": return "Further work is paused. See the review notes for what would change that decision.";
    case "Reserve": return "Keep this option available if a higher-priority site falls through.";
    default: return option.next;
  }
}
