import type { Opportunity, OpportunitySite } from "@/lib/selection/opportunity";
import type { ChargingSummary } from "@/lib/charging/summary";
import { amounts } from "@/lib/charging/model";
import PowerDelayTrial from "./PowerDelayTrial";

type Props = {
  option: Opportunity;
  plan?: OpportunitySite["visitPlan"];
  charging?: ChargingSummary;
};

export default function VisitDecision({ option, plan, charging }: Props) {
  return <div className="visit-decision" aria-label="Visit decision">
    <h4>Why visit?</h4>
    <p>{plan?.reason ?? option.rationale}</p>
    {plan && <p><b>Travel</b> · {plan.decision}</p>}
    <p><b>Charging</b> · {charging?.merit.action ?? "Case pending"}</p>
    <small>{option.owner ?? "Owner unassigned"}{option.revisitOn && " · Review " + option.revisitOn}</small>
    {plan && <VisitActions plan={plan} charging={charging}/>}
  </div>;
}

export function VisitActions({plan,charging}:{plan: NonNullable<Props["plan"]>; charging?: ChargingSummary}) {
  return <details className="disclosure">
      <summary className="disclosure">Actions and offer conditions</summary>
      <h4>Run in parallel</h4>
      <p><b>Seller and economics.</b> {plan.commercial}</p>
      <p><b>Utility.</b> {plan.power}</p>
      <h4>Visit</h4>
      <p><b>Before booking.</b> {plan.beforeVisit}</p><p><b>On site.</b> {plan.fieldwork}</p>
      <h4>Price and approval</h4>
      <p>{plan.scenario}</p><small>{plan.basis}</small>
      {charging?.selected && !charging.stale && charging.comparator === "local" && charging.merit.downsideCeiling != null &&
        <p><b>Selected local case</b> · Downside price ceiling {amounts(charging.merit.downsideCeiling)}</p>}
      <p><b>Before an LOI.</b> {plan.beforeLoi}</p>
      <PowerDelayTrial/>
    </details>;
}
