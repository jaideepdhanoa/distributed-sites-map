"use client";
import type {PreliminaryCost,ListAssumptions} from "@/lib/charging/preliminary";
import type {SavedScreen} from "@/lib/charging/screenLedger";
import {ScreeningLedger} from "./ScreeningLedger";

export function PreliminaryChargingCost({estimate,hypothetical=false,saveContext,initial,layoutName,omitted=[]}:{
  estimate:PreliminaryCost;hypothetical?:boolean;
  saveContext?:{site:string;source:string;canWrite:boolean;listTrial?:ListAssumptions};initial?:SavedScreen;layoutName?:string|null;omitted?:string[];
}){
  const bases=initial?[initial.inputs.basis]:"layouts" in estimate?estimate.layouts.map(l=>l.ledger):[];
  const index=!initial && layoutName?bases.findIndex(b=>b.mixId===layoutName || b.condition.startsWith(layoutName+". ")):0;
  if(index<0)return <p role="status">This combination changed. Reopen Spaces for the current assessment.</p>;
  const excluded=initial?.inputs.omitted??omitted;
  const parts=bases[index]?.parts;
  if(!initial && excluded.length && (!parts?.some(p=>!excluded.includes(p.area)) || excluded.some(area=>!parts.some(p=>p.area===area))))
    return <p role="status">These selected areas are unavailable. Reopen Spaces to choose a current combination.</p>;
  return <section className="preliminary-cost" aria-label="Preliminary site cost">
    <h3>{initial?initial.name:hypothetical?"What if this footprint fits?":"Preliminary site cost per completed charge"}</h3>
    {initial && <p>Saved by {initial.author} · {new Date(initial.at).toLocaleDateString()}</p>}
    {bases.length?<ScreeningLedger key={JSON.stringify([initial?.id,bases.map(b=>b.condition),index,excluded,saveContext?.source])} bases={bases} initialIndex={index} excluded={excluded} saveContext={saveContext} initial={initial}/>:
      <p>{"reason" in estimate?estimate.reason:"Refresh the site to load its calculation inputs."}</p>}
  </section>;
}
