import type { DealProps } from "../types";
import type { PurchaseAssumptions } from "../purchaseReview";
import type { ChargingFootprint } from "../spaces/pipelineFit";
import { annualRecovery, type Inputs } from "./model";

export type RangeCase = { sessions: number; upgrade: number; annualCost: number; perCharge: number };
export type LayoutCost = ChargingFootprint & {
  base: RangeCase; downside: RangeCase; build: number; staffing: number; upkeep: number;
};
export type PreliminaryCost = { reason: string } | {
  layouts: LayoutCost[]; space: string; price: number; terms: "purchase" | "lease"; priceBasis: string;
  cash: number; cashBasis: string; years: number; closing: number; capital: number; tax: number;
};

export function preliminaryCost(d: DealProps, a?: PurchaseAssumptions, selected?: Inputs): PreliminaryCost {
  const option = d.opportunityReview?.primary;
  if (d.kind === "land" || option?.disposition === "Outside mandate") return { reason: "Outside the current charging acquisition scope" };
  if (d.listing_removed || ["Watch availability", "Archive listing", "Dropped", "Off-market prospect"].includes(option?.disposition ?? "")) {
    return { reason: "Confirm the property is available and obtain current terms" };
  }
  if (selected?.rights === "unavailable") return { reason: "Charging rights are unavailable for the selected case" };
  if (d.chargingHold && /seller availability|tenant lease/i.test(d.chargingHold)) return { reason: d.chargingHold };
  const lease = option?.route === "Operating lease" || selected?.terms === "lease";
  if (["Host agreement", "Fleet service", "Service premises"].includes(option?.route ?? "")) {
    return { reason: "Charging access and commercial terms are needed for this service offer" };
  }
  const research = d.selectionResearch;
  const w = d.purchase?.inputs;
  const wholeProperty = research ? research.basis === "Public whole-property ask" ||
    (research.basis === "Workbook asking price" && /real estate included/i.test(research.scope)) : /^yes$/i.test(w?.ownership ?? "");
  const price = lease ? selected?.terms === "lease" && selected.rights === "controlled" ? selected.values.rent : null
    : wholeProperty ? (research ? research.quote : d.asking_price ?? w?.ask) : null;
  if (!lease && research?.quote != null && d.asking_price != null && d.asking_price > 0 && Math.abs(research.quote - d.asking_price) > 1) {
    return {reason:"Reconcile the two asking prices and confirm which assets are included"};
  }
  if (price == null || !Number.isFinite(price) || price <= 0) return { reason: lease
    ? "Confirm monthly rent and rights to use the spaces for charging" : "Confirm a current purchase price that includes the property" };

  const fit = d.chargingSpace;
  const layouts = fit?.layouts ?? (fit?.count && fit.count > 0 ? [{stalls:fit.count, condition:fit.basis}] : []);
  if (!layouts.length) return { reason: fit?.count === 0 ? "No charging spaces fit the assessed layout" : fit?.basis || "Measure a charging layout and its aisle" };
  const c = a?.charging;
  if (!a || !c || !(a.horizon && a.horizon > 0 && a.demand && a.demand > 0 && c.charges && c.charges > 0 &&
    c.ports && c.ports > 0 && c.perPost && c.perPost > 0) || a.capital == null || a.closing == null ||
    c.attendant == null || c.unitBuild == null || c.upgrade == null || c.fixed == null || c.insurance == null ||
    c.perCharger == null || c.tax == null) return {reason:"The workbook charging and cost assumptions are incomplete"};

  const chargesPerStall = c.charges / a.horizon / a.demand;
  const recovery = annualRecovery(a.capital, a.horizon);
  const annualProperty = lease ? price * 12 : price * (1 + a.closing) * recovery;
  // Use retained business cash only for an operating purchase. A missing figure earns no credit.
  const retained = !lease && option?.route !== "Property only" && !/^no$/i.test(w?.open ?? "") ? w?.cash : null;
  const cash = retained ?? 0;
  const costed: LayoutCost[] = [];
  for (const layout of layouts) {
    const build = layout.stalls * c.unitBuild;
    const staffing = Math.ceil(layout.stalls / c.perPost) * c.attendant;
    const upkeep = c.fixed + c.insurance + Math.ceil(layout.stalls / c.ports) * c.perCharger;
    const scenario = (volume: number, upgrade: number): RangeCase => {
      const sessions = layout.stalls * chargesPerStall * volume;
      const annualCost = annualProperty + (build + upgrade) * (recovery + c.tax!) + staffing + upkeep - cash;
      return {sessions, upgrade, annualCost, perCharge:annualCost / sessions};
    };
    costed.push({...layout, build, staffing, upkeep, base:scenario(1, c.upgrade), downside:scenario(0.75, c.upgrade * 1.5)});
  }
  return {layouts:costed, space:fit!.value, price, terms:lease ? "lease" : "purchase",
    priceBasis:lease ? "Selected charging lease" : research?.basis || "Workbook property ask",
    cash, cashBasis:retained == null ? "No business income credited" : "Workbook retained annual cash",
    years:a.horizon, capital:a.capital, closing:a.closing, tax:c.tax};
}
