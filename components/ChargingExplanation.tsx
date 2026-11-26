"use client";
import {useEffect,useRef,useState} from "react";
import {amounts,fields,groups,keys,type CalculationLine,type CalculationTrace,type Evidence,type Inputs,type Key,type Result} from "@/lib/charging/model";
import {planning,sourceValue} from "@/lib/charging/evidence";
import type {networkReference} from "@/lib/charging/reference";

const number=(value:number|null,places=1)=>value==null?"Pending":value.toLocaleString("en-US",{maximumFractionDigits:places});
const money=(value:number|null,places=2)=>value==null?"Pending":amounts(value,places);
const signed=(value:number)=> (value>0?"+":"")+money(value);
const status=(value:number|null,e:Evidence)=>value==null?"Missing":({assumed:"Assumed",quoted:"Quoted",verified:"Verified"}[e.status]);
type Props={
  draft:Inputs;seed:Inputs;result:Result;trace:CalculationTrace;reference:ReturnType<typeof networkReference>;
  referenceBasis:string;priorNetwork:number|null;baseline:Result;trial:boolean;onTrial:(key:Key,value:number|null)=>void; reset:()=>void;
  reviewSource:(key:Key)=>void;stale:boolean;author?:string;legacy:boolean;
};
export function ChargingExplanation({draft,seed,result:r,trace,reference,referenceBasis,priorNetwork,baseline,trial,onTrial,reset,reviewSource,stale,author,legacy}:Props){
  const [inspect,setInspect]=useState<Key|null>(null);
  const inspector=useRef<HTMLElement>(null);
  const evidenceList=useRef<HTMLDetailsElement>(null);
  const [focusInput,setFocusInput]=useState(0);
  useEffect(()=>{if(focusInput){inspector.current?.scrollIntoView({block:"center"});inspector.current?.querySelector("select")?.focus({preventScroll:true});}},[focusInput]);
  function chip(key:Key){
    return <button type="button" className="text-link" key={key} onClick={()=>{choose(key);setFocusInput(n=>n+1);}}>{fields[key].label}</button>;
  }
  const maxAnnual=Math.max(0,...trace.annual.map(row=>Math.abs(row.value??0)));
  const material=new Set<Key>(["days","hostWeek","ownWeek","hostEnd","ownEnd","weekdayHours","weekendHours","depot",...trace.annual.filter(row=>!row.excluded).flatMap(row=>row.keys),...trace.throughput.flatMap(row=>row.keys)]);
  const counts:Record<string,number>={Verified:0,Quoted:0,Assumed:0,Missing:0};
  let overrides=0;
  for(const k of material){
    const src=sourceValue(draft,k);
    counts[status(src.value,src.evidence)]++;
    if(draft.sourceValues?.[k])overrides++;
  }
  function line(row:CalculationLine,hourly=false){
    const limiting=hourly && trace.perHour!=null && row.value===trace.perHour;
    return <details className="disclosure calc-item" key={row.label}><summary className="disclosure"><span>{row.label}{limiting && <small>Limits throughput</small>}</span>
      {!hourly && maxAnnual>0 && row.value!=null && <span aria-hidden="true" className="calc-bar"><i className={row.value<0?"offset":""} style={{width:Math.abs(row.value)/maxAnnual*100+"%"}}/></span>}
      <b>{row.excluded?"Excluded":hourly?number(row.value,2):money(row.value,0)}</b></summary>
      <div className="calc-inputs">{row.keys.map(chip)}</div></details>;
  }
  const missing=keys.filter(k=>r.missing.includes(fields[k].label));
  if(draft.values[draft.terms==="lease"?"rent":"ask"]==null)missing.push(draft.terms==="lease"?"rent":"ask");
  const atParity=r.difference!=null && Math.abs(r.difference)<1e-8;
  const earlier=r.earlyMin==null||r.earlyMax==null?"Pending":number(r.earlyMin,0)+"–"+number(r.earlyMax,0);
  function impact(label:string,now:number|null,before:number|null,currency=true){
    const format=currency?money:number;
    return <div><dt>{label}</dt><dd>{format(now)}{trial && <small>Before trial · {format(before)}</small>}</dd></div>;
  }
  const [entry,setEntry]=useState("");
  function choose(key:Key){setInspect(key);setEntry(draft.values[key]?.toString()??"");}
  const observation=inspect && sourceValue(draft,inspect);
  return <section className="cost-explanation" aria-label="Cost per charge explanation">
    <div className="cost-reading">
      <div><span>This site per completed charge</span><strong>{money(r.siteCost)}</strong><small>{r.siteCost==null?(missing.length?missing.length+" inputs to review":"Check staffed throughput"):"Annual net cost ÷ completed charges"}</small></div>
      <div><span>{draft.comparator==="workbook"?"Miami depot proxy":"Local depot"} per charge</span><strong>{money(r.depot)}</strong><small>{draft.energyScope==="excluded"?"Electricity excluded":"Energy and demand costs included"}</small></div>
    </div>
    <p className="cost-verdict" data-state={r.difference==null?"pending":r.difference>1e-8?"above":"parity"}>{r.difference==null?"Parity comparison pending":atParity?"At depot parity":money(Math.abs(r.difference))+(r.difference>0?" above":" below")+" depot per charge"} · {draft.comparator==="workbook"?"Workbook benchmark":draft.comparable?"Comparable scope recorded":"Confirm benchmark scope"}</p>
    <button className="text-link cost-evidence-link" type="button" onClick={()=>{
      if(evidenceList.current){evidenceList.current.open=true;evidenceList.current.querySelector("summary")?.focus();}
    }}>Cost input sources · {Object.entries(counts).filter(([,count])=>count>0).map(([label,count])=>count+" "+label.toLowerCase()).join(" · ")}{overrides?" · "+overrides+" overridden":""}</button>
      <section className="calc-next" aria-label="Next validation"><span className="eyebrow">Verify next</span><h3>{r.next}</h3>

        {r.neededSessions!=null && <p>At these terms, parity needs {number(Math.ceil(r.neededSessions),0)} completed charges per year.</p>}
        {r.upgradeLimit!=null && <p>{r.upgradeLimit<0?"The case exceeds depot cost even with a free utility upgrade.":"Maximum utility upgrade at parity · "+money(r.upgradeLimit,0)}</p>}
        {missing.length>0 && <details className="disclosure"><summary className="disclosure">Inputs to review ({missing.length})</summary><div className="calc-inputs">{missing.map(chip)}</div></details>}
      </section>
    <div className="cost-sections">
      <details className="disclosure cost-section" open><summary className="disclosure">How this site is calculated</summary>
        <div className="calc-equation"><div><span>Annual net cost</span><b>{money(trace.total,0)}</b></div><i>÷</i><div><span>Annual completed charges</span><b>{number(r.sessions,0)}</b></div><i>=</i><div><span>Cost per charge</span><b>{money(r.siteCost)}</b></div></div>
        <details className="disclosure calc-group"><summary className="disclosure">Annual costs and retained cash</summary>
          <p className="layer-meta">Annual dollars. Purchase and construction use capital recovery over the case horizon. Retained cash reduces cost.</p>{trace.annual.map(row=>line(row))}</details>
        <details className="disclosure calc-group"><summary className="disclosure">What limits completed charges?</summary>
          <p>{number(trace.hours,0)} covered hours/year × {number(trace.perHour,2)} completed charges/hour</p>
          <p className="layer-meta">The lowest of these hourly rates sets throughput. Stall turnover and deliverable power include availability.</p>{trace.throughput.map(row=>line(row,true))}
          <div className="calc-inputs">{(["days","weekdayHours","weekendHours","hostWeek","hostEnd","ownWeek","ownEnd"] as Key[]).map(chip)}</div></details>
        <p className="layer-meta">Peak shift · {number(r.peakSessions,0)} charges. Additional charges before the depot opens · {earlier}.</p>
      </details>
      <details className="disclosure cost-section" open={r.siteCost==null && !!reference}><summary className="disclosure">Workbook network reference <b>{money(reference?.cost??null)}</b></summary>
        {reference?<><p>{reference.sites} similar sites · dollars per completed charge · electricity excluded<br/><small>{referenceBasis}</small></p>
          {reference.lines.map((l,i)=><div className="calc-row" key={l.label}><span>{l.label}{i===0?" · "+reference.hostHours+" host hours/day":""}</span><b>{i?signed(l.value):money(l.value)}</b></div>)}
          <div className="calc-row calc-total"><span>Network cost minus workbook depot</span><b>{signed(reference.cost-reference.depot)}</b></div>
          <p className="layer-meta">Depot reference {money(reference.depot)}. This calculation uses the filed network volume and staffing rates.</p></>:<p>A filed purchase case at this stall count and a complete 24-hour coverage plan are required.</p>}</details>
      <details ref={evidenceList} className="disclosure cost-section"><summary className="disclosure">Evidence and scenario inputs</summary>
        <p className="layer-meta">Inspect a source to see its recorded value, date and the value used in this case.</p>
        {groups.map(group=><details className="disclosure calc-group" key={group}><summary className="disclosure">{group}</summary>
          {keys.filter(k=>fields[k].group===group && !(k==="rent" && draft.terms==="purchase") && !(k==="ask" && draft.terms==="lease")).map(k=>{
            const src=sourceValue(draft,k);
            return <button type="button" className="action calc-evidence-row" onClick={()=>{choose(k);setFocusInput(n=>n+1);}} key={k}><span>{fields[k].label}<small>{status(src.value,src.evidence)}{draft.sourceValues?.[k]?" · Scenario override":legacy && src.evidence.status==="assumed"?" · Saved assumption":" · Source value"}</small></span><b>{number(draft.values[k],3)}</b></button>;
          })}</details>)}</details>

    </div>
    <section ref={inspector} className="calc-trial" aria-label="Try a change">
      <label>Inspect an input or try a change<select className="secondary" value={inspect??""} onChange={e=>e.target.value?choose(e.target.value as Key):setInspect(null)}>
        <option value="">Choose an input</option>{keys.filter(k=>!(k==="rent" && draft.terms==="purchase") && !(k==="ask" && draft.terms==="lease")).map(k=><option key={k} value={k}>{fields[k].label}</option>)}</select></label>
      {inspect && observation && <div className="calc-observation" key={inspect}>
        <p><strong>{status(observation.value,observation.evidence)} · {number(observation.value,3)}</strong><br/>{observation.value==null?"No source value recorded":observation.evidence.source || "Source unrecorded"}{observation.evidence.date && " · "+observation.evidence.date}
          {observation.evidence.reviewer && " · Reviewed by "+observation.evidence.reviewer}</p>
        <p>Used in this case · {number(draft.values[inspect],3)} · {draft.sourceValues?.[inspect]?"Scenario override":legacy && (draft.evidence[inspect]??planning).status==="assumed"?"Saved assumption":"Follows source"}</p>
        {legacy && !draft.sourceValues?.[inspect] && <small>Earlier revision · only the saved value and its recorded evidence are available.{author?" Case saved by "+author+".":""}</small>}
        {stale && seed.evidence[inspect]?.source && observation.evidence.source===seed.evidence[inspect]?.source && seed.values[inspect]!==observation.value && <p>Current filed value · {number(seed.values[inspect],3)} · {seed.evidence[inspect]?.date||"Date unrecorded"}</p>}
        {inspect==="depot" && draft.comparator==="workbook"?<p>Choose a local depot in the case editor to test a different benchmark.</p>:
          <form onSubmit={e=>{e.preventDefault();onTrial(inspect,entry===""?null:Number(entry));}}>
            <label>Trial value<input className="field" type="number" min={fields[inspect].min} max={fields[inspect].max} step={inspect==="stalls"?"1":"any"} value={entry} placeholder="Unknown" onChange={e=>setEntry(e.target.value)}/></label>
            <button className="paper-btn" type="submit">Apply trial</button></form>}
        <button className="text-link" type="button" onClick={()=>reviewSource(inspect)}>Review source and date</button>
      </div>}
      {trial && <><dl className="charging-metrics purchase-ledger" aria-live="polite">
        {impact("Cost per charge",r.siteCost,baseline.siteCost)}{impact("Peak charges",r.peakSessions,baseline.peakSessions,false)}{impact(draft.terms==="lease"?"Monthly rent at parity":"Price at parity",r.ceiling,baseline.ceiling)}</dl>
        {priorNetwork!=null && reference && <p>Network reference · {money(priorNetwork)} → {money(reference.cost)} per charge</p>}
        <button type="button" className="text-link" onClick={reset}>Discard trial</button></>}
    </section>
  </section>;
}
