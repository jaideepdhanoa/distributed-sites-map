import { planningPriceCases, type PlanningPrice } from "./planningInputs";
import type { DealProps } from "../types";
import type { PurchaseAssumptions } from "../purchaseReview";
import type { ChargingFootprint } from "../spaces/pipelineFit";
import { higherUpgradeCase,screenLedger,type LedgerBasis } from "./screenLedger";
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
  assumeFit?:boolean; stalls: number; volume: number; upgrade?: number; unitBuild?: number; attendant?: number; creditCash: boolean;
};
export const defaultListAssumptions: ListAssumptions = { assumeFit:false, stalls: 6, volume: 100, creditCash: true };

export type ScreenTenure = Pick<Inputs, "rights" | "terms"> & {values: Pick<Inputs["values"], "rent">};
type Trial = {assumptions: ListAssumptions; hypothetical: boolean};

function costCase(d: DealProps, a?: PurchaseAssumptions, selected?: ScreenTenure,
  trial?: Trial, planning?: PlanningPrice): PreliminaryCost {
  const option = d.opportunityReview?.primary;
  if (d.kind === "land" || option?.disposition === "Outside mandate") return { reason: "Outside the current charging acquisition scope" };
  if (!planning && (d.listing_removed || ["Watch availability", "Archive listing", "Dropped", "Off-market prospect"].includes(option?.disposition ?? ""))) {
    return { reason: "Confirm the property is available and obtain current terms" };
  }
  if (trial?.hypothetical && option?.disposition === "Suggest drop") return {reason:"Review the disposition before testing a new charging layout"};
  if (selected?.rights === "unavailable") return { reason: "Charging rights are unavailable for the selected case" };
  if (!planning && d.chargingHold && /seller availability/i.test(d.chargingHold)) return { reason: d.chargingHold };
  const lease = option?.route === "Operating lease" || selected?.terms === "lease";
  if (["Host agreement", "Fleet service", "Service premises"].includes(option?.route ?? "")) {
    return { reason: "Charging access and commercial terms are needed for this service offer" };
  }
  const research = d.selectionResearch;
  const w = d.purchase?.inputs;
  const wholeProperty = research ? research.basis === "Public whole-property ask" ||
    (research.basis === "Workbook asking price" && /real estate included/i.test(research.scope)) : /^yes$/i.test(w?.ownership ?? "");
  // A filed sensitivity can have explicit test terms while the actual offer still needs confirmation.
  const matchedCases = d.chargingSpace?.layouts?.filter(l=>l.parcel && !l.system).map(l=>
    d.opportunityReview?.coverage?.cases.find(c=>c.stalls===l.stalls && c.price!=null && c.base!=null));
  const sharedTerms = matchedCases?.[0];
  const parcelTerms = !lease && option?.route?.includes("acquisition") && !trial?.hypothetical && sharedTerms &&
    matchedCases?.every(c=>c?.price===sharedTerms.price && c?.cash===sharedTerms.cash) ? sharedTerms : undefined;
  const filed = trial?.hypothetical && !lease && option?.route?.includes("acquisition")
    ? d.opportunityReview?.coverage?.cases.find(c => c.stalls === trial.assumptions.stalls && c.price != null && c.base != null)
    : parcelTerms;
  const price = planning?.value ?? filed?.price ?? (lease ? selected?.terms === "lease" && selected.rights === "controlled" ? selected.values.rent : null
    : wholeProperty ? (research ? research.quote : d.asking_price ?? w?.ask) : null);
  if (!planning && parcelTerms && wholeProperty && research?.quote != null && Math.abs(research.quote - parcelTerms.price!) > 1) return {reason:"Reconcile the filed test price and current property terms"};
  if (!planning && !lease && research?.quote != null && d.asking_price != null && d.asking_price > 0 && Math.abs(research.quote - d.asking_price) > 1) {
    return {reason:"Reconcile the two asking prices and confirm which assets are included"};
  }
  if (price == null || !Number.isFinite(price) || price <= 0) return { reason: lease
    ? "Confirm monthly rent and rights to use the spaces for charging" : "Confirm a current purchase price that includes the property" };

  const fit = d.chargingSpace;
  const layouts:ChargingFootprint[] = planning?.layouts ?? (trial?.hypothetical ? [{stalls:trial.assumptions.stalls, condition:"Assumed footprint · verify space, access and displacement"}] : fit?.layouts ?? (fit?.count && fit.count > 0 ? [{stalls:fit.count, condition:fit.basis}] : []));
  if (!layouts.length) return { reason: fit?.count === 0 ? "No charging spaces fit the assessed layout" : fit?.basis || "Measure a charging layout and its aisle" };
  const c = a?.charging;
  if (!a || !c || !(a.horizon && a.horizon > 0 && a.demand && a.demand > 0 && c.charges && c.charges > 0 &&
    c.ports && c.ports > 0 && c.perPost && c.perPost > 0) || a.capital == null || a.closing == null ||
    c.attendant == null || c.unitBuild == null || c.upgrade == null || c.fixed == null || c.insurance == null ||
    c.perCharger == null || c.tax == null) return {reason:"The workbook charging and cost assumptions are incomplete"};

  // Use retained business cash only for an operating purchase. A missing figure earns no credit.
  const retained = !lease && option?.route !== "Property only" && !/^no$/i.test(w?.open ?? "") ? w?.cash : null;
  const credited = planning ? Math.min(0, retained ?? 0) : filed && option?.route !== "Property only" && !/^no$/i.test(w?.open ?? "") ? filed.cash : retained;
  // Removing credit for positive earnings must preserve any operating loss.
  const cash = trial?.assumptions.creditCash === false ? Math.min(0, credited ?? 0) : credited ?? 0;
  const upgrade = trial?.assumptions.upgrade ?? c.upgrade;
  const terms=lease ? "lease" : "purchase";
  const priceBasis=planning?.label ?? (filed ? "Filed test price · confirm the offering" : lease ? "Selected charging lease" : research?.basis || "Workbook property ask");
  const cashBasis=planning ? (credited && credited<0 ? "Recorded operating loss included" : "No positive business income credited pending validation") : trial?.assumptions.creditCash===false && (credited??0)>0 ? "Credit removed in list trial" : credited==null ? "No business income credited" : filed ? "Retained cash in filed test" : "Workbook retained annual cash";
  const space=fit?.value ?? "unmeasured";
  const costed: LayoutCost[] = [];
  for (const layout of layouts) {
    const incomeUnverified=layout.operatingConversion && layout.lostAnnualCash==null && (credited??0)>0;
    const layoutIncome=incomeUnverified ? 0 : credited??0;
    const ledger:LedgerBasis = {
      mixId:layout.mixId, componentIds:layout.componentIds, areaKinds:layout.areaKinds, terms, siteDrivers:true, withheldOperatingCash:incomeUnverified?credited??undefined:undefined, parts:layout.parts, rightsByArea:layout.rightsByArea, businessType:d.business_type, creditCash:trial?.assumptions.creditCash, condition:layout.condition, space:layout.system ? layout.stalls+" assessed stalls" : space, priceBasis, cashBasis:incomeUnverified ? "Positive business income excluded until conversion losses are quantified" : cashBasis, hypothetical:planning?.assumedFit ?? trial?.hypothetical ?? false,
      ...(planning ? {validation:planning.validation} : {}),
      parcel:layout.parcel, conversionRecorded:layout.conversionCost!=null, displacedRecorded:layout.lostAnnualCash!=null,
      workbookDefaults:trial ? {volume:100,unitBuild:c.unitBuild,postCost:c.attendant,upgrade:c.upgrade,cash:credited??0} : undefined,
      source:planning?.source ?? (lease || filed ? null : research?.source), date:planning ? null : lease || filed ? null : research?.reviewedOn,
      proxy:a.hub!=null ? a.hub/c.charges : null,
      inputs:{stalls:layout.stalls, volume:100, benchmark:c.charges, referenceYears:a.horizon, referenceStalls:a.demand,
        price, years:a.horizon, rate:a.capital*100, closing:a.closing*100, unitBuild:trial?.assumptions.unitBuild??c.unitBuild, upgrade,
        tax:c.tax*100, postCost:trial?.assumptions.attendant??c.attendant, perPost:c.perPost, fixed:c.fixed, insurance:c.insurance,
        ports:c.ports, perCharger:c.perCharger, cash:layoutIncome, conversion:layout.conversionCost??0, displaced:lease?0:layout.lostAnnualCash??0},
    };
    const base=screenLedger(ledger), downside=higherUpgradeCase(ledger);
    if(base.perCharge==null || downside.perCharge==null) continue;
    const range=(r:typeof base):RangeCase=>({sessions:r.sessions,upgrade:r.upgrade,annualCost:r.annualCost,perCharge:r.perCharge!});
    costed.push({...layout, ...(layout.parcel?{layoutCash:-base.costs.cash-base.costs.displaced}:{}), ledger, build:base.build, staffing:base.costs.staffing, upkeep:base.costs.upkeep,
      base:range(base), downside:range(downside)});
  }
  if (!costed.length) return {reason:"No completed charges in this layout"};
  // Keep the least disruptive operating scope first. A smaller priced variant can
  // save a staffed post, but a different rights or cash assumption is a new case.
  const first=costed[0];
  if(first.operatingScope!=null) {
    const comparable=costed.filter(l=>l.operatingScope===first.operatingScope &&
      (l.rights?.pending===0)===(first.rights?.pending===0) &&
      l.ledger.conversionRecorded===first.ledger.conversionRecorded &&
      l.ledger.displacedRecorded===first.ledger.displacedRecorded && l.ledger.cashBasis===first.ledger.cashBasis);
    const preferred=comparable.reduce((best,l)=>l.base.perCharge<best.base.perCharge ? l : best,first);
    if(preferred!==first) costed.unshift(...costed.splice(costed.indexOf(preferred),1));
  }
  return {layouts:costed, space, price, terms, priceBasis, cash, cashBasis,
    years:a.horizon, capital:a.capital, closing:a.closing, tax:c.tax};
}


export function preliminaryCost(d:DealProps, a?:PurchaseAssumptions, selected?:ScreenTenure, trial?:Trial):PreliminaryCost {
  const original=costCase(d,a,selected,trial);
  if ("layouts" in original) return original;
  let result: Extract<PreliminaryCost,{layouts:LayoutCost[]}> | undefined;
  for (const planning of planningPriceCases(d,selected,trial)) {
    const estimate=costCase(d,a,selected,trial,planning);
    if (!("layouts" in estimate)) continue;
    if (result) result.layouts.push(...estimate.layouts);
    else result=estimate;
  }
  return result ?? original;
}
