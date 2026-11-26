"use client";
import { useEffect, useState } from "react";
import type { SelectionRow } from "@/lib/selection/screen";

type Result = { rows: SelectionRow[]; mismatches: number; hasInputs: boolean };

export default function SelectionReview() {
  const [data,setData] = useState<Result | null>(null);
  const [error,setError] = useState(false);
  const [attempt,setAttempt] = useState(0);
  const [market,setMarket] = useState("");
  const [check,setCheck] = useState("");
  const [query,setQuery] = useState("");
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
  const scoped = rows.filter(r => (!market || r.city === market) && (!check || r.priority === check) &&
    [r.name,r.city,r.id].join(" ").toLowerCase().includes(query.trim().toLowerCase())).sort((a,b)=>a.city.localeCompare(b.city) || a.name.localeCompare(b.name));
  return <main className="space-review-page">
    <a className="text-link" href="/?funnel=pipeline&view=list">← Pipeline list</a>
    <h1>Selection review</h1><p>Choose the next diligence check. Investment approval requires verified site rights, usable space, power, retained cash flow and network benefit.</p>
    <div className="space-review-filters">
      <label>Market<select aria-label="Market" className="secondary" value={market} onChange={e=>setMarket(e.target.value)}><option value="">All markets</option>{[...new Set(rows.map(r=>r.city))].sort().map(c=><option key={c}>{c}</option>)}</select></label>
      <label>Next check<select aria-label="Next check" className="secondary" value={check} onChange={e=>setCheck(e.target.value)}><option value="">All checks</option>{[...new Set(rows.map(r=>r.priority))].sort().map(c=><option key={c}>{c}</option>)}</select></label>
      <label>Find a site<input className="field" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Name or site ID" /></label>
    </div>
    {!data && !error && <p role="status">Loading pipeline…</p>}
    {error && <p role="alert">Pipeline could not be loaded. <button className="text-link" onClick={()=>setAttempt(a=>a+1)}>Retry</button></p>}
    {data && <><p aria-live="polite">{scoped.length} of {rows.length} active sites</p>
      {!data.hasInputs && <p>Workbook screen pending. Some unlocated sites use their dated assessment cohort.</p>}
      {data.hasInputs && <p>{data.mismatches} stage differences across the joined records. The review uses the application stage when available.</p>}
      {!scoped.length && <p>No sites match these filters.</p>}
      <ul className="space-review-results">{scoped.map(r=><li key={r.id}><div>
        <small>{r.city} · {r.stage} · {r.section}</small><h2>{r.name}</h2><p>{r.id}</p><strong>{r.readiness}</strong>
        {r.mirrorStage && r.stage !== r.mirrorStage && <p>Workbook stage: {r.mirrorStage}</p>}
        {r.financeVisible && <p>Workbook base savings: {r.amount === null ? "Unmodeled" : (r.amount*100).toFixed(1)+"%"}</p>}
        {r.mapped && <a href={"/?"+new URLSearchParams({site:r.id,city:r.city,funnel:"pipeline",sheet:"full"})}>Open site record</a>}
      </div><div><strong>{r.priority}</strong><p>{r.instruction}</p><p>{r.geometry} · {r.option}</p>
        {r.quickLube && r.priority !== "Screen fleet service" && <p>Retained lifts and fleet-service rights also need a separate check.</p>}
        {r.assessed && <a href={"/space-review?"+new URLSearchParams({site:r.id,panel:"space-options"})}>Review layout evidence{r.evidenceDate && " · "+r.evidenceDate}</a>}
      </div></li>)}</ul></>}
  </main>;
}
