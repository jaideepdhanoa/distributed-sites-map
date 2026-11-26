"use client";
import { siteMerit } from "@/lib/charging/merit";
import { MeritEditor } from "./SiteMerit";
import { useEffect,useRef,useState } from "react";
import { amounts,calculate,diligenceDrivers,fields,groups,initialCase,keys,modelVersion,type Evidence,type Inputs,type Key,type SavedCase } from "@/lib/charging/model";
import { filedScreenLabel } from "@/lib/charging/summary";
import { validateInputs } from "@/lib/charging/schema";
import { networkReference,paidScreen } from "@/lib/charging/reference";
import type { DealProps } from "@/lib/types";

type Payload={site:DealProps;source:string;history:SavedCase[]|null;canWrite:boolean};
const quick:Key[]=["ask","rent","stalls","hostWeek","hostEnd","ownWeek","ownEnd","hostFee","conversion","interruption","loss"];
const keyOf=(r:SavedCase)=>r.id+":"+r.revision;
export function ChargingSiteSection({deal}:{deal:DealProps}) {
  const c=deal.charging;
  if(!c)return null;
  return <section className="charging-preview" aria-label="Charging economics"><strong>Charging economics</strong>
    <p>{c.merit.action} · {c.name}</p>
    <p>{c.result.siteCost==null?"Site cost pending":amounts(c.result.siteCost,2)+" per charge"} · {amounts(c.result.depot,2)} {c.comparator==="workbook"?"depot proxy":"depot"}</p>
    <p>{c.merit.next}</p>{!c.selected && <p className="layer-meta">{filedScreenLabel(c.screen)}</p>}<a className="text-link" href={"/charging?site="+encodeURIComponent(deal.deal_id)}>Edit assumptions and compare cases</a></section>;
}
export function ChargingEditor({site}:{site:string}) {
  const [payload,setPayload]=useState<Payload|null>(null),[failed,setFailed]=useState(false),[attempt,retry]=useState(0);
  useEffect(()=>{
    const ac=new AbortController();
    setFailed(false);setPayload(null);
    fetch("/api/actions/charging?site="+encodeURIComponent(site),{cache:"no-store",signal:ac.signal}).then(async r=>{
      if(!r.ok)throw Error();const data=await r.json();if(!ac.signal.aborted)setPayload(data);
    }).catch(()=>{if(!ac.signal.aborted)setFailed(true);});
    return ()=>ac.abort();
  },[site,attempt]);
  if(!payload)return <p role="status">{failed?<><span>Charging case unavailable. </span><button className="text-link" onClick={()=>retry(attempt+1)}>Retry</button></>:"Loading charging assumptions…"}</p>;
  return <Editor key={site+":"+attempt} data={payload} reload={()=>retry(attempt+1)}/>;
}

const defaultEvidence:Evidence={status:"assumed",source:"Scenario estimate",date:""};
function Editor({data,reload}:{data:Payload;reload:()=>void}) {
  const {site}=data, seed=initialCase(site);
  const [history,setHistory]=useState(data.history??[]);
  const original=history.find(c=>c.selected);
  const [draft,setDraft]=useState<Inputs>(original?.inputs??seed);
  const [parent,setParent]=useState<SavedCase|undefined>(original);
  const [name,setName]=useState(original?.name??"Moove staffed");
  const [useOnCard,setUseOnCard]=useState(true);
  const [other,setOther]=useState(""),[status,setStatus]=useState(""),[saving,setSaving]=useState(false);
  const [reviewed,setReviewed]=useState(false);
  const request=useRef<{body:string;requestId:string;id:string}|null>(null);
  const current=calculate(draft), compare=history.find(r=>keyOf(r)===other);
  const screen=paidScreen(site),drivers=diligenceDrivers(draft,current);
  const reference=networkReference(site,draft),layout=site.purchase?.layout;
  const stale=!!parent && (parent.sourceRevision!==data.source || parent.model!==modelVersion);
  const merit=siteMerit(site,draft,true,stale && !reviewed,false);
  function edit(next:Inputs){setDraft(next);setStatus("");}
  function setValue(key:Key,value:number|null){
    const values={...draft.values,[key]:value},evidence={...draft.evidence,[key]:{...defaultEvidence}};
    if((key==="hostWeek" || key==="hostEnd") && value!=null){
      const own=key==="hostWeek"?"ownWeek":"ownEnd", total=key==="hostWeek"?"weekdayHours":"weekendHours";
      if(values[total]!=null && draft.values[own]!=null && draft.values[key]!=null && draft.values[own]+draft.values[key]===values[total]) {
        values[own]=Math.max(0,values[total]-value);evidence[own]={...defaultEvidence,source:"Remainder of staffed window"};
      }
    }
    edit({...draft,values,evidence,comparable:["depot","years","energy","efficiency","rate"].includes(key)?false:draft.comparable});
  }
  function stamp(key:Key,patch:Partial<Evidence>){
    edit({...draft,evidence:{...draft.evidence,[key]:{...(draft.evidence[key]??defaultEvidence),...patch}}});
  }
  function load(row?:SavedCase){
    setParent(row);setDraft(row?.inputs??seed);setName(row?.name??"Moove staffed");setReviewed(false);setStatus("");request.current=null;
  }
  function changeLayout(label:string){
    const index=layout?.zones.indexOf(label)??-1;
    const count=index<0?seed.values.stalls:layout?.stalls?.[index]??null;
    const ref=site.purchase?.assumptions.charging;
    const values={...draft.values,stalls:count,build:count!=null && ref?.unitBuild!=null ? count*ref.unitBuild:null,
      posts:count!=null && ref?.perPost ? Math.ceil(count/ref.perPost):null,loss:null,conversion:null,interruption:null};
    const evidence={...draft.evidence};
    for(const k of ["stalls","build","posts","loss","conversion","interruption"] as Key[])delete evidence[k];
    edit({...draft,ranking:undefined,layout:label,rights:"unknown",rightsSource:"",rightsDate:"",allOptionsReviewed:false,values,evidence});
  }
  function field(key:Key){
    const meta=fields[key],e=draft.evidence[key]??defaultEvidence,val=draft.values[key];
    return <div className="charging-field" key={key}>
      <label>{meta.label}<input className="field" type="number" step={key==="stalls"?"1":"any"} min={meta.min} max={meta.max}
        disabled={key==="depot" && draft.comparator==="workbook"} value={val??""} placeholder="Unknown" onChange={event=>setValue(key,event.target.value===""?null:event.target.valueAsNumber)}/></label>
      <details className="disclosure"><summary className="disclosure">{val==null?"Unknown":e.status} · source</summary>
        <label>Evidence status<select className="secondary" value={e.status} onChange={x=>stamp(key,{status:x.target.value as Evidence["status"]})}>
          <option value="assumed">Assumed</option><option value="quoted">Quoted</option><option value="verified">Verified</option></select></label>
        <label>Source<input className="field" maxLength={400} value={e.source} onChange={x=>stamp(key,{source:x.target.value})}/></label>
        <label>Evidence date<input className="field" type="date" value={e.date} onChange={x=>stamp(key,{date:x.target.value})}/></label></details>
    </div>;
  }
  async function save(){
    const valid=validateInputs(draft);
    if(!valid.success){setStatus(valid.error.issues[0].message);return;}
    if(!name.trim()){setStatus("Enter a case name.");return;}
    const inputs={name:name.trim(),inputs:draft,base:parent?.revision??0,sourceRevision:data.source,select:useOnCard,
      expectedSelection:history.find(r=>r.selected)?keyOf(history.find(r=>r.selected)!):null};
    const body=JSON.stringify(inputs);
    if(request.current?.body!==body)request.current={body,id:parent?.id??crypto.randomUUID(),requestId:crypto.randomUUID()};
    const {id,requestId}=request.current;
    setSaving(true);
    try{
      const response=await fetch("/api/actions/charging?site="+encodeURIComponent(site.deal_id),{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...inputs,id,requestId})});
      const json=await response.json();
      if(!response.ok)throw Error(json.error??"Unable to save this case.");
      const rows:SavedCase[]=json.history,saved=rows.find(r=>r.id===id && r.revision===inputs.base+1);
      if(!saved)throw Error("Saved revision could not be read back. Retry.");
      setHistory(rows);load(saved);setStatus("Saved "+saved.name+" · revision "+saved.revision+".");
      window.dispatchEvent(new Event("charging-case-saved"));
    }catch(error){setStatus(error instanceof Error?error.message:"Save failed. Retry.");}finally{setSaving(false);}
  }
  function metric(label:string,a:string,b?:string){return <div key={label}><dt>{label}</dt><dd>{a}{b && <small>Compared · {b}</small>}</dd></div>;}
  const shown=(n:number|null)=>n==null?"Unknown":Math.round(n).toLocaleString("en-US");
  const otherResult=compare?.result;
  return <section className="charging-editor" aria-label="Charging economics editor">
    <p className="eyebrow">Charging economics</p><h2 className="charging-title">{site.name || site.deal_id}</h2>
    <div className="charging-controls">
      <label>Work on a case<select className="secondary" value={parent?keyOf(parent):""} onChange={e=>load(history.find(r=>keyOf(r)===e.target.value))}>
        <option value="">New planning case</option>{history.map(r=><option key={keyOf(r)} value={keyOf(r)}>{r.name} · v{r.revision}{r.selected?" · on site card":""}</option>)}</select></label>
      {history.length>0 && <label>Compare with<select className="secondary" value={other} onChange={e=>setOther(e.target.value)}>
        <option value="">Choose saved revision</option>{history.map(r=><option key={keyOf(r)} value={keyOf(r)}>{r.name} · v{r.revision}</option>)}</select></label>}
    </div>
    {parent && <p className="layer-meta">Saved by {parent.author} · {new Date(parent.at).toLocaleDateString()} · {parent.model}</p>}
    {stale && <div className="purchase-check"><strong>Site evidence or model changed</strong><p>Review the saved inputs against today's layout, price and benchmark.</p>
      {keys.filter(k=>parent?.inputs.evidence[k]?.source===seed.evidence[k]?.source && parent?.inputs.values[k]!==seed.values[k]).map(k=><p key={k}>{fields[k].label} · saved {parent?.inputs.values[k]??"unknown"} / current default {seed.values[k]??"unknown"}</p>)}
      <button className="paper-btn" type="button" onClick={()=>{
        const values={...draft.values},evidence={...draft.evidence};
        for(const k of keys){const inherited=parent?.inputs.evidence[k]?.source;
          if(inherited && inherited!=="Planning assumption" && inherited===seed.evidence[k]?.source && draft.values[k]===parent?.inputs.values[k] && draft.evidence[k]?.status==="assumed"){values[k]=seed.values[k];evidence[k]=seed.evidence[k];}}
        edit({...draft,values,evidence});setReviewed(true);
      }}>Refresh inherited inputs from current evidence</button>
      <label><input className="check" type="checkbox" checked={reviewed} onChange={e=>setReviewed(e.target.checked)}/> Reviewed current evidence for the next revision</label></div>}
    <dl className="purchase-ledger charging-metrics" aria-live="polite">
      {metric("This site per charge",amounts(current.siteCost,2),compare?amounts(otherResult!.siteCost,2):undefined)}
      {metric(draft.comparator==="workbook"?"Miami depot proxy per charge":"Local depot per charge",amounts(current.depot,2),compare?amounts(otherResult!.depot,2):undefined)}
      {metric("Site minus depot per charge",amounts(current.difference,2),compare?amounts(otherResult!.difference,2):undefined)}
      {metric("Peak charges per shift",shown(current.peakSessions),compare?shown(otherResult!.peakSessions):undefined)}
      {metric(draft.terms==="lease"?"Monthly rent at parity":"Purchase price at parity",current.annualGap>0?"Fails even at zero":amounts(current.ceiling),compare?amounts(otherResult!.ceiling):undefined)}
    </dl>
    <p className="purchase-check"><strong>{merit.action}</strong> · {merit.next}</p>
    {!parent && <p className="charging-screen">{filedScreenLabel(screen)}</p>}
    {site.selectionResearch?.check && <p>Filed site check · {site.selectionResearch.check}</p>}
    <details className="disclosure"><summary className="disclosure">Throughput, offer and cash details</summary>
      <dl className="purchase-ledger">{metric("Site cost per delivered kWh",amounts(current.perKwh,2))}
        {metric("Completed charges per year",shown(current.sessions))}{metric("Uncovered hours per week",shown(current.uncovered))}
        {metric("Site opening window",current.opening||"Unknown")}{metric("Additional charges before depot opens",shown(current.earlyMin)+" – "+shown(current.earlyMax))}
        {metric("Sessions per year needed at these terms",shown(current.neededSessions))}{metric("Maximum total utility upgrade at these terms",current.upgradeLimit!=null && current.upgradeLimit<0?"Fails at zero upgrade cost":amounts(current.upgradeLimit))}{metric("Temporary spend avoided before depot opening",amounts(current.avoidedTemp))}
        {metric("Year-one net cash required",amounts(current.yearOne))}{metric("Ceiling after available asset-value constraint",amounts(current.offer))}
        {metric("Annual shortfall at zero property cost",current.ceiling==null?"Unknown":amounts(current.annualGap))}
        {current.hostLimit!=null && metric("Maximum host fee per covered hour",current.hostLimit<0?"Fails with free host labor":amounts(current.hostLimit,2))}
      </dl><p className="layer-meta">Single-site costs use annual capital recovery over the selected horizon with zero residual value. Year-one cash includes the purchase or rent and construction. Temporary spend is shown separately. The Miami proxy excludes electricity on both sides.</p></details>
    <details className="disclosure"><summary className="disclosure">Which assumption could change the decision?</summary>
      <label>Test each uncertain input by ± (%)<input className="field" type="number" min={1} max={100} value={draft.sensitivityPct} onChange={e=>{const n=e.target.valueAsNumber;if(n>=1 && n<=100)edit({...draft,sensitivityPct:n});}}/></label>
      <p>Each range changes one input. Figures show site cost minus depot cost per charge. Values at or below zero meet parity.</p>
      {drivers.length?<ol>{drivers.slice(0,5).map(d=><li key={d.key}><strong>{fields[d.key].label}</strong> · {d.low.toLocaleString("en-US",{maximumFractionDigits:2})}–{d.high.toLocaleString("en-US",{maximumFractionDigits:2})} · {amounts(d.best,2)} to {amounts(d.worst,2)}{d.flips?" · crosses parity":""}</li>)}</ol>:<p>{current.difference==null?"Complete the site and depot inputs to rank the uncertainties.":"The tested inputs leave the modeled gap unchanged at this precision."}</p>}
    </details>
    {compare && <details className="disclosure"><summary className="disclosure">Assumptions changed from {compare.name}</summary>
      {keys.filter(k=>draft.values[k]!==compare.inputs.values[k]).map(k=><p key={k}>{fields[k].label} · {compare.inputs.values[k]??"Unknown"} → {draft.values[k]??"Unknown"}</p>)}
      <p>Footprint · {compare.inputs.layout} → {draft.layout}. Terms · {compare.inputs.terms} → {draft.terms}.</p>
    </details>}
    {screen.length>0 && <details className="disclosure"><summary className="disclosure">Which stall counts could work with Moove staffing?</summary>
      <table><caption>Workbook savings against depot at the filed ask, by hypothetical layout</caption><thead><tr><th>Stalls</th><th>Filed costs</th><th>Conversion downside</th></tr></thead>
        <tbody>{screen.map(row=><tr key={row.stalls}><th>{row.stalls}</th><td>{(100*row.base).toFixed(1)}%</td><td>{(100*row.downside).toFixed(1)}%</td></tr>)}</tbody></table>
      <p>Zero or positive savings reaches parity. Paid Moove staffing throughout. The filed downside adds conversion works and lost operating contribution. Verify the layout and local service.</p></details>}
    <MeritEditor draft={draft} merit={merit} onChange={edit}/>
    <h4>Edit assumptions</h4>
    <button className="paper-btn" type="button" onClick={()=>{
      const derived={...draft,values:{...draft.values,conversion:250000,loss:50000},evidence:{...draft.evidence,
        conversion:{...defaultEvidence,source:"Illustrative filed downside"},loss:{...defaultEvidence,source:"Illustrative filed downside"}}};
      setOther(parent?keyOf(parent):"");setParent(undefined);setName("Conversion downside");setUseOnCard(false);edit(derived);request.current=null;
    }}>Start a conversion downside case</button><p className="layer-meta">Starts a separate draft at $250,000 of additional works and $50,000 of lost annual margin. Replace either figure with the estimate for this footprint.</p><p className="layer-meta">Host hours replace Moove hours when the full operating window is covered. Verify the host schedule and fee.</p>
    <div className="charging-controls">
      <label>Deal terms<select className="secondary" value={draft.terms} onChange={e=>edit({...draft,terms:e.target.value as Inputs["terms"]})}><option value="purchase">Purchase</option><option value="lease">Lease</option></select></label>
      <label>Footprint<select className="secondary" value={draft.layout} onChange={e=>changeLayout(e.target.value)}>
        {[...new Set(["Workbook footprint",...(layout?.zones??[]),draft.layout])].map(n=><option key={n}>{n}</option>)}</select></label>
      <label>Site rights<select className="secondary" value={draft.rights} onChange={e=>edit({...draft,rights:e.target.value as Inputs["rights"]})}>
        <option value="unknown">Unverified</option><option value="controlled">Controlled during operating hours</option><option value="unavailable">Documented as unavailable</option></select></label>
      <label>Rights evidence<input className="field" value={draft.rightsSource} maxLength={400} onChange={e=>edit({...draft,rightsSource:e.target.value})}/></label>
      <label>Rights evidence date<input className="field" type="date" value={draft.rightsDate} onChange={e=>edit({...draft,rightsDate:e.target.value})}/></label>
    </div>
    {draft.rights!=="unknown" && <label><input type="checkbox" className="check" checked={draft.allOptionsReviewed} onChange={e=>edit({...draft,allOptionsReviewed:e.target.checked})}/> All credible layouts and attainable terms reviewed</label>}
    <div className="charging-controls">{quick.filter(k=>!(k==="ask" && draft.terms==="lease") && !(k==="rent" && draft.terms==="purchase")).map(field)}</div>
    {groups.map(group=><details className="disclosure" key={group}><summary className="disclosure">{group}</summary><div className="charging-controls">
      {keys.filter(k=>fields[k].group===group && !quick.includes(k)).map(field)}
      {group===groups[0] && (["openEarly","openLate","depotDate"] as const).map((k,i)=><label key={k}>{["Earliest site opening","Latest site opening","Depot opening date"][i]}
        <input className="field" type="date" value={draft[k]} onChange={e=>edit({...draft,[k]:e.target.value})}/></label>)}
      {group===groups[1] && <label>Peak shift day<select className="secondary" value={draft.peakDay} onChange={e=>edit({...draft,peakDay:e.target.value as Inputs["peakDay"]})}><option value="weekday">Weekday</option><option value="weekend">Weekend</option></select></label>}
      {group===groups[0] && <><label>Temporary replacement end date<input className="field" type="date" value={draft.temporaryEnd} onChange={e=>edit({...draft,temporaryEnd:e.target.value})}/></label>
        <label>Documented spend replacement plan<input className="field" value={draft.temporarySource} maxLength={400} onChange={e=>edit({...draft,temporarySource:e.target.value})}/></label></>}
      {group===groups[4] && <><label>Benchmark<select className="secondary" value={draft.comparator} onChange={e=>{
        const local=e.target.value==="local";edit({...draft,comparator:local?"local":"workbook",comparable:false,energyScope:local?"included":"excluded",
          values:{...draft.values,depot:local?null:seed.values.depot},evidence:{...draft.evidence,depot:local?defaultEvidence:seed.evidence.depot}});
      }}><option value="workbook">Miami workbook proxy</option><option value="local">Local depot</option></select></label>
        <label>Energy scope on both sides<select className="secondary" disabled={draft.comparator==="workbook"} value={draft.energyScope} onChange={e=>edit({...draft,comparable:false,energyScope:e.target.value as Inputs["energyScope"]})}>
          <option value="excluded">Exclude electricity</option><option value="included">Include energy and demand charges</option></select></label>
        {draft.comparator==="local" && <label><input className="check" type="checkbox" checked={draft.comparable} onChange={e=>edit({...draft,comparable:e.target.checked})}/> Depot quote covers the same session energy, operating scope and financing horizon</label>}</>}
    </div></details>)}
    {current.missing.length>0 && <details className="disclosure"><summary className="disclosure">Inputs needed for a complete cost ({current.missing.length})</summary><p>{current.missing.join(" · ")}</p></details>}
    <details className="disclosure"><summary className="disclosure">Workbook network reference</summary><p>{reference?amounts(reference.cost,2)+" per charge vs "+amounts(reference.depot,2)+" at the depot · "+reference.sites+" similar sites.":"Unavailable for this footprint, staffing window or price."}</p>
      <p>Uses the filed network case at this stall count. Adjusts purchase price, host coverage and fee, conversion work and recurring lost margin. Other single-site inputs apply to the calculation above.</p></details>
    <div className="charging-save"><label>Case name<input className="field" value={name} maxLength={80} onChange={e=>setName(e.target.value)}/></label>
      <label><input className="check" type="checkbox" checked={useOnCard} onChange={e=>setUseOnCard(e.target.checked)}/> Use this revision on the site card and in Compare</label>
      {data.canWrite && <button className="primary" type="button" disabled={saving || (stale && !reviewed)} onClick={save}>{saving?"Saving…":"Save case"}</button>}
      {parent && <button type="button" className="paper-btn" onClick={()=>{setParent(undefined);setName(name+" copy");setStatus("");request.current=null;}}>Duplicate as new case</button>}
      {data.history===null && <p>Shared history is unavailable. You can still explore a draft.</p>}
      {status && <p role="status">{status}</p>}{status && /reload|newer/i.test(status) && <button className="text-link" type="button" onClick={reload}>Reload site and cases</button>}
    </div>
  </section>;
}
