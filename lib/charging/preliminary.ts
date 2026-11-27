import type { DealProps } from "../types";
import type { PurchaseAssumptions } from "../purchaseReview";
import type { ChargingFootprint } from "../spaces/pipelineFit";
import { screenLedger,type LedgerBasis } from "./screenLedger";
import { type Inputs } from "./model";

export type RangeCase = { sessions: number; upgrade: number; annualCost: number; perCharge: number };
export type LayoutCost = ChargingFootprint & {
  ledger: LedgerBasis; base: RangeCase; downside: RangeCase; build: number; layoutCash?:number; staffing: number; upkeep: number;
};
export type PreliminaryCost = { reason: string } | {
  layouts: LayoutCost[]; space: string; price: number; terms: "purchase" | "lease"; priceBasis: string;
  cash: number; cashBasis: string; years: number; closing: number; capital: number; tax: number;
};

export type ListAssumptions = {
  stalls: number; volume: number; upgrade?: number; unitBuild?: number; attendant?: number; creditCash: boolean;
};
export const defaultListAssumptions: ListAssumptions = { stalls: 6, volume: 100, creditCash: true };

export type ScreenTenure = Pick<Inputs, "rights" | "terms"> & {values: Pick<Inputs["values"], "rent">};
export function preliminaryCost(d: DealProps, a?: PurchaseAssumptions, selected?: ScreenTenure,
  trial?: { assumptions: ListAssumptions; hypothetical: boolean }): PreliminaryCost {
  const option = d.opportunityReview?.primary;
  if (d.kind === "land" || option?.disposition === "Outside mandate") return { reason: "Outside the current charging acquisition scope" };
  if (d.listing_removed || ["Watch availability", "Archive listing", "Dropped", "Off-market prospect"].includes(option?.disposition ?? "")) {
    return { reason: "Confirm the property is available and obtain current terms" };
  }
  if (trial?.hypothetical && option?.disposition === "Suggest drop") return {reason:"Review the disposition before testing a new charging layout"};
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
  // A filed sensitivity can have explicit test terms while the actual offer still needs confirmation.
  const matchedCases = d.chargingSpace?.layouts?.filter(l=>l.parcel).map(l=>
    d.opportunityReview?.coverage?.cases.find(c=>c.stalls===l.stalls && c.price!=null && c.base!=null));
  const sharedTerms = matchedCases?.[0];
  const parcelTerms = !lease && option?.disposition==="Shortlist" && !trial?.hypothetical && sharedTerms &&
    matchedCases?.every(c=>c?.price===sharedTerms.price && c?.cash===sharedTerms.cash) ? sharedTerms : undefined;
  const filed = trial?.hypothetical && !lease && option?.disposition === "Shortlist"
    ? d.opportunityReview?.coverage?.cases.find(c => c.stalls === trial.assumptions.stalls && c.price != null && c.base != null)
    : parcelTerms;
  const price = filed?.price ?? (lease ? selected?.terms === "lease" && selected.rights === "controlled" ? selected.values.rent : null
    : wholeProperty ? (research ? research.quote : d.asking_price ?? w?.ask) : null);
  if (parcelTerms && wholeProperty && research?.quote != null && Math.abs(research.quote - parcelTerms.price!) > 1) return {reason:"Reconcile the filed test price and current property terms"};
  if (!lease && research?.quote != null && d.asking_price != null && d.asking_price > 0 && Math.abs(research.quote - d.asking_price) > 1) {
    return {reason:"Reconcile the two asking prices and confirm which assets are included"};
  }
  if (price == null || !Number.isFinite(price) || price <= 0) return { reason: lease
    ? "Confirm monthly rent and rights to use the spaces for charging" : "Confirm a current purchase price that includes the property" };

  const fit = d.chargingSpace;
  const layouts:ChargingFootprint[] = trial?.hypothetical ? [{stalls:trial.assumptions.stalls, condition:"Assumed footprint · verify space, access and displacement"}] : fit?.layouts ?? (fit?.count && fit.count > 0 ? [{stalls:fit.count, condition:fit.basis}] : []);
  if (!layouts.length) return { reason: fit?.count === 0 ? "No charging spaces fit the assessed layout" : fit?.basis || "Measure a charging layout and its aisle" };
  const c = a?.charging;
  if (!a || !c || !(a.horizon && a.horizon > 0 && a.demand && a.demand > 0 && c.charges && c.charges > 0 &&
    c.ports && c.ports > 0 && c.perPost && c.perPost > 0) || a.capital == null || a.closing == null ||
    c.attendant == null || c.unitBuild == null || c.upgrade == null || c.fixed == null || c.insurance == null ||
    c.perCharger == null || c.tax == null) return {reason:"The workbook charging and cost assumptions are incomplete"};

  // Use retained business cash only for an operating purchase. A missing figure earns no credit.
  const retained = !lease && option?.route !== "Property only" && !/^no$/i.test(w?.open ?? "") ? w?.cash : null;
  const credited = filed && option?.route !== "Property only" && !/^no$/i.test(w?.open ?? "") ? filed.cash : retained;
  // Removing credit for positive earnings must preserve any operating loss.
  const cash = trial?.assumptions.creditCash === false ? Math.min(0, credited ?? 0) : credited ?? 0;
  const upgrade = trial?.assumptions.upgrade ?? c.upgrade;
  const terms=lease ? "lease" : "purchase";
  const priceBasis=filed ? "Filed test price · confirm the offering" : lease ? "Selected charging lease" : research?.basis || "Workbook property ask";
  const cashBasis=trial?.assumptions.creditCash===false && (credited??0)>0 ? "Credit removed in list trial" : credited==null ? "No business income credited" : filed ? "Retained cash in filed test" : "Workbook retained annual cash";
  const space=fit?.value ?? "unmeasured";
  const costed: LayoutCost[] = [];
  for (const layout of layouts) {
    const ledger:LedgerBasis = {
      terms, creditCash:trial?.assumptions.creditCash, condition:layout.condition, space, priceBasis, cashBasis, hypothetical:trial?.hypothetical??false,
      parcel:layout.parcel, conversionRecorded:layout.conversionCost!=null, displacedRecorded:layout.lostAnnualCash!=null,
      workbookDefaults:trial ? {volume:100,unitBuild:c.unitBuild,postCost:c.attendant,upgrade:c.upgrade,cash:credited??0} : undefined,
      source:lease || filed ? null : research?.source, date:lease || filed ? null : research?.reviewedOn,
      proxy:a.hub!=null ? a.hub/c.charges : null,
      inputs:{stalls:layout.stalls, volume:trial?.assumptions.volume??100, benchmark:c.charges, referenceYears:a.horizon, referenceStalls:a.demand,
        price, years:a.horizon, rate:a.capital*100, closing:a.closing*100, unitBuild:trial?.assumptions.unitBuild??c.unitBuild, upgrade,
        tax:c.tax*100, postCost:trial?.assumptions.attendant??c.attendant, perPost:c.perPost, fixed:c.fixed, insurance:c.insurance,
        ports:c.ports, perCharger:c.perCharger, cash:credited??0, conversion:layout.conversionCost??0, displaced:lease?0:layout.lostAnnualCash??0},
    };
    const base=screenLedger(ledger), downside=screenLedger(ledger,{},3);
    if(base.perCharge==null || downside.perCharge==null) continue;
    const range=(r:typeof base):RangeCase=>({sessions:r.sessions,upgrade:r.upgrade,annualCost:r.annualCost,perCharge:r.perCharge!});
    costed.push({...layout, ...(layout.parcel?{layoutCash:-base.costs.cash-base.costs.displaced}:{}), ledger, build:base.build, staffing:base.costs.staffing, upkeep:base.costs.upkeep,
      base:range(base), downside:range(downside)});
  }
  if (!costed.length) return {reason:"No completed charges in this layout"};
  return {layouts:costed, space, price, terms, priceBasis, cash, cashBasis,
    years:a.horizon, capital:a.capital, closing:a.closing, tax:c.tax};
}
