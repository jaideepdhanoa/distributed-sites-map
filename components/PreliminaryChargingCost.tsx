"use client";
import {useState} from "react";
import type {PreliminaryCost,ListAssumptions} from "@/lib/charging/preliminary";
import {costRange} from "@/lib/charging/pipelineCost";
import type {SavedScreen} from "@/lib/charging/screenLedger";
import {ScreeningLedger} from "./ScreeningLedger";

export function PreliminaryChargingCost({estimate,hypothetical=false,saveContext,initial,layoutName}:{
  estimate:PreliminaryCost;hypothetical?:boolean;
  saveContext?:{site:string;source:string;canWrite:boolean;listTrial?:ListAssumptions};initial?:SavedScreen;layoutName?:string|null;
}){
  const layouts="layouts" in estimate?estimate.layouts:[];
  const [index,setIndex]=useState(()=>layoutName ? Math.max(0,layouts.findIndex(row=>row.parcel && row.condition.startsWith(layoutName+". "))) : 0);
  const layout=layouts[index]??layouts[0], basis=initial?.inputs.basis??layout?.ledger;
  return <section className="preliminary-cost" aria-label="Preliminary site cost">
    <h3>{initial?initial.name:hypothetical?"What if this footprint fits?":"Preliminary site cost per completed charge"}</h3>
    {initial && <p>Screening alternative · {initial.author} · {new Date(initial.at).toLocaleDateString()}</p>}
    {!initial && layout && <p><b>{costRange(layout)}</b> · Base and combined downside</p>}
    {!initial && layouts.length>1 && <label>Assessed layout<select className="secondary screen-layouts" value={index} onChange={e=>setIndex(Number(e.target.value))}>
      {layouts.map((l,i)=><option key={i} value={i}>{l.stalls} stalls · {l.condition}</option>)}</select></label>}
    {basis ? <ScreeningLedger key={initial?.id??index} basis={basis} saveContext={saveContext} initial={initial}/> :
      <p>{("reason" in estimate)?estimate.reason:"Refresh the site to load its calculation inputs."}</p>}
  </section>;
}
