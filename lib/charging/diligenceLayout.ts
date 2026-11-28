import type { PreliminaryCost } from "./preliminary";

// The four-stall program minimum and the twenty-stall costing scale apply to
// screening for diligence. Larger physical estimates remain available in Spaces.
export function diligenceLayout(estimate?:PreliminaryCost) {
  if(!estimate || !("layouts" in estimate)) return undefined;
  return estimate.layouts.filter(l=>l.system && l.mixId && l.stalls>=4 && l.stalls<=20 &&
    l.ledger.proxy!=null && l.downside.perCharge<=l.ledger.proxy)
    .sort((a,b)=>a.downside.perCharge-b.downside.perCharge)[0];
}
