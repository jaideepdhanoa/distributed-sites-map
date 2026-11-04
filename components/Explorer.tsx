"use client";

import dynamic from "next/dynamic";
import { Fragment, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Detail, { DealDetail } from "./Detail";
import SiteTable, { DealTable } from "./SiteTable";
import { CITY_VIEW, CITIES, compareSites, droppedAt, heldOutside, inStage, nearestDepot, type PipeId, type StageId } from "@/lib/filter";
import { AREA_NOTES, BUSINESS_TYPES, CENSUS_NOTE, FUNNEL_NOTES, STATUS_NOTES, SUMMARY_NOTES, TIER_NOTES, stageTitle } from "@/lib/labels";
import type { AppData, DealFeature, DealProps, SiteFeature, SiteProps } from "@/lib/types";

const MapView = dynamic(() => import("./MapView"), { ssr: false });

const PIPE_STEPS: { id: PipeId; label: string }[] = [
  { id: "desk", label: "Desk screen" },
  { id: "contacted", label: "Contacted" },
  { id: "later", label: "Later stages" },
  { id: "dropped", label: "Dropped" },
];

const STEPS: { id: StageId; label: string }[] = [
  { id: "universe", label: "Universe" },
  { id: "in_area", label: "In service area" },
  { id: "land", label: "Spare land" },
  { id: "county", label: "County-checked" },
  { id: "cleared", label: "Cleared" },
];

export default function Explorer() {
  const params = useSearchParams();
  const router = useRouter();
  const [data, setData] = useState<AppData | null>(null);
  const [detail, setDetail] = useState<SiteProps | null>(null);
  const [me, setMe] = useState<{ u: string; role: string } | null>(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<string | null>(params.get("site"));
  const [tableOpen, setTableOpen] = useState(false);
  const [compare, setCompare] = useState(false);
  const [showDropped, setShowDropped] = useState(false);
  const [layersOpen, setLayersOpen] = useState(true);
  const showAreas = params.get("areas") !== "0";
  const showDepots = params.get("depots") !== "0";
  const showUniverse = params.get("pins") !== "0";
  const showPipeline = params.get("deals") !== "0";
  const showLandLayer = params.get("landlayer") === "1";
  const showDroppedDeals = params.get("dropped") === "1";
  const showRings = params.get("rings") === "1";
  const typesParam = params.get("types");
  const businessTypes = typesParam ? typesParam.split("|").filter(Boolean) : null;
  const tabParam = params.get("tab");
  const tableTab: "universe" | "pipeline" | "land" = tabParam === "pipeline" || tabParam === "land" ? tabParam : "universe";
  const [tip, setTip] = useState("");
  const [copied, setCopied] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [legendOpen, setLegendOpen] = useState(true);

  const city = params.get("city") || "PHX";
  const stageParam = params.get("stage") as StageId | null;
  const stage: StageId = stageParam && STEPS.some((step) => step.id === stageParam) ? stageParam : "land";
  const landTier = params.get("tier") || "any";
  const verdict = params.get("verdict") || "any";
  const listed = params.get("listed") || "any";
  const landSites = params.get("land") === "1";
  const query = params.get("q") || "";
  const funnel = params.get("funnel") === "pipeline" ? "pipeline" : "universe";
  const extraParam = params.get("extra");
  const extra = extraParam === "listed" || extraParam === "contacted" || extraParam === "held" ? extraParam : null;
  const pipeParam = params.get("pstage") as PipeId | null;
  const pipeStage: PipeId = pipeParam && PIPE_STEPS.some((step) => step.id === pipeParam) ? pipeParam : "desk";

  function write(next: Record<string, string | null>) {
    const url = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(next)) {
      if (!value) url.delete(key);
      else url.set(key, value);
    }
    router.replace(`/?${url.toString()}`, { scroll: false });
  }

  function setTableTab(tab: "universe" | "pipeline" | "land") {
    write({ tab: tab === "universe" ? null : tab });
  }

  async function copyLink() {
    await navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  useEffect(() => {
    let cancel = false;
    Promise.all([
      fetch(`/api/data/sites?city=${city}`),
      fetch("/api/data/areas"),
      fetch("/api/data/depots"),
      fetch(`/api/data/parcels?city=${city}`),
      fetch("/api/data/funnel"),
      fetch("/api/data/deals"),
      fetch("/api/me"),
    ]).then(async ([sitesRes, areasRes, depotsRes, parcelsRes, funnelRes, dealsRes, meRes]) => {
      if (sitesRes.status === 401) {
        window.location.href = "/login";
        return;
      }
      if (!sitesRes.ok || !areasRes.ok || !depotsRes.ok || !parcelsRes.ok || !funnelRes.ok || !dealsRes.ok) {
        setError("The site data could not be loaded.");
        return;
      }
      const funnelPayload = await funnelRes.json();
      if (!cancel) {
        setData({
          sites: await sitesRes.json(),
          areas: await areasRes.json(),
          depots: await depotsRes.json(),
          parcels: await parcelsRes.json(),
          deals: await dealsRes.json(),
          funnel: funnelPayload.funnel,
        });
        setMe(meRes.ok ? await meRes.json() : null);
      }
    });
    return () => {
      cancel = true;
    };
  }, [city]);

  const features = data?.sites.features ?? [];
  const featureById = useMemo(() => {
    const map = new Map<string, SiteFeature>();
    for (const feature of features) map.set(feature.properties.site_id, feature);
    return map;
  }, [features]);
  const censusFeatures = features.filter((feature) => feature.properties.origin !== "off-market");
  const sites = censusFeatures.map((feature) => feature.properties);
  const offMarketFeatures = features.filter((feature) => feature.properties.origin === "off-market" && feature.properties.city === city);

  function passesChips(site: SiteProps, loose: boolean) {
    if (site.city !== city) return false;
    if (query) {
      const blob = `${site.site_id} ${site.name} ${site.also_known_as || ""} ${site.address} ${site.apn} ${site.owner}`.toLowerCase();
      if (!blob.includes(query.toLowerCase())) return false;
    }
    if (loose) return true;
    if (landTier !== "any" && site.land_tier !== landTier) return false;
    if (verdict !== "any" && (site.verdict || "none") !== verdict) return false;
    if (listed === "yes" && !site.listed) return false;
    if (!typeOn(site.business_type || "Car wash")) return false;
    return true;
  }

  function typeOn(type: string) {
    return businessTypes === null || businessTypes.includes(type);
  }

  function setBusinessTypes(next: string[] | null) {
    write({ types: next && next.length ? next.join("|") : null });
  }

  function toggleType(type: string) {
    if (businessTypes === null) {
      setBusinessTypes([type]);
      return;
    }
    const next = businessTypes.includes(type)
      ? businessTypes.filter((item) => item !== type)
      : [...businessTypes, type];
    setBusinessTypes(next.length === 0 || next.length === BUSINESS_TYPES.length ? null : next);
  }

  useEffect(() => {
    setTip("");
  }, [funnel, city, stage]);

  const visibleSites = useMemo(() => {
    const byId = new Map<string, SiteProps>();
    const add = (list: SiteProps[]) => {
      for (const site of list) byId.set(site.site_id, site);
    };
    if (compare) {
      add(sites.filter((site) => site.verdict_disagreement && passesChips(site, true)));
    } else if (extra === "held") {
      add(sites.filter((site) => heldOutside(site) && passesChips(site, true)));
    } else if (extra === "listed") {
      add(sites.filter((site) => site.city === city && inStage(site, stage) && site.listed && passesChips(site, true)));
    } else if (extra === "contacted") {
      add(sites.filter((site) => site.city === city && inStage(site, stage) && site.contacted && passesChips(site, true)));
    } else {
      add(sites.filter((site) => inStage(site, stage) && passesChips(site, false)));
      if (showDropped) add(sites.filter((site) => droppedAt(site, stage) && passesChips(site, true)));
      if (landSites) add(sites.filter((site) => site.land_only && passesChips(site, true)));
    }
    return [...byId.values()].sort(compareSites);
    // passesChips closes over the chip state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [features, stage, city, landTier, verdict, listed, landSites, showDropped, compare, query, extra, businessTypes]);

  const visibleFeatures: SiteFeature[] = visibleSites
    .map((site) => featureById.get(site.site_id))
    .filter((feature): feature is SiteFeature => Boolean(feature));

  const dealFeatures = data?.deals.features ?? [];
  const dealRows = dealFeatures.map((feature) => feature.properties);

  function dealMatches(deal: DealProps) {
    if (deal.city !== city) return false;
    if (query) {
      const blob = `${deal.deal_id} ${deal.name} ${deal.address} ${deal.broker} ${deal.firm} ${deal.universe_id}`.toLowerCase();
      if (!blob.includes(query.toLowerCase())) return false;
    }
    if (funnel === "pipeline" && deal.kind === "pipeline" && deal.stage_group !== pipeStage) return false;
    if (!typeOn(deal.business_type || "Other")) return false;
    return true;
  }

  const pipelineDeals = dealRows.filter((deal) => deal.kind === "pipeline" && dealMatches(deal) && (deal.stage_group !== "dropped" || showDroppedDeals || (funnel === "pipeline" && pipeStage === "dropped")));
  const landDeals = dealRows.filter((deal) => deal.kind === "land" && deal.city === city && typeOn(deal.business_type || "Other") && (!query || `${deal.name} ${deal.address}`.toLowerCase().includes(query.toLowerCase())));

  function dealPoint(deal: DealProps): [number, number] | null {
    if (deal.universe_id) {
      const site = featureById.get(deal.universe_id);
      const coords = site?.geometry?.coordinates;
      if (coords) return [coords[0], coords[1]];
    }
    const feature = dealFeatures.find((item) => item.properties.deal_id === deal.deal_id);
    const coords = feature?.geometry?.coordinates;
    return coords ? [coords[0], coords[1]] : null;
  }

  function asSquare(deal: DealProps): DealFeature | null {
    const feature = dealFeatures.find((item) => item.properties.deal_id === deal.deal_id);
    const point = dealPoint(deal);
    if (!feature || !point) return null;
    return { ...feature, geometry: { type: "Point", coordinates: point } };
  }

  const pipelineStepRows = dealRows.filter((deal) => {
    if (deal.kind !== "pipeline" || deal.city !== city || deal.stage_group !== pipeStage) return false;
    if (!typeOn(deal.business_type || "Other")) return false;
    if (!query) return true;
    const blob = `${deal.deal_id} ${deal.name} ${deal.address} ${deal.broker} ${deal.firm} ${deal.universe_id}`.toLowerCase();
    return blob.includes(query.toLowerCase());
  });
  const pipelineSquares = pipelineStepRows.map(asSquare).filter((feature): feature is DealFeature => Boolean(feature));
  const drawnDeals: DealFeature[] = funnel === "pipeline"
    ? (showPipeline ? pipelineSquares : [])
    : [
        ...(showPipeline ? pipelineDeals.filter((deal) => !deal.universe_id) : []),
        ...(showLandLayer ? landDeals : []),
      ]
        .map((deal) => dealFeatures.find((feature) => feature.properties.deal_id === deal.deal_id))
        .filter((feature): feature is DealFeature => Boolean(feature?.geometry));
  const linkedIds = new Set(pipelineSquares.map((feature) => feature.properties.universe_id).filter(Boolean));
  const pipelineSites = features.filter((feature) => linkedIds.has(feature.properties.site_id) && feature.geometry);

  const selectedSite = detail && detail.site_id === selected
    ? detail
    : sites.find((site) => site.site_id === selected)
      ?? offMarketFeatures.find((feature) => feature.properties.site_id === selected)?.properties
      ?? null;
  const selectedDeal = dealRows.find((deal) => deal.deal_id === selected) ?? null;

  useEffect(() => {
    if (!selected) return;
    let cancel = false;
    fetch(`/api/data/sites/${encodeURIComponent(selected)}`).then(async (response) => {
      if (!response.ok) return;
      const payload = (await response.json()) as SiteProps;
      if (!cancel) setDetail(payload);
    });
    return () => {
      cancel = true;
    };
  }, [selected]);

  function choose(id: string | null) {
    setSelected(id);
    write({ site: id });
  }

  function jump(nextCity: string) {
    setSelected(null);
    write({ city: nextCity === "PHX" ? null : nextCity, site: null });
  }

  function count(step: StageId) {
    return sites.filter((site) => site.city === city && inStage(site, step)).length;
  }

  function subcount(step: StageId, field: "listed" | "contacted") {
    return sites.filter((site) => site.city === city && inStage(site, step) && site[field]).length;
  }

  const heldCount = sites.filter((site) => site.city === city && heldOutside(site)).length;
  const censusForCity = data?.funnel.stages.find((item) => item.id === "census")?.by_city?.[city] ?? 0;

  async function logout() {
    await fetch("/api/logout", { method: "POST" });
    window.location.href = "/login";
  }

  if (error) return <main className="empty">{error}</main>;
  if (!data) return <main className="empty">Loading</main>;

  const focus = CITY_VIEW[city] ?? CITY_VIEW.PHX;
  const dropCount = sites.filter((site) => droppedAt(site, stage) && site.city === city).length;
  const place = city === "PHX" ? "Phoenix" : city === "LAS" ? "Las Vegas" : "Miami";

  function summaryText() {
    if (funnel === "pipeline") {
      const rows = dealRows.filter((deal) => deal.kind === "pipeline" && deal.city === city);
      const desk = rows.filter((deal) => deal.stage_group === "desk").length;
      const dropped = rows.filter((deal) => deal.stage_group === "dropped").length;
      const active = rows.length - dropped;
      return `${place}: ${active} active deals (${desk} desk screen), ${dropped} dropped`;
    }
    const candidates = sites.filter((site) => site.city === city && inStage(site, "land")).length;
    const cleared = sites.filter((site) => site.city === city && inStage(site, "cleared")).length;
    return `${place}: ${candidates} candidates, ${cleared} cleared`;
  }

  return (
    <div className={`shell ${tableOpen ? "table-open" : ""} ${selected ? "drawer-open" : ""}`} data-visible={visibleSites.length} data-city={city} data-stage={stage}>
      <header className="bar">
        <div className="bar-row">
          <h1 className="word">Sites</h1>
          <div className="cities">
            {CITIES.map((item) => (
              <button key={item} className={city === item ? "on" : ""} type="button" onClick={() => jump(item)}>
                {item === "PHX" ? "Phoenix" : item === "LAS" ? "Las Vegas" : "Miami"}
              </button>
            ))}
          </div>
          <input className="search" placeholder="Address, APN, owner, id" value={query} onChange={(event) => write({ q: event.target.value || null })} />
          <div className="who">
            <span>{me?.u}</span>
            {me?.role === "admin" ? <a href="/admin">Accounts</a> : null}
            <button type="button" onClick={logout}>Sign out</button>
          </div>
        </div>
        <div className="funnel-switch">
          <button className={funnel === "universe" ? "on" : ""} type="button" onClick={() => write({ funnel: null, tab: null })}>Universe funnel</button>
          <button className={funnel === "pipeline" ? "on" : ""} type="button" onClick={() => write({ funnel: "pipeline", tab: "pipeline" })}>Pipeline funnel</button>
        </div>
        {funnel === "universe" ? (
          <p className="census-note" title={CENSUS_NOTE} onMouseEnter={() => setTip(CENSUS_NOTE)} onMouseLeave={() => setTip("")}>Car washes</p>
        ) : null}
        <div className="type-filters" aria-label="Business type">
          <button type="button" className={businessTypes === null ? "on" : ""} onClick={() => setBusinessTypes(null)}>All types</button>
          {BUSINESS_TYPES.map((type) => {
            const inStep = sites.filter((site) => site.city === city && inStage(site, stage) && (site.business_type || "Car wash") === type).length;
            const offCount = offMarketFeatures.filter((feature) => (feature.properties.business_type || "Other") === type).length;
            const count = funnel === "pipeline"
              ? dealRows.filter((deal) => deal.kind === "pipeline" && deal.city === city && deal.stage_group === pipeStage && (deal.business_type || "Other") === type && Boolean(dealPoint(deal))).length
              : inStep || offCount;
            if (count === 0 && type !== "Car wash") return null;
            return (
              <button key={type} type="button" className={typeOn(type) && businessTypes !== null ? "on" : businessTypes === null ? "on" : ""} onClick={() => toggleType(type)}>
                {type} {count.toLocaleString()}
              </button>
            );
          })}
        </div>
        <nav className="funnel" aria-label="Funnel">
          {funnel === "universe" ? STEPS.map((step, index) => {
            const listedHere = subcount(step.id, "listed");
            const contactedHere = subcount(step.id, "contacted");
            const note = step.id === "universe"
              ? `Built from ${censusForCity.toLocaleString()} census records. The count keeps the rows the workbook includes.`
              : FUNNEL_NOTES[step.id];
            return (
              <Fragment key={step.id}>
                {index > 0 ? <span className="chev" aria-hidden="true">›</span> : null}
                <span className="step">
                  <button className={stage === step.id && extra !== "listed" && extra !== "contacted" ? "on" : ""} type="button" aria-current={stage === step.id && !extra ? "step" : undefined} title={note} onMouseEnter={() => setTip(note)} onMouseLeave={() => setTip("")} onClick={() => { setShowDropped(false); write({ stage: step.id === "land" ? null : step.id, extra: null }); }}>
                    <span>{step.label}</span>
                    <strong>{count(step.id).toLocaleString()}</strong>
                  </button>
                  {listedHere > 0 ? (
                    <button className={`sub ${extra === "listed" && stage === step.id ? "on" : ""}`} type="button" title={FUNNEL_NOTES.listed} onMouseEnter={() => setTip(FUNNEL_NOTES.listed)} onMouseLeave={() => setTip("")} onClick={() => write({ stage: step.id === "land" ? null : step.id, extra: extra === "listed" ? null : "listed" })}>
                      · {listedHere.toLocaleString()} listed
                    </button>
                  ) : null}
                  {contactedHere > 0 ? (
                    <button className={`sub ${extra === "contacted" && stage === step.id ? "on" : ""}`} type="button" title={FUNNEL_NOTES.contacted} onMouseEnter={() => setTip(FUNNEL_NOTES.contacted)} onMouseLeave={() => setTip("")} onClick={() => write({ stage: step.id === "land" ? null : step.id, extra: extra === "contacted" ? null : "contacted" })}>
                      · {contactedHere.toLocaleString()} contacted
                    </button>
                  ) : null}
                </span>
                {step.id === "land" && heldCount > 0 ? (
                  <button className={`aside ${extra === "held" ? "on" : ""}`} type="button" onClick={() => write({ stage: null, extra: extra === "held" ? null : "held" })}>
                    {heldCount} held outside the service area
                  </button>
                ) : null}
              </Fragment>
            );
          }) : PIPE_STEPS.map((step, index) => {
            const rows = dealRows.filter((deal) => deal.kind === "pipeline" && deal.city === city && deal.stage_group === step.id && typeOn(deal.business_type || "Other"));
            const squares = rows.filter((deal) => dealPoint(deal)).length;
            const unmapped = rows.length - squares;
            return (
              <Fragment key={step.id}>
                {index > 0 ? <span className="chev" aria-hidden="true">›</span> : null}
                <span className="step">
                  <button className={pipeStage === step.id ? "on" : ""} type="button" aria-current={pipeStage === step.id ? "step" : undefined} title={FUNNEL_NOTES[step.id]} onMouseEnter={() => setTip(FUNNEL_NOTES[step.id])} onMouseLeave={() => setTip("")} onClick={() => write({ pstage: step.id === "desk" ? null : step.id })}>
                    <span>{step.label}</span>
                    <strong>{squares.toLocaleString()}</strong>
                  </button>
                  {unmapped > 0 ? <span className="sub">{unmapped.toLocaleString()} without a location</span> : null}
                </span>
              </Fragment>
            );
          })}
        </nav>
        {funnel === "pipeline" ? (
          <details className="unplaced">
            <summary>
              {dealRows.filter((deal) => deal.kind === "pipeline" && deal.city === city && !dealPoint(deal)).length.toLocaleString()} unplaced deals
            </summary>
            <ul>
              {dealRows.filter((deal) => deal.kind === "pipeline" && deal.city === city && !dealPoint(deal)).map((deal) => (
                <li key={deal.deal_id}>
                  <button type="button" className="text-link" onClick={() => choose(deal.deal_id)}>{deal.name || deal.address || deal.deal_id}</button>
                  {" · "}{stageTitle(deal.stage_group)}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
        <div className="chips">
          {funnel === "universe" ? (
            <>
              {(["any", "L10", "L4"] as const).map((item) => (
                <button key={item} className={landTier === item ? "on" : ""} type="button" title={item === "any" ? "" : TIER_NOTES[item].note} onMouseEnter={() => item !== "any" && setTip(TIER_NOTES[item].note)} onMouseLeave={() => setTip("")} onClick={() => write({ tier: item === "any" ? null : item })}>
                  {item === "any" ? "All tiers" : TIER_NOTES[item].label}
                </button>
              ))}
              {[
                ["any", "All statuses"],
                ["PASS", "Cleared"],
                ["MAYBE", "Possible"],
                ["UNRESOLVED", "Unresolved"],
              ].map(([item, label]) => (
                <button key={item} className={verdict === item ? "on" : ""} type="button" onClick={() => write({ verdict: item === "any" ? null : item })}>
                  {label}
                </button>
              ))}
              <button className={listed === "yes" ? "on" : ""} type="button" onClick={() => write({ listed: listed === "yes" ? null : "yes" })}>Listed</button>
              <button className={landSites ? "on" : ""} type="button" onClick={() => write({ land: landSites ? null : "1" })}>Land sites</button>
              <button className={compare ? "on" : ""} type="button" onClick={() => setCompare((value) => !value)}>Compare</button>
              {dropCount > 0 ? (
                <button className={showDropped ? "on" : ""} type="button" onClick={() => setShowDropped((value) => !value)}>
                  Ruled out ({dropCount.toLocaleString()})
                </button>
              ) : null}
            </>
          ) : null}
          <button className={tableOpen ? "on" : ""} type="button" onClick={() => setTableOpen((value) => !value)}>Table</button>
          <button type="button" onClick={() => setGuideOpen((value) => !value)}>How to read this</button>
          <button type="button" onClick={() => void copyLink()}>{copied ? "Link copied" : "Copy link"}</button>
          <span
            className="summary-chip"
            title={funnel === "pipeline" ? SUMMARY_NOTES.pipeline : SUMMARY_NOTES.universe}
            onMouseEnter={() => setTip(funnel === "pipeline" ? SUMMARY_NOTES.pipeline : SUMMARY_NOTES.universe)}
            onMouseLeave={() => setTip("")}
          >
            {summaryText()}
          </span>
        </div>
      </header>
      <div className="map-stage">
        <MapView
          sites={funnel === "pipeline" ? (showUniverse ? pipelineSites : []) : (showUniverse ? visibleFeatures : [])}
          deals={drawnDeals}
          areas={data.areas.features}
          depots={data.depots.features}
          parcels={data.parcels.features}
          offMarket={funnel === "pipeline" ? [] : offMarketFeatures.filter((feature) => typeOn(feature.properties.business_type || "Other"))}
          selectedId={selected}
          showAreas={showAreas}
          showDepots={showDepots}
          showSites={showUniverse}
          showRings={showRings}
          focusLng={focus.center[0]}
          focusLat={focus.center[1]}
          focusZoom={focus.zoom}
          onSelect={(id) => {
            if (dealRows.some((deal) => deal.deal_id === id)) setTableTab(dealRows.find((deal) => deal.deal_id === id)?.kind === "land" ? "land" : "pipeline");
            choose(id);
          }}
          onBounds={() => undefined}
        />
        <aside className="layers">
          <button type="button" onClick={() => setLayersOpen((value) => !value)}>{layersOpen ? "Layers" : "Layers"}</button>
          {layersOpen ? (
            <>
              <label><input type="checkbox" checked={showAreas} onChange={(event) => write({ areas: event.target.checked ? null : "0" })} /> Service areas</label>
              <label><input type="checkbox" checked={showDepots} onChange={(event) => write({ depots: event.target.checked ? null : "0" })} /> Depots</label>
              <label><input type="checkbox" checked={showUniverse} onChange={(event) => write({ pins: event.target.checked ? null : "0" })} /> Universe sites</label>
              <label><input type="checkbox" checked={showPipeline} onChange={(event) => write({ deals: event.target.checked ? null : "0" })} /> Pipeline deals</label>
              <label><input type="checkbox" checked={showLandLayer} onChange={(event) => write({ landlayer: event.target.checked ? "1" : null })} /> Land Sites</label>
              <label><input type="checkbox" checked={showDroppedDeals} onChange={(event) => write({ dropped: event.target.checked ? "1" : null })} /> Dropped deals</label>
              <label><input type="checkbox" checked={showRings} onChange={(event) => write({ rings: event.target.checked ? "1" : null })} /> Depot rings</label>
            </>
          ) : null}
        </aside>
        <div className="legend" onMouseLeave={() => setTip("")}>
          <button type="button" onClick={() => setLegendOpen((value) => !value)}>{legendOpen ? "Hide legend" : "Legend"}</button>
          {legendOpen ? (
            <ul>
              {STATUS_NOTES.map((item) => (
                <li key={item.id} onMouseEnter={() => setTip(item.note)} onMouseLeave={() => setTip("")}>
                  <i className={`swatch ${item.id}`} /> {item.label}
                </li>
              ))}
              <li onMouseEnter={() => setTip(TIER_NOTES.L10.note)} onMouseLeave={() => setTip("")}><i className="swatch l10" /> {TIER_NOTES.L10.label}</li>
              <li onMouseEnter={() => setTip(TIER_NOTES.L4.note)} onMouseLeave={() => setTip("")}><i className="swatch l4" /> {TIER_NOTES.L4.label}</li>
              <li onMouseEnter={() => setTip(AREA_NOTES.current)} onMouseLeave={() => setTip("")}><i className="swatch current-area" /> Current area</li>
              <li onMouseEnter={() => setTip(AREA_NOTES.later)} onMouseLeave={() => setTip("")}><i className="swatch later-area" /> Later expansion</li>
            </ul>
          ) : null}
          {tip ? <p className="tip">{tip}</p> : null}
        </div>
        {guideOpen ? (
          <aside className="guide">
            <button className="close" type="button" onClick={() => setGuideOpen(false)}>Close</button>
            <h2>How to read this</h2>
            <p>The universe funnel starts with one site for each place. The hover note on Universe says how many census records were merged to get there. Each later step keeps only the sites that passed the step before it.</p>
            <p>When a step has sites on the market, a count beside it lists them. Click that count to show those sites. A larger site has about 10,000 sq ft of spare land. A smaller site has about 4,000.</p>
            <p>Held sites are cleared on the land, but they sit outside the current service area. They are not counted in the in-area steps.</p>
            <ul>
              {STATUS_NOTES.map((item) => <li key={item.id}><strong>{item.label}.</strong> {item.note}</li>)}
            </ul>
          </aside>
        ) : null}
        {selectedDeal ? (
          <DealDetail
            deal={selectedDeal}
            universeName={sites.find((site) => site.site_id === selectedDeal.universe_id)?.name}
            depotMiles={selectedDeal.miles_to_depot}
            lng={dealPoint(selectedDeal)?.[0]}
            lat={dealPoint(selectedDeal)?.[1]}
            onOpenSite={selectedDeal.universe_id ? () => choose(selectedDeal.universe_id) : undefined}
            onClose={() => choose(null)}
          />
        ) : selectedSite ? (
          <Detail
            site={selectedSite}
            lng={featureById.get(selectedSite.site_id)?.geometry?.coordinates?.[0]}
            lat={featureById.get(selectedSite.site_id)?.geometry?.coordinates?.[1]}
            depotMiles={(() => {
              const feature = featureById.get(selectedSite.site_id);
              const coords = feature?.geometry?.coordinates;
              if (!coords || !data) return selectedSite.miles_to_depot;
              return nearestDepot(coords[0], coords[1], data.depots.features)?.miles ?? selectedSite.miles_to_depot;
            })()}
            onOpenDeal={selectedSite.linked_deal_id ? () => choose(selectedSite.linked_deal_id || null) : undefined}
            onClose={() => choose(null)}
          />
        ) : null}
      </div>
      {tableOpen ? (
        <section className="dock">
          <div className="dock-tabs">
            {(["universe", "pipeline", "land"] as const).map((tab) => (
              <button key={tab} className={tableTab === tab ? "on" : ""} type="button" onClick={() => setTableTab(tab)}>
                {tab === "universe" ? "Universe" : tab === "pipeline" ? "Pipeline" : "Land"}
              </button>
            ))}
          </div>
          {tableTab === "universe" ? <SiteTable rows={visibleSites} selectedId={selected} onSelect={choose} /> : null}
          {tableTab === "pipeline" ? <DealTable rows={pipelineDeals} selectedId={selected} onSelect={choose} /> : null}
          {tableTab === "land" ? <DealTable rows={landDeals} selectedId={selected} onSelect={choose} /> : null}
        </section>
      ) : null}
    </div>
  );
}
