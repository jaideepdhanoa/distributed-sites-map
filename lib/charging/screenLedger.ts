import { annualRecovery } from "./model";

export const scenarios = [
  { label: "Base", volume: 1, upgrade: 1 },
  { label: "25% fewer charges", volume: .75, upgrade: 1 },
  { label: "50% higher upgrade", volume: 1, upgrade: 1.5 },
  { label: "Both changes", volume: .75, upgrade: 1.5 },
] as const;

export type LedgerInputs = {
  stalls:number; volume:number; benchmark:number; referenceYears:number; referenceStalls:number;
  price:number; years:number; rate:number; closing:number; unitBuild:number; upgrade:number; tax:number;
  postCost:number; perPost:number; fixed:number; insurance:number; ports:number; perCharger:number;
  cash:number; conversion:number; displaced:number;
};
export type LedgerKey = keyof LedgerInputs;
export type Changes = Partial<LedgerInputs>;
export type LedgerBasis = {
  inputs:LedgerInputs; terms:"purchase"|"lease"; condition:string; space:string;
  priceBasis:string; cashBasis:string; source?:string|null; date?:string|null; proxy?:number|null;
  // The layout may be a conditional screen rather than a proven fit.
  hypothetical?:boolean; creditCash?:boolean; workbookDefaults?:Changes;
};
export type SavedScreen = {id:string; name:string; author:string; at:string;
  inputs:{basis:LedgerBasis; changes:Changes; scenario:number}};

export function screenLedger(basis:LedgerBasis, changes:Changes={}, scenario=0) {
  const v={...basis.inputs,...changes}, stress=scenarios[scenario];
  const recovery=annualRecovery(v.rate/100,v.years);
  const stalls=v.stalls, posts=Math.ceil(stalls/v.perPost), chargers=Math.ceil(stalls/v.ports);
  const perStall=v.benchmark/v.referenceYears/v.referenceStalls;
  const sessions=stalls*perStall*v.volume/100*stress.volume;
  const construction=stalls*v.unitBuild, upgrade=v.upgrade*stress.upgrade;
  const build=construction+v.conversion;
  const displaced=basis.terms==="lease"?0:v.displaced;
  // A trial with income credit off still carries any loss after displacement.
  const cash=basis.creditCash===false?Math.min(v.cash,displaced):v.cash;
  const costs={
    property:basis.terms==="lease"?v.price*12:v.price*(1+v.closing/100)*recovery,
    construction:construction*recovery, conversion:v.conversion*recovery,
    upgrade:upgrade*recovery, tax:(build+upgrade)*v.tax/100,
    staffing:posts*v.postCost, upkeep:v.fixed+v.insurance+chargers*v.perCharger,
    displaced, cash:-cash,
  };
  const annualCost=Object.values(costs).reduce((sum,n)=>sum+n,0);
  return {costs,sessions,annualCost,perCharge:sessions>0?annualCost/sessions:null,
    recovery,posts,chargers,perStall,build,upgrade};
}

export const ledgerFields = {
  stalls:"Operating stalls", volume:"Volume (% of benchmark)", benchmark:"Reference completed charges",
  referenceYears:"Years in volume benchmark",referenceStalls:"Stalls in volume benchmark",
  price:"Property terms ($)",years:"Capital recovery (years)",rate:"Cost of capital (%)",closing:"Closing costs (%)",
  unitBuild:"Construction per stall ($)",upgrade:"Utility upgrade ($)",tax:"Annual infrastructure tax (%)",
  postCost:"Annual cost per staffed post ($)",perPost:"Stalls covered per post",fixed:"Fixed annual upkeep ($)",
  insurance:"Annual insurance ($)",ports:"Stalls per charger",perCharger:"Annual upkeep per charger ($)",
  cash:"Retained business cash ($/year)", conversion:"Additional works ($)",displaced:"Displaced cash ($/year)",
} satisfies Record<LedgerKey,string>;

export function validChange(key:LedgerKey, value:number) {
  if (!Number.isFinite(value) || Math.abs(value)>1e10) return false;
  if (key==="cash") return true;
  if (["referenceYears","years","referenceStalls","perPost","ports"].includes(key)) return Number.isInteger(value) && value>=1 && value<=10000;
  if (key==="stalls") return Number.isInteger(value) && value>=0 && value<=200;
  if (["rate","tax","closing"].includes(key)) return value>=0 && value<=100;
  if (key==="volume") return value>=0 && value<=200;
  return value>=0;
}
