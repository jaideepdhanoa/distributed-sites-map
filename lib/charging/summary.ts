import { preliminaryCost, type PreliminaryCost } from "./preliminary";
import type { PurchaseAssumptions } from "../purchaseReview";
import { pipelineCost } from "./pipelineCost";
import { siteMerit,type Merit } from "./merit";
import { paidScreen } from "./reference";
import type { DealProps } from "../types";
import { amounts,calculate,initialCase,modelVersion,type Result,type SavedCase } from "./model";

export type ChargingSummary = {preliminary?: PreliminaryCost;energyScope?:ReturnType<typeof initialCase>["energyScope"];merit:Merit;screen:ReturnType<typeof paidScreen>;screenDepot:number|null;name:string;sourceRevision:string;stale:boolean;result:Result;selected:string|null;term:"purchase"|"lease";comparator:"workbook"|"local"};
export function summarize(deal:DealProps,sourceRevision:string,active?:SavedCase, assumptions: PurchaseAssumptions | undefined = deal.purchase?.assumptions):ChargingSummary {
  const inputs=active?.inputs ?? initialCase(deal);
  const a=deal.purchase?.assumptions;
  const screen=paidScreen(deal);
  const fit=deal.purchase?.inputs.fit ?? deal.bays_that_fit;
  const supported=screen.filter(s=>fit!=null && s.stalls<=fit).sort((a,b)=>b.stalls-a.stalls)[0];
  const stale=!!active && (active.sourceRevision!==sourceRevision || active.model!==modelVersion);
  const merit=siteMerit(deal,inputs,!!active,stale,!!supported && supported.downside>=0);
  return {preliminary:preliminaryCost(deal,assumptions,stale ? undefined : active?.inputs),energyScope:inputs.energyScope,merit,screen,screenDepot:a?.hub && a.charging?.charges?a.hub/a.charging.charges:null,name:active?.name??"Moove staffed · planning",sourceRevision,selected:active?active.id+":"+active.revision:null,
    stale,result:active?.result??calculate(inputs),term:inputs.terms,comparator:inputs.comparator};
}
export function filedScreenLabel(screen:ReturnType<typeof paidScreen>) {
  if(!screen.length)return "Comparable filed price needed for the layout screen.";
  const first=[...screen].sort((a,b)=>a.stalls-b.stalls).find(c=>c.downside>=0);
  return first?"Paid Moove coverage reaches depot parity in the filed downside at "+first.stalls+" hypothetical stalls. Confirm a usable footprint.":"Every filed stall count exceeds depot cost under the paid Moove downside.";
}
export function chargingRows(d:DealProps) {
  const c=d.charging;
  if(!c)return [];
  const r=c.result;
  const cost=pipelineCost(c);
  const values=[
    ["Dispatch pool",c.merit.network?.pool??"Unknown"],["Charging decision",c.merit.action],["Working gap per charge",amounts(r.difference,2)],["Downside gap per charge",amounts(c.merit.downsideGap,2)],["Downside network value",amounts(c.merit.netValue)],["Downside offer ceiling",amounts(c.merit.downsideCeiling)+(c.term==="lease"?" / month":"")],["First-year cash",amounts(r.yearOne)],["Opening window",r.opening||"Unknown"],
    ["Depot cost per charge",amounts(r.depot,2)],["Peak charges per shift",r.peakSessions?.toString()??"Unknown"],
    ["Parity offer ceiling",amounts(r.offer)+(c.term==="lease"?" / month":"")],["Charging next check",c.merit.next],
  ];
  const basis=c.name+" · "+(c.comparator==="workbook"?"Workbook proxy":"Local depot");
  return [{label:"Site cost per charge",value:cost.value,key:cost.amount,basis:cost.basis}, ...values.map(([label,value])=>({label,value,key:value,basis}))];
}
export const chargingLabels=["Charging decision","Working gap per charge","Dispatch pool","Marginal value in comparison","Downside gap per charge","Downside network value","Downside offer ceiling","First-year cash","Opening window","Site cost per charge","Depot cost per charge","Peak charges per shift","Parity offer ceiling","Charging next check"];
