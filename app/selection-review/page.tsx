"use client";
import { amounts } from "@/lib/charging/model";
import { marketSequence,diligenceOrder,incompatibleMarkets } from "@/lib/charging/merit";
import { filedScreenLabel } from "@/lib/charging/summary";
import { useSearchParams } from "next/navigation";
import { reviewLink, reviewReturn, setReviewFilter, rememberReviewPosition, restoreReviewPosition } from "@/lib/reviewNavigation";
import { Suspense, useEffect, useRef, useState } from "react";
import SelectionResearch from "@/components/SelectionResearch";
import type { SelectionRow } from "@/lib/selection/screen";

type Result = { rows: SelectionRow[]; mismatches: number; hasInputs: boolean };

export default function SelectionReview() {
  return <Suspense fallback={<main>Loading selection review…</main>}><SelectionList /></Suspense>;
}

function SelectionList() {
  const [data,setData] = useState<Result | null>(null);
  const [error,setError] = useState(false);
  const [attempt,setAttempt] = useState(0);
  const params=useSearchParams();
  const market=params.get("market") || "", check=params.get("check") || "", query=params.get("q") || "";
  const pane=useRef<HTMLElement>(null);
  const back=reviewReturn(params.get("returnTo"),["/"]);
  const origin="/selection-review?" + params;
  const scope=params.has("scope") ? new Map(params.get("scope")?.split("|").map((id,i)=>[id,i])) : null;
  useEffect(()=>{if(data) restoreReviewPosition(pane.current);},[data]);
  useEffect(() => {
    const controller = new AbortController();
    setError(false);
    fetch("/api/data/selection-review",{cache:"no-store",signal:controller.signal})
      .then(async response => { if (!response.ok) throw Error(); return response.json(); })
      .then(value => { if (!controller.signal.aborted) setData(value); })
      .catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  },[attempt]);
  const rows = data?.rows || [];
  const candidates=rows.map(r=>({id:r.id,city:r.city,merit:r.charging?.merit}));
  const sequence=marketSequence(candidates);
  const incompatible=[...incompatibleMarkets(candidates)].filter(c=>!market || market===c);
  const investment=params.get("sort")==="investment";
  const scoped = rows.filter(r => (!investment || sequence.has(r.id)) && (!scope || scope.has(r.id)) && (!market || r.city === market) && (!check || r.priority === check) &&
    (!params.get("stalls") || r.charging?.screen.some(c=>c.stalls===Number(params.get("stalls")) && c.downside>=0)) &&
    (!params.get("charging") || r.charging?.merit.action===params.get("charging")) &&
    [r.name,r.city,r.id].join(" ").toLowerCase().includes(query.trim().toLowerCase())).sort((a,b)=>investment ? a.city.localeCompare(b.city) || sequence.get(a.id)!.rank-sequence.get(b.id)!.rank : (params.get("sort")==="earlier" ? (b.charging?.result.earlyMin??-1)-(a.charging?.result.earlyMin??-1) : scope ? scope.get(a.id)!-scope.get(b.id)! : diligenceOrder(a.charging?.merit,b.charging?.merit)) || a.city.localeCompare(b.city) || a.name.localeCompare(b.name));
  return <main ref={pane} className="space-review-page">
    <a className="text-link" href={back}>← Pipeline list</a>
    <h1>Selection review</h1><p>Choose the next diligence check. Investment approval requires verified site rights, usable space, power, retained cash flow and network benefit.</p>
    <div className="space-review-filters">
      <label>Market<select aria-label="Market" className="secondary" value={market} onChange={e=>setReviewFilter("market",e.target.value)}><option value="">All markets</option>{[...new Set(rows.map(r=>r.city))].sort().map(c=><option key={c}>{c}</option>)}</select></label>
      <label>Next check<select aria-label="Next check" className="secondary" value={check} onChange={e=>setReviewFilter("check",e.target.value)}><option value="">All checks</option>{[...new Set(rows.map(r=>r.priority))].sort().map(c=><option key={c}>{c}</option>)}</select></label>
      <label>Charging decision<select className="secondary" value={params.get("charging")||""} onChange={e=>setReviewFilter("charging",e.target.value)}>
        <option value="">All decisions</option>{[...new Set(rows.flatMap(r=>r.charging?[r.charging.merit.action]:[]))].sort().map(s=><option key={s}>{s}</option>)}</select></label>
      <label>Moove-staffed downside at parity<select className="secondary" value={params.get("stalls")||""} onChange={e=>setReviewFilter("stalls",e.target.value)}><option value="">Any stall count</option>{[4,6,8,10].map(n=><option value={n} key={n}>{n} hypothetical stalls</option>)}</select></label>
      <label>Order<select aria-label="Order" className="secondary" value={params.get("sort")||""} onChange={e=>setReviewFilter("sort",e.target.value)}><option value="">{scope?"Shortlist order":"Next diligence action"}</option>{rows.some(r=>r.financeVisible) && <option value="investment">Investment sequence by market</option>}<option value="earlier">Earlier usable charges</option></select></label>
      <label>Find a site<input className="field" value={query} onChange={e=>setReviewFilter("q",e.target.value)} placeholder="Name or site ID" /></label>
    </div>
    {investment && <p>Each market starts with fleet demand after existing commitments. Each ranked site uses part of its dispatch pool. Values and peak charges show the contribution remaining at that position.</p>}
    {investment && incompatible.length>0 && <p role="status">Align the valuation date, horizon, discount rate and energy per charge before ranking {incompatible.join(", ")}.</p>}
    {scope && <button type="button" className="text-link" onClick={()=>setReviewFilter("scope","")}>Show all active sites</button>}
    {!data && !error && <p role="status">Loading pipeline…</p>}
    {error && <p role="alert">Pipeline could not be loaded. <button className="text-link" onClick={()=>setAttempt(a=>a+1)}>Retry</button></p>}
    {data && <><p aria-live="polite">{scoped.length} of {rows.length} active sites</p>
      {!data.hasInputs && <p>Workbook screen pending. Some unlocated sites use their dated assessment cohort.</p>}
      {data.hasInputs && <details className="disclosure"><summary className="disclosure">Data details{data.mismatches > 0 && " · Stage differences"}</summary><p>{data.mismatches} stage differences across the joined records. The application stage is shown when available.</p></details>}
      {!scoped.length && <p>{investment?"No current site case qualifies for investment ranking in this view.":"No sites match these filters."}</p>}
      <ul className="space-review-results">{scoped.map(r=><li id={r.id} tabIndex={-1} key={r.id} onClick={()=>rememberReviewPosition(pane.current,r.id)}><div>
        <small>{r.city} · {r.stage} · {r.section}</small><h2>{r.name}</h2><strong>{r.charging?.merit.action ?? r.priority}</strong><p>{r.charging?.merit.next ?? r.instruction}</p>{investment && <p>{r.city} #{sequence.get(r.id)!.rank} · {amounts(sequence.get(r.id)!.value)} incremental value · {sequence.get(r.id)!.peak} residual peak charges</p>}<small>{r.id}</small></div><div><strong>{r.readiness}</strong>
        {r.mirrorStage && r.stage !== r.mirrorStage && <p>Workbook stage: {r.mirrorStage}</p>}
        {r.financeVisible && <p>Workbook base savings: {r.amount === null ? "Unmodeled" : (r.amount*100).toFixed(1)+"%"}</p>}
        {r.charging && <div className="charging-preview"><strong>Charging · {r.charging.merit.action}</strong>
          <p>{r.charging.name} · {r.charging.result.siteCost==null?"Cost pending":"$"+r.charging.result.siteCost.toFixed(2)+"/charge"}</p><small>{r.charging.merit.netValue!=null?"Standalone downside network value "+amounts(r.charging.merit.netValue):"Investment rank pending"}</small>{!r.charging.selected && <p>{filedScreenLabel(r.charging.screen)}</p>}
          <a className="text-link" href={"/charging?site="+encodeURIComponent(r.id)}>Open charging case</a></div>}
        {r.research && <SelectionResearch row={r.research}/>}
        {r.mapped && <a href={reviewLink("/",{site:r.id,city:r.city,funnel:"pipeline",sheet:"full"},origin+"#"+r.id)}>Open site record</a>}
      <p>{r.geometry} · {r.option}</p>
        {r.quickLube && r.priority !== "Screen fleet service" && <p>Retained lifts and fleet-service rights also need a separate check.</p>}
        {r.assessed && <a href={reviewLink("/space-review",{site:r.id,panel:"space-options"},origin+"#"+r.id)}>Review layout evidence{r.evidenceDate && " · "+r.evidenceDate}</a>}
      </div></li>)}</ul></>}
  </main>;
}
