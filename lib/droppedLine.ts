import { formatActivityWhen } from "@/lib/actions/time";

/** Dropped view line: reason, proposer, approver, and time. */
export function droppedDecisionLine(deal: {
  stage_group?: string | null;
  decision_reason?: string | null;
  decision_proposer?: string | null;
  decision_approver?: string | null;
  decision_at?: string | null;
}): string {
  if (deal.stage_group !== "dropped") return "";
  const when = deal.decision_at ? formatActivityWhen(deal.decision_at).label : "";
  return [
    deal.decision_reason || "",
    deal.decision_proposer ? `Proposed by ${deal.decision_proposer}` : "",
    deal.decision_approver ? `Approved by ${deal.decision_approver}` : "",
    when,
  ].filter(Boolean).join(" · ");
}
