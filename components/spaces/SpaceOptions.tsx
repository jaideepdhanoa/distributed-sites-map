"use client";

import { useEffect, useState, useRef, useId } from "react";
import { useSearchParams } from "next/navigation";
import { Layers3 } from "lucide-react";
import { checkSpaceFit, fitChecks } from "@/lib/spaces/fitCheck";
import { firstOption, kinds, options, outlineDimensions, usableOutline, fitRange, threshold, optionZones, recordedFit, type Assessment, type Option, type Point } from "@/lib/spaces/options";
import ParcelInventory from "./ParcelInventory";
import OutlineTools from "./OutlineTools";
import OptionAerial from "./OptionAerial";
import { imageCandidates, isPanoUrl, type PhotoCard } from "@/lib/photos";
import { spacesMapHref } from "@/lib/spaces/mapCatalog";
import { outlineId, findOutline } from "@/lib/spaces/outlineAnchor";
import { reviewBody } from "@/lib/spaces/optionReview";
import { canWrite, useActionStatus } from "@/components/actions/panel";
import CommentThread from "@/components/comments/CommentThread";
import OptionReview, { useOptionReviews, useSaveReview } from "./OptionReview";

type Loaded = { row: Assessment; reviewedOn: string };
const missing: Record<Option, string> = {
  retain: "No independent pad outlined. Check the recorded layout and access before counting stalls.",
  outdoor: "No outdoor area outlined. Check for parking, vacuums or staging that could be released at the hours the fleet needs.",
  bays: "No bay footprint established. Obtain the service layout and confirm which positions could be released.",
};
export type MapOutline = { site: string; frame: NonNullable<Assessment["image"]>["bounds"]; zones: Assessment["zones"]; reviewed: string[] };

function Workspace({ site, data, photos, onOverlay }: { site: string; data: Loaded; photos?: PhotoCard; onOverlay?: (v: MapOutline | null) => void }) {
  const { row, reviewedOn } = data;
  const linked = findOutline(row, useSearchParams().get("outline") || "");
  const initialOption = (linked && kinds[linked.kind].option) || firstOption(row);
  const [allAreas,setAllAreas]=useState(!linked);
  const [option, setOption] = useState<Option>(initialOption);
  const [which, setWhich] = useState(linked ? optionZones(row, initialOption).indexOf(linked) : 0);
  const [discussion, setDiscussion] = useState(Boolean(linked));
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState("");
  const busy = useRef(false);
  const save = useSaveReview(site);
  const status = useActionStatus();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Point[]>();
  const [corner, setCorner] = useState(0);
  const history = useOptionReviews(site);
  const zones = optionZones(row, option);
  const zone = zones[which];
  const area = zone?.label || options[option];
  const prior = history.reviews.find(x => x.review?.option === option && x.review.area === area && x.review.disposition !== "Adjust outline");
  const reviewed: string[] = [];
  const visible = zones.map(candidate => {
    if (candidate === zone && draft) return { ...candidate, points: draft };
    const geometry = history.reviews.find(({review}) => review?.option === option && review.area === candidate.label && review.frame === row.image?.id && review.points)?.review?.points;
    if (!geometry) return candidate;
    reviewed.push(candidate.label);
    return { ...candidate, points: geometry };
  });
  const clear = row.status === "reviewed" ? row.zones.filter(z => z.kind === "clear") : [];
  const other = allAreas && row.status==="reviewed" ? row.zones.filter(z=>z.kind!=="clear" && kinds[z.kind].option!==option).map(z=>{
    const updated=history.reviews.find(({review})=>review?.option===kinds[z.kind].option && review.area===z.label && review.frame===row.image?.id && review.points)?.review?.points;
    return updated ? {...z,points:updated} : z;
  }) : [];
  const painted = [...other,...visible, ...clear];
  const overlayKey = JSON.stringify({ zones: painted, reviewed });
  useEffect(() => {
    if (editing && onOverlay && row.image?.bounds) onOverlay({ site, frame: row.image.bounds, ...JSON.parse(overlayKey) });
    return () => onOverlay?.(null);
  }, [site, row.image?.bounds, overlayKey, onOverlay, editing]);
  const reset = () => { setDraft(undefined); setEditing(false); setCorner(0); setEditError(""); };
  function changePoint(point: Point, index = corner) {
    const current = visible[which]?.points;
    if (!current) return;
    setDraft(current.map((p,i) => i === index ? point : p));
  }
  async function saveOutline() {
    if (!zone || !row.image || !draft || busy.current) return;
    if (!usableOutline(draft)) { setEditError("The outline crosses itself or has no area. Move a corner before saving."); return; }
    busy.current = true;
    setSaving(true);
    setEditError("");
    try {
      await save(reviewBody({ disposition: "Adjust outline", option, area, revision: row.revision, frame: row.image.id, points: draft, reason: "Updated the outline." }));
      history.retry();
      reset();
    } catch (error) {
      setEditError(error instanceof Error ? error.message : "The outline could not be saved.");
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }
  const activePoint = (visible[which]?.points)?.[corner];
  const shown = visible.find(z => z.label === zone?.label);
  const fit = shown && checkSpaceFit(shown, row.image);
  const dims = fit?.dimensions ?? null;
  const range = fit?.inside;
  const edge = fit?.adjacent;
  const originalDims = outlineDimensions(zone, row.image?.bounds, row.image);
  const predicted = originalDims && fitRange(originalDims[0], originalDims[1], Math.min(6, originalDims[1]), "stalls_90");
  const held = row.status !== "reviewed";
  const bayEvidence = option === "bays" && photos ? photos.photos.filter(photo =>
    ["building", "street_level", "floor_plan", "site_plan"].includes(photo.role) || /(?:floor|site) plan/i.test(photo.caption || "")
  ).flatMap(photo => imageCandidates(photo, "full").slice(0, 1).map(url => ({ url, label: photo.caption || (photo.role === "building" ? "Building photo" : "Filed site evidence") }))) : [];
  const selectArea = (index: number) => { setWhich(index); setDiscussion(false); reset(); };
  return <div className="space-workspace">
    <ParcelInventory inventory={row.inventory} zones={row.zones}/>
    <div className="space-tabs" role="group" aria-label="Operating layout"><button type="button" className={allAreas ? "segmented on":"segmented"} aria-pressed={allAreas} disabled={saving} onClick={()=>{setAllAreas(true);selectArea(0);}}>All areas</button>{(Object.keys(options) as Option[]).map(key =>
      <button type="button" className={!allAreas && key === option ? "segmented on" : "segmented"} aria-pressed={!allAreas && key === option} disabled={saving} key={key}
        onClick={() => { setAllAreas(false); setOption(key); selectArea(0); }}>{options[key]}</button>)}</div>
    {row.image && <OptionAerial image={row.image} zones={painted} active={zone?.label} reviewed={reviewed} onSelect={!editing ? label=>{
      const target=painted.find(z=>z.label===label);
      const tab=target && kinds[target.kind].option;
      if(tab){setOption(tab);setAllAreas(false);selectArea(optionZones(row,tab).findIndex(z=>z.label===label));}
    } : undefined} onPoint={editing && !saving ? changePoint : undefined} corner={editing ? corner : undefined} onCorner={setCorner} />}
    {painted.length > 0 && <div className="space-legend">{visible.some(z => !reviewed.includes(z.label)) && <span><i className="draft-key" />Proposed area</span>}{reviewed.length > 0 && <span><i className="review-key" />Team outline</span>}{clear.length > 0 && <span><i className="clear-key" />Keep clear</span>}</div>}
    {zones.length > 1 && <label>Candidate area<select className="secondary" value={which} disabled={saving} onChange={e => selectArea(Number(e.target.value))}>{zones.map((z,i) => <option key={z.label} value={i}>{z.label}</option>)}</select></label>}
    {zone && <div className="space-actions" aria-label={zone.label}>
      {history.state === "ready" && status.enabled && canWrite(status.actionRole) && !editing && <button type="button" className="paper-btn" onClick={() => setEditing(true)}>Adjust outline</button>}
      <button type="button" className="paper-btn" aria-expanded={discussion} onClick={() => setDiscussion(open => !open)}>Comment</button>
    </div>}
    {editing && activePoint && zone && <div className="space-edit"><OutlineTools points={draft || zone.points} corner={corner} frame={row.image} disabled={saving} onChange={(next,index)=>{setDraft(next);setCorner(index);}}/><strong>Adjust a corner</strong><p>Drag a corner, tap its new position, or enter its coordinates.</p>
      <div className="layout-inputs"><label>Corner<select className="secondary" value={corner} disabled={saving} onChange={e=>setCorner(Number(e.target.value))}>{(draft || zone.points).map((_,i) => <option key={i} value={i}>{i+1}</option>)}</select></label>
      {(["Horizontal %", "Vertical %"] as const).map((n,i) => <label key={n}>{n}<input className="field" type="number" min={0} max={100} step={0.1} value={activePoint[i]} disabled={saving} onChange={e => { const v=e.target.valueAsNumber; if(Number.isFinite(v)&&v>=0&&v<=100) changePoint(i===0?[v,activePoint[1]]:[activePoint[0],v]); }} /></label>)}</div>
      <div className="space-actions"><button type="button" className="primary" disabled={!draft || saving} onClick={() => void saveOutline()}>{saving ? "Saving…" : "Save outline"}</button>
        <button type="button" className="text-link" disabled={saving} onClick={reset}>Cancel</button></div>
      {editError && <p role="alert">{editError}</p>}</div>}
    {zone && discussion && <CommentThread key={outlineId(zone)} siteId={site} anchor={{type:"space", siteId:site, line:"", period:"", spaceId:outlineId(zone), label:zone.label}} variant="inline" source="Space Review" />}
    <div className="space-observation"><h4>{held ? (row.status === "hold" ? "Resolve the site or image" : "Source needed") : row.image?.kind === "site-plan" ? "What the site plan shows" : row.image?.kind === "site-photo" ? "What the site photo shows" : "What the aerial shows"}</h4><p>{row.summary}</p></div>
    <h4>{zone?.label || options[option]}</h4><p>{zone ? kinds[zone.kind].protect : held ? "The stall count remains unresolved for this layout." : missing[option]}</p>
    {row.evidence?.filter(item => item.option === option).map(item => <p key={item.url}><a className="text-link" href={item.url} target="_blank" rel="noopener noreferrer">{item.label}</a></p>)}
    {option === "bays" && (bayEvidence.length > 0 || isPanoUrl(photos?.frontageUrl || "")) && <details className="disclosure"><summary className="disclosure">View bay and frontage evidence</summary>
      {bayEvidence.map((item, i) => <p key={i}><a className="text-link" href={item.url} target="_blank" rel="noopener noreferrer">{item.label}</a></p>)}
      {isPanoUrl(photos?.frontageUrl || "") && <p><a className="text-link" href={photos!.frontageUrl} target="_blank" rel="noopener noreferrer">Inspect the street frontage</a></p>}
    </details>}
    {range && dims && <div className="space-fit-range"><strong>{range[0] === range[1] ? range[0] : range.join("–")} stalls · outline-only test</strong><p>{threshold(...range)}. Approx. {dims[0]} × {dims[1]} ft; 90° stalls and aisle inside this outline. The lower case reserves up to 6 ft in each dimension. Rights and operating hours still need evidence.</p></div>}
    {edge && range && range[1] < 4 && edge[1] >= 4 && <p className="space-gate"><strong>An adjacent aisle could change the decision.</strong> The outline could serve {edge[0] === edge[1] ? edge[0] : edge.join("–")} stalls in one row if a continuous 24 ft outside aisle is usable. Verify its width, turning access and availability at peak.</p>}
    {zone?.fitHold && <p className="space-gate"><strong>{fitChecks[zone.fitHold]}</strong></p>}
    {zone && !zone.fitHold && !range && <p className="space-gate"><strong>Four-stall fit unresolved.</strong> {zone.kind === "bay" ? "Interior dimensions and access are needed." : "Measure the clear rectangle and its aisle."}</p>}
    {zone && <div className="space-next"><strong>What would settle fit and availability</strong><p>{zone.check || kinds[zone.kind].check}</p></div>}
    {history.state === "unavailable" && <p role="status">Team reviews unavailable. <button type="button" className="text-link" onClick={history.retry}>Retry</button></p>}
    <OptionReview key={option + area} site={site} option={option} row={row} area={area} prior={prior} dimensions={dims} predicted={predicted} ready={history.state === "ready"}
      refresh={history.retry} points={draft || visible[which]?.points} clearPoints={() => setDraft(undefined)} stopEdit={() => setEditing(false)} />
    {history.reviews.some(x => x.review?.revision !== row.revision && x.review?.area !== area) && <details className="disclosure"><summary className="disclosure">Earlier layout reviews</summary>{history.reviews.filter(x => x.review?.revision !== row.revision && x.review?.area !== area).map(x => <p key={x.note.id}>{x.review?.area} · {x.review?.disposition} · {x.review?.reason}</p>)}</details>}
    <a className="text-link" href="/space-review">Review other sites</a>
    <p className="space-date">Layout review · {reviewedOn}{row.cohort !== "active" ? " · " + (row.cohort === "dropped" ? "Dropped record" : "Off-market record") : ""}</p>
  </div>;
}
export default function SpaceOptions({ site, photos, compact, onOpen, onOverlay }: { site: string; photos?: PhotoCard; compact?: boolean; onOpen?: () => void; onOverlay?: (v: MapOutline | null) => void }) {
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
  const compactDimensions = first ? outlineDimensions(first, row?.image?.bounds, row?.image) : null;
  const compactFit = compactDimensions && fitRange(compactDimensions[0], compactDimensions[1], Math.min(6, compactDimensions[1]), "stalls_90");
  const fitLabel = compactFit ? compactFit[0] === compactFit[1] ? compactFit[0] + " stalls" : compactFit.join("–") + " stalls" : "Four-stall fit unresolved";
  if (compact) {
    if (!row && !canDraft) return null;
    return <div className="space-options-pin"><Layers3 size={16} aria-hidden="true"/><button className="text-link" type="button" onClick={onOpen}>Compare space options</button>{first && <span>{first.label}</span>}</div>;
  }
  return <section ref={ref} data-evidence="space-options" aria-labelledby={titleId} className="space-options" data-testid="space-options">
    <div className="space-heading"><Layers3 size={19} aria-hidden="true"/><h3 id={titleId}>Space options</h3></div>
    {row?.zones.some(z=>z.kind!=="clear") && <a className="paper-btn" href={spacesMapHref(site)}>Open spaces on main map</a>}
    {row && !open && <div className="space-top">
      {row.image && <div className="space-thumb"><OptionAerial image={row.image} zones={row.zones}/><button type="button" className="text-link" aria-label="Open annotated layout" onClick={() => setOpen(true)} /></div>}
      <div><strong>{row.inventory ? "Whole-parcel assessment" : first ? first.label : row.status === "hold" ? "Parcel or imagery check" : row.status === "needs-image" ? "Aerial needed" : "Layout needs measurement"}</strong>
      <p>{row.inventory ? row.summary : summary}</p>{first && !row.inventory && <small>{options[opt]} · {fitLabel}{compactFit && " in outline test"}</small>}</div>
    </div>}
    {open && row && <p className="space-recorded">{summary}</p>}
    {!row && <p>{error ? "Space review could not be loaded." : loaded === undefined ? "Loading space review…" : "No aerial assessment on file. A parcel-matched aerial or dimensioned site plan is needed."}</p>}
    {canDraft && !compact && <button type="button" className="paper-btn" disabled={drafting} onClick={() => void draftOptions()}>{drafting ? "Reviewing aerial…" : "Draft options from the filed aerial"}</button>}
    {draftError && <p role="alert">{draftError}</p>}
    {error && <button type="button" className="text-link" onClick={() => setRetry(n=>n+1)}>Retry</button>}
    {row && <button type="button" className="text-link" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? "Close layout comparison" : "Compare space options"}</button>}
    {open && !compact && loaded && <Workspace key={site} data={loaded} site={site} photos={photos} onOverlay={onOverlay} />}
  </section>;
}
