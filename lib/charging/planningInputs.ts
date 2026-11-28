import type {DealProps} from "../types";
import type {ChargingFootprint} from "../spaces/pipelineFit";
import type {ListAssumptions, ScreenTenure} from "./preliminary";

export type PlanningPrice = {
  value:number; label:string; validation:string; source?:string|null; layouts:ChargingFootprint[]; assumedFit:boolean;
};

/** Evidence for a possible purchase may support a cost sensitivity before it supports a comparable offer. */
export function planningPriceCases(d:DealProps, selected?:ScreenTenure,
  trial?:{assumptions:ListAssumptions; hypothetical:boolean}):PlanningPrice[] {
  const review=d.opportunityReview, option=review?.primary, fit=d.chargingSpace;
  if (!review || !option || d.kind!=="pipeline" || selected?.rights==="unavailable" || selected?.terms==="lease" ||
      !["Shortlist","Investigate","Watch availability","Hold","Reserve"].includes(option.disposition) ||
      !["Property only","Operating acquisition","Offered acquisition","Site lead"].includes(option.route) ||
      /dropped|off[ -]market/i.test(d.stage??"") || fit?.value==="Use unavailable") return [];
  const hints=review.planningInputs ?? [];
  const drawn=fit?.layouts?.length ? fit.layouts : fit?.count && fit.count>0 ? [{stalls:fit.count,condition:fit.basis}] : [];
  if (!drawn.length && review.coverage?.countyStatus!=="Address matched") return [];
  const fitInputs=hints.filter(p=>p.kind==="Stalls");
  if (!drawn.length && fit?.count===0 && !fitInputs.length) return [];
  const assumedFit=Boolean(trial?.hypothetical || !drawn.length);
  const test=(stalls:number,label:string):ChargingFootprint=>({stalls,condition:label+" · assumed footprint"});
  const layouts=trial?.hypothetical ? [test(trial.assumptions.stalls,"Manual stall trial")] : drawn.length ? drawn :
    fitInputs.length ? fitInputs.map(p=>test(p.value,p.label)) : [test(2,"Two-stall test"),test(4,"Four-stall test")];
  const wait=option.disposition==="Watch availability" || d.listing_removed || Boolean(d.chargingHold && /seller availability/i.test(d.chargingHold));
  const gates=[wait ? "Only if the property becomes available on these terms." : "", assumedFit ?
    (fitInputs.length ? [...new Set(fitInputs.map(p=>p.validation))].join(" ") : "Confirm the assumed stalls, independent drive aisle and access on the parcel.") : ""].filter(Boolean);
  const research=d.selectionResearch;
  const explicit=hints.filter(p=>p.kind==="Price");
  type Quote={value:number;label:string;validation:string;source?:string|null};
  const quotes:Quote[]=[...explicit];
  if (!quotes.length) {
    // Package and business-only offers require an explicit allocation or property-inclusive test.
    if (/bundle|business.only|no real estate|leasehold|archived offering/i.test(research?.scope??"")) return [];
    const validation=["Confirm the purchase price, included real estate and charging rights.",research?.check || option.next].filter(Boolean).join(" ");
    const add=(value:number|null|undefined,label:string,source?:string|null)=>{
      if(value!=null && Number.isFinite(value) && value>0 && !quotes.some(p=>p.value===value)) quotes.push({value,label,validation,source});
    };
    add(research?.quote,"Research price",research?.source);
    add(d.asking_price,"Pipeline asking price",option.evidence);
    add(d.purchase?.inputs.ask,"Workbook asking price",option.evidence);
    quotes.sort((a,b)=>b.value-a.value);
    if(quotes.length>1) for(const quote of quotes) quote.validation="The recorded prices disagree. "+quote.validation;
  }
  return quotes.map(q=>({...q,assumedFit,layouts,validation:[...gates,q.validation].join(" ")}));
}
