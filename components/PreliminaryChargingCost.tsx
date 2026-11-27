"use client";
import {useState} from "react";
import type {PreliminaryCost,ListAssumptions} from "@/lib/charging/preliminary";
import {costRange} from "@/lib/charging/pipelineCost";
import { amounts } from "@/lib/charging/model";
import { screenLedger } from "@/lib/charging/screenLedger";
import type {SavedScreen} from "@/lib/charging/screenLedger";
import {ScreeningLedger} from "./ScreeningLedger";

export function PreliminaryChargingCost({estimate,hypothetical=false,saveContext,initial,layoutName,omitted=[]}:{
  estimate:PreliminaryCost;hypothetical?:boolean;
  saveContext?:{site:string;source:string;canWrite:boolean;listTrial?:ListAssumptions};initial?:SavedScreen;layoutName?:string|null;omitted?:string[];
}){
  const layouts="layouts" in estimate?estimate.layouts:[];
  const [index,setIndex]=useState(()=>layoutName ? Math.max(0,layouts.findIndex(row=>row.parcel && row.condition.startsWith(layoutName+". "))) : 0);
  const layout=layouts[index]??layouts[0], basis=initial?.inputs.basis??layout?.ledger;
  const linked=layoutName && layout?.condition.startsWith(layoutName+". ");
  const subset=!initial && linked && omitted.length>0 && layout.parts &&
    omitted.every(area=>layout.parts!.some(p=>p.area===area)) ? layout.parts.filter(p=>!omitted.includes(p.area)) : undefined;
  if (!initial && layoutName && !layouts.some(l=>l.condition.startsWith(layoutName+". "))) return <p role="status">This combination changed. Reopen Spaces for the current assessment.</p>;
  if (!initial && linked && omitted.length && !subset?.length) return <p role="status">These selected areas are unavailable. Reopen Spaces to choose a current combination.</p>;
  const stalls=subset?.reduce((n,p)=>n+p.stalls,0);
  const range=stalls && basis ? [0,3].map(i=>screenLedger(basis,{stalls},i).perCharge!).sort((a,b)=>a-b).map(n=>amounts(n,2)).join("–") : layout && costRange(layout);
  return <section className="preliminary-cost" aria-label="Preliminary site cost">
    <h3>{initial?initial.name:hypothetical?"What if this footprint fits?":"Preliminary site cost per completed charge"}</h3>
    {initial && <p>Screening alternative · {initial.author} · {new Date(initial.at).toLocaleDateString()}</p>}
    {!initial && layout && <p><b>{range}</b> · Base and combined downside</p>}
    {!initial && layouts.length>1 && <label>Assessed layout<select className="secondary screen-layouts" value={index} onChange={e=>setIndex(Number(e.target.value))}>
      {layouts.map((l,i)=><option key={i} value={i}>{l.stalls} stalls · {l.condition}</option>)}</select></label>}
    {!initial && layout?.system && <p>Same utilization per stall across combinations. {subset ? "Your areas" : "Included areas"} · {(subset||layout.parts||[]).map(p=>p.area+" ("+p.stalls+")").join(" + ")}</p>}
    {subset && <p>Your combination uses {stalls} stalls. Shared site costs and any filed conversion allowances carry through in full.</p>}
    {basis ? <ScreeningLedger key={initial?.id??(index+"-"+(stalls??"all"))} startingStalls={stalls} basis={basis} saveContext={saveContext} initial={initial}/> :
      <p>{("reason" in estimate)?estimate.reason:"Refresh the site to load its calculation inputs."}</p>}
  </section>;
}
