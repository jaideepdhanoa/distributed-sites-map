import "./opportunity-review.css";
import type { Opportunity, OpportunitySite } from "@/lib/selection/opportunity";
import type { ChargingSummary } from "@/lib/charging/summary";
import { recommendation, recommendationNote } from "@/lib/selection/opportunityDisplay";
import VisitDecision from "./VisitDecision";

function Evidence({option}:{option:Opportunity}) {
  return <>
    <p>{option.rationale}</p>
    <small>Reviewed {option.reviewedOn}{option.owner && " · " + option.owner}{option.revisitOn && " · Revisit " + option.revisitOn}</small>
    <p><a className="text-link" href={option.evidence} target="_blank" rel="noreferrer">Pipeline evidence</a>
      {option.offering && (/^https:\/\//.test(option.offering)
        ? <> · <a className="text-link" href={option.offering} target="_blank" rel="noreferrer">Offering evidence</a></>
        : <> · {option.offering}</>)}</p>
  </>;
}

export default function OpportunityReview({review, matched, active, charging, record}:{record?:boolean; review:OpportunitySite; matched?:Opportunity; active?:boolean; charging?:ChargingSummary}) {
  const primary = matched ?? review.primary;
  const others = [review.primary, ...review.alternatives].filter(o => o.route !== primary.route);
  if (record) return <section className="opportunity-review" aria-label="Team recommendation">
    <small>Team recommendation</small><h3>{recommendation(primary)}</h3>
    <p>{recommendationNote(primary)}</p>
    {primary.rank != null && <small>Ranked across all markets on the {primary.disposition === "Shortlist" ? "acquisition" : "fleet service"} list.</small>}
    {primary.dropReason && <p><b>Reason</b> · {primary.dropReason}</p>}
    {active && primary.disposition === "Shortlist" && <VisitDecision option={primary} plan={review.visitPlan} charging={charging}/>}
    <details className="disclosure"><summary className="disclosure">Review notes and sources</summary>
      {primary.route !== "Site lead" && <p>{primary.route}</p>}
      {recommendationNote(primary) !== primary.next && <p>{primary.next}</p>}
      <Evidence option={primary}/>
      {others.map(option => <div key={option.route}><h4>{option.route} · {recommendation(option)}</h4><p>{option.next}</p>
        {option.dropReason && <p>{option.dropReason}</p>}<Evidence option={option}/></div>)}
    </details>
  </section>;
  const ranked = primary.rank == null ? "" : (primary.disposition === "Shortlist" ? " · Acquisition #" : " · Service #") + primary.rank;
  return <section className="opportunity-review" aria-label="Commercial review">
    <small>{primary.route}{ranked}{primary.route !== review.primary.route && " · Alternative route"}</small>
    <h3>{primary.disposition}</h3>
    {active && primary.disposition === "Shortlist" && primary.route === review.primary.route &&
      <VisitDecision option={primary} plan={review.visitPlan} charging={charging}/>}
    {primary.dropReason && <p><b>Drop reason</b> · {primary.dropReason}</p>}
    <p><b>{["Dropped","Archive listing","Outside mandate","Watch availability","Off-market prospect"].includes(primary.disposition) ? "Reopen when" : "Next check"}</b> · {primary.next}</p>
    <details className="disclosure"><summary className="disclosure">Decision evidence{others.length > 0 && " and alternative routes"}</summary>
      <Evidence option={primary}/>
      {others.map(option=><div key={option.route}><h4>{option.route} · {option.disposition}</h4>
        {option.dropReason && <p>Drop reason · {option.dropReason}</p>}<p>{option.next}</p><Evidence option={option}/></div>)}
    </details>
  </section>;
}
