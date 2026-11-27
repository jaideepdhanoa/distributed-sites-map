import SiteCoverageReview from "./SiteCoverageReview";
import "./opportunity-review.css";
import type { Opportunity, OpportunitySite } from "@/lib/selection/opportunity";
import type { ChargingSummary } from "@/lib/charging/summary";
import { recommendation, nextDecision } from "@/lib/selection/opportunityDisplay";
import VisitDecision from "./VisitDecision";

export function Evidence({option}:{option:Opportunity}) {
  return <>
    <p>{option.rationale}</p>
    <small>Reviewed {option.reviewedOn}{option.owner && " · " + option.owner}{option.revisitOn && " · Revisit " + option.revisitOn}</small>
    <p><a className="text-link" href={option.evidence} target="_blank" rel="noreferrer">Pipeline evidence</a>
      {option.offering && (/^https:\/\//.test(option.offering)
        ? <> · <a className="text-link" href={option.offering} target="_blank" rel="noreferrer">Offering evidence</a></>
        : <> · {option.offering}</>)}</p>
  </>;
}

type RecommendationProps = { review: OpportunitySite; active?: boolean; charging?: ChargingSummary };

export function RecordRecommendation({review, active}: RecommendationProps) {
  const primary = review.primary;
  const visit = active && primary.disposition === "Shortlist" ? review.visitPlan : undefined;
  return <section className="acquisition-brief" aria-label="Team recommendation">
    <div className="recommendation-body"><small className="recommendation-label">Team recommendation{primary.rank != null && " · All markets"}</small>
    <h3>{recommendation(primary)}</h3>
    {primary.route !== "Site lead" && <small>{primary.route}</small>}
    {visit && <p>{visit.reason}</p>}
    {primary.dropReason && <p><b>Reason</b> · {primary.dropReason}</p>}
    <p className="recommended-next"><b>{visit ? "Visit decision" : ["Dropped","Archive listing","Outside mandate","Watch availability","Off-market prospect"].includes(primary.disposition) ? "Reconsider when" : "Next step"}</b> {nextDecision(review, primary)}</p>
    <small>{primary.owner ? "Owner · " + primary.owner : "Decision owner unassigned"}{primary.revisitOn && <> · Review <time dateTime={primary.revisitOn}>{primary.revisitOn}</time></>}</small></div>

  </section>;
}

export function RecommendationSources({review, active, charging}: RecommendationProps) {
  const primary = review.primary;
  const others = review.alternatives.filter(o => o.route !== primary.route);
  const visit = active && primary.disposition === "Shortlist" ? review.visitPlan : undefined;
  return (<details className="disclosure"><summary className="disclosure">Review notes and sources</summary>
      {active && primary.disposition === "Shortlist" && <VisitDecision option={primary} plan={review.visitPlan} charging={charging}/>}
      {visit && <p><b>Before booking</b> {visit.beforeVisit}</p>}
      {visit && <p>{primary.next}</p>}
      <Evidence option={primary}/>
      {others.map(option => <div key={option.route}><h4>{option.route} · {recommendation(option)}</h4><p>{option.next}</p>
        {option.dropReason && <p>{option.dropReason}</p>}<Evidence option={option}/></div>)}
    </details>);
}

export default function OpportunityReview({review, matched, active, charging}:RecommendationProps & { matched?: Opportunity }) {
  const primary = matched ?? review.primary;
  const others = [review.primary, ...review.alternatives].filter(o => o.route !== primary.route);
  const ranked = primary.rank == null ? "" : (primary.disposition === "Shortlist" ? " · Acquisition #" : " · Service #") + primary.rank;
  return <section className="opportunity-review" aria-label="Commercial review">
    <small>{primary.route}{ranked}{primary.route !== review.primary.route && " · Alternative route"}</small>
    <h3>{primary.disposition}</h3>
    {active && primary.disposition === "Shortlist" && primary.route === review.primary.route &&
      <VisitDecision option={primary} plan={review.visitPlan} charging={charging}/>}
    {primary.dropReason && <p><b>Drop reason</b> · {primary.dropReason}</p>}
    <p><b>{["Dropped","Archive listing","Outside mandate","Watch availability","Off-market prospect"].includes(primary.disposition) ? "Reopen when" : "Next check"}</b> · {primary.next}</p>
    {review.coverage && <SiteCoverageReview evidence={review.coverage}/>}
    <details className="disclosure"><summary className="disclosure">Decision evidence{others.length > 0 && " and alternative routes"}</summary>
      <Evidence option={primary}/>
      {others.map(option=><div key={option.route}><h4>{option.route} · {option.disposition}</h4>
        {option.dropReason && <p>Drop reason · {option.dropReason}</p>}<p>{option.next}</p><Evidence option={option}/></div>)}
    </details>
  </section>;
}
