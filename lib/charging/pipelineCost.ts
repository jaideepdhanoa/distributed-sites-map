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

export function costRange(layout: LayoutCost) {
  const low = Math.min(layout.base.perCharge, layout.downside.perCharge);
  const high = Math.max(layout.base.perCharge, layout.downside.perCharge);
  return amounts(low, 2) + "–" + amounts(high, 2);
}

/** Pin the number being explained even when the selected detailed case is incomplete. */
export function screenBasis(c?:ChargingSummary) {
  return c && !c.stale && c.result.siteCost==null && c.preliminary && "layouts" in c.preliminary ? "screen" : undefined;
}

export function pipelineCost(charging?: ChargingSummary) {
  if (!charging) return { value: "No charging case", basis: "", amount: null };
  if (charging.stale) return { value: "Needs recalculation", basis: "Site inputs have changed", amount: null };
  const amount = charging.result.siteCost;
  if (amount != null) {
    const scope = charging.energyScope === "excluded" ? " · excludes electricity" : "";
    return { value: amounts(amount, 2), basis: (charging.selected ? "Selected case" : "Planning estimate") + scope, amount };
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
