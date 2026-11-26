"use client";
import { useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { DealProps } from "@/lib/types";
import { comparisonPower } from "@/lib/mapPower";
import type { PowerRecords } from "@/lib/powerLinkIndex";
import { useSearchParams } from "next/navigation";
import { originalScenario, amount, financialEvidence, layoutName, purchaseCase, purchaseCheck, purchaseConstraints, type PurchaseScenario } from "@/lib/purchaseReview";
import { usePurchaseScenario } from "./PurchaseScenarios";
import FinancialsEntry, { type usePnlTiles } from "./FinancialsEntry";
import { ChargingSiteSection } from "./ChargingEconomics";
import SelectionResearch from "./SelectionResearch";
import FinancialsPanel from "./FinancialsPanel";
import ComparisonEvidence from "./actions/ComparisonEvidence";
import { useActionStatus } from "./actions/panel";

function Ledger({rows}:{rows:[string,ReactNode][]}) {
  return <dl className="purchase-ledger">{rows.map(([name,value])=><div key={name}><dt>{name}</dt><dd>{value}</dd></div>)}</dl>;
}
const percent = (n:number|null|undefined) => n==null ? "—" : (n*100).toLocaleString("en-US",{maximumFractionDigits:2})+"%";
export default function PurchaseReview({deal,pnl,power}:{deal:DealProps;pnl:ReturnType<typeof usePnlTiles>;power?:PowerRecords}) {
  const selected = usePurchaseScenario(deal);
  const baseline = useSearchParams().get("caseView") === "baseline";
  const [inspection,setInspection] = useState(originalScenario);
  const scenario = baseline ? inspection : selected.scenario;
  const update = baseline ? setInspection : selected.update;
  const [checklist,setChecklist]=useState(false);
  const [gap,setGap]=useState(false);
  const [invalid,setInvalid]=useState("");
  const trigger=useRef<HTMLButtonElement>(null);
  const access=useActionStatus();
  const data=deal.purchase, w=data?.inputs, a=data?.assumptions;
  const result=data && purchaseCase(data,scenario);
  const isRecast=scenario.basis==="normalized";
  const linePeriod=w?.periods?.[isRecast?"normalized":"ebitda"] || "Period unconfirmed";
  const evidence=financialEvidence(deal);
  const claim=w?.claim ?? deal.stated_cash_flow;
  const claimLabel=w?.claimLabel || deal.cash_flow_label || "Reported earnings";
  const annual=result?.cash;
  const standaloneEarnings = w?.normalized ?? w?.ebitda;
  const earningsLabel = w?.normalized!=null ? "Normalized EBITDA" : "Workbook EBITDA";
  const revenue = w?.revenue ?? deal.stated_revenue;
  const ask = deal.asking_price ?? w?.ask;
  const leadLabel = annual!=null ? "Retained annual cash" : claim!=null ? claimLabel : standaloneEarnings!=null ? earningsLabel : revenue!=null ? "Reported revenue" : ask!=null ? "Asking price" : "Operating cash";
  const leadNote = annual!=null ? [scenario.basis==="normalized" ? "Normalized EBITDA" : "Workbook EBITDA", linePeriod, "modeled per year"] :
    claim!=null ? [deal.earnings_period || "Period unconfirmed", deal.earnings_basis || w?.status || "Source basis unconfirmed"] :
    standaloneEarnings!=null ? [w?.periods?.[w?.normalized!=null?"normalized":"ebitda"] || "Period unconfirmed","Annual cash calculation pending"] :
    revenue!=null ? [w?.periods?.revenue || deal.revenue_period || "Period unconfirmed", deal.revenue_basis || "Revenue only"] : ["Annual operating cash pending"];
  const layout=layoutName(deal,scenario);
  const { service,frontage } = comparisonPower(power ? power.deal : deal,power?.site);
  const changed=layout==="Footprint changed";
  const hasStatement=pnl.statement?.status==="ready";
  const basisLabel=isRecast ? "Normalized EBITDA" : "Workbook EBITDA";
  function changeAmount(k:"lostCash"|"upgrade"|"downtime",raw:string) {
    const n=Number(raw);
    if (!Number.isFinite(n) || n<0 || n>99999999999 || (k==="downtime" && n>12)) {setInvalid("Enter a nonnegative amount and keep interruption within 12 months.");return;}
    setInvalid(""); update({...scenario,[k]:Math.round(n*100)/100});
  }
  function switchCase(next:Partial<PurchaseScenario>) {update({...scenario,...next});}
  function closeChecklist(){setChecklist(false);requestAnimationFrame(()=>trigger.current?.focus());}
  if (evidence==="Not applicable") return <>{deal.charging && <ChargingSiteSection deal={deal}/>}<p>Operating financials are not applicable to this site.</p></>;
  const withheld=evidence==="Withheld" || /refus|unavailable/i.test(w?.package || deal.package_status || "");
  const constraints = purchaseConstraints(deal);
  const sources = (pnl.panel?.figures || []).filter(f=>{
    if (!result || result.ebitda==null || ![f.figure,f.metric].some(v=>v?.trim().toLowerCase()===(isRecast?"normalized ebitda":"ebitda"))) return false;
    const raw = f.text.trim();
    if (!/^(?:-?\$?[\d,]+(?:\.\d+)?|\(\$?[\d,]+(?:\.\d+)?\))$/.test(raw)) return false;
    const n = Number(raw.replace(/[$,()]/g,"")) * (raw.startsWith("(")?-1:1);
    return Math.abs(n-result.ebitda)<1 && (!w?.periods?.[isRecast?"normalized":"ebitda"] ||
      [f.period,f.periodLabel].includes(linePeriod));
  });
  const source=sources.length===1?sources[0]:null;
  const check=changed ? "Review the changed footprint" : purchaseCheck(deal);
  return <section className="purchase-review" aria-label="Purchase support" data-testid="purchase-review">
    {deal.charging && <ChargingSiteSection deal={deal}/>}
    <div className="purchase-summary">
    <header><p className="eyebrow">Site financials</p><h3>Can the business carry the purchase?</h3>
      <p className="purchase-basis">{evidence}{w?.checked && " · Checked "+w.checked}</p></header>
    <article className="purchase-lead">
      <span>{leadLabel}</span>{baseline && <small>Workbook baseline inspection</small>}
      <strong>{amount(annual ?? claim ?? standaloneEarnings ?? revenue ?? ask)}</strong>
      <small>{leadNote.join(" · ")}</small>
      {source?.sourceHref && <a className="text-link" href={source.sourceHref} target="_blank" rel="noreferrer">Open earnings source ↗</a>}
    </article>
    {annual!=null && result?.charge!=null && <div className="purchase-funding" aria-label="Annual purchase coverage">
      <div><span>Annual charge at ask</span><b>{amount(result.charge)}</b></div>
      <div><span>{result.gap==null ? "Annual balance" : result.gap<0 ? "Annual shortfall" : "Annual surplus"}</span><b>{amount(result.gap==null?null:Math.abs(result.gap))}</b></div>
      {result.charge>0 && <p><span className="purchase-meter" aria-hidden="true"><i style={{width:Math.max(0,Math.min(100,100*annual/result.charge))+"%"}}/></span>
        {percent(annual/result.charge)} of the asking-price charge covered by operating cash</p>}
    </div>}
    <div className="purchase-check"><b>{check}</b><p>{w?.normalized!=null && w.normalized!==w.ebitda ? "Compare the workbook input and the normalized recast. Check the period and lease obligations for the purchase." :
      withheld ? "View the existing request or refusal before another follow-up." : w?.fit===0 ? "The recorded layout fits zero stalls. Review an alternative footprint before using the network ceiling." :
      result?.cash==null ? "Open the available evidence and identify a full operating period." : "Confirm that the income, occupancy costs and available space belong to the same purchase setup."}</p>{constraints.length>0 && <ul>{constraints.map(c=><li key={c}>{c}</li>)}</ul>}</div>
    </div>
    {deal.selectionResearch && <SelectionResearch row={deal.selectionResearch}/>}
    {data && w && a && result && <>
      <h4>Cash from operations</h4>
      {w.normalized!=null && <div className="segmented" role="group" aria-label="Earnings basis">{(["workbook","normalized"] as const).map(b=><button type="button" key={b} aria-pressed={b===scenario.basis} className={b===scenario.basis?"segmented on":"segmented"} onClick={()=>switchCase({basis:b})}>{b==="workbook"?"Workbook input":"Normalized recast"}</button>)}</div>}
      <Ledger rows={[[basisLabel,amount(result.ebitda)],["Annual revenue"+(result.inferredRevenue?" · inferred from margin":""),amount(result.revenue)],
        ["Upkeep reserve · "+percent(a.upkeep),amount(result.upkeep==null?null:-result.upkeep)],["Moove oversight",amount(a.oversight==null?null:-a.oversight)],
        ...(scenario.lostCash?[["Displaced operating contribution",amount(-scenario.lostCash)] as [string,string]]:[]),["Retained per year",amount(result.cash)]]}/>
      {source && (source.sourceName || source.sourceHref) && <p className="layer-meta">{source.sourceHref
        ? <a className="text-link" href={source.sourceHref} target="_blank" rel="noreferrer">{source.sourceName || "Open earnings source"} ↗</a>
        : source.sourceName}{source.page && " · "+source.page}</p>}
      {!result.open && <p>Workbook setup closes the business. Its retained operating cash is zero.</p>}
      {w.textInputs.length>0 && <p className="layer-meta">Some worksheet amounts are stored as text. The workbook case preserves its published outputs.</p>}
      <h4>Purchase at the asking price</h4>
      <Ledger rows={[["Asking price used in workbook",amount(w.ask)],["Annual capital charge",amount(w.charge)],...(scenario.upgrade?[["Incremental upgrade charge",amount(result.extraAnnual)] as [string,string]]:[]),["Modeled annual surplus or shortfall",amount(result.gap)],
        ["EBITDA needed at ask for target saving",amount(w.required)]]}/>
      <p className="layer-meta">The capital charge uses {percent(a.closing)} closing costs and {percent(a.capital)} cost of capital. Operating and purchase scopes require review.</p>
      <details className="disclosure"><summary className="disclosure">Price support and network assumptions</summary>
        <Ledger rows={[["Price supported by business cash alone",amount(result.cashPrice)],["Workbook filed ceiling",amount(result.ceiling)],
          ["Alternative · "+percent(a.lower)+" saving",amount(result.lower)],["Breakeven with hub",amount(result.breakeven)],["Land-value constraint",amount(w.landCap)],
          ["Land-constrained target",w.landCap==null?"Land-value check pending":amount(result.walkAway)],["Screening price",amount(w.screeningPrice)],
          ["Annual land cost the network can carry",amount(w.allowance)],["Workbook layout",w.archetype || "Default setup"],["Recorded stalls that fit",w.fit??"Unconfirmed"]]}/>
        <p className="layer-meta">Screening estimates use the workbook’s network and staffing setup. A footprint change needs a fresh stall count and utility-cost check.</p>
      </details>
      <details className="disclosure"><summary className="disclosure">Test a layout or operating change</summary>
        {data.layout && <a href={"/?spaces=1&spaceSite="+encodeURIComponent(deal.deal_id)} className="text-link">Inspect footprints on the main map</a>}
        <label>Assessed footprint<select className="secondary" value={scenario.layout} onChange={e=>switchCase({layout:e.target.value})}>
          <option value="">Workbook setup</option>{changed && <option value={scenario.layout}>Footprint changed</option>}
          {data.layout?.zones.map((z,i)=><option key={i} value={data.layout!.revision+"."+i}>{z}</option>)}</select></label>
        {([["lostCash","Annual contribution displaced ($)"],["upgrade","Additional one-time power upgrade ($)"],["downtime","Months of lost contribution in year one"]] as const).map(([key,label])=><label key={key}>{label}<input className="field" type="number" min="0" max={key==="downtime"?12:99999999999} step="0.01" value={scenario[key]} onChange={e=>changeAmount(key,e.target.value)}/></label>)}
        {invalid && <p role="alert">{invalid}</p>}
        <Ledger rows={[["Year-one retained cash",amount(result.firstYear)],["Incremental annual capital charge on upgrade",amount(result.extraAnnual)]]}/>
        <p className="layer-meta">The upgrade is incremental to the workbook. Interruption reduces year-one cash only. The price ceilings use recurring annual cash. Compare can save this scenario with a decision.</p>
      </details>
    </>}
    <h4>Statements and evidence</h4>
    {pnl.failed || pnl.statement?.status==="unavailable" ? <p role="status">Couldn’t load the statement. <button type="button" className="text-link" onClick={pnl.retry}>Retry</button></p> :
      hasStatement ? <FinancialsEntry dealId={deal.deal_id} loaded={pnl}/> : <p>{!pnl.settled?"Checking statements…":/receiv|partial/i.test(w?.package || deal.package_status || "")?"Package recorded. No statement lines available.":"No statement lines on file."}</p>}
    {claim!=null && <Ledger rows={[[claimLabel,amount(claim)],["Earnings evidence",[deal.earnings_period,deal.earnings_basis,deal.figures_source].filter(Boolean).join(" · ") || "Source not recorded"]]}/>}
    <div className="purchase-actions">
      {pnl.panel?.open && <button ref={trigger} type="button" className="paper-btn" onClick={()=>setChecklist(true)}>Figures, sources and package checklist</button>}
      {pnl.panel?.packageHref && <a className="text-link" href={pnl.panel.packageHref} target="_blank" rel="noreferrer">Open package ↗</a>}
      {access.enabled && !withheld && !hasStatement && deal.stage_group!=="dropped" && <button type="button" className="text-link" onClick={()=>setGap(true)}>Check earnings follow-up</button>}
    </div>
    <details className="disclosure"><summary className="disclosure">Durability and site fit</summary>
      <Ledger rows={[["Car count · latest / prior",[w?.cars,w?.priorCars].map(v=>v?.toLocaleString()??"—").join(" / ")],["Prior annual revenue",amount(w?.priorRevenue)],["Membership share",percent(w?.memberShare)],
        ["Nearby washes within 1 mile",deal.trade_washes_1mi??"Unknown"],["Road traffic · vehicles per day",deal.trade_aadt?.toLocaleString()??"Unknown"],["On-site electrical service",service ? [service.value,service.source].filter(Boolean).join(" · ") : "Unconfirmed"],
        ["Street-frontage hosting",frontage ? [frontage.value,frontage.source].filter(Boolean).join(" · ") : "Unconfirmed"],
        ["Assessed layout",deal.screening?.fit || "Unassessed"],["Earlier workbook stalls",w?.fit??deal.bays_that_fit??"Unknown"],["Selected footprint",layout]]}/>
      <p>Check peak demand, power upgrade timing and any loss of operating space for this footprint.</p>
    </details>
    {checklist && pnl.panel && createPortal(<FinancialsPanel dealId={deal.deal_id} initial={pnl.panel} onClose={closeChecklist}/>,document.body)}
    {gap && <ComparisonEvidence target={{targetKind:"deal",targetId:deal.deal_id,measure:"ebitda",period:deal.earnings_period || "",basis:deal.earnings_basis || ""}}
      title={deal.name || deal.deal_id} context="Annual earnings" close={()=>setGap(false)} saved={()=>{}} inspect={note=>{
        const q=new URL(window.location.href);q.searchParams.set("panel","discussion");q.searchParams.set("note",note);window.location.assign(q.href);
      }}/>}
  </section>;
}
