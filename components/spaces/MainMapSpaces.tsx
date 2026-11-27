"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import MapPanelGrip from "../MapPanelGrip";
import { useSearchParams } from "next/navigation";
import type { Map } from "maplibre-gl";
import { ChevronLeft, Pencil, MessageSquare, Minus, Plus } from "lucide-react";
import { canWrite, useActionStatus } from "@/components/actions/panel";
import CommentThread from "@/components/comments/CommentThread";
import {
  kinds,
  options,
  outlineDimensions,
  fitRange,
  usableOutline,
  type Option,
  type Aerial,
  type Assessment,
  type Point,
} from "@/lib/spaces/options";
import { costRange } from "@/lib/charging/pipelineCost";
import type { PreliminaryCost } from "@/lib/charging/preliminary";
import { navigateSpaces } from "@/lib/spaces/navigation";
import { reviewLabel, reviewReturn } from "@/lib/reviewNavigation";
import { outlineId } from "@/lib/spaces/outlineAnchor";
import { reviewBody } from "@/lib/spaces/optionReview";
import type { MapSpaceSite, SpaceCatalog } from "@/lib/spaces/mapCatalog";
import OptionReview, { useOptionReviews, useSaveReview } from "./OptionReview";
import { checkSpaceFit, fitChecks, type FitCheck } from "@/lib/spaces/fitCheck";
import MapSpaceFit from "./MapSpaceFit";
import OptionAerial from "./OptionAerial";
import { bestRow, sketchCase, sketchRow, type Angle } from "@/lib/spaces/parcelLayout";
import { areaCounts, assessedCases } from "@/lib/spaces/assessedMix";
import OutlineTools from "./OutlineTools";
import ParcelInventory from "./ParcelInventory";
import SpaceGeography from "./SpaceGeography";

const cohorts = { active: "Active pipeline", "off-market": "Off market", dropped: "Dropped" } as const;
const markets = { PHX: "Phoenix", LAS: "Las Vegas", MIA: "Miami", SNA: "Orange County" } as Record<
  string,
  string
>;
const catalogUrl = "/api/data/space-options?view=map";
async function readCatalog(signal?: AbortSignal): Promise<SpaceCatalog> {
  const response = await fetch(catalogUrl, { cache: "no-store", signal });
  if (!response.ok) throw Error("The analyzed spaces could not be loaded.");
  const catalog = await response.json();
  if (!Array.isArray(catalog.sites)) throw Error("The space inventory is unavailable.");
  return catalog;
}
function candidates(site: MapSpaceSite) {
  return site.zones.filter((zone) => zone.kind !== "clear");
}
export default function MainMapSpaces({
  map,
  failed,
  enabled,
  blocked,
  market,
  selectedSite,
  previewSite,
  estimate,
  mapSiteIds,
  onDraw,
  onDrawAt,
}: {
  map: Map | null;
  failed: boolean;
  enabled: boolean;
  blocked: boolean;
  market: string;
  selectedSite?: string;
  previewSite?: string;
  estimate?:PreliminaryCost;
  mapSiteIds: ReadonlySet<string>;
  onDraw?: () => void;
  onDrawAt?: (site: string, center: Point) => void;
}) {
  const params = useSearchParams();
  const back = reviewReturn(params.get("returnTo"), ["/space-review", "/selection-review"], "");
  const open = params.get("spaces") === "1";
  const id = params.get("spaceSite") || "",
    area = params.get("spaceArea") || "";
  const [catalog, setCatalog] = useState<SpaceCatalog | null>(null);
  const [loadError, setLoadError] = useState("");
  const [attempt, retry] = useState(0);
  const [fitCheck,setFitCheck] = useState<FitCheck|"">("");
  const [cohort, setCohort] = useState<MapSpaceSite["cohort"]>("active");
  const [search, setSearch] = useState("");
  const [region, setRegion] = useState("");
  const [assessment, setAssessment] = useState<Assessment>();
  const image = assessment?.image;
  const [overlays, setOverlays] = useState(true);
  const [imageError, setImageError] = useState("");
  const [compactInspector, setCompactInspector] = useState(false);
  useEffect(() => { setCompactInspector(false); }, [open, id, area]);
  const [sourceView, setSourceView] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [draft, setDraft] = useState<Point[] | null>(null);
  const [corner, setCorner] = useState(0);
  const [thread, setThread] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [discard, setDiscard] = useState<(() => void) | null>(null);
  const locked = useRef(false);
  const status = useActionStatus();
  const save = useSaveReview(id);
  const history = useOptionReviews(open && id ? id : "");
  const site = open ? catalog?.sites.find((s) => s.id === id) : undefined;
  const zones = useMemo(() => (site ? candidates(site) : []), [site]);
  const linked = zones.find((z) => outlineId(z) === area);
  const requested = params.get("spaceLayout") as Option | null;
  const filter = requested && Object.hasOwn(options,requested) ? requested : "all";
  const choices = zones.filter(z => filter === "all" || kinds[z.kind].option === filter);
  const active = choices.find(z => z === linked) || choices[0];
  const layout: Option = (active && kinds[active.kind].option) || (filter === "all" ? "retain" : filter);
  const [study,setStudy] = useState("default");
  const [edge,setEdge] = useState(0);
  const [angle,setAngle] = useState<Angle>(90);
  const cases = useMemo(() => site && assessment?.image?.id===site.frame.id && catalog?.reviewsAvailable
    ? assessedCases(site.zones,site.frame,assessment) : [],[site,assessment,catalog?.reviewsAvailable]);
  const [localMix,setLocalMix]=useState<{site:string;from:string;name:string;omitted:string[]}|null>(null);
  const query=params.toString();
  // Render a checkbox immediately while the router commits the shareable URL.
  const pending=localMix?.site===id && localMix.from===query ? localMix : null;
  useEffect(()=>{setLocalMix(prev=>prev && (prev.site!==id || prev.from!==query) ? null : prev);},[id,query]);
  const namedCase=pending?.name??params.get("mix");
  const exclusions=useMemo(()=>pending?.omitted??params.getAll("omit"),[pending,params]);
  const writeMix=(name:string, omitted:string[])=>{
    setLocalMix({site:id,from:query,name,omitted});
    const url=new URL(window.location.href);
    url.searchParams.set("mix",name);
    url.searchParams.delete("omit");
    for(const label of omitted) url.searchParams.append("omit",label);
    window.history.replaceState(null,"",url);
  };
  const caseIndex = study === "default" ? Math.max(0,cases.findIndex(c=>c.name===namedCase)) : Number(study);
  const selectedCase = filter === "all" && !area && cases && Number.isInteger(caseIndex) ? cases[caseIndex] : undefined;
  const parts=selectedCase ? areaCounts(selectedCase.rows) : [];
  const omitted=selectedCase?.name===namedCase ? parts.filter(p=>exclusions.includes(p.area)).map(p=>p.area) : [];
  const filtered=useMemo(()=>selectedCase && ({...selectedCase,
    rows:selectedCase.rows.filter(r=>!(selectedCase.name===namedCase && exclusions.includes(r.area))),
    approach:selectedCase.name===namedCase && exclusions.length>0 ? undefined : selectedCase.approach
  }),[selectedCase,namedCase,exclusions]);
  const matchingCase=omitted.length && filtered ? cases.find(c=>JSON.stringify(c.rows)===JSON.stringify(filtered.rows)) : undefined;
  const canTestRow = active && !active.fitHold && active.kind !== "bay" && active.kind !== "clear";
  const rowTrial = study === "row" && canTestRow;
  const sketch = useMemo(() => {
    if (draft || !site) return null;
    if (filtered) return sketchCase(filtered,site.zones,site.frame);
    if (rowTrial && active) return sketchRow(active,site.frame,edge,angle,100,site.zones.filter(z=>z.kind==="clear").map(z=>z.points));
    return null;
  },[active,angle,draft,edge,rowTrial,filtered,site]);
  const costCase=matchingCase || selectedCase;
  const price=costCase && estimate && "layouts" in estimate ? estimate.layouts.find(l=>
    l.condition===costCase.name+". "+costCase.condition && l.stalls===costCase.rows.reduce((n,r)=>n+r.count,0)) : undefined;
  const prior = history.reviews.find(
    (x) =>
      x.review?.option === layout &&
      x.review.area === active?.label &&
      x.review.disposition !== "Adjust outline",
  );
  const [reviewOpen, setReviewOpen] = useState(false);
  const inSource = Boolean(site && (sourceView || !site.frame.bounds || failed || !map));
  const dirty = Boolean(draft && JSON.stringify(draft) !== JSON.stringify(active?.points));
  const discussionRequested = params.get("discussion") === "1";
  useEffect(() => {
    if (!enabled && !open) return;
    const controller = new AbortController();
    let version = 0;
    const refresh = () => {
      const request = ++version;
      void readCatalog(controller.signal)
        .then((data) => {
          if (request === version && !controller.signal.aborted) {
            setCatalog(data);
            setLoadError("");
          }
        })
        .catch(() => {
          if (request === version && !controller.signal.aborted)
            setLoadError("The analyzed spaces could not be loaded.");
        });
    };
    refresh();
    window.addEventListener("focus", refresh);
    window.addEventListener("space-outline-saved", refresh);
    return () => {
      controller.abort();
      window.removeEventListener("focus", refresh);
      window.removeEventListener("space-outline-saved", refresh);
    };
  }, [enabled, open, attempt]);
  const frame = site?.frame.id;
  useEffect(() => {
    setAssessment(undefined);
    setImageError("");
    setZoom(1);
    setSourceView(false);
    if (!id || !frame || !open) return;
    const controller = new AbortController();
    fetch("/api/data/space-options?" + new URLSearchParams({ site: id }), {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (r) => {
        if (!r.ok) throw Error();
        const row = (await r.json()).assessment?.row as Assessment | undefined;
        if (!row?.image || row.image.id !== frame) throw Error();
        if (!controller.signal.aborted) setAssessment(row);
      })
      .catch(() => {
        if (!controller.signal.aborted) setImageError("The source image could not be loaded.");
      });
    return () => controller.abort();
  }, [id, frame, open, attempt]);
  useEffect(() => {
    setStudy("default"); setEdge(0); setAngle(90);
    setDraft(null);
    setCorner(0);
    setReviewOpen(false);
    setOverlays(true);
    setThread(discussionRequested);
    setMessage("");
    setDiscard(null);
  }, [id, area, open, filter, discussionRequested]);
  useEffect(() => {
    if (!dirty) return;
    const leave = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", leave);
    return () => window.removeEventListener("beforeunload", leave);
  }, [dirty]);
  const fromMap = params.get("spaceScope") === "map";
  const scoped = useMemo(
    () =>
      (catalog?.sites || []).filter(
        (s) => fromMap ? mapSiteIds.has(s.id) : s.cohort === (site?.cohort || cohort) && (!region || s.market === region),
      ),
    [catalog, cohort, region, site, fromMap, mapSiteIds],
  );
  const needle=search.trim().toLowerCase();
  const list=useMemo(()=>scoped.flatMap(s=>{
    const matchesSite=[s.name,s.id,markets[s.market]].join(" ").toLowerCase().includes(needle);
    const zones=candidates(s).filter(z=>(matchesSite || z.label.toLowerCase().includes(needle))
      && (!fitCheck || checkSpaceFit(z,s.frame).check===fitCheck));
    if(!zones.length) return [];
    return [zones.length===candidates(s).length ? s : {...s,zones}];
  }),[scoped,needle,fitCheck]);
  const footprintCount = list.reduce((total, record) => total + candidates(record).length, 0);
  const visible=useMemo(()=>{
    if(!open) return (catalog?.sites||[]).filter(s=>s.id!==previewSite && s.cohort==="active" && (!market||market==="all"||s.market===market));
    return site ? [...list.filter(s=>s.id!==site.id),site] : list;
  },[open,catalog,previewSite,market,site,list]);
  function leave(action: () => void) {
    if (locked.current) return;
    if (dirty) setDiscard(() => action);
    else action();
  }
  function pick(s: string, a?: string) {
    const match = !a && (needle || fitCheck) ? list.find((item) => item.id === s) : undefined;
    const first = match && candidates(match)[0];
    leave(() => navigateSpaces(true, s, a ?? (first && outlineId(first)), s === id && filter !== "all" ? filter : undefined));
  }
  function move(p: Point, i = corner) {
    setCorner(i);
    setDraft((old) => old?.map((v, j) => (j === i ? p : v)) || null);
  }
  async function commit() {
    if (!site || !active || !draft || !dirty || locked.current) return;
    if (!usableOutline(draft)) {
      setMessage("Move the corners so the outline has area and its edges do not cross.");
      return;
    }
    locked.current = true;
    setSaving(true);
    setMessage("");
    try {
      const latest = await readCatalog();
      const current = latest.sites.find((s) => s.id === site.id);
      const same = current?.zones.find((z) => outlineId(z) === outlineId(active));
      if (
        !latest.reviewsAvailable ||
        !same ||
        current?.frame.id !== site.frame.id ||
        JSON.stringify(same.points) !== JSON.stringify(startPoints.current)
      ) {
        setMessage("The saved outline or source changed. Cancel this edit and reopen the latest outline.");
        setCatalog(latest);
        return;
      }
      await save(
        reviewBody({
          disposition: "Adjust outline",
          option: kinds[active.kind].option!,
          area: active.label,
          revision: site.revision,
          frame: site.frame.id,
          points: draft,
          reason: "Updated the outline.",
        }),
      );
      const verified = await readCatalog();
      setCatalog(verified);
      const saved = verified.sites
        .find((s) => s.id === site.id)
        ?.zones.find((z) => outlineId(z) === outlineId(active));
      if (!saved?.edited || JSON.stringify(saved.points) !== JSON.stringify(draft))
        throw Error("The saved outline could not be confirmed. Reload to check the latest version.");
      setDraft(null);
      setMessage("Outline saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The outline could not be saved.");
    } finally {
      locked.current = false;
      setSaving(false);
    }
  }
  const startPoints = useRef<Point[]>([]);
  const activePoint = draft?.[corner];
  const dims = outlineDimensions(active, image?.bounds, image);
  const original = assessment?.zones.find((z) => active && outlineId(z) === outlineId(active));
  const originalDims = outlineDimensions(original, image?.bounds, image);
  const predicted = originalDims && fitRange(...originalDims, Math.min(6, originalDims[1]), "stalls_90");
  const plotted =
    site?.zones
      .filter((z) => filter === "all" || z.kind === "clear" || kinds[z.kind].option === filter)
      .map((z) => (active && outlineId(z) === outlineId(active) && draft ? { ...z, points: draft } : z)) ||
    [];
  return (
    <>
      <SpaceGeography
        map={map}
        sites={visible}
        site={site}
        active={active}
        draft={draft}
        image={image}
        workspace={open}
        muted={blocked || (!enabled && !open) || inSource}
        layout={filter}
        sketch={sketch} whole={filter==="all" && !area && !draft && !rowTrial}
        overlays={overlays}
        edit={Boolean(draft) && !saving}
        onPick={pick}
        onPoint={move}
      />
      {open && (
        <div className="space-map-open" data-testid="map-spaces-workspace">
          <div className="space-map-header"><header className="space-map-bar">
            <button type="button" className="paper-btn" onClick={() => leave(() => back ? window.location.assign(back) : navigateSpaces(false))}>
              <ChevronLeft size={16} />
              {back ? reviewLabel(back) : "Main map"}
            </button>
            <h2>Spaces</h2>
            {site && (
              <button
                type="button"
                className="paper-btn"
                onClick={() =>
                  leave(() => {
                    setCohort(site.cohort);
                    navigateSpaces(true);
                  })
                }
              >
                Browse spaces
              </button>
            )}
          </header>
          {site && (
            <div className="space-map-layouts space-tabs" role="group" aria-label="Operating layout">
              {(["all",...Object.keys(options)] as ("all"|Option)[]).map((key) => (
                <button
                  type="button"
                  className={key === filter ? "segmented on" : "segmented"}
                  aria-pressed={key === filter}
                  key={key}
                  disabled={saving}
                  onClick={() => {
                    if (key !== filter) leave(() => navigateSpaces(true, site.id, undefined, key === "all" ? undefined : key));
                  }}
                >
                  {key === "all" ? "All areas" : options[key]}
                </button>
              ))}
            </div>
          )}
          </div>
          {site && !draft && (
            <button
              type="button"
              className="paper-btn map-overlay-toggle"
              aria-pressed={overlays}
              onClick={() => setOverlays((v) => !v)}
            >
              {overlays ? "Hide overlays" : "Show overlays"}
            </button>
          )}
          {inSource && (
            <div className="space-map-source">
              {image ? (
                <div
                  className="space-source-surface"
                  style={{ width: zoom * 100 + "%", height: zoom * 100 + "%" }}
                >
                  <OptionAerial
                    image={image}
                    zones={overlays ? plotted : []}
                    sketch={overlays ? sketch : null}
                    focus={site?.zones}
                    labels
                    active={active?.label}
                    reviewed={zones.filter((z) => z.edited).map((z) => z.label)}
                    onSelect={
                      draft
                        ? undefined
                        : (label) => {
                            const z = zones.find((x) => x.label === label);
                            if (z) pick(id, outlineId(z));
                          }
                    }
                    onPoint={draft && !saving ? move : undefined}
                    corner={draft ? corner : undefined}
                    onCorner={setCorner}
                  />
                </div>
              ) : (
                <p role="status">
                  {imageError || "Loading source image…"}{" "}
                  {imageError && (
                    <button type="button" className="text-link" onClick={() => retry((n) => n + 1)}>
                      Retry
                    </button>
                  )}
                </p>
              )}
            </div>
          )}
          {inSource && image && (
            <div className="space-source-zoom" role="group" aria-label="Source zoom">
              <button
                type="button"
                className="paper-btn"
                aria-label="Zoom out of source"
                onClick={() => setZoom((v) => Math.max(1, v - 0.5))}
                disabled={zoom <= 1}
              >
                <Minus size={16} />
              </button>
              <button
                type="button"
                className="paper-btn"
                aria-label="Zoom into source"
                onClick={() => setZoom((v) => Math.min(4, v + 0.5))}
                disabled={zoom >= 4}
              >
                <Plus size={16} />
              </button>
            </div>
          )}
          <aside
            data-map-panel="spaces" data-compact={compactInspector && !discard}
            className={"space-map-inspector" + (site ? " selected" : "")}
            aria-label={site ? "Selected space" : "Analyzed spaces"}
          >
            <MapPanelGrip label="Spaces inspector" />
            <button type="button" className="text-link space-inspector-toggle" aria-controls="space-inspector-content"
              aria-expanded={!compactInspector || Boolean(discard)} disabled={Boolean(discard)} onClick={() => setCompactInspector(value => !value)}>
              {compactInspector && !discard ? "Show space details" : "Hide space details"}
            </button>
            <div id="space-inspector-content">
            {loadError && (
              <p role="alert">
                {loadError}{" "}
                <button type="button" className="text-link" onClick={() => retry((v) => v + 1)}>
                  Retry
                </button>
              </p>
            )}
            {!catalog && !loadError && <p role="status">Loading analyzed spaces…</p>}
            {catalog && !catalog.reviewsAvailable && (
              <p role="status">Showing analysis outlines. Team edits are temporarily unavailable.</p>
            )}
            {catalog && !site && (
              <>
                <h3>Analyzed spaces</h3>
                {id && <p role="status">This site has no analyzed footprints in the current inventory.</p>}
                {selectedSite && onDraw && canWrite(status.actionRole) && (
                  <button
                    type="button"
                    className="paper-btn"
                    data-testid="mark-space"
                    onClick={() => {
                      navigateSpaces(false);
                      onDraw();
                    }}
                  >
                    Draw a lot at the selected site
                  </button>
                )}
                {fromMap && <p>Showing sites from your filtered map. <button type="button" className="text-link" onClick={() => {
                  const url = new URL(window.location.href);
                  url.searchParams.delete("spaceScope");
                  url.searchParams.delete("spaceSite");
                  setRegion(""); setCohort("active"); setSearch(""); setFitCheck("");
                  window.history.pushState(null, "", url);
                }}>Browse all analyzed sites</button></p>}
                {!fromMap && <div className="space-map-filters">
                  <label>
                    Pipeline
                    <select
                      className="secondary"
                      value={cohort}
                      onChange={(e) => setCohort(e.target.value as typeof cohort)}
                    >
                      {Object.entries(cohorts).map(([v, label]) => (
                        <option key={v} value={v}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Market
                    <select
                      className="secondary"
                      value={region}
                      onChange={(e) => setRegion(e.target.value)}
                    >
                      <option value="">All markets</option>
                      {Object.entries(markets).map(([v, label]) => (
                        <option key={v} value={v}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>}
                <label>Physical fit
                  <select className="secondary" aria-label="Physical fit filter" value={fitCheck} onChange={e=>setFitCheck(e.target.value as FitCheck|"")}>
                    <option value="">All fit checks</option>{Object.entries(fitChecks).map(([key,label])=><option value={key} key={key}>{label}</option>)}
                  </select>
                </label>
                <input
                  className="field"
                  aria-label="Find a site or space"
                  placeholder="Find a site or space"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <p>
                  {footprintCount} {footprintCount === 1 ? "space" : "spaces"} across {list.length} {list.length === 1 ? "site" : "sites"}
                </p>
                {list.length === 0 && <p>No analyzed spaces match this view.</p>}
                <div className="space-map-list">
                  {list.map((s) => (
                    <button className="menu-item" type="button" key={s.id} onClick={() => pick(s.id)}>
                      <strong>{s.name}</strong>
                      <small>
                        {s.assessed ? `${s.assessed.stalls} assessed stalls${s.assessed.maximum>s.assessed.stalls ? " · up to "+s.assessed.maximum+" with assumptions" : ""}` : "No system combination"} · {candidates(s).length} {candidates(s).length === 1 ? "space" : "spaces"} ·{" "}
                        {s.frame.bounds ? "Map aligned" : "Source image"}
                      </small>
                    </button>
                  ))}
                </div>
              </>
            )}
            {site && filter==="all" && !area && !draft && assessment && !cases.length && <p className="layer-meta">{catalog?.reviewsAvailable ? "No system combination fits the currently usable, scaled outlines." : "Latest outline edits are unavailable."}</p>}
            {site && filter==="all" && !draft && <ParcelInventory inventory={assessment?.inventory} zones={site.zones}/>}
            {site && !draft && (filter==="all" && !area && cases?.length || rowTrial || canTestRow) ? <div className="parcel-sketch">
              <label>Charging layout<select aria-label="Charging layout" className="secondary" value={selectedCase ? String(caseIndex) : rowTrial ? "row" : "none"} onChange={event=>{
                const value=event.target.value;
                if(value==="row" && active) {
                  const best=bestRow(active,site.frame,site.zones.filter(z=>z.kind==="clear").map(z=>z.points));
                  setEdge(best?.edge ?? 0);setAngle(best?.angle ?? 90);
                }
                if (cases[Number(value)]) {writeMix(cases[Number(value)].name,[]);setStudy("default");}
                else setStudy(value);
              }}>
                <option value="none">Area outlines</option>
                {filter==="all" && !area && cases?.map((c,i)=><option value={i} key={c.name}>{c.system ? "System · " : "Filed · "}{c.name} ({c.rows.reduce((n,r)=>n+r.count,0)})</option>)}
                {canTestRow && <option value="row">Test a row in this area</option>}
              </select></label>
              {rowTrial && active && <div className="space-map-filters"><label>Curb edge<select aria-label="Curb edge" className="secondary" value={edge} onChange={e=>setEdge(Number(e.target.value))}>
                {active.points.map((_,i)=><option key={i} value={i}>Corners {i+1}–{(i+1)%active.points.length+1}</option>)}</select></label>
                <label>Stall angle<select aria-label="Stall angle" className="secondary" value={angle} onChange={e=>setAngle(Number(e.target.value) as Angle)}>{[90,60,45].map(a=><option key={a} value={a}>{a}°</option>)}</select></label></div>}
              {selectedCase && <div className="assessed-mix">
                <strong>{omitted.length ? "Your combination" : selectedCase.system ? "System recommendation" : "Filed alternative"}</strong>
                {selectedCase.system && <small>Highest stall count found under these operating assumptions.</small>}
                {parts.map(p=><label key={p.area}><input className="check" type="checkbox" checked={!omitted.includes(p.area)}
                  onChange={e=>writeMix(selectedCase.name,e.target.checked ? omitted.filter(x=>x!==p.area) : [...omitted,p.area])}/><span>{p.area}</span><b>{p.stalls}</b></label>)}
                {omitted.length>0 && <button type="button" className="text-link" onClick={()=>writeMix(selectedCase.name,[])}>Restore full combination</button>}
                <small>Every included stall uses the same utilization rate.</small>
              </div>}
              {(selectedCase || rowTrial) && <p aria-live="polite"><strong>{sketch ? sketch.stalls.length+" stalls sketched" : selectedCase && !filtered?.rows.length ? "0 stalls selected" : "Layout needs measurement"}</strong>
                {sketch && " · Blue stalls and amber drive aisle."} {sketch?.approach && "Dashed line shows the proposed entry route."} {selectedCase?.condition || (rowTrial && (angle===90 ? "Verify the two-way approach and peak availability." : "Verify one-way entry, exit and peak availability."))} {rowTrial && active?.kind === "ground" && "Development scenario. Verify buildable limits, drainage and paving cost."}</p>}
              {selectedCase && sketch && price && <p className="mix-price"><b>{costRange(price,sketch.stalls.length)}</b> per completed charge
                <small>Base to downside · excludes electricity{price.operatingConversion && !price.ledger.conversionRecorded ? " and unquoted conversion works" : ""}.</small></p>}
              {selectedCase && sketch && <a className="text-link" href={"/charging?"+new URLSearchParams([
                ["site",site.id],["view","explain"],["basis","screen"],["layout",matchingCase?.name || selectedCase.name],
                ...(matchingCase ? [] : omitted).map(p=>["omit",p]),["returnTo","/?"+params.toString()]])}>See cost per charge</a>}
            </div> : null}
            {site && !active && (
              <>
                <small>
                  {markets[site.market] || site.market} · {site.name}
                </small>
                <h3>{options[layout]}</h3>
                <p>
                  {layout === "bays"
                    ? "No bay footprint established. An interior plan or site measurement can establish whether a bay can be released."
                    : layout === "outdoor"
                      ? "No outdoor conversion footprint was identified in this assessment."
                      : "No spare footprint was identified while retaining current operations."}
                </p>
              </>
            )}
            {site && active && (
              <>
                <small>
                  {site.name} · {markets[site.market] || site.market} · {site.id}
                </small>
                <h3 data-testid="map-space-title">{selectedCase ? "Areas on this parcel" : active.label}</h3>
                {(choices.length > 1 || selectedCase) && (
                  <label>
                    Space
                    <select
                      className="secondary"
                      aria-label="Selected footprint"
                      value={selectedCase ? "" : outlineId(active)}
                      disabled={saving}
                      onChange={(e) => pick(site.id, e.target.value)}
                    >
                      {selectedCase && <option value="" disabled>Inspect an area</option>}
                      {choices.map((z) => (
                        <option key={outlineId(z)} value={outlineId(z)}>
                          {z.label}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {!selectedCase && <div className="space-map-status">
                  <span>{active.edited ? "Team-edited outline" : "Analysis proposal"}</span>
                  {prior?.review && <span>{prior.review.disposition==="Dismiss option" ? "Dismissed" : "Kept for diligence"}</span>}
                  <span>{site.frame.bounds ? "Map aligned" : "Source image · alignment needed"}</span>
                </div>}
                {!draft && !selectedCase && !rowTrial && <MapSpaceFit zone={active} image={image} review={prior?.review} />}
                <div className="space-actions">
                  {!draft && !selectedCase && assessment && (
                    <button
                      type="button"
                      className="primary"
                      aria-expanded={reviewOpen}
                      onClick={() => {
                        setReviewOpen((v) => !v);
                        setThread(false);
                      }}
                    >
                      {reviewOpen ? "Close review" : "Review area"}
                    </button>
                  )}
                  {!draft && !selectedCase && canWrite(status.actionRole) && status.enabled && catalog?.reviewsAvailable && (
                    <button
                      type="button"
                      className="paper-btn"
                      onClick={() => {
                        setOverlays(true);
                        setReviewOpen(false);
                        startPoints.current = active.points;
                        setDraft(active.points);
                        setThread(false);
                        setMessage("");
                      }}
                    >
                      <Pencil size={14} /> Edit outline
                    </button>
                  )}
                  {!draft && !selectedCase && (
                    <button
                      type="button"
                      className="paper-btn"
                      aria-expanded={thread}
                      onClick={() => {
                        setThread((v) => !v);
                        setReviewOpen(false);
                      }}
                    >
                      <MessageSquare size={14} /> Comment
                    </button>
                  )}
                  {draft && (
                    <>
                      <button
                        type="button"
                        className="primary"
                        disabled={!dirty || saving}
                        onClick={() => void commit()}
                      >
                        {saving ? "Saving…" : "Save outline"}
                      </button>
                      <button
                        type="button"
                        className="text-link"
                        disabled={saving}
                        onClick={() => {
                          setDraft(null);
                          setMessage("");
                        }}
                      >
                        Cancel edit
                      </button>
                    </>
                  )}
                </div>
                {draft && <p>Drag a corner to adjust this space.</p>}
                {reviewOpen && assessment && (
                  <OptionReview
                    key={site.id + outlineId(active)}
                    site={site.id}
                    option={layout}
                    area={active.label}
                    row={assessment}
                    dimensions={dims}
                    predicted={predicted}
                    prior={prior}
                    points={active.edited ? active.points : undefined}
                    ready={history.state === "ready"}
                    refresh={history.retry}
                    stopEdit={() => {}}
                    clearPoints={() => {}}
                  />
                )}
                {draft && <OutlineTools points={draft} corner={corner} frame={image} disabled={saving} onChange={(next,index)=>{setDraft(next);setCorner(index);}}/>}
                {activePoint && (
                  <details className="disclosure">
                    <summary className="disclosure">Corner coordinates</summary>
                    <label>
                      Corner
                      <select
                        className="secondary"
                        value={corner}
                        onChange={(e) => setCorner(Number(e.target.value))}
                      >
                        {draft!.map((_, i) => (
                          <option key={i} value={i}>
                            {i + 1}
                          </option>
                        ))}
                      </select>
                    </label>
                    {["Horizontal %", "Vertical %"].map((name, i) => (
                      <label key={name}>
                        {name}
                        <input
                          type="number"
                          className="field"
                          min="0"
                          max="100"
                          step=".1"
                          disabled={saving}
                          value={activePoint[i]}
                          onChange={(e) => {
                            const n = e.target.valueAsNumber;
                            if (Number.isFinite(n) && n >= 0 && n <= 100)
                              move(i === 0 ? [n, activePoint[1]] : [activePoint[0], n]);
                          }}
                        />
                      </label>
                    ))}
                  </details>
                )}
                {message && <p role="status">{message}</p>}
                {thread && (
                  <CommentThread
                    key={site.id + outlineId(active)}
                    siteId={site.id}
                    anchor={{
                      type: "space",
                      siteId: site.id,
                      line: "",
                      period: "",
                      spaceId: outlineId(active),
                      label: active.label,
                    }}
                    source="Spaces map"
                    variant="inline"
                  />
                )}
                <details className="disclosure">
                  <summary className="disclosure">Source and site checks</summary>
                  <p>
                    {site.frame.source} · {site.frame.date || "Date unknown"}
                  </p>
                  <p>{active.check || kinds[active.kind].check}</p>
                  {site.frame.bounds && !failed && map && (
                    <button type="button" className="text-link" onClick={() => setSourceView((v) => !v)}>
                      {sourceView ? "Show geographic map" : "Inspect source image"}
                    </button>
                  )}
                  <p>
                    <a
                      className="text-link"
                      href={
                        "/space-review?" +
                        new URLSearchParams({
                          site: site.id,
                          panel: "space-options",
                          outline: outlineId(active),
                        })
                      }
                    >
                      Review layout and economics
                    </a>
                  </p>
                </details>
              </>
            )}
            {!draft && site?.center && onDrawAt && canWrite(status.actionRole) && (
              <button
                type="button"
                className="text-link"
                data-testid="mark-space"
                onClick={() => {
                  navigateSpaces(false);
                  onDrawAt(site.id, site.center!);
                }}
              >
                Draw an additional lot
              </button>
            )}

            {discard && (
              <div role="alert">
                <p>Discard your unsaved corners?</p>
                <button
                  type="button"
                  className="paper-btn"
                  onClick={() => {
                    setDiscard(null);
                  }}
                >
                  Keep editing
                </button>{" "}
                <button
                  type="button"
                  className="text-link"
                  onClick={() => {
                    const next = discard;
                    setDiscard(null);
                    setDraft(null);
                    next();
                  }}
                >
                  Discard edit
                </button>
              </div>
            )}
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
