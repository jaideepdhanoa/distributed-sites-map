import "./opportunity-review.css";
import type { Opportunity, OpportunitySite } from "@/lib/selection/opportunity";

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

export default function OpportunityReview({review, matched}:{review:OpportunitySite; matched?:Opportunity}) {
  const primary = matched ?? review.primary;
  const others = [review.primary, ...review.alternatives].filter(o => o.route !== primary.route);
  const ranked = primary.rank == null ? "" : (primary.disposition === "Shortlist" ? " · Acquisition #" : " · Service #") + primary.rank;
  return <section className="opportunity-review" aria-label="Commercial review">
    <small>{primary.route}{ranked}{primary.route !== review.primary.route && " · Alternative route"}</small>
    <h3>{primary.disposition}</h3>
    <p><b>{["Close offering","Archive listing","Outside mandate","Previously dropped","Watch availability","Off-market prospect"].includes(primary.disposition) ? "Reopen when" : "Next check"}</b> · {primary.next}</p>
    <details className="disclosure"><summary className="disclosure">Decision evidence{others.length > 0 && " and alternative routes"}</summary>
      <Evidence option={primary}/>
      {others.map(option=><div key={option.route}><h4>{option.route} · {option.disposition}</h4>
        <p>{option.next}</p><Evidence option={option}/></div>)}
    </details>
  </section>;
}
