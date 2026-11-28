import type { PreliminaryCost } from "./preliminary";

/** Base parity on a drawn layout. Pending rights and larger footprints remain eligible. */
export function diligenceLayout(estimate?:PreliminaryCost, acquisition = false) {
  if (!estimate || !("layouts" in estimate)) return undefined;
  return estimate.layouts.find(layout => (layout.mixId || layout.parcel) && !layout.ledger.hypothetical &&
    (!acquisition || (layout.stalls >= 4 && layout.ledger.terms === "purchase")) &&
    layout.ledger.proxy != null && layout.base.perCharge <= layout.ledger.proxy);
}
