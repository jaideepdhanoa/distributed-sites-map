import type { PreliminaryCost } from "@/lib/charging/preliminary";
import { amounts } from "@/lib/charging/model";
import { costRange } from "@/lib/charging/pipelineCost";

const count = (n: number) => Math.round(n).toLocaleString("en-US");

export function PreliminaryChargingCost({ estimate, hypothetical = false }: { estimate: PreliminaryCost; hypothetical?: boolean }) {
  return <section className="preliminary-cost" aria-label="Preliminary site cost">
    <h3>{hypothetical ? "What if this footprint fits?" : "Preliminary site cost per completed charge"}</h3>
    {"reason" in estimate ? <p>{estimate.reason}.</p> : <>
      {estimate.layouts.map(layout => <div key={layout.condition}>
        <strong>{costRange(layout)}</strong>
        <p>{layout.stalls} {layout.stalls === 1 ? "space" : "spaces"} · {layout.condition} {layout.parcel ? "Verify access and peak operating availability." : (hypothetical ? "Recorded layout: " : "Footprint on its own: ")+estimate.space+"."}</p>
        <details className="disclosure cost-section"><summary className="disclosure">How this range was calculated</summary>
          <dl>
            <dt>Base estimate</dt><dd>{amounts(layout.base.annualCost)} annual net cost ÷ {count(layout.base.sessions)} annual charges = {amounts(layout.base.perCharge, 2)} per charge.</dd>
            <dt>Lower use and higher upgrade cost</dt><dd>{amounts(layout.downside.annualCost)} ÷ {count(layout.downside.sessions)} charges = {amounts(layout.downside.perCharge, 2)} per charge. This assumes 25% fewer completed charges and a 50% higher utility upgrade. Lower volume alone gives {amounts(layout.base.annualCost / layout.downside.sessions, 2)} per charge. The higher upgrade alone gives {amounts(layout.downside.annualCost / layout.base.sessions, 2)}.</dd>
            <dt>{estimate.terms === "purchase" ? "Property purchase" : "Monthly lease"}</dt><dd>{amounts(estimate.price)} · {estimate.priceBasis}. {estimate.terms === "purchase" && (estimate.closing * 100).toFixed(1) + "% closing costs."}</dd>
            <dt>Construction and power</dt><dd>{amounts(layout.build)} for stall construction{layout.conversionCost != null ? ", including "+amounts(layout.conversionCost)+" in additional works" : ""}. The utility upgrade is {amounts(layout.base.upgrade)} in the base case and {amounts(layout.downside.upgrade)} in the downside. Capital is recovered over {estimate.years} years at {(estimate.capital * 100).toFixed(1)}%, plus annual infrastructure tax of {(estimate.tax * 100).toFixed(1)}%.</dd>
            <dt>Annual operations</dt><dd>{amounts(layout.staffing)} for round-the-clock Moove attendants and {amounts(layout.upkeep)} for upkeep and insurance. {estimate.cashBasis} · {amounts(layout.layoutCash ?? estimate.cash)} per year after any filed displacement.</dd>
            {layout.parcel && <><dt>Operating sensitivity</dt><dd>Without credit for positive business income, {amounts((layout.base.annualCost+Math.max(0,layout.layoutCash ?? estimate.cash))/layout.base.sessions,2)}–{amounts((layout.downside.annualCost+Math.max(0,layout.layoutCash ?? estimate.cash))/layout.downside.sessions,2)} per charge. {layout.conversionCost == null && "Additional paving or conversion work is unpriced."}</dd></>}
          </dl>
          <p>Charge volume is scaled to the stalls in this layout. It assumes enough fleet demand and power from the utility. Confirm peak demand, power and access before relying on it.</p>
          <p>Excludes electricity, demand charges, additional conversion work, interrupted business income and shared management overhead.</p>
        </details>
      </div>)}
      <small>Planning scenarios · excludes electricity</small>
    </>}
  </section>;
}
