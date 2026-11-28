"use client";
import {useRef,useState, type CSSProperties, type FormEvent} from "react";
import type {ListAssumptions} from "@/lib/charging/preliminary";
import {displayedPriceDelta} from "@/lib/charging/pipelineCost";
import {amounts} from "@/lib/charging/model";
import {higherUpgradeCase,ledgerFields,savedChanges,screenLedger,validChange,type Changes,type LedgerBasis,type LedgerKey,type SavedScreen} from "@/lib/charging/screenLedger";
import {LedgerNumber} from "./LedgerNumber";
import "./screening-ledger.css";

const num=(n:number)=>n.toLocaleString("en-US",{maximumFractionDigits:2});
const count=(n:number)=>Math.round(n).toLocaleString("en-US");
const delta=(n:number)=>(n>0?"+":"")+amounts(n,2);
const localFields=new Set<LedgerKey>(["stalls","conversion","cash","displaced"]);
type SaveContext={site:string;source:string;canWrite:boolean;listTrial?:ListAssumptions};
type Line={key:keyof ReturnType<typeof screenLedger>["costs"];label:string;fact:string;fields:LedgerKey[];test:Changes;testLabel:string};
function selectFields(changes:Changes,local:boolean):Changes{
  return Object.fromEntries(Object.entries(changes).filter(([k])=>localFields.has(k as LedgerKey)===local));
}
export function ScreeningLedger({bases,initialIndex,excluded,saveContext,initial}:{
  bases:LedgerBasis[];initialIndex:number;excluded:string[];saveContext?:SaveContext;initial?:SavedScreen;
}){
  const first=bases[initialIndex];
  const selectedParts=first.parts?.filter(p=>!excluded.includes(p.area));
  const subset=excluded.length && selectedParts?{stalls:selectedParts.reduce((n,p)=>n+p.stalls,0)}:{};
  const start=initial?savedChanges(initial):subset;
  const [index,setIndex]=useState(initialIndex);
  const [common,setCommon]=useState<Changes>(()=>selectFields(start,false));
  const [locals,setLocals]=useState<Record<number,Changes>>(()=>({[initialIndex]:selectFields(start,true)}));
  const [areas,setAreas]=useState<Record<number,string[]>>({[initialIndex]:excluded});
  const [name,setName]=useState(""),[status,setStatus]=useState(""),[saving,setSaving]=useState(false);
  const [saved,setSaved]=useState<SavedScreen|null>(null);
  const retry=useRef<{body:string;id:string}|null>(null);
  const changes={...common,...locals[index]},basis=bases[index];
  const omitted=areas[index]??[];
  const r=screenLedger(basis,changes),base=screenLedger(first,subset);
  const v={...basis.inputs,...changes,cash:r.operatingCash};
  const lease=basis.terms==="lease",priced=r.perCharge!=null,custom=Object.keys(changes).length>0 || index!==0 || omitted.length>0;
  function clearStatus(){setSaved(null);setStatus("");}
  function change(k:LedgerKey,n:number){
    if(!validChange(k,n))return;
    function updated(old:Changes){const next={...old,[k]:n};if(n===basis.inputs[k] && !(basis.withheldOperatingCash!=null && (k==="cash" || k==="displaced")))delete next[k];return next;}
    if(localFields.has(k))setLocals(old=>({...old,[index]:updated(old[index]??{})}));
    else setCommon(updated);
    clearStatus();
  }
  async function save(event:FormEvent){
    event.preventDefault();if(!saveContext || saving)return;
    const draft={kind:"screen",listTrial:saveContext.listTrial,name:name.trim(),sourceRevision:saveContext.source,basis,changes,omitted,scenario:0};
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
  const availableCash=basis.withheldOperatingCash??basis.inputs.cash;
  const pendingCash=basis.withheldOperatingCash!=null && changes.cash==null && changes.displaced==null;
  const testedCash=v.cash>0?v.cash:availableCash;
  const lossTest=pendingCash?availableCash*.25:v.displaced+(v.cash>0?v.cash*.25:10000);
  const lossLabel=pendingCash?"Credit 75% of source cash after conversion":v.cash>0?"Lose another 25% of operating cash":"$10k more displaced";
  const netCash=-(r.costs.cash+r.costs.displaced) || 0;
  const lines:Line[]=[
    {key:"property",label:lease?"Lease":"Purchase and closing",fact:lease?amounts(v.price)+"/month × 12":"("+amounts(v.price)+" × "+(1+v.closing/100).toLocaleString("en-US",{maximumFractionDigits:5})+") × annual recovery · "+num(v.closing)+"% closing",fields:lease?["price"]:["price","closing","years","rate"],test:{price:v.price*.9},testLabel:"10% lower terms"},
    {key:"construction",label:"Stall construction",fact:v.stalls+" stalls × "+amounts(v.unitBuild)+" per stall × annual recovery",fields:["unitBuild","years","rate"],test:{unitBuild:tenPct(v.unitBuild)},testLabel:v.unitBuild?"10% higher build":"$10k more per stall"},
    {key:"upgrade",label:"Utility upgrade",fact:amounts(r.upgrade)+" × annual recovery",fields:["upgrade"],test:{upgrade:v.upgrade>0?v.upgrade*1.5:100000},testLabel:v.upgrade>0?"50% higher upgrade":"$100k upgrade"},
    {key:"tax",label:"Infrastructure tax",fact:num(v.tax)+"% × "+amounts(r.build+r.upgrade)+" infrastructure",fields:["tax"],test:{tax:v.tax+.5},testLabel:"0.5 points higher"},
    {key:"staffing",label:"Round-the-clock attendants",fact:r.posts+(r.posts===1?" staffed post × ":" staffed posts × ")+amounts(v.postCost)+"/year · "+num(v.perPost)+" stalls per post",fields:["postCost","perPost"],test:{postCost:tenPct(v.postCost)},testLabel:v.postCost?"10% higher post cost":"$10k more per post"},
    {key:"upkeep",label:"Upkeep and insurance",fact:amounts(v.fixed)+" fixed + "+amounts(v.insurance)+" insurance + "+r.chargers+" chargers × "+amounts(v.perCharger)+" · "+v.ports+" stalls per charger",fields:["fixed","insurance","perCharger","ports"],test:{fixed:v.fixed+10000},testLabel:"$10k more per year"},
    {key:"conversion",label:"Additional conversion works",fact:amounts(v.conversion)+" × annual recovery",fields:["conversion"],test:{conversion:v.conversion+100000},testLabel:"$100k more in works"},
    ...(!lease?[{key:"cash" as const,label:/wash/i.test(basis.businessType??"")?"Car wash operating cash":"Business cash before displacement",fact:basis.creditCash===false?"Business income offsets displacement only.":amounts(v.cash)+"/year before any cash lost to conversion",fields:["cash" as const],test:{cash:v.cash>0?0:v.cash},testLabel:v.cash>0?"No positive cash credit":"Current cash credit"},
      {key:"displaced" as const,label:/wash/i.test(basis.businessType??"")?"Car wash cash lost to conversion":"Lost business cash",fact:amounts(v.displaced)+" per year",fields:["displaced" as const],test:{displaced:lossTest},testLabel:lossLabel}]:[]),
  ];
  function source(line:Line){
    if(line.fields.some(k=>basis.workbookDefaults?.[k]!=null && basis.workbookDefaults[k]!==basis.inputs[k]))return "Pipeline trial assumption";
    if(line.key==="property")return basis.priceBasis+(basis.date?" · "+basis.date:"");
    if(line.key==="conversion" || line.key==="displaced"){
      const recorded=line.key==="conversion"?basis.conversionRecorded:basis.displacedRecorded;
      return recorded || basis.inputs[line.key]?"Filed layout assumption":"Unpriced · $0 allowance in this estimate";
    }
    if(line.key==="cash")return basis.withheldOperatingCash!=null && (changes.displaced!=null || changes.cash!=null)?"Operating cash trial · verify conversion impact":basis.cashBasis;
    return "Workbook assumption";
  }
  function savedLink(id:string){
    const query=new URLSearchParams(window.location.search);
    query.delete("case");query.delete("basis");query.set("site",saveContext!.site);query.set("view","explain");query.set("screen",id);
    return "?"+query.toString();
  }
  const currentParts=basis.parts?.filter(p=>!omitted.includes(p.area));
  const layoutCount=currentParts?.length?currentParts.reduce((n,p)=>n+p.stalls,0):basis.inputs.stalls;
  const nameOf=(b:LedgerBasis)=>b.condition.split(". ")[0];
  const comparisons=bases.map((b,i)=>screenLedger(b,{...common,...locals[i]}));
  const higherUpgrades=bases.map((b,i)=>higherUpgradeCase(b,{...common,...locals[i]}));
  const columns=Math.ceil(bases.length/Math.ceil(bases.length/4));
  const diff=(n:number|null)=>n==null || r.perCharge==null?null:displayedPriceDelta(n,r.perCharge);
  const stallTrials=[-1,1].map(step=>{
    const stalls=v.stalls+step,valid=validChange("stalls",stalls);
    const tested=valid?screenLedger(basis,{...changes,stalls}):null;
    return {step,stalls,valid,impact:diff(tested?.perCharge??null),posts:tested?.posts};
  });
  const ranked=[
    ...lines.map(l=>({label:l.label,test:l.testLabel,impact:diff(screenLedger(basis,{...changes,...l.test}).perCharge)})),
    ...stallTrials.filter(t=>t.step<0).map(t=>({label:"Manual stall count",test:"One fewer stall"+(t.posts!=null && t.posts<r.posts?" and one fewer staffed post":""),impact:t.impact})),
    ...comparisons.flatMap((c,i)=>i===index?[]:[{label:nameOf(bases[i]),test:"Switch configuration",impact:diff(c.perCharge)}]),
  ].filter(item=>item.impact!=null && Math.abs(item.impact)>=.005).sort((a,b)=>Math.abs(b.impact!)-Math.abs(a.impact!)).slice(0,3);
  const parity=basis.proxy!=null && r.sessions>0?(basis.proxy*r.sessions-(r.annualCost-r.costs.property))/(lease?12:(1+v.closing/100)*r.recovery):null;
  const presets:Partial<Record<LedgerKey,[string,number][]>>={
    price:[["Starting price",basis.inputs.price],["−10%",basis.inputs.price*.9],["−20%",basis.inputs.price*.8]],
    upgrade:basis.inputs.upgrade?[["Base",basis.inputs.upgrade],["−50%",basis.inputs.upgrade*.5],["+50%",basis.inputs.upgrade*1.5]]:[["Base",0],["$100k",100000],["$250k",250000]],
    unitBuild:[["Base",basis.inputs.unitBuild],["+10%",basis.inputs.unitBuild*1.1]],
    conversion:[["As modeled",basis.inputs.conversion],["+$100k",basis.inputs.conversion+100000]],
    cash:[[basis.withheldOperatingCash!=null?"Source cash":"Starting cash",availableCash],...(availableCash>0?[["Half",availableCash/2],["None",0]] as [string,number][]:[])],
    displaced:testedCash>0?[["No loss",0],["Lose 25%",testedCash*.25],["Lose all",testedCash]]:[["No loss",0],["$10k/year",10000]],
  };
  const captions:Partial<Record<LedgerKey,string>>={closing:"Closing",years:"Term",rate:"Capital rate",perPost:"Stalls per post",ports:"Stalls / charger",insurance:"Insurance / yr",perCharger:"Upkeep / charger"};
  function control(k:LedgerKey,primary:boolean){
    const label=k==="price"?(lease?"Monthly rent ($)":"Purchase price ($)"):k==="cash"?"Business cash before displacement ($/year)":ledgerFields[k];
    const unit=k==="years"?"years":["closing","rate","tax"].includes(k)?"percent":["stalls","ports","perPost"].includes(k)?"count":"money";
    const scale=primary?{base:k==="cash"?availableCash:k==="displaced"?testedCash || basis.inputs.displaced:basis.inputs[k],
      fallback:k==="tax"?5:k==="conversion" || k==="upgrade"?250000:100000,negative:k==="cash",factor:k==="displaced"?1:k==="price"?1.5:2,limit:unit==="percent"?100:1e10}:undefined;
    return <div className={primary?"ledger-control":"ledger-secondary"} key={k}><LedgerNumber label={label} caption={primary?undefined:captions[k]} unit={unit} scale={scale} value={v[k]} valid={n=>validChange(k,n)} onValue={n=>change(k,n)}/>
      {presets[k] && <div className="ledger-presets" role="group" aria-label={label+" scenarios"}>
        {presets[k]!.map(([title,n])=>{const amount=Math.round(n*100)/100;
          const impact=diff(screenLedger(basis,{...changes,[k]:amount}).perCharge);
          return <button key={title} type="button" className="paper-btn" aria-pressed={Math.abs(v[k]-amount)<1e-7 && !(basis.withheldOperatingCash!=null && k==="displaced" && changes.displaced==null)} onClick={()=>change(k,amount)}>{title}{impact!=null && impact!==0 && <small>{delta(impact)}/charge</small>}</button>;})}</div>}
    </div>;
  }
  const linesByPriority=(["property","upgrade","construction","conversion","cash","displaced","staffing","upkeep","tax"] as const).flatMap(key=>lines.filter(l=>l.key===key));
  return <div className="screen-ledger">
    <div className="screen-result" aria-live="polite"><div><span>{initial?"Saved alternative":custom?"Site trial":"Starting estimate"} · {v.stalls} operating stalls</span>
      <strong>{priced?amounts(r.perCharge,2):"No completed charges"}{priced && <small> / charge</small>}</strong></div>
      <p>{amounts(r.annualCost)} annual net cost ÷ {count(r.sessions)} annual charges{priced && base.perCharge!=null && custom?" · "+delta(displayedPriceDelta(r.perCharge!,base.perCharge))+" vs starting estimate":""}</p>
      <small>Electricity and utility demand charges excluded</small></div>
    {initial && !basis.siteDrivers && <p>Historical case · original utilization of {num(v.volume)}% of the workbook benchmark.</p>}
    <section className="layout-ledger" aria-label="Stall configuration"><h3>Stall configuration</h3>
      <p className="layout-legend">Cost per charge with an upfront utility upgrade of <b>{amounts(r.upgrade)}</b>{!initial && r.upgrade>0 && <> → <b>{amounts(higherUpgrades[index].upgrade)}</b> (+50%)</>}</p>
      <div className="layout-choices" style={{"--layout-columns":columns} as CSSProperties}>{bases.map((b,i)=>{
        const c=comparisons[i],higher=higherUpgrades[i],stalls=locals[i]?.stalls??b.inputs.stalls;
        const content=<><b className="layout-count">{stalls} {stalls===1?"stall":"stalls"}</b><span className="layout-name">{nameOf(b)}</span>
          <span className="layout-price">{c.perCharge==null?"Unpriced":amounts(c.perCharge,2)}{!initial && c.upgrade>0 && higher.perCharge!=null && <> → {amounts(higher.perCharge,2)}</>}</span></>;
        return bases.length===1?<div className="layout-only" key={i}>{content}</div>:
          <button type="button" className="paper-btn layout-choice" key={i} aria-pressed={index===i} onClick={()=>{setIndex(i);clearStatus();}}>{content}</button>;
      })}</div>
      {initial && !!currentParts?.length && <p><b>Included areas</b> · {currentParts.map(p=>p.area+" ("+p.stalls+")").join(" + ")}</p>}
      {currentParts?.length && basis.rightsByArea && v.stalls===layoutCount ? <p><b>Right to use</b> · {currentParts.reduce((n,p)=>n+(basis.rightsByArea?.[p.area]?p.stalls:0),0)} of {layoutCount} stalls have documented use and access.</p> : null}
      {basis.condition!==nameOf(basis) && <p>{basis.condition.slice(nameOf(basis).length+2)}</p>}
      {!!basis.parts?.length && !initial && <fieldset className="ledger-areas"><legend>Included areas</legend>{basis.parts.map(part=><label key={part.area}>
        <input type="checkbox" className="check" checked={!omitted.includes(part.area)} disabled={currentParts?.length===1 && !omitted.includes(part.area)} onChange={e=>{
          const next=e.target.checked?omitted.filter(a=>a!==part.area):[...omitted,part.area];
          setAreas(old=>({...old,[index]:next}));change("stalls",basis.parts!.reduce((n,p)=>n+(next.includes(p.area)?0:p.stalls),0));
        }}/>{part.area} · {part.stalls}</label>)}</fieldset>}
      <div className="ledger-control"><LedgerNumber label="Operating stalls" caption="Stalls" unit="count" scale={{base:Math.max(layoutCount,...bases.map(b=>b.inputs.stalls)),factor:1,fallback:12,limit:200}} value={v.stalls} valid={n=>validChange("stalls",n)} onValue={n=>change("stalls",n)}/>
        <div className="ledger-presets" role="group" aria-label="Stall count scenarios">
          {stallTrials.map(t=><button type="button" key={t.step} className="paper-btn" disabled={!t.valid} onClick={()=>change("stalls",t.stalls)}>{t.step<0?"−1 stall":"+1 stall"}{t.impact!=null && <small>{delta(t.impact)}/charge</small>}</button>)}
          <button type="button" className="paper-btn" onClick={()=>change("stalls",layoutCount)}>Restore {layoutCount} stalls</button></div></div>
      <p><b>{v.stalls===layoutCount?(basis.hypothetical?"Assumed layout":omitted.length?"Selected areas":"Assessed layout"):"Manual stall trial"}</b> · {v.stalls} × {num(r.perStall*v.volume/100)} charges per stall per year = {count(r.sessions)} annual charges.</p>
      <small>Same utilization per stall across layouts. Confirm circulation, aisle access and operating rights. {omitted.length>0 && "Selected areas retain the full site and conversion allowances."}</small>
    </section>
    {ranked.length>0 && <p className="screen-insight"><b>Largest tested change</b> · {ranked[0].label} · {ranked[0].test} · <b>{delta(ranked[0].impact!)}/charge</b></p>}
    <h3>Annual cost ledger</h3><p className="layer-meta">Drag to try a value. Click the amount to enter an exact figure, even outside the slider range. Upfront costs use {recovery}.</p>
    <div className="screen-table"><div className="screen-line screen-head"><span>Site driver</span><span>Annual cost</span><span>$/charge</span></div>
      {linesByPriority.map(line=>{const impact=diff(screenLedger(basis,{...changes,...line.test}).perCharge);
        const secondary=line.fields.slice(1).filter(k=>line.key!=="construction" || lease || (k!=="years" && k!=="rate"));
        return <section key={line.key} aria-label={line.label} className="screen-item"><div className="screen-line"><div><b>{line.label}</b><small>{source(line)}{line.fields.some(k=>changes[k]!=null)?" · trial override":""}</small></div>
          <span>{amounts(r.costs[line.key])}</span><b>{priced?amounts(r.costs[line.key]/r.sessions,2):"—"}</b></div>
          <p className="ledger-math">{line.fact}</p>
          {line.key==="cash" && basis.withheldOperatingCash!=null && <p>The source carries {amounts(basis.withheldOperatingCash)}/year before conversion. Entering a loss tests how much of that cash survives.</p>}
          {line.key==="property" && basis.source?.startsWith("https://") && <a className="text-link" href={basis.source} target="_blank" rel="noopener noreferrer">Property source ↗</a>}
          {line.key==="displaced" && pendingCash && <p>The starting estimate credits $0 of the {amounts(availableCash)} in annual source cash. Choose a loss to credit the remaining earnings.</p>}
          {control(line.fields[0],true)}
          {secondary.length>0 && <div className="ledger-terms">{secondary.map(k=>control(k,false))}</div>}
          {impact!=null && (!presets[line.fields[0]] || (line.key==="displaced" && pendingCash)) && <small>{line.testLabel} · {delta(impact)}/charge</small>}
          {line.key==="property" && parity!=null && <p className="ledger-parity">{parity<0?"Site costs exceed the benchmark even with free property.":(lease?"Rent":"Price")+" at depot parity: "+amounts(parity)+" ("+amounts(basis.proxy!,2)+"/charge)"}</p>}
          {line.key==="displaced" && <p><b>{amounts(netCash)}</b> net annual business cash credited after displacement.</p>}
        </section>;})}
      <div className="screen-line screen-total"><b>Net site cost</b><b>{amounts(r.annualCost)}</b><b>{priced?amounts(r.perCharge,2):"—"}</b></div></div>
    <small>Rows round separately. Shared management overhead and one-time business interruption are outside this screen.</small>
    {ranked.length>0 && <section><h3>Largest changes in the tested assumptions</h3>
      <ol className="screen-checks">{ranked.map((s,i)=><li key={i}><b>{s.label}</b> · {s.test} · {delta(s.impact!)}/charge</li>)}</ol></section>}
    <h3>What needs verification?</h3>
    <p>Confirm the selected areas can operate together, get a utility quote for the {amounts(v.upgrade)} allowance and price the conversion work.{!lease && " Check retained business earnings and the cash lost when each area changes use."}</p>

    {(custom || initial || index!==initialIndex) && <button className="text-link" type="button" onClick={()=>{setIndex(initialIndex);setAreas({[initialIndex]:excluded});setCommon(selectFields(start,false));setLocals({[initialIndex]:selectFields(start,true)});clearStatus();}}>Reset to starting estimate</button>}
    {saveContext?.canWrite && !initial && priced && custom && <form className="screen-save" onSubmit={save}><label>Alternative name<input className="field" required maxLength={80} value={name} onChange={e=>{setName(e.target.value);setSaved(null);}}/></label>
      <button type="submit" className="paper-btn" disabled={saving||!!saved||!name.trim()}>{saving?"Saving…":"Save screening alternative"}</button></form>}
    <p role="status">{status}{saved && <> <a className="text-link" href={savedLink(saved.id)}>Reopen saved ledger</a></>}</p>
  </div>;
}
