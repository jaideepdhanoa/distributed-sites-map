import type { SelectionRow } from "@/lib/selection/screen";
import type { Opportunity, OpportunitySite } from "@/lib/selection/opportunity";
import { reviewLink } from "@/lib/reviewNavigation";
import { amounts } from "@/lib/charging/model";
import { filedScreenLabel } from "@/lib/charging/summary";
import { ChargingLink } from "./ChargingLink";
import { Evidence } from "./OpportunityReview";
import { VisitActions } from "./VisitDecision";
import SelectionResearch from "./SelectionResearch";

type Props = { row: SelectionRow; review: OpportunitySite; option: Opportunity; origin: string };
const marketNames:Record<string,string> = {LAS:"Las Vegas", MIA:"Miami", PHX:"Phoenix"};

export default function ShortlistCard({ row, review, option, origin }:Props) {
  const plan = option.route === review.primary.route ? review.visitPlan : undefined;
  const charging = row.charging;
  const alternatives = [review.primary, ...review.alternatives].filter(other => other.route !== option.route);
  return <article aria-labelledby={"title-"+row.id} className="shortlist-card">
    <header>
      <div><span className="shortlist-kicker">{option.rank != null && <>Acquisition #{option.rank} · </>}{marketNames[row.city] ?? row.city}</span>
        <h2 id={"title-"+row.id}>{row.name}</h2>
        {review.name !== row.name && <p>{review.name}</p>}
      </div>
      {(row.hasRecord || row.mapped) && <a className="paper-btn" href={reviewLink("/",{site:row.id,city:row.city,funnel:"pipeline",sheet:"full"},origin)}>Open site record →</a>}
    </header>
    <div className="visit-decision shortlist-visit" aria-label="Visit decision">
      <div className="shortlist-judgment"><div><small>Visit decision</small><h3>{plan?.decision ?? "Review the next check"}</h3>
        <p><b>Why visit?</b> {plan?.reason ?? option.rationale}</p></div>
        <div className="shortlist-owner"><small>Decision owner</small><span>{option.owner ?? "Unassigned"}{option.revisitOn && <> · <time dateTime={option.revisitOn}>{option.revisitOn}</time></>}</span>
          <small>Charging screen</small><span>{charging?.merit.action ?? "Case pending"}</span></div></div>
      <p className="shortlist-next"><b>Next check</b> {option.next}</p>
      {plan && <VisitActions plan={plan} charging={charging}/>}
    </div>
    <details className="disclosure shortlist-evidence"><summary className="disclosure">Site evidence and economics</summary>
      <p>{option.route} · {row.stage} · {row.id}</p>
      <Evidence option={option}/>
      {alternatives.map(other=><div key={other.route}><h4>{other.route} · {other.disposition}</h4><p>{other.next}</p><Evidence option={other}/></div>)}
      <p>{row.geometry} · {row.option}</p>
      {row.assessed && <a className="text-link" href={reviewLink("/space-review",{site:row.id,panel:"space-options"},origin)}>Review layout evidence{row.evidenceDate && " · "+row.evidenceDate}</a>}
      {row.quickLube && row.priority !== "Screen fleet service" && <p>Check retained lifts and fleet-service rights separately.</p>}
      {row.mirrorStage && row.stage !== row.mirrorStage && <p>Workbook stage · {row.mirrorStage}</p>}
      {row.financeVisible && <p>{row.readiness} · Workbook base savings {row.amount == null ? "unmodeled" : (100*row.amount).toFixed(1)+"%"}</p>}
      {charging && <><h4>{charging.name}</h4><p>{charging.merit.next}</p>
        <p>{charging.result.siteCost == null ? "Cost pending" : "$"+charging.result.siteCost.toFixed(2)+"/charge"} · {charging.merit.netValue == null ? "Investment rank pending" : "Standalone downside network value "+amounts(charging.merit.netValue)}</p>
        {!charging.selected && <p>{filedScreenLabel(charging.screen)}</p>}<ChargingLink site={row.id} revision={charging.selected}/></>}
      {row.research && <SelectionResearch row={row.research}/>}
    </details>
  </article>;
}
