import { annualRecovery } from "./model";

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
  rightsByArea?:Record<string,boolean>; parts?:{area:string;stalls:number}[]; businessType?:string; siteDrivers?:boolean; withheldOperatingCash?:number;
  parcel?:boolean; conversionRecorded?:boolean; displacedRecorded?:boolean;
};
export type SavedScreen = {id:string; name:string; author:string; at:string;
  inputs:{basis:LedgerBasis; changes:Changes; scenario:number; omitted?:string[]}};

/** Preserve the historical volume/upgrade stress when reopening an immutable v1 case. */
export function savedChanges(saved:SavedScreen):Changes {
  const {basis,changes,scenario}=saved.inputs;
  if (!scenario) return {...changes};
  const values={...basis.inputs,...changes};
  return {...changes,
    volume:values.volume*(scenario===1 || scenario===3 ? 0.75 : 1),
    upgrade:values.upgrade*(scenario>=2?1.5:1)};
}

export function screenLedger(basis:LedgerBasis, changes:Changes={}) {
  const v={...basis.inputs,...changes};
  const recovery=annualRecovery(v.rate/100,v.years);
  const stalls=v.stalls, posts=Math.ceil(stalls/v.perPost), chargers=Math.ceil(stalls/v.ports);
  const perStall=v.benchmark/v.referenceYears/v.referenceStalls;
  const sessions=stalls*perStall*v.volume/100;
  const construction=stalls*v.unitBuild, upgrade=v.upgrade;
  const build=construction+v.conversion;
  const displaced=basis.terms==="lease"?0:v.displaced;
  // A trial with income credit off still carries any loss after displacement.
  const operatingCash=changes.cash??(changes.displaced!=null?basis.withheldOperatingCash:undefined)??v.cash;
  const cash=basis.creditCash===false?Math.min(operatingCash,displaced):operatingCash;
  const costs={
    property:basis.terms==="lease"?v.price*12:v.price*(1+v.closing/100)*recovery,
    construction:construction*recovery, conversion:v.conversion*recovery,
    upgrade:upgrade*recovery, tax:(build+upgrade)*v.tax/100,
    staffing:posts*v.postCost, upkeep:v.fixed+v.insurance+chargers*v.perCharger,
    displaced, cash:cash===0?0:-cash,
  };
  const annualCost=Object.values(costs).reduce((sum,n)=>sum+n,0);
  return {costs,sessions,annualCost,operatingCash,perCharge:sessions>0?annualCost/sessions:null,
    recovery,posts,chargers,perStall,build,upgrade};
}

export function higherUpgradeCase(basis:LedgerBasis,changes:Changes={}) {
  return screenLedger(basis,{...changes,upgrade:(changes.upgrade??basis.inputs.upgrade)*1.5});
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
