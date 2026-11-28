import type { DealProps } from "../types";
import type { PipelineFit } from "../spaces/pipelineFit";
import { amounts } from "./model";
import { displayedFit, pipelineCost, costRange, displayedPriceDelta } from "./pipelineCost";
import { defaultListAssumptions, preliminaryCost, type ListAssumptions, type PreliminaryCost } from "./preliminary";

export function listSpace(physical?: PipelineFit, charging?:DealProps["charging"]) {
  const fit=displayedFit(physical,charging);
  if (fit?.count == null) return {value:fit?.value ?? "Needs measurement", basis:fit?.basis || "No measured layout on file", count:null, group:"unmeasured"};
  if (fit.count === 0) return {value:"0 in assessed layout", basis:fit.basis, count:0, group:"zero"};
  return {...fit, group:"positive"};
}

export function listScreen(d: DealProps, assumptions = defaultListAssumptions) {
  const c = d.charging;
  const original = pipelineCost(c);
  const originalGroup = original.amount == null ? "pending" : "priced";
  const result = (cost:typeof original, group:string, estimate?:PreliminaryCost, proxy?:number|null) =>
    ({cost, group, estimate, proxy});
  if (!c || c.stale || (c.selected && c.result.siteCost != null)) return result(original, originalGroup, c && !c.stale && c.result.siteCost == null ? c.preliminary : undefined);
  const a = d.purchase?.assumptions ?? c.screenAssumptions;
  const assessed = c.preliminary && "layouts" in c.preliminary;
  if (!a) return result(original, originalGroup, assessed ? c.preliminary : undefined);
  if(!assessed && !assumptions.assumeFit) return result(original,originalGroup);
  const custom = hasListChanges(assumptions, false);
  const estimate = assessed && !custom ? c.preliminary! :
    preliminaryCost(d, a, c.screenTenure, {assumptions, hypothetical:!assessed});
  if (!("layouts" in estimate)) return result(original, originalGroup);
  const layout = estimate.layouts[0];
  const proxy = a.hub != null && a.charging?.charges ? a.hub / a.charging.charges : null;
  const detail = assessed ? (custom ? "Trial" : "Preliminary") + " · " + layout.stalls + " spaces · " + layout.condition
    : "If " + layout.stalls + " spaces fit · " + estimate.priceBasis + (c.selected ? " · selected case incomplete" : "");
  return result({amount:layout.base.perCharge, value:costRange(layout), basis:detail + " · excludes electricity"}, assessed ? "priced" : "scenario", estimate, proxy);
}

export function hasListChanges(a:ListAssumptions, includeStalls = true) {
  return (includeStalls && (a.assumeFit || a.stalls !== defaultListAssumptions.stalls)) || !a.creditCash ||
    a.upgrade != null || a.unitBuild != null || a.attendant != null;
}

export function proxyReading(screen: ReturnType<typeof listScreen>) {
  if (screen.proxy == null || !screen.estimate || !("layouts" in screen.estimate)) return "";
  const {base, downside} = screen.estimate.layouts[0];
  const gap = displayedPriceDelta(downside.perCharge,screen.proxy);
  if (gap===0) return "Matches depot proxy in downside to the cent";
  if (gap <= 0) return amounts(-gap,2) + " below depot proxy in downside";
  const baseGap=displayedPriceDelta(base.perCharge,screen.proxy);
  if (baseGap===0) return "Matches depot proxy in base to the cent";
  if (baseGap<0) return "Below depot proxy in base only";
  return amounts(baseGap,2) + " above depot proxy in base";
}
