import { paidScreen } from "./reference";
import type { DealProps } from "../types";
import { amounts,calculate,initialCase,modelVersion,type Result,type SavedCase } from "./model";

export type ChargingSummary = {screen:ReturnType<typeof paidScreen>;name:string;sourceRevision:string;stale:boolean;result:Result;selected:string|null;term:"purchase"|"lease";comparator:"workbook"|"local"};
export function summarize(deal:DealProps,sourceRevision:string,active?:SavedCase):ChargingSummary {
  const inputs=active?.inputs ?? initialCase(deal);
  return {screen:paidScreen(deal),name:active?.name??"Moove staffed · planning",sourceRevision,selected:active?active.id+":"+active.revision:null,
    stale:!!active && (active.sourceRevision!==sourceRevision || active.model!==modelVersion),result:active?.result??calculate(inputs),term:inputs.terms,comparator:inputs.comparator};
}
export function chargingRows(d:DealProps) {
  const c=d.charging;
  if(!c)return [];
  const r=c.result;
  const values=[
    ["Charging decision",c.stale?"Refresh saved case":r.decision],["Site cost per charge",amounts(r.siteCost,2)],
    ["Depot cost per charge",amounts(r.depot,2)],["Peak charges per shift",r.peakSessions?.toString()??"Unknown"],
    ["Parity offer ceiling",amounts(r.offer)+(c.term==="lease"?" / month":"")],["Charging next check",r.next],
  ];
  return values.map(([label,value])=>({label,value,key:value,basis:c.name+" · "+(c.comparator==="workbook"?"Workbook proxy":"Local depot")}));
}
export const chargingLabels=["Charging decision","Site cost per charge","Depot cost per charge","Peak charges per shift","Parity offer ceiling","Charging next check"];
