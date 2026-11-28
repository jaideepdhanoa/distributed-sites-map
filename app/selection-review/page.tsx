"use client";
import { dropReasons } from "@/lib/selection/dropReasons";
import { amounts } from "@/lib/charging/model";
import { marketSequence,diligenceOrder,incompatibleMarkets } from "@/lib/charging/merit";
import {ChargingLink} from "@/components/ChargingLink";
import { filedScreenLabel } from "@/lib/charging/summary";
import { useSearchParams } from "next/navigation";
import { reviewLink, reviewReturn, setReviewFilter, rememberReviewPosition, restoreReviewPosition } from "@/lib/reviewNavigation";
import { Suspense, useEffect, useRef, useState } from "react";
import ShortlistCard from "@/components/ShortlistCard";
import "./shortlist.css";
import OpportunityReview from "@/components/OpportunityReview";
import { pipelineTrack } from "@/lib/selection/pipelineTrack";
import { compareAttention, currentDisposition, dispositions, matchingOption, routes, type OpportunitySite, type FiledReview } from "@/lib/selection/opportunity";
import SelectionResearch from "@/components/SelectionResearch";
import type { SelectionRow } from "@/lib/selection/screen";

type Result = { rows: SelectionRow[]; mismatches: number; hasInputs: boolean; filed?: FiledReview[]; registerUrl?: string };

export default function SelectionReview() {
  return <Suspense fallback={<main>Loading selection review…</main>}><SelectionList /></Suspense>;
}

function SelectionList() {
  const [data,setData] = useState<Result | null>(null);
  const [error,setError] = useState(false);
  const [showFilters,setShowFilters] = useState(false);
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
  const serviceView = params.get("disposition") === "Service diligence";
  const explicitDecision=params.get("disposition");
  const explicitRoute=params.get("route");
  const rows=(data?.rows || []).filter(row=>{
    const category=row.pipelineTrack ?? pipelineTrack(row.review?.primary.disposition);
    if(category==="service" || serviceView) return serviceView && category==="service";
    return category==="charging" || Boolean(explicitDecision || explicitRoute);
  });
  const candidates=rows.map(r=>({id:r.id,city:r.city,merit:r.charging?.merit}));
  const sequence=marketSequence(candidates);
  const incompatible=[...incompatibleMarkets(candidates)].filter(c=>!market || market===c);
  const investment=params.get("sort")==="investment";
  const decision = currentDisposition(params.get("disposition") || "");
  const order = params.get("sort") || "attention";
  const hasReviews = Boolean(data?.registerUrl || data?.filed?.length || rows.some(r=>r.review));
  const route = params.get("route") || "";
  const reason = decision === "Dropped" ? params.get("reason") || "" : "";
  const evidenceFilter = params.get("evidence") || "";
  const coverageOptions = [...new Set(rows.flatMap(r => r.review?.coverage ? [r.review.coverage.countyStatus, r.review.coverage.spaceStatus, r.review.coverage.financeStatus] : []))].sort();
  const evidenceMatches = (review?: OpportunitySite) => !evidenceFilter || Boolean(review?.coverage && [review.coverage.countyStatus,review.coverage.spaceStatus,review.coverage.financeStatus].includes(evidenceFilter));
  const match = (review?:OpportunitySite) => matchingOption(review,decision,route,reason);
  const matchesDecision = (review?:OpportunitySite) => review ? Boolean(match(review)) : !route && (!decision || decision === "Unreviewed");
  const matchesPlace = (r:{id:string;city:string}, name:string) => (!scope || scope.has(r.id)) && (!market || r.city === market) && [name,r.city,r.id].join(" ").toLowerCase().includes(query.trim().toLowerCase());
  const filed = (data?.filed || []).filter(r => (r.review.primary.disposition === "Service diligence") === serviceView && evidenceMatches(r.review) && matchesPlace(r,r.review.name) && matchesDecision(r.review));
  const showFiled = !check && !params.get("stalls") && !params.get("charging") && !investment;
  const shortlist = decision === "Shortlist";
  const droppedView = decision === "Dropped";
  const scoped = rows.filter(r => evidenceMatches(r.review) && (!investment || sequence.has(r.id)) && matchesPlace(r,r.name + " " + (r.review?.name || "")) && matchesDecision(r.review) && (!check || r.priority === check) &&
    (!params.get("stalls") || r.charging?.screen.some(c=>c.stalls===Number(params.get("stalls")) && c.downside>=0)) &&
    (!params.get("charging") || r.charging?.merit.action===params.get("charging"))).sort((a,b)=>{
      if(investment)return a.city.localeCompare(b.city) || sequence.get(a.id)!.rank-sequence.get(b.id)!.rank;
      const priority = order === "attention" ? compareAttention(match(a.review),match(b.review)) :
        order === "earlier" ? (b.charging?.result.earlyMin??-1)-(a.charging?.result.earlyMin??-1) : 0;
      return priority || (scope && order !== "market" ? scope.get(a.id)! - scope.get(b.id)! : 0) || (order === "attention" ? diligenceOrder(a.charging?.merit,b.charging?.merit) : 0) || a.city.localeCompare(b.city) || a.name.localeCompare(b.name);
    });
  const droppedCount = scoped.length + (showFiled ? filed.length : 0);
  const guidance = <>
    {data?.registerUrl && <p><a className="text-link" href={data.registerUrl} target="_blank" rel="noreferrer">Open the team’s review register</a> to file new evidence, assign the next check or revise a decision.</p>}
    {scoped.some(r => r.review && match(r.review)?.disposition === "Shortlist") &&
      <details className="disclosure"><summary className="disclosure">How to decide on visits, utility studies and offers</summary>
        <ol>
          <li><b>Prepare in parallel.</b> Confirm seller access and the offered parcel, sketch the controlled footprint, request operating evidence and prepare the utility load brief. Compare completed peak sessions with the local alternative.</li>
          <li><b>Review the visit.</b> Agree who will attend and what measurement or observation could change the decision. Record access and a busy-hour window before booking.</li>
          <li><b>Scope the power study.</b> Ask for available service after existing load, managed and full loads, upgrade cost split, tariff and earliest and latest energization. Record the utility reference and estimate basis. Review owner consent, study fees and deposits before authorizing formal design.</li>
          <li><b>Review an indicative LOI.</b> Set a price range, expiry, evidence access and conditions for footprint, utility, retained cash and timing. Obtain commercial and legal review before sending. An early indication to unlock documents should state the unresolved assumptions.</li>
          <li><b>Approve firm terms.</b> Compare base and joint downside to the local cost for the same service. Include peak demand, opening delay, peak funding and independent property support. Submit the supported price and open conditions to the investment approver.</li>
        </ol>
      </details>}
  </>;
  const dataDetails = data?.hasInputs && <details className="disclosure"><summary className="disclosure">Data details{data.mismatches > 0 && " · Stage differences"}</summary><p>{data.mismatches} stage differences across the joined records. The application stage is shown when available.</p></details>;
  return <main ref={pane} className={shortlist ? "space-review-page shortlist-page" : "space-review-page"}>
    <a className="text-link" href={back}>← Pipeline list</a>
    {shortlist ? <header className="shortlist-intro"><h1>Acquisition shortlist</h1>
      <p>Priority diligence uses a drawn layout of at least four stalls, comparable costs or documented break-even terms, and a check that can change the decision. There is no fixed shortlist size.</p>
      <a className="text-link" href="/?review=1&qmarket=all&qstage=any&qapprove=1">Open items needing my approval →</a>
      <small>The Review inbox also includes changes and requests across the wider pipeline.</small>
    </header> : <><h1>Selection review</h1><p>Choose the next diligence check. Investment approval requires verified site rights, usable space, power, retained cash flow and network benefit.</p></>}
    {!shortlist && guidance}
    {shortlist && <button type="button" className="paper-btn shortlist-filter-toggle" aria-controls="selection-filters" aria-expanded={showFilters} onClick={()=>setShowFilters(!showFilters)}>
      {showFilters ? "Hide filters" : "Filter shortlist"}{market && " · "+market}{query && " · "+query}
    </button>}
    <div id="selection-filters" hidden={shortlist && !showFilters}>
    <div className="space-review-filters">
      {hasReviews && <label>Commercial decision<select className="secondary" value={decision} onChange={e=>setReviewFilter("disposition",e.target.value)}>
        <option value="">Current opportunities</option>{[...dispositions,"Unreviewed"].map(d=><option key={d}>{d}</option>)}</select></label>}
      {droppedView && <label>Drop reason<select aria-label="Drop reason" className="secondary" value={reason} onChange={e=>setReviewFilter("reason",e.target.value)}>
        <option value="">All drop reasons</option>{dropReasons.map(r=><option key={r.code}>{r.label}</option>)}</select></label>}
      <label>Market<select aria-label="Market" className="secondary" value={market} onChange={e=>setReviewFilter("market",e.target.value)}><option value="">All markets</option>{[...new Set([...rows, ...(data?.filed || [])].map(r=>r.city))].sort().map(c=><option key={c}>{c}</option>)}</select></label>
      {coverageOptions.length > 0 && <label>Evidence status<select className="secondary" value={evidenceFilter} onChange={e=>setReviewFilter("evidence",e.target.value)}>
        <option value="">All evidence</option>{coverageOptions.map(value=><option key={value}>{value}</option>)}</select></label>}
      <label>Find a site<input className="field" value={query} onChange={e=>setReviewFilter("q",e.target.value)} placeholder="Name or site ID" /></label>
    </div>
    <details className="disclosure" open={(!hasReviews || Boolean(check || route || params.get("stalls") || params.get("charging") || params.get("sort"))) || undefined}>
      <summary className="disclosure">Route, charging and screening filters</summary>
      <div className="space-review-filters">
      {hasReviews && <label>Transaction route<select className="secondary" value={route} onChange={e=>setReviewFilter("route",e.target.value)}>
        <option value="">All routes</option>{routes.map(r=><option key={r}>{r}</option>)}</select></label>}
      <label>Screening check<select aria-label="Next check" className="secondary" value={check} onChange={e=>setReviewFilter("check",e.target.value)}><option value="">All checks</option>{[...new Set(rows.map(r=>r.priority))].sort().map(c=><option key={c}>{c}</option>)}</select></label>
      <label>Charging decision<select className="secondary" value={params.get("charging")||""} onChange={e=>setReviewFilter("charging",e.target.value)}>
        <option value="">All decisions</option>{[...new Set(rows.flatMap(r=>r.charging?[r.charging.merit.action]:[]))].sort().map(s=><option key={s}>{s}</option>)}</select></label>
      <label>Moove-staffed downside at parity<select className="secondary" value={params.get("stalls")||""} onChange={e=>setReviewFilter("stalls",e.target.value)}><option value="">Any stall count</option>{[4,6,8,10].map(n=><option value={n} key={n}>{n} hypothetical stalls</option>)}</select></label>
      <label>Order<select aria-label="Order" className="secondary" value={params.get("sort")||""} onChange={e=>setReviewFilter("sort",e.target.value)}><option value="">Diligence priority</option>{rows.some(r=>r.financeVisible) && <option value="investment">Investment sequence by market</option>}<option value="market">Market and site</option><option value="earlier">Earlier usable charges</option></select></label>
      </div>
    </details>
    </div>
    {investment && <p>Each market starts with fleet demand after existing commitments. Each ranked site uses part of its dispatch pool. Values and peak charges show the contribution remaining at that position.</p>}
    {investment && incompatible.length>0 && <p role="status">Align the valuation date, horizon, discount rate and energy per charge before ranking {incompatible.join(", ")}.</p>}
    {scope && <p className="inherited-scope">Limited to the sites from your pipeline list. <button type="button" className="text-link" onClick={()=>setReviewFilter("scope","")}>Show all active sites</button></p>}
    {!data && !error && <p role="status">Loading pipeline…</p>}
    {error && <p role="alert">Pipeline could not be loaded. <button className="text-link" onClick={()=>setAttempt(a=>a+1)}>Retry</button></p>}
    {data && <><p aria-live="polite">{droppedView ? `${droppedCount} ${droppedCount === 1 ? "site" : "sites"} with a dropped opportunity` : shortlist ? scoped.length+" shortlisted · "+rows.length+" active pipeline sites" : serviceView ? `${scoped.length} parked service opportunities` : `${scoped.length} of ${rows.length} active sites`}</p>
      {!data.hasInputs && <p>Workbook screen pending. Some unlocated sites use their dated assessment cohort.</p>}
      {!shortlist && dataDetails}
      {!scoped.length && !(droppedView && showFiled && filed.length) && <p>{investment?"No current site case qualifies for investment ranking in this view.":"No sites match these filters."}</p>}
      <ul className={shortlist ? "shortlist-results" : "space-review-results"}>{scoped.map(r=>{
        const selected = match(r.review);
        if (shortlist && selected && r.review) return <li id={r.id} key={r.id} tabIndex={-1} onClick={()=>rememberReviewPosition(pane.current,r.id)}>
          <ShortlistCard row={r} review={r.review} option={selected} origin={origin+"#"+r.id}/>
          {investment && <p>{r.city} #{sequence.get(r.id)!.rank} · {amounts(sequence.get(r.id)!.value)} incremental value · {sequence.get(r.id)!.peak} residual peak charges</p>}
        </li>;
        return <li id={r.id} tabIndex={-1} key={r.id} onClick={()=>rememberReviewPosition(pane.current,r.id)}><div>
        <small>{droppedView ? r.city : `${r.city} · ${r.stage} · ${r.section}`}</small><h2>{r.name}</h2>{r.review?.name && r.review.name !== r.name && <small>{r.review.name}</small>}
        {r.review?.primary.disposition === "Dropped" && r.review.primary.route === "Site lead" && <p><strong>Reconcile stage history before reopening.</strong></p>}{r.review ? <OpportunityReview review={r.review} matched={match(r.review)} active charging={r.charging}/> : <><strong>{r.charging?.merit.action ?? r.priority}</strong><p>{r.charging?.merit.next ?? r.instruction}</p></>}{investment && <p>{r.city} #{sequence.get(r.id)!.rank} · {amounts(sequence.get(r.id)!.value)} incremental value · {sequence.get(r.id)!.peak} residual peak charges</p>}<small>{r.id}</small></div><div>{!droppedView && <strong>{r.readiness}</strong>}
        {r.mirrorStage && r.stage !== r.mirrorStage && <p>Workbook stage: {r.mirrorStage}</p>}
        {!droppedView && r.financeVisible && <p>Workbook base savings: {r.amount === null ? "Unmodeled" : (r.amount*100).toFixed(1)+"%"}</p>}
        {r.charging && match(r.review)?.disposition !== "Dropped" && <div className="charging-preview"><strong>Charging · {r.charging.merit.action}</strong>{r.review && r.charging.merit.next !== match(r.review)?.next && <p>{r.charging.merit.next}</p>}
          <p>{r.charging.name} · {r.charging.result.siteCost==null?"Cost pending":"$"+r.charging.result.siteCost.toFixed(2)+"/charge"}</p><small>{r.charging.merit.netValue!=null?"Standalone downside network value "+amounts(r.charging.merit.netValue):"Investment rank pending"}</small>{!r.charging.selected && <p>{filedScreenLabel(r.charging.screen)}</p>}
          <ChargingLink site={r.id} revision={r.charging.selected} returnTo={origin+"#"+r.id}/></div>}
        {!droppedView && r.research && <SelectionResearch row={r.research}/>}
        {(r.hasRecord || r.mapped) && <a href={reviewLink("/",{site:r.id,city:r.city,funnel:"pipeline",sheet:"full"},origin+"#"+r.id)}>Open site record</a>}
      {match(r.review)?.disposition !== "Dropped" && <p>{r.geometry} · {r.option}</p>}
        {match(r.review)?.disposition !== "Dropped" && r.quickLube && r.priority !== "Screen fleet service" && <p>Retained lifts and fleet-service rights also need a separate check.</p>}
        {!droppedView && r.assessed && <a href={reviewLink("/space-review",{site:r.id,panel:"space-options"},origin+"#"+r.id)}>Review layout evidence{r.evidenceDate && " · "+r.evidenceDate}</a>}
      </div></li>;})}</ul>
      {filed.length > 0 && showFiled && <details className="disclosure" key={decision} open={droppedView || undefined}>
        <summary className="disclosure">{droppedView ? "Outside the active pipeline" : "Filed reviews outside the active list"} ({filed.length})</summary>
        <ul className="space-review-results">{filed.map(r=><li key={r.id}><div><small>{r.city} · {r.stage} · {r.id}</small><h2>{r.review.name}</h2><OpportunityReview review={r.review} matched={match(r.review)}/>{r.hasRecord && <a href={reviewLink("/",{site:r.id,city:r.city,funnel:"pipeline",sheet:"full"},origin+"#"+r.id)}>Open site record</a>}</div></li>)}</ul>
      </details>}
      {shortlist && <footer className="shortlist-guide">{guidance}{dataDetails}</footer>}</>}
  </main>;
}
