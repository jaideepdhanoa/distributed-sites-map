import type { DealProps } from "../types";
import type { Inputs } from "./model";

export function networkReference(d:DealProps,c:Inputs) {
  const row=d.selectionResearch, a=d.purchase?.assumptions, ref=a?.charging, v=c.values;
  const filed=row?.cases.find(x=>x.stalls===v.stalls);
  if(!filed || !row || row.quote==null || !a?.hub || !a.horizon || !a.demand || a.capital==null || a.closing==null ||
     !ref?.charges || ref.attendant==null || !ref.escalation || ref.tax==null || ref.hostHours==null || !ref.perPost ||
     !v.stalls || v.ask==null || v.conversion==null || v.loss==null || c.terms!=="purchase")return null;
  const hours=((v.hostWeek??0)*5+(v.hostEnd??0)*2)/7;
  if(v.ownWeek==null || v.ownEnd==null || v.hostWeek==null || v.hostEnd==null ||
     v.ownWeek+v.hostWeek!==24 || v.ownEnd+v.hostEnd!==24 || (hours>0 && v.hostFee==null))return null;
  const sites=Math.ceil(a.demand/v.stalls);
  const labor=(ref.hostHours-hours)/24*ref.attendant*Math.ceil(v.stalls/ref.perPost)+hours*365*(v.hostFee??0);
  const filedCost=a.hub*(1-filed.base);
  const adjustments=[
    {label:"Change to purchase price",value:(v.ask-row.quote)*(1+a.closing)*a.capital*a.horizon},
    {label:"Change to paid staffing",value:labor*ref.escalation},
    {label:"Additional conversion works",value:v.conversion*(a.capital*a.horizon+ref.tax*ref.escalation)},
    {label:"Displaced operating margin",value:v.loss*a.horizon}
  ];
  const delta=adjustments.reduce((total,line)=>total+line.value,0);
  const lines=[{label:"Filed network cost",value:filedCost/ref.charges},
    ...adjustments.map(line=>({label:line.label,value:sites*line.value/ref.charges!}))];
  return {cost:(filedCost+sites*delta)/ref.charges,depot:a.hub/ref.charges,sites,lines,hostHours:ref.hostHours};
}

// Re-price the filed layout sensitivities with paid Moove coverage, leaving the
// filed conversion downside intact. A hypothetical stall count grants no rights.
export function paidScreen(d:DealProps) {
  const a=d.purchase?.assumptions,ref=a?.charging;
  if(!a?.hub || !a.demand || !ref?.charges || ref.attendant==null || !ref.escalation || ref.hostHours==null || !ref.perPost)return [];
  return (d.selectionResearch?.cases??[]).map(c=>{
    const delta=(ref.hostHours!/24)*ref.attendant!*Math.ceil(c.stalls/ref.perPost!)*ref.escalation!*Math.ceil(a.demand!/c.stalls)/a.hub!;
    return {stalls:c.stalls,base:c.base-delta,downside:c.stress-delta};
  });
}
