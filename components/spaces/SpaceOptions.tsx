"use client";

import { useEffect, useState, useRef, useId } from "react";
import { useSearchParams } from "next/navigation";
import { Layers3 } from "lucide-react";
import { firstOption, kinds, options, outlineDimensions, fitRange, threshold, optionZones, recordedFit, type Assessment, type Option, type Point } from "@/lib/spaces/options";
import OptionAerial from "./OptionAerial";
import OptionReview, { useOptionReviews } from "./OptionReview";

type Loaded = { row: Assessment; reviewedOn: string };
const missing: Record<Option, string> = {
  retain: "No independent pad outlined. Check the recorded layout and access before counting stalls.",
  outdoor: "No outdoor area outlined. Check for parking, vacuums or staging that could be released at the hours the fleet needs.",
  bays: "No bay footprint established. Obtain the service layout and confirm which positions could be released.",
};
export type MapOutline = { site: string; frame: NonNullable<Assessment["image"]>["bounds"]; zones: Assessment["zones"] };

function Workspace({ site, data, onOverlay }: { site: string; data: Loaded; onOverlay?: (v: MapOutline | null) => void }) {
  const { row, reviewedOn } = data;
  const [option, setOption] = useState<Option>(firstOption(row));
  const [which, setWhich] = useState(0);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Point[]>();
  const [corner, setCorner] = useState(0);
  const history = useOptionReviews(site);
  const zones = optionZones(row, option);
  const zone = zones[which];
  const area = zone?.label || options[option];
  const prior = history.reviews.find(x => x.review?.option === option && x.review.area === area);
  const savedOutline = prior?.review?.frame === row.image?.id ? prior?.review?.points : undefined;
  const visible = zones.map(z => z === zone && (draft || savedOutline) ? { ...z, points: (draft || savedOutline)! } : z);
  const clear = row.status === "reviewed" ? row.zones.filter(z => z.kind === "clear") : [];
  const painted = [...visible, ...clear];
  const overlayKey = JSON.stringify(painted);
  useEffect(() => {
    if (onOverlay && row.image?.bounds) onOverlay({ site, frame: row.image.bounds, zones: JSON.parse(overlayKey) });
    return () => onOverlay?.(null);
  }, [site, row.image?.bounds, overlayKey, onOverlay]);
  const reset = () => { setDraft(undefined); setEditing(false); setCorner(0); };
  function changePoint(point: Point) {
    const current = draft || savedOutline || zone?.points;
    if (!current) return;
    setDraft(current.map((p,i) => i === corner ? point : p));
  }
  const activePoint = (draft || savedOutline || zone?.points)?.[corner];
  const dims = outlineDimensions(visible.find(z => z.label === zone?.label), row.image?.bounds);
  const range = dims && fitRange(dims[0], dims[1], Math.min(6, dims[1]), "stalls_90");
  const held = row.status !== "reviewed";
  return <div className="space-workspace">
    <div className="space-tabs" role="group" aria-label="Operating layout">{(Object.keys(options) as Option[]).map(key =>
      <button type="button" className={key === option ? "segmented on" : "segmented"} aria-pressed={key === option} key={key}
        onClick={() => { setOption(key); setWhich(0); reset(); }}>{options[key]}</button>)}</div>
    {row.image && <OptionAerial image={row.image} zones={painted} active={zone?.label} corrected={!draft && savedOutline ? zone?.label : undefined} onPoint={editing ? changePoint : undefined} />}
    {painted.length > 0 && <div className="space-legend"><span><i className="draft-key" />Proposed area</span>{savedOutline && <span><i className="review-key" />Team outline</span>}{clear.length > 0 && <span><i className="clear-key" />Keep clear</span>}</div>}
    <div className="space-observation"><h4>{held ? (row.status === "hold" ? "Resolve the site or image" : "Source needed") : "What the aerial shows"}</h4><p>{row.summary}</p></div>
    {zones.length > 1 && <label>Candidate area<select className="secondary" value={which} onChange={e => {setWhich(Number(e.target.value)); reset();}}>{zones.map((z,i) => <option key={z.label} value={i}>{z.label}</option>)}</select></label>}
    <h4>{zone?.label || options[option]}</h4><p>{zone ? kinds[zone.kind].protect : held ? "The stall count remains unresolved for this layout." : missing[option]}</p>
    {range && dims && <div className="space-fit-range"><strong>{range[0] === range[1] ? range[0] : range.join("–")} stalls · outline-only test</strong><p>{threshold(...range)}. Approx. {dims[0]} × {dims[1]} ft; 90° stalls and aisle inside this outline. The lower case reserves up to 6 ft in each dimension. Rights and operating hours still need evidence.</p></div>}
    {zone && !range && <p className="space-gate"><strong>Four-stall fit unresolved.</strong> {zone.kind === "bay" ? "Interior dimensions and access are needed." : "Measure the clear rectangle and its aisle."}</p>}
    {zone && <div className="space-next"><strong>What would settle fit and availability</strong><p>{zone.check || kinds[zone.kind].check}</p></div>}
    {editing && activePoint && zone && <div className="space-edit"><strong>Adjust a corner</strong><p>Choose a corner, then tap the aerial or enter its position.</p>
      <div className="layout-inputs"><label>Corner<select className="secondary" value={corner} onChange={e=>setCorner(Number(e.target.value))}>{zone.points.map((_,i) => <option key={i} value={i}>{i+1}</option>)}</select></label>
      {(["Horizontal %", "Vertical %"] as const).map((n,i) => <label key={n}>{n}<input className="field" type="number" min={0} max={100} step={0.1} value={activePoint[i]} onChange={e => { const v=e.target.valueAsNumber; if(Number.isFinite(v)&&v>=0&&v<=100) changePoint(i===0?[v,activePoint[1]]:[activePoint[0],v]); }} /></label>)}</div>
      <button type="button" className="text-link" onClick={reset}>Reset changes</button><p>Keep for diligence to save this outline with the team's review.</p></div>}
    {history.state === "unavailable" && <p role="status">Team reviews unavailable. <button type="button" className="text-link" onClick={history.retry}>Retry</button></p>}
    <OptionReview key={option + area} site={site} option={option} row={row} area={area} prior={prior} dimensions={dims} ready={history.state === "ready"}
      refresh={history.retry} edit={zone && !editing ? () => setEditing(true) : undefined} points={draft} clearPoints={() => setDraft(undefined)} stopEdit={() => setEditing(false)} />
    {history.reviews.some(x => x.review?.revision !== row.revision && x.review?.area !== area) && <details className="disclosure"><summary className="disclosure">Earlier layout reviews</summary>{history.reviews.filter(x => x.review?.revision !== row.revision && x.review?.area !== area).map(x => <p key={x.note.id}>{x.review?.area} · {x.review?.disposition} · {x.review?.reason}</p>)}</details>}
    <p className="space-date">Aerial review · {reviewedOn}{row.cohort !== "active" ? " · " + (row.cohort === "dropped" ? "Dropped record" : "Off-market record") : ""}</p>
  </div>;
}
export default function SpaceOptions({ site, compact, onOpen, onOverlay }: { site: string; compact?: boolean; onOpen?: () => void; onOverlay?: (v: MapOutline | null) => void }) {
  const linked = useSearchParams().get("panel") === "space-options";
  const [open,setOpen] = useState(linked && !compact);
  const [loaded,setLoaded] = useState<Loaded | null | undefined>();
  const [error,setError] = useState(false);
  const [canDraft,setCanDraft] = useState(false);
  const [drafting,setDrafting] = useState(false);
  const [draftError,setDraftError] = useState("");
  const [retry,setRetry] = useState(0);
  const ref = useRef<HTMLElement>(null);
  const titleId = useId();
  useEffect(() => {
    const ac = new AbortController();
    setLoaded(undefined); setError(false); setCanDraft(false);
    fetch("/api/data/space-options?site=" + encodeURIComponent(site), { signal: ac.signal, cache: "no-store" })
      .then(async response => { if (!response.ok) throw Error(); return response.json(); })
      .then(data => { if (!ac.signal.aborted) { setLoaded(data.assessment); setCanDraft(Boolean(data.canDraft)); } })
      .catch(() => { if(!ac.signal.aborted) setError(true); });
    return () => ac.abort();
  }, [site, retry]);
  useEffect(() => {
    if (!compact && linked) { setOpen(true); ref.current?.scrollIntoView({ block: "start" }); }
  }, [linked, compact, loaded]);
  async function draftOptions() {
    if (drafting) return;
    setDrafting(true); setDraftError("");
    try {
      const result = await fetch("/api/data/space-options?site="+encodeURIComponent(site),{method:"POST"});
      const body = await result.json();
      if (!result.ok || !body.assessment) throw Error(body.error || "Draft unavailable.");
      setLoaded(body.assessment); setCanDraft(false); if (!compact) setOpen(true);
    } catch (cause) { setDraftError(cause instanceof Error ? cause.message : "Draft unavailable."); }
    finally { setDrafting(false); }
  }
  const row = loaded?.row;
  const opt = row ? firstOption(row) : "retain";
  const first = row && optionZones(row, opt)[0];
  const summary = row ? recordedFit(row) : "";
  return <section ref={ref} aria-labelledby={titleId} className={"space-options" + (compact ? " compact" : "")} data-testid="space-options">
    <div className="space-heading"><Layers3 size={19} aria-hidden="true"/><h3 id={titleId}>Space options</h3></div>
    {row && <div className="space-top">
      {row.image && !open && <div className="space-thumb"><OptionAerial image={row.image} zones={first ? [first] : []}/></div>}
      <div><strong>{first ? first.label : row.status === "hold" ? "Parcel or imagery check" : row.status === "needs-image" ? "Aerial needed" : "Layout needs measurement"}</strong>
      <p>{summary}</p>{first && <small>{options[opt]} · potential fit</small>}</div>
    </div>}
    {!row && <p>{error ? "Space review could not be loaded." : loaded === undefined ? "Loading space review…" : "No aerial assessment on file. A parcel-matched aerial or dimensioned site plan is needed."}</p>}
    {canDraft && !compact && <button type="button" className="paper-btn" disabled={drafting} onClick={() => void draftOptions()}>{drafting ? "Reviewing aerial…" : "Draft options from the filed aerial"}</button>}
    {canDraft && compact && !row && <button className="text-link" type="button" onClick={onOpen}>Review site aerial</button>}
    {draftError && <p role="alert">{draftError}</p>}
    {error && <button type="button" className="text-link" onClick={() => setRetry(n=>n+1)}>Retry</button>}
    {row && (compact ? <button type="button" className="text-link" onClick={onOpen}>Compare space options</button> :
      <button type="button" className="text-link" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? "Close layout comparison" : "Compare space options"}</button>)}
    {open && !compact && loaded && <Workspace data={loaded} site={site} onOverlay={onOverlay} />}
  </section>;
}
