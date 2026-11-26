"use client";

import { useEffect, useState } from "react";
import { focusOrder, type TriageRow } from "@/lib/spaces/triage";
import { useSearchParams } from "next/navigation";
import SpaceOptions from "./SpaceOptions";
import { options } from "@/lib/spaces/options";

const cohorts = { active: "Active pipeline", "off-market": "Off market", dropped: "Dropped" } as const;
export default function SpaceReviewList() {
  const selectedId = useSearchParams().get("site");
  const [rows, setRows] = useState<TriageRow[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [retry, setRetry] = useState(0);
  const [cohort, setCohort] = useState<TriageRow["cohort"]>("active");
  const [focus, setFocus] = useState("");
  const [layout, setLayout] = useState("");
  const [search, setSearch] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setStatus("loading");
    fetch("/api/data/space-options?view=portfolio", { cache: "no-store", signal: controller.signal })
      .then(async response => { if (!response.ok) throw Error(); return response.json(); })
      .then(data => { if (!controller.signal.aborted) { setRows(data.rows); setStatus("ready"); } })
      .catch(() => { if (!controller.signal.aborted) setStatus("error"); });
    return () => controller.abort();
  }, [retry]);
  const scoped = rows.filter(row => row.cohort === cohort);
  const query = search.trim().toLowerCase();
  const matches = scoped.filter(row => (!focus || row.focus === focus) && (!layout || row.options.includes(layout)) &&
    (!query || [row.id, row.city, row.name, ...row.kinds].join(" ").toLowerCase().includes(query)))
    .sort((a,b) => focusOrder.indexOf(a.focus) - focusOrder.indexOf(b.focus) || a.city.localeCompare(b.city) || a.name.localeCompare(b.name));
  if (selectedId && status === "ready") {
    const site = rows.find(row => row.id === selectedId);
    return <main className="space-review-page"><a className="text-link" href="/space-review">← All space reviews</a>
      {site ? <><h1>{site.name}</h1><p>{site.city} · {cohorts[site.cohort]}</p><SpaceOptions site={site.id} /></> : <p>This site is unavailable.</p>}
    </main>;
  }
  return <main className="space-review-page">
    <a className="text-link" href="/?funnel=pipeline&view=list">← Pipeline list</a>
    <h1>Space review</h1><a className="paper-btn" href="/?spaces=1">Open spaces on main map</a><p>Find a footprint to measure, a conversion to test, or a parcel that needs better evidence.</p>
    <div className="space-review-filters">
      <label>Pipeline<select className="secondary" value={cohort} onChange={e => setCohort(e.target.value as TriageRow["cohort"])}>{Object.entries(cohorts).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
      <label>Next check<select className="secondary" value={focus} onChange={e=>setFocus(e.target.value)}><option value="">All checks</option>{focusOrder.map(f=><option key={f}>{f}</option>)}</select></label>
      <label>Layout with an outline<select className="secondary" value={layout} onChange={e=>setLayout(e.target.value)}><option value="">All layouts</option>{Object.entries(options).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
      <label>Find a site or use<input className="field" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Site, market, vacuum, bay…" /></label>
    </div>
    {status === "loading" && <p role="status">Loading site assessments…</p>}
    {status === "error" && <p role="alert">Site assessments could not be loaded. <button className="text-link" onClick={()=>setRetry(v=>v+1)}>Retry</button></p>}
    {status === "ready" && <>
      <p aria-live="polite">{matches.length} of {scoped.length} sites</p>
      {matches.length === 0 && <p>No sites match these filters.</p>}
      <ul className="space-review-results">{matches.map(row=><li key={row.id}>
        <div><small>{row.city} · {row.stage}</small><h2><a href={row.mapped ? "/?" + new URLSearchParams({ city:row.city, site:row.id, funnel:"pipeline", panel:"space-options", sheet:"full" }) : "/space-review?" + new URLSearchParams({ site:row.id, panel:"space-options" })}>{row.name}</a></h2><p>{row.baseline}</p></div>
        <div><strong>{row.focus}</strong>{row.finding && <p>{row.finding}</p>}<p>{row.next}</p></div>
      </li>)}</ul>
    </>}
  </main>;
}
