"use client";
import {useRef,useState, type FormEvent} from "react";
import type {ListAssumptions} from "@/lib/charging/preliminary";
import {displayedPriceDelta} from "@/lib/charging/pipelineCost";
import {amounts} from "@/lib/charging/model";
import {ledgerFields,scenarios,screenLedger,validChange,type Changes,type LedgerBasis,type LedgerKey,type SavedScreen} from "@/lib/charging/screenLedger";
import "./screening-ledger.css";

const num=(n:number)=>n.toLocaleString("en-US",{maximumFractionDigits:2});
const count=(n:number)=>Math.round(n).toLocaleString("en-US");
const delta=(n:number)=>(n>0?"+":"")+amounts(n,2);
type SaveContext={site:string;source:string;canWrite:boolean;listTrial?:ListAssumptions};
type Line={key:keyof ReturnType<typeof screenLedger>["costs"];label:string;fact:string;fields:LedgerKey[];test:Changes;testLabel:string};

export function ScreeningLedger({basis,saveContext,initial}:{
  basis:LedgerBasis;saveContext?:SaveContext;initial?:SavedScreen;
}){
  const [changes,setChanges]=useState<Changes>(initial?.inputs.changes??{});
  const [scenario,setScenario]=useState(initial?.inputs.scenario??0);
  const [editing,setEditing]=useState<string|null>(null);
  const [name,setName]=useState(""),[status,setStatus]=useState(""),[saving,setSaving]=useState(false);
  const [saved,setSaved]=useState<SavedScreen|null>(null);
  const retry=useRef<{body:string;id:string}|null>(null);
  const v={...basis.inputs,...changes}, r=screenLedger(basis,changes,scenario), base=screenLedger(basis), lease=basis.terms==="lease";
  const custom=Object.keys(changes).length>0, priced=r.perCharge!=null, stress=scenarios[scenario];
  const cases=scenarios.map((_,i)=>screenLedger(basis,changes,i));
  function change(next:Changes){
    setChanges(Object.fromEntries(Object.entries(next).filter(([k,n])=>n!==basis.inputs[k as LedgerKey])));
    setEditing(null);setStatus("");setSaved(null);
  }
  function editor(id:string,keys:LedgerKey[]){
    if(editing!==id)return null;
    function apply(event:FormEvent<HTMLFormElement>){
      event.preventDefault();const data=new FormData(event.currentTarget),next={...changes};
      for(const k of keys){
        const value=Number(data.get(k));
        if(!validChange(k,value)){setStatus("Review "+ledgerFields[k]+".");return;}
        next[k]=value;
      }
      change(next);
    }
    return <form className="screen-edit" onSubmit={apply}>{keys.map(k=><label key={k}>{k==="price"?(lease?"Monthly rent ($)":"Purchase price ($)"):ledgerFields[k]}
      <input className="field" type="number" name={k} required step={["stalls","referenceYears","years","referenceStalls","perPost","ports"].includes(k)?1:"any"} defaultValue={v[k]} />
      <small>Starting value · {num(basis.inputs[k])}{basis.workbookDefaults?.[k]!=null && basis.workbookDefaults[k]!==basis.inputs[k]?" · workbook "+num(basis.workbookDefaults[k]!):""}</small></label>)}
      <div><button className="paper-btn" type="submit">Apply trial</button> <button className="text-link" type="button" onClick={()=>setEditing(null)}>Cancel</button></div>
    </form>;
  }
  function editButton(id:string,label:string){
    return <button type="button" className="text-link" aria-expanded={editing===id} onClick={()=>setEditing(editing===id?null:id)}>{label}</button>;
  }
  async function save(event:FormEvent){
    event.preventDefault();if(!saveContext || saving)return;
    const draft={kind:"screen",listTrial:saveContext.listTrial,name:name.trim(),sourceRevision:saveContext.source,basis,changes,scenario};
    const body=JSON.stringify(draft);
    if(retry.current?.body!==body)retry.current={id:crypto.randomUUID(),body};
    setSaving(true);setStatus("");
    try{
      const resp=await fetch("/api/actions/charging?site="+encodeURIComponent(saveContext.site),{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...draft,id:retry.current.id})});
      const data=await resp.json();
      if(!resp.ok || data.saved?.id!==retry.current.id)throw Error(data.error??"Unable to confirm the saved alternative.");
      setSaved(data.saved);setStatus("Saved "+data.saved.name+".");retry.current=null;
    }catch(e){setStatus(e instanceof Error?e.message:"Unable to save the alternative.");}
    finally{setSaving(false);}
  }
  const recovery=num(r.recovery*100)+"% annual recovery ("+num(v.rate)+"% over "+num(v.years)+" years)";
  const tenPct=(n:number)=>n===0?10000:n*1.1;
  const lines:Line[]=[
    {key:"property",label:lease?"Lease":"Purchase and closing",fact:lease?amounts(v.price)+"/month × 12":"("+amounts(v.price)+" × "+(1+v.closing/100).toLocaleString("en-US",{maximumFractionDigits:5})+") × annual recovery · "+num(v.closing)+"% closing",fields:lease?["price"]:["price","closing","years","rate"],test:{price:v.price*.9},testLabel:"10% lower terms"},
    {key:"construction",label:"Stall construction",fact:v.stalls+" stalls × "+amounts(v.unitBuild)+" per stall × annual recovery",fields:["unitBuild","years","rate"],test:{unitBuild:tenPct(v.unitBuild)},testLabel:v.unitBuild?"10% higher build":"$10k more per stall"},
    {key:"upgrade",label:"Utility upgrade",fact:amounts(r.upgrade)+" × annual recovery",fields:["upgrade"],test:{upgrade:v.upgrade+100000},testLabel:"$100k more before stress"},
    {key:"tax",label:"Infrastructure tax",fact:num(v.tax)+"% × "+amounts(r.build+r.upgrade)+" infrastructure",fields:["tax"],test:{tax:v.tax+.5},testLabel:"0.5 points higher"},
    {key:"staffing",label:"Round-the-clock attendants",fact:r.posts+(r.posts===1?" staffed post × ":" staffed posts × ")+amounts(v.postCost)+"/year · "+num(v.perPost)+" stalls per post",fields:["postCost","perPost"],test:{postCost:tenPct(v.postCost)},testLabel:v.postCost?"10% higher post cost":"$10k more per post"},
    {key:"upkeep",label:"Upkeep and insurance",fact:amounts(v.fixed)+" fixed + "+amounts(v.insurance)+" insurance + "+r.chargers+" chargers × "+amounts(v.perCharger)+" · "+v.ports+" stalls per charger",fields:["fixed","insurance","perCharger","ports"],test:{fixed:v.fixed+10000},testLabel:"$10k more per year"},
    {key:"conversion",label:"Additional conversion works",fact:amounts(v.conversion)+" × annual recovery",fields:["conversion"],test:{conversion:v.conversion+100000},testLabel:"$100k more in works"},
    ...(!lease?[{key:"cash" as const,label:"Less retained operating cash",fact:basis.creditCash===false?basis.cashBasis+" · income offsets displacement only":basis.cashBasis,fields:["cash" as const],test:{cash:v.cash+100000},testLabel:"$100k more retained"},
      {key:"displaced" as const,label:"Displaced operating cash",fact:amounts(v.displaced)+" per year",fields:["displaced" as const],test:{displaced:v.displaced+10000},testLabel:"$10k more displaced"}]:[]),
  ];
  function source(line:Line){
    if(line.fields.some(k=>basis.workbookDefaults?.[k]!=null && basis.workbookDefaults[k]!==basis.inputs[k]))return "Pipeline trial assumption";
    if(line.key==="property")return basis.priceBasis+(basis.date?" · "+basis.date:"");
    if(line.key==="conversion" || line.key==="displaced"){
      const recorded=line.key==="conversion"?basis.conversionRecorded:basis.displacedRecorded;
      return recorded || basis.inputs[line.key]?"Filed layout assumption":"Unpriced · $0 allowance in this estimate";
    }
    if(line.key==="cash")return "Income credit";
    return "Workbook assumption";
  }
  function savedLink(id:string){
    const query=new URLSearchParams(window.location.search);
    query.delete("case");query.delete("basis");query.set("site",saveContext!.site);query.set("view","explain");query.set("screen",id);
    return "?"+query.toString();
  }
  const fewer=v.stalls>1?screenLedger(basis,{...changes,stalls:v.stalls-1},scenario):null;
  const sensitivities=lines.map(line=>{
    const tested=screenLedger(basis,{...changes,...line.test},scenario);
    return {label:line.label,test:line.testLabel,impact:tested.perCharge!=null && r.perCharge!=null?displayedPriceDelta(tested.perCharge,r.perCharge):0};
  });
  if(fewer?.perCharge!=null && r.perCharge!=null)sensitivities.push({label:"Operating layout",test:"One fewer stall",impact:displayedPriceDelta(fewer.perCharge,r.perCharge)});
  const lowerVolume=screenLedger(basis,{...changes,volume:v.volume*.75},scenario);
  if(lowerVolume.perCharge!=null && r.perCharge!=null)sensitivities.push({label:"Charge volume",test:"25% fewer completions",impact:displayedPriceDelta(lowerVolume.perCharge,r.perCharge)});
  const noIncome=basis.parcel && !lease && basis.creditCash!==false && v.cash>v.displaced?screenLedger({...basis,creditCash:false},changes,scenario):null;
  const ranked=sensitivities.filter(s=>Math.abs(s.impact)>=.005).sort((a,b)=>Math.abs(b.impact)-Math.abs(a.impact)).slice(0,3);
  return <div className="screen-ledger">
    <div className="screen-result" aria-live="polite"><div><span>{initial?"Saved screening alternative":custom?"Screening trial":basis.hypothetical?"Hypothetical layout":"Preliminary site estimate"} · {stress.label}</span>
      <strong>{priced?amounts(r.perCharge,2):"No completed charges"}</strong></div>
      <p>{priced?amounts(r.annualCost)+" annual net cost ÷ "+count(r.sessions)+" annual charges":"A cost per charge needs an operating layout and positive volume."}</p>
      <small>Electricity and utility demand charges excluded{custom && base.perCharge!=null && priced?" · "+delta(displayedPriceDelta(r.perCharge!,base.perCharge))+" vs original base":""}</small></div>
    <h3>What changes the result?</h3>
    <div className="screen-scenarios">{cases.map((c,i)=><button type="button" className="paper-btn screen-scenario" aria-pressed={scenario===i} key={i}
      onClick={()=>{setScenario(i);setSaved(null);setStatus("");}}><span>{scenarios[i].label}</span><b>{c.perCharge==null?"—":amounts(c.perCharge,2)}</b>
      <small>{i===0?"Per charge":c.perCharge!=null && cases[0].perCharge!=null?delta(displayedPriceDelta(c.perCharge,cases[0].perCharge))+" vs base":"No volume"}</small></button>)}</div>
    {cases[0].perCharge!=null && cases[1].perCharge!=null && cases[2].perCharge!=null && Math.abs(Math.abs(cases[1].perCharge-cases[0].perCharge)-Math.abs(cases[2].perCharge-cases[0].perCharge))>=.005 &&
      <p className="screen-insight"><b>{Math.abs(cases[1].perCharge-cases[0].perCharge)>=Math.abs(cases[2].perCharge-cases[0].perCharge)?"Volume has the larger effect in these tests.":"The utility upgrade has the larger effect in these tests."}</b> Verify the layout and access before relying on either case.</p>}
    <h3>Completed charges</h3>
    <p><b>{v.stalls} operating stalls</b> · {basis.condition}{v.stalls!==basis.inputs.stalls?" · trial layout":""}. {basis.hypothetical?"Recorded layout":basis.parcel?"Filed layouts":"Assessed footprint"} · {basis.space}.</p>
    <p>{v.stalls} × {num(r.perStall)} charges/stall/year × {num(v.volume*stress.volume)}% = <b>{count(r.sessions)} per year</b> · {count(r.sessions/365)} per day.</p>
    <small>Workbook benchmark · {count(v.benchmark)} completions over {v.referenceYears} years across {v.referenceStalls} stalls. Fleet demand and power need site confirmation.</small>
    <div className="screen-tools">{editButton("volume","Test layout and volume")}
      {fewer?.perCharge!=null && <button type="button" className="text-link" onClick={()=>change({...changes,stalls:v.stalls-1})}>Try {v.stalls-1} stalls · {amounts(fewer.perCharge,2)}/charge{fewer.posts!==r.posts?" · one fewer staffed post":""}</button>}</div>
    {editor("volume",["stalls","volume","benchmark","referenceYears","referenceStalls"])}
    <h3>Annual cost ledger</h3><p className="layer-meta">{recovery}. Each trial changes one driver and recalculates all affected costs.</p>
    <div className="screen-table"><div className="screen-line screen-head"><span>Driver and evidence</span><span>Annual cost</span><span>$/charge</span></div>
      {lines.map(line=>{const trial=screenLedger(basis,{...changes,...line.test},scenario);
        return <div key={line.key} className="screen-item"><div className="screen-line"><div><b>{line.label}</b><small>{source(line)}{line.fields.some(k=>changes[k]!=null)?" · trial override":""}</small></div>
          <span>{amounts(r.costs[line.key])}</span><span>{priced?amounts(r.costs[line.key]/r.sessions,2):"—"}</span></div>
          <p>{line.fact}</p>{line.key==="property" && basis.source?.startsWith("https://") && <a className="text-link" href={basis.source} target="_blank" rel="noopener noreferrer">Open source document ↗</a>}
          <div className="screen-tools">{editButton(line.key,"Edit "+line.label.toLowerCase())}
          {priced && trial.perCharge!=null && <span>{line.testLabel} · <b>{delta(displayedPriceDelta(trial.perCharge,r.perCharge!))}/charge</b></span>}</div>
          {editor(line.key,line.fields)}</div>;})}
      <div className="screen-line screen-total"><b>Net site cost</b><b>{amounts(r.annualCost)}</b><b>{priced?amounts(r.perCharge,2):"—"}</b></div></div>
    {noIncome?.perCharge!=null && <p>Without credit for positive business income · <b>{amounts(noIncome.perCharge,2)}/charge</b> in this scenario.</p>}
    <p className="layer-meta">Rows round separately. Shared management overhead and one-time business interruption are outside this screen.</p>
    {ranked.length>0 && <section><h3>Largest changes in the tested assumptions</h3>
      <ol className="screen-checks">{ranked.map(s=><li key={s.label}><b>{s.label}</b> · {s.test} · <b>{delta(s.impact)}/charge</b></li>)}</ol>
      <small>Each change is measured on its own against the scenario shown above.</small></section>}
    <h3>What needs to be true?</h3><ol className="screen-checks">
      <li><b>Layout and access.</b> Confirm the stall count, circulation and written operating rights for {basis.condition.toLowerCase()}.</li>
      <li><b>Charge volume.</b> Confirm fleet arrivals and available utility power can sustain {count(r.sessions/365)} completions per day, including the peak shift.
        {basis.proxy!=null && basis.proxy>0 && r.annualCost>0 && <> At the {amounts(basis.proxy,2)} workbook depot proxy, these costs require {count(Math.ceil(r.annualCost/basis.proxy))} completions a year.</>}</li>
      <li><b>Staff and power costs.</b> Confirm the staffing plan for {r.posts} round-the-clock {r.posts===1?"post":"posts"} and obtain a utility quote against the {amounts(r.upgrade)} allowance.</li></ol>
    {(custom || scenario!==0 || initial) && <div className="screen-tools"><button className="text-link" type="button" onClick={()=>{change({});setScenario(0);}}>Reset to starting estimate</button></div>}
    {saveContext?.canWrite && priced && (custom || scenario!==0) && <form className="screen-save" onSubmit={save}><label>Alternative name<input className="field" required maxLength={80} value={name} onChange={e=>{setName(e.target.value);setSaved(null);}}/></label>
      <button type="submit" className="paper-btn" disabled={saving||!!saved||!name.trim()}>{saving?"Saving…":"Save screening alternative"}</button></form>}
    <p role="status">{status}{saved && <> <a className="text-link" href={savedLink(saved.id)}>Reopen saved ledger</a></>}</p>
  </div>;
}
