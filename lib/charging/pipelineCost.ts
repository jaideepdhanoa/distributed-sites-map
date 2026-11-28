import { higherUpgradeCase,screenLedger } from "./screenLedger";
import type { PipelineFit } from "../spaces/pipelineFit";
import { amounts } from "./model";
import type { LayoutCost } from "./preliminary";
import type { ChargingSummary } from "./summary";

const priceFormat=new Intl.NumberFormat("en-US",{useGrouping:false,minimumFractionDigits:2,maximumFractionDigits:2});
function printedCents(price:number){
  return Number(priceFormat.format(price).replace(".",""));
}

/** Compare the two prices shown to a reviewer. The model keeps its full precision. */
export function displayedPriceDelta(price:number,reference:number){
  return (printedCents(price)-printedCents(reference))/100 || 0;
}

export function costRange(layout: LayoutCost, stalls?:number) {
  const values=stalls!=null && stalls>0 && stalls!==layout.stalls ?
    [screenLedger(layout.ledger,{stalls}).perCharge!,higherUpgradeCase(layout.ledger,{stalls}).perCharge!] : [layout.base.perCharge,layout.downside.perCharge];
  const low = Math.min(...values);
  const high = Math.max(...values);
  return amounts(low, 2) + "–" + amounts(high, 2);
}

/** The count displayed alongside a price comes from the case supplying that price. */
export function displayedFit(fit?:PipelineFit, c?:ChargingSummary):PipelineFit|undefined {
  if(c?.selected && !c.stale && c.result.siteCost!=null && c.selectedStalls!=null)
    return {count:c.selectedStalls,value:c.selectedStalls+" spaces",basis:"Selected case · "+c.name+
      (fit ? " · System assessment: "+fit.value : "")};
  const lead=c && !c.stale && c.preliminary && "layouts" in c.preliminary ? c.preliminary.layouts[0] : null;
  if(lead && fit && lead.mixId && lead.mixId!==fit.layouts?.[0]?.mixId)
    return {...fit,count:lead.stalls,value:lead.stalls+" spaces",basis:lead.condition};
  return fit;
}

/** Pin the number being explained even when the selected detailed case is incomplete. */
export function screenBasis(c?:ChargingSummary) {
  return c && !c.stale && (!c.selected || c.result.siteCost==null) && c.preliminary && "layouts" in c.preliminary ? "screen" : undefined;
}

export function pipelineCost(charging?: ChargingSummary) {
  if (!charging) return { value: "No charging case", basis: "", amount: null };
  if (charging.stale) return { value: "Needs recalculation", basis: "Site inputs have changed", amount: null };
  const amount = charging.result.siteCost;
  if (amount != null && (charging.selected || !charging.preliminary)) {
    const scope = charging.energyScope === "excluded" ? " · excludes electricity" : "";
    return { value: amounts(amount, 2), basis: (charging.selected ? "Selected case" + (charging.selectedStalls != null ? " · " + charging.selectedStalls + " stalls" : "") : "Planning estimate") + scope, amount };
  }
  if (charging.preliminary) {
    if ("layouts" in charging.preliminary) {
      const layout = charging.preliminary.layouts[0];
      return {value:costRange(layout), amount:layout.base.perCharge,
        basis:"Preliminary · " + layout.stalls + (layout.stalls === 1 ? " space · " : " spaces · ") + layout.condition + " · excludes electricity"};
    }
    return {value:"Not estimated", basis:charging.preliminary.reason, amount:null};
  }
  const missing = charging.result.missing?.[0];
  const example = charging.screen?.find(scenario => scenario.stalls === 4);
  if (example && charging.screenDepot != null) {
    const estimate = amounts(charging.screenDepot * (1 - example.base), 2);
    return { value: "Site cost pending", basis: (missing ? "Needed: " + missing + ". " : "") + "Network example: " + estimate + "/charge at 4 assumed spaces, excluding electricity", amount: null };
  }
  return { value: "Not calculated", basis: missing ? "Needed: " + missing : "Check site inputs and completed charges", amount: null };
}
