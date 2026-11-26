import { folderHref, formatRecordedDate } from "@/lib/format";
import { mapPower } from "@/lib/mapPower";
import type { DealProps, SiteProps } from "@/lib/types";
import { PowerFollowUp } from "./PowerEvidence";

export type GridCoverage = { open:boolean; status:"loading" | "ready" | "error"; substation:boolean; line:boolean; retry:()=>void };
type Props = {
  deal?: DealProps | null; site?: SiteProps | null; grid: GridCoverage;
  onGrid: () => void;
};

function ReadingSource({ evidence, date, confidence, folder }: {
  evidence: {label:string; href:string}; date:string; confidence?:string; folder?:string;
}) {
  const directory = folderHref(folder);
  return <details className="disclosure power-source"><summary className="disclosure">{
    [evidence.label || "Source not recorded",formatRecordedDate(date)].filter(Boolean).join(" · ")
  }</summary><div>{confidence && <span>{confidence}</span>}
    {evidence.href ? <a className="text-link" href={evidence.href} target="_blank" rel="noopener noreferrer">Open source document ↗</a>
      : directory ? <a className="text-link" href={directory} target="_blank" rel="noopener noreferrer">Open site evidence folder ↗</a>
      : <span>Source document link unavailable</span>}
  </div></details>;
}

export default function MapPowerCard({ deal, site, grid, onGrid }:Props) {
  const {service,street,distances,load,differing,next} = mapPower(deal,site);
  const vegas = (deal?.city || site?.city) === "LAS";
  return <section className="map-power-card" aria-label="Site power">
    <section><h3>At the property</h3>
      {service.length === 0 && <p>Service details unknown</p>}
      {service.map((r,i)=><div key={i} className="power-reading">
        <span className="power-status">{r.status}</span><strong>{r.facts}</strong>
        {r.amps == null && (r.volts != null || r.phase) && <small>Main breaker rating unknown</small>}
        <ReadingSource evidence={r.evidence} date={r.date} confidence={r.confidence} folder={r.folder} />
        {r.available != null && <p>Available for additional load · {r.available.toLocaleString()} MW</p>}
      </div>)}
      {differing && <p className="power-disagreement">Sources disagree on service details</p>}
      {!service.some(r=>r.available != null) && <small>Available charging capacity unconfirmed</small>}
      {load.map((r,i)=><details className="disclosure power-source" key={i}><summary className="disclosure">Recorded electricity use</summary>
        <p>{[r.peak != null && r.peak.toLocaleString()+" kW peak demand",r.annual != null && r.annual.toLocaleString()+" kWh/year"].filter(Boolean).join(" · ")}</p>
        <ReadingSource evidence={r.source} date={r.date}/></details>)}
    </section>
    <section><h3>On the street</h3>{street.length === 0 ? <p>No utility estimate on file</p> : street.map((r,i)=><div key={i}>
      <p className="power-forecast">{(/nv energy|\bdrp\b/i.test(r.evidence.label) || (vegas && /utility hosting map/i.test(r.evidence.label))) ? "NV Energy load hosting" : "Utility load hosting"} · {r.horizon ? r.horizon+" estimate" : "Forecast year unknown"}</p>
      <dl className="power-hosting">{([["At the frontage",r.frontage],["Nearby",r.nearby]] as const).map(([label,value])=>
        <div key={label}><dt>{label}</dt><dd>{value == null ? "No reading on file" : value.toLocaleString(undefined,{maximumFractionDigits:3})+" MW"}</dd></div>)}</dl>
      <ReadingSource evidence={r.evidence} date={r.date} confidence={[r.confidence,r.feeder && "Feeder "+r.feeder].filter(Boolean).join(" · ")} />
    </div>)}</section>
    <section><h3>Nearby grid</h3>{distances.length ? distances.map((r,i)=><div key={i}>
      {r.sub != null && <p>Substation · {r.sub.toLocaleString()} mi away{grid.status === "ready" && !grid.substation && <small>Mapped substation unavailable</small>}</p>}
      {r.line != null && <p>High-voltage line · {r.line.toLocaleString()} ft away{grid.status === "ready" && !grid.line && <small>Mapped line unavailable</small>}</p>}
      <small>Estimated distance from the site pin</small>{(r.source.label || r.source.href || r.date) && <ReadingSource evidence={r.source} date={r.date}/>}
    </div>) : <p>No distance readings on file</p>}
      {grid.status === "error" && <button type="button" className="text-link" onClick={grid.retry}>Retry grid map</button>}
      {grid.status === "loading" && <small role="status">Checking mapped locations…</small>}
      {(grid.substation || grid.line) && <button type="button" className="paper-btn" aria-pressed={grid.open} onClick={onGrid}>{grid.open ? "Return to site view" : "Show nearby grid"}</button>}
    </section>
    <section><h3>Next check</h3><p>{next}</p><PowerFollowUp deal={deal} site={site} primary /></section>
  </section>;
}
