import { ChargingLink } from "./ChargingLink";
import type { DealProps } from "@/lib/types";
import { amounts,fields,type Inputs } from "@/lib/charging/model";
import { actionColors,downsideKeys,emptyRanking,type Merit,type RankingInputs } from "@/lib/charging/merit";

export function MeritCard({deal}:{deal:DealProps}) {
  const c=deal.charging;
  if(!c)return null;
  const m=c.merit;
  return <section className="charging-preview" aria-label="Site decision">
    <small>Charging assessment</small><strong style={{color:actionColors[m.action]}}>{m.action}</strong><p>{m.next}</p>
    {m.netValue!=null && <small>{amounts(m.netValue)} downside network value · {m.servedPeak} peak charges</small>}
    <ChargingLink site={deal.deal_id} revision={c.selected}>Review site case</ChargingLink>
  </section>;
}
const measures=[
  ["annualNeed","Residual fleet charges per year"],["peakNeed","Residual charges per peak shift"],
  ["avoided","Avoidable local cost per displaced charge ($)"],["checkCost","Cost of the next check ($)"],["checkDays","Days to complete the next check"],
] as const;
export function MeritEditor({merit:m,draft,onChange}:{merit:Merit;draft:Inputs;onChange:(v:Inputs)=>void}) {
  const n=draft.ranking??emptyRanking;
  const update=(patch:Partial<RankingInputs>)=>onChange({...draft,ranking:{...n,...patch}});
  const schedule=n.schedule;
  const blankFlow={date:"",without:null,withSite:null};
  const editFlow=(index:number,patch:Partial<import("@/lib/charging/merit").NetworkFlow>)=>{
    if(schedule)update({schedule:{...schedule,flows:schedule.flows.map((f,i)=>i===index?{...f,...patch}:f)}});
  };
  return <details className="disclosure"><summary className="disclosure">Site decision and joint downside</summary>
    <strong>{m.action}</strong><p>{m.next}</p>
    <p>Use the same dispatch pool ID for sites that share vehicles and a peak window. Assign partially overlapping sites to the same pool until dispatch can separate their demand. Enter residual demand after existing and committed chargers. Use a level annual forecast for the case horizon and a documented avoidable cost per completed charge.</p>
    <div className="charging-controls">
      <label>Dispatch pool identifier<input className="field" value={n.pool} maxLength={120} onChange={e=>update({pool:e.target.value})}/></label>
      <label>Pool, cost and downside evidence<input className="field" value={n.source} maxLength={400} onChange={e=>update({source:e.target.value})}/></label>
      <label>Evidence date<input className="field" type="date" value={n.date} onChange={e=>update({date:e.target.value})}/></label>
      <label>Market valuation date<input className="field" type="date" value={n.valuationDate??""} onChange={e=>update({valuationDate:e.target.value})}/></label>
      <label>Peak service needed by<input className="field" type="date" value={n.needBy} onChange={e=>update({needBy:e.target.value})}/></label>
      {measures.map(([key,label])=><label key={key}>{label}<input className="field" type="number" min={0} step="any" value={n[key]??""} onChange={e=>update({[key]:e.target.value===""?null:e.target.valueAsNumber})}/></label>)}
    </div>
    <details className="disclosure"><summary className="disclosure">Additional network cash flows</summary>
      <p>Enter dated payments for a rental cancellation, deferred project or other cost avoided if the site delivers its full downside service. Include both payment dates for a deferral. Exclude costs already in the site case or the avoided cost per charge. Use one obligation ID across competing sites.</p>
      {schedule ? <>
        <label>Shared obligation ID<input className="field" value={schedule.key} maxLength={120} onChange={e=>update({schedule:{...schedule,key:e.target.value}})}/></label>
        <label>Cash-flow evidence<input className="field" value={schedule.source} maxLength={400} onChange={e=>update({schedule:{...schedule,source:e.target.value}})}/></label>
        {schedule.flows.map((f,i)=><fieldset className="charging-controls" key={i}><legend>Payment {i+1}</legend>
          <label>Payment date<input className="field" type="date" value={f.date} onChange={e=>editFlow(i,{date:e.target.value})}/></label>
          {(["without","withSite"] as const).map(k=><label key={k}>{k==="without"?"Without site ($)":"With site ($)"}<input className="field" type="number" min={0} value={f[k]??""} onChange={e=>editFlow(i,{[k]:e.target.value===""?null:e.target.valueAsNumber})}/></label>)}
          <button type="button" className="text-link" onClick={()=>update({schedule:{...schedule,flows:schedule.flows.filter((_,j)=>i!==j)}})}>Remove payment</button>
        </fieldset>)}
        {schedule.flows.length<120 && <button type="button" className="secondary" onClick={()=>update({schedule:{...schedule,flows:[...schedule.flows,blankFlow]}})}>Add payment</button>}
        <button type="button" className="text-link" onClick={()=>update({schedule:undefined})}>Remove cash schedule</button>
      </> : <button type="button" className="secondary" onClick={()=>update({schedule:{key:"",source:"",flows:[blankFlow]}})}>Add cash schedule</button>}
    </details>
    <p>Change the inputs that move together under downside conditions. Blank fields use the working case. Use the same footprint, terms and charging rights.</p>
    <div className="charging-controls">{downsideKeys.map(k=><label key={k}>Downside · {fields[k].label}<input className="field" type="number" min={fields[k].min} max={fields[k].max} step={k==="stalls"?"1":"any"} value={n.downside[k]??""} placeholder={String(draft.values[k]??"Unknown")} onChange={e=>{
      const downside={...n.downside};if(e.target.value==="")delete downside[k];else downside[k]=e.target.valueAsNumber;update({downside});
    }}/></label>)}</div>
    <p>Downside gap {amounts(m.downsideGap,2)} per charge · Network value {amounts(m.netValue)}</p>
  </details>;
}
