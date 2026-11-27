import type { Opportunity, OpportunitySite } from "./opportunity";

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

export function nextDecision(review: OpportunitySite, option = review.primary) {
  if (option.route === review.primary.route && option.disposition === "Shortlist" && review.visitPlan) {
    return review.visitPlan.decision;
  }
  return option.next;
}
