"use client";

import dynamic from "next/dynamic";
import { Fragment, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Detail, { DealDetail } from "./Detail";
import SiteTable, { DealTable } from "./SiteTable";
import { CITY_VIEW, CITIES, compareSites, droppedAt, heldOutside, inStage, nearestDepot, type PipeId, type StageId } from "@/lib/filter";
import { AREA_NOTES, BUSINESS_TYPES, CENSUS_NOTE, FUNNEL_NOTES, STATUS_NOTES, SUMMARY_NOTES, TIER_NOTES, plainVerdict, stageTitle, tierLabel } from "@/lib/labels";
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
  const [layersOpen, setLayersOpen] = useState(false);
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
  const compareIds = (params.get("compare") || "").split("|").filter(Boolean).slice(0, 4);
  const [changesNote, setChangesNote] = useState("");
  const [guideOpen, setGuideOpen] = useState(false);
  const [legendOpen, setLegendOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [sheetExpanded, setSheetExpanded] = useState(false);
  const [unplacedOpen, setUnplacedOpen] = useState(false);

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
        const changes = funnelPayload.meta?.changes;
        if (changes && typeof changes.new_sites === "number") {
          setChangesNote(`Since the previous build: ${changes.new_sites} new sites, ${changes.verdict_changes} verdict changes, ${changes.stage_moves} stage moves.`);
        }
      }
    });
    return () => {
      cancel = true;
    };
  }, [city]);

  useEffect(() => {
    const media = window.matchMedia("(min-width: 1100px)");
    const apply = () => setLayersOpen(media.matches);
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    setSheetExpanded(false);
  }, [selected]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setFiltersOpen(false);
      setMoreOpen(false);
      setUserOpen(false);
      setMenuOpen(false);
      setUnplacedOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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

  function exportTable() {
    const rows = tableTab === "pipeline" ? pipelineDeals : tableTab === "land" ? landDeals : visibleSites;
    const headers = tableTab === "universe"
      ? ["site_id", "name", "address", "city", "verdict", "zoning", "flood_zone", "year_built", "miles_to_depot", "confidence", "owner"]
      : ["deal_id", "name", "address", "city", "stage", "firm", "asking_price_display"];
    const lines = [headers.join(",")];
    for (const row of rows as Record<string, unknown>[]) {
      lines.push(headers.map((key) => `"${String(row[key] ?? "").replace(/"/g, "\"\"")}"`).join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${city}-${tableTab}.csv`;
    link.click();
  }

  function addCompare(id: string) {
    const next = compareIds.includes(id) ? compareIds.filter((item) => item !== id) : compareIds.length >= 4 ? compareIds : [...compareIds, id];
    write({ compare: next.length ? next.join("|") : null });
  }

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

  const sheet = { expanded: sheetExpanded, onToggle: () => setSheetExpanded((value) => !value) };
  const unplacedDeals = dealRows.filter((deal) => deal.kind === "pipeline" && deal.city === city && !dealPoint(deal));

  const activeFilters: { id: string; label: string; clear: () => void }[] = [];
  if (businessTypes) activeFilters.push({ id: "types", label: businessTypes.join(", "), clear: () => setBusinessTypes(null) });
  if (landTier !== "any") activeFilters.push({ id: "tier", label: tierLabel(landTier) || "Spare land", clear: () => write({ tier: null }) });
  if (verdict !== "any") activeFilters.push({ id: "verdict", label: plainVerdict(verdict), clear: () => write({ verdict: null }) });
  if (listed === "yes") activeFilters.push({ id: "listed", label: "Listed", clear: () => write({ listed: null }) });
  if (landSites) activeFilters.push({ id: "land", label: "Land sites", clear: () => write({ land: null }) });
  if (compare) activeFilters.push({ id: "compare", label: "Reviews disagree", clear: () => setCompare(false) });
  if (showDropped) activeFilters.push({ id: "ruled", label: "Ruled out", clear: () => setShowDropped(false) });
  if (extra === "held") activeFilters.push({ id: "held", label: "Held outside the service area", clear: () => write({ extra: null }) });

  function closeMenus() {
    setFiltersOpen(false);
    setMoreOpen(false);
    setUserOpen(false);
    setMenuOpen(false);
    setUnplacedOpen(false);
  }

  function summaryText() {
    if (funnel === "pipeline") {
      const rows = dealRows.filter((deal) => deal.kind === "pipeline" && deal.city === city);
      const desk = rows.filter((deal) => deal.stage_group === "desk").length;
      const dropped = rows.filter((deal) => deal.stage_group === "dropped").length;
      const active = rows.length - dropped;
      return `${active} active deals (${desk} desk screen), ${dropped} dropped`;
    }
    const candidates = sites.filter((site) => site.city === city && inStage(site, "land")).length;
    const cleared = sites.filter((site) => site.city === city && inStage(site, "cleared")).length;
    return `${candidates} candidates, ${cleared} cleared`;
  }

  return (
    <div className={`shell ${tableOpen ? "table-open" : ""} ${selected ? "drawer-open" : ""}`} data-visible={visibleSites.length} data-city={city} data-stage={stage}>
      {(filtersOpen || moreOpen || userOpen || menuOpen || unplacedOpen) ? (
        <button className="backdrop" type="button" aria-label="Close menu" onClick={closeMenus} />
      ) : null}
      <header className="bar">
        <div className="top">
          <h1 className="word">Sites</h1>
          <div className="cities only-desktop" role="group" aria-label="City">
            {CITIES.map((item) => (
              <button key={item} className={city === item ? "on" : ""} type="button" onClick={() => jump(item)}>
                {item === "PHX" ? "Phoenix" : item === "LAS" ? "Las Vegas" : "Miami"}
              </button>
            ))}
          </div>
          <label className="city-pick only-mobile">
            <span className="sr">City</span>
            <select aria-label="City" value={city} onChange={(event) => jump(event.target.value)}>
              <option value="PHX">Phoenix</option>
              <option value="LAS">Las Vegas</option>
              <option value="MIA">Miami</option>
            </select>
          </label>
          <input className="search only-desktop" placeholder="Address, APN, owner, id" value={query} onChange={(event) => write({ q: event.target.value || null })} />
          <div className="funnel-switch only-desktop" role="group" aria-label="Which funnel">
            <button className={funnel === "universe" ? "on" : ""} type="button" onClick={() => write({ funnel: null, tab: null })}>Universe</button>
            <button className={funnel === "pipeline" ? "on" : ""} type="button" onClick={() => write({ funnel: "pipeline", tab: "pipeline" })}>Pipeline</button>
          </div>
          <div className="user-menu only-desktop">
            <button className="avatar" type="button" aria-haspopup="menu" aria-expanded={userOpen} aria-label={me?.u ? `Account menu for ${me.u}` : "Account menu"} onClick={() => { setUserOpen((value) => !value); setFiltersOpen(false); setMoreOpen(false); }}>
              {(me?.u || "?").slice(0, 1).toUpperCase()}
            </button>
            {userOpen ? (
              <div className="menu" role="menu">
                <p className="menu-note">{me?.u}</p>
                {me?.role === "admin" ? <a role="menuitem" href="/admin">Accounts</a> : null}
                <button type="button" role="menuitem" onClick={logout}>Sign out</button>
              </div>
            ) : null}
          </div>
          <button className="icon-btn only-mobile" type="button" aria-pressed={searchOpen} aria-label={searchOpen ? "Hide search" : "Search"} onClick={() => setSearchOpen((value) => !value)}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6" /><path d="M16 16l5 5" /></svg>
          </button>
          <button className="icon-btn only-mobile" type="button" aria-expanded={menuOpen} aria-label="Menu" onClick={() => { setMenuOpen((value) => !value); setFiltersOpen(false); }}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
          </button>
        </div>
        {searchOpen ? (
          <input className="search mobile-search" placeholder="Address, APN, owner, id" value={query} onChange={(event) => write({ q: event.target.value || null })} />
        ) : null}
        <div className="funnel-row">
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
                        {listedHere.toLocaleString()} listed
                      </button>
                    ) : null}
                    {contactedHere > 0 ? (
                      <button className={`sub ${extra === "contacted" && stage === step.id ? "on" : ""}`} type="button" title={FUNNEL_NOTES.contacted} onMouseEnter={() => setTip(FUNNEL_NOTES.contacted)} onMouseLeave={() => setTip("")} onClick={() => write({ stage: step.id === "land" ? null : step.id, extra: extra === "contacted" ? null : "contacted" })}>
                        {contactedHere.toLocaleString()} contacted
                      </button>
                    ) : null}
                  </span>
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
            {funnel === "pipeline" && unplacedDeals.length > 0 ? (
              <button className={`aside ${unplacedOpen ? "on" : ""}`} type="button" onClick={() => { setUnplacedOpen((value) => !value); setMoreOpen(false); setFiltersOpen(false); }}>
                {unplacedDeals.length.toLocaleString()} unplaced
              </button>
            ) : null}
          </nav>
          <span
            className="summary-chip"
            title={funnel === "pipeline" ? SUMMARY_NOTES.pipeline : SUMMARY_NOTES.universe}
            onMouseEnter={() => setTip(funnel === "pipeline" ? SUMMARY_NOTES.pipeline : SUMMARY_NOTES.universe)}
            onMouseLeave={() => setTip("")}
          >
            {summaryText()}
          </span>
          <button className={`tool only-desktop ${filtersOpen ? "on" : ""}`} type="button" aria-expanded={filtersOpen} onClick={() => { setFiltersOpen((value) => !value); setMoreOpen(false); setUserOpen(false); setUnplacedOpen(false); }}>
            Filters
            {activeFilters.length ? <span className="count-badge">{activeFilters.length}</span> : null}
          </button>
          <div className="more-wrap only-desktop">
            <button className={`tool ${moreOpen ? "on" : ""}`} type="button" aria-expanded={moreOpen} onClick={() => { setMoreOpen((value) => !value); setFiltersOpen(false); setUserOpen(false); setUnplacedOpen(false); }}>More</button>
            {moreOpen ? (
              <div className="menu" role="menu">
                <button type="button" onClick={exportTable}>Export CSV</button>
                <button type="button" onClick={() => { setTableOpen((value) => !value); setMoreOpen(false); }}>{tableOpen ? "Hide table" : "Table"}</button>
                <button type="button" onClick={() => void copyLink()}>{copied ? "Link copied" : "Copy link"}</button>
                <button type="button" onClick={() => { setGuideOpen(true); setMoreOpen(false); }}>How to read this</button>
                {changesNote ? <p className="menu-note">{changesNote}</p> : null}
              </div>
            ) : null}
          </div>
        </div>
        {activeFilters.length ? (
          <div className="active-row" aria-label="Active filters">
            {activeFilters.map((item) => (
              <button key={item.id} className="removable" type="button" onClick={item.clear}>
                {item.label}
                <span aria-hidden="true">×</span>
                <span className="sr">Remove</span>
              </button>
            ))}
          </div>
        ) : null}
        {filtersOpen ? (
          <div className="popover" role="dialog" aria-label="Filters">
            <div className="popover-head">
              <h2>Filters</h2>
              <button type="button" onClick={() => setFiltersOpen(false)}>Close</button>
            </div>
            <h3>Business type</h3>
            <div className="type-filters">
              <button type="button" className={businessTypes === null ? "on" : ""} onClick={() => setBusinessTypes(null)}>All types</button>
              {BUSINESS_TYPES.map((type) => {
                const inStep = sites.filter((site) => site.city === city && inStage(site, stage) && (site.business_type || "Car wash") === type).length;
                const offCount = offMarketFeatures.filter((feature) => (feature.properties.business_type || "Other") === type).length;
                const shown = funnel === "pipeline"
                  ? dealRows.filter((deal) => deal.kind === "pipeline" && deal.city === city && deal.stage_group === pipeStage && (deal.business_type || "Other") === type && Boolean(dealPoint(deal))).length
                  : inStep || offCount;
                if (shown === 0 && type !== "Car wash") return null;
                return (
                  <button key={type} type="button" title={type === "Car wash" ? CENSUS_NOTE : undefined} className={typeOn(type) && businessTypes !== null ? "on" : businessTypes === null ? "on" : ""} onClick={() => toggleType(type)}>
                    {type} {shown.toLocaleString()}
                  </button>
                );
              })}
            </div>
            {funnel === "universe" ? (
              <>
                <h3>Spare land</h3>
                <div className="chips">
                  {(["any", "L10", "L4"] as const).map((item) => (
                    <button key={item} className={landTier === item ? "on" : ""} type="button" title={item === "any" ? "" : TIER_NOTES[item].note} onMouseEnter={() => item !== "any" && setTip(TIER_NOTES[item].note)} onMouseLeave={() => setTip("")} onClick={() => write({ tier: item === "any" ? null : item })}>
                      {item === "any" ? "All tiers" : <><i className={`swatch ${item === "L10" ? "l10" : "l4"}`} /> {TIER_NOTES[item].label}</>}
                    </button>
                  ))}
                </div>
                <h3>Status</h3>
                <div className="chips">
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
                  <button className={compare ? "on" : ""} type="button" onClick={() => setCompare((value) => !value)}>Reviews disagree</button>
                  {dropCount > 0 ? (
                    <button className={showDropped ? "on" : ""} type="button" onClick={() => setShowDropped((value) => !value)}>
                      Ruled out ({dropCount.toLocaleString()})
                    </button>
                  ) : null}
                  {heldCount > 0 ? (
                    <button className={extra === "held" ? "on" : ""} type="button" onClick={() => write({ stage: null, extra: extra === "held" ? null : "held" })}>
                      Held outside the service area ({heldCount.toLocaleString()})
                    </button>
                  ) : null}
                </div>
              </>
            ) : null}
          </div>
        ) : null}
        {menuOpen ? (
          <div className="popover menu-sheet" role="dialog" aria-label="Menu">
            <div className="popover-head">
              <h2>Menu</h2>
              <button type="button" onClick={() => setMenuOpen(false)}>Close</button>
            </div>
            <div className="funnel-switch" role="group" aria-label="Which funnel">
              <button className={funnel === "universe" ? "on" : ""} type="button" onClick={() => write({ funnel: null, tab: null })}>Universe</button>
              <button className={funnel === "pipeline" ? "on" : ""} type="button" onClick={() => write({ funnel: "pipeline", tab: "pipeline" })}>Pipeline</button>
            </div>
            <button type="button" onClick={() => { setFiltersOpen(true); setMenuOpen(false); }}>Filters{activeFilters.length ? ` (${activeFilters.length})` : ""}</button>
            <button type="button" onClick={() => { setLayersOpen(true); setMenuOpen(false); }}>Layers</button>
            <button type="button" onClick={() => { setLegendOpen(true); setMenuOpen(false); }}>Legend</button>
            <button type="button" onClick={() => { setTableOpen((value) => !value); setMenuOpen(false); }}>{tableOpen ? "Hide table" : "Table"}</button>
            <button type="button" onClick={exportTable}>Export CSV</button>
            <button type="button" onClick={() => void copyLink()}>{copied ? "Link copied" : "Copy link"}</button>
            <button type="button" onClick={() => { setGuideOpen(true); setMenuOpen(false); }}>How to read this</button>
            {funnel === "pipeline" && unplacedDeals.length > 0 ? (
              <button type="button" onClick={() => { setUnplacedOpen(true); setMenuOpen(false); }}>Unplaced deals ({unplacedDeals.length.toLocaleString()})</button>
            ) : null}
            {changesNote ? <p className="menu-note">{changesNote}</p> : null}
            <p className="menu-note">{me?.u}</p>
            {me?.role === "admin" ? <a href="/admin">Accounts</a> : null}
            <button type="button" onClick={logout}>Sign out</button>
          </div>
        ) : null}
        {unplacedOpen ? (
          <div className="popover" role="dialog" aria-label="Unplaced deals">
            <div className="popover-head">
              <h2>{unplacedDeals.length.toLocaleString()} unplaced deals</h2>
              <button type="button" onClick={() => setUnplacedOpen(false)}>Close</button>
            </div>
            <ul className="unplaced-list">
              {unplacedDeals.map((deal) => (
                <li key={deal.deal_id}>
                  <button type="button" className="text-link" onClick={() => { choose(deal.deal_id); setUnplacedOpen(false); }}>{deal.name || deal.address || deal.deal_id}</button>
                  {" · "}{stageTitle(deal.stage_group)}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
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
        <aside className={`layers ${layersOpen ? "open" : ""}`}>
          <button type="button" onClick={() => setLayersOpen((value) => !value)}>{layersOpen ? "Hide layers" : "Layers"}</button>
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
        <div className={`legend ${legendOpen ? "open" : ""}`} onMouseLeave={() => setTip("")}>
          <button type="button" onClick={() => setLegendOpen((value) => !value)}>{legendOpen ? "Hide legend" : "Legend"}</button>
          {legendOpen ? (
            <ul>
              {STATUS_NOTES.map((item) => (
                <li key={item.id} onMouseEnter={() => setTip(item.note)} onMouseLeave={() => setTip("")} onClick={() => setTip(item.note)}>
                  <i className={`swatch ${item.id}`} /> {item.label}
                </li>
              ))}
              <li onMouseEnter={() => setTip(TIER_NOTES.L10.note)} onMouseLeave={() => setTip("")} onClick={() => setTip(TIER_NOTES.L10.note)}><i className="swatch l10" /> {TIER_NOTES.L10.label}</li>
              <li onMouseEnter={() => setTip(TIER_NOTES.L4.note)} onMouseLeave={() => setTip("")} onClick={() => setTip(TIER_NOTES.L4.note)}><i className="swatch l4" /> {TIER_NOTES.L4.label}</li>
              <li onMouseEnter={() => setTip(AREA_NOTES.current)} onMouseLeave={() => setTip("")} onClick={() => setTip(AREA_NOTES.current)}><i className="swatch current-area" /> Current area</li>
              <li onMouseEnter={() => setTip(AREA_NOTES.later)} onMouseLeave={() => setTip("")} onClick={() => setTip(AREA_NOTES.later)}><i className="swatch later-area" /> Later expansion</li>
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
            sheet={sheet}
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
            onAddCompare={() => addCompare(selectedSite.site_id)}
            sameOwner={sites.filter((site) => site.site_id !== selectedSite.site_id && site.owner && site.owner === selectedSite.owner).slice(0, 6)}
            onClose={() => choose(null)}
            sheet={sheet}
          />
        ) : null}
        {compareIds.length >= 2 ? (
          <aside className="compare-panel">
            <button className="close" type="button" onClick={() => write({ compare: null })}>Close</button>
            <h2>Side by side</h2>
            <div className="compare-grid">
              {compareIds.map((id) => {
                const site = sites.find((item) => item.site_id === id);
                if (!site) return null;
                return (
                  <article key={id}>
                    <h3>{plainVerdict(site.verdict)}</h3>
                    <p>{site.name || site.address}</p>
                    <p className="note">{site.address}</p>
                    <p className="note">{site.owner || "Owner not on file"}</p>
                    <p className="note">{site.zoning || "Zoning not on file"}</p>
                  </article>
                );
              })}
            </div>
          </aside>
        ) : null}
      </div>
      {tableOpen ? (
        <section className="dock">
          <div className="dock-tabs">
            <button className="only-mobile" type="button" onClick={() => setTableOpen(false)}>Map</button>
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
