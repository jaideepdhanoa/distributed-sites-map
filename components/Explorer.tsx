"use client";

import dynamic from "next/dynamic";
import { Fragment, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Detail, { DealDetail } from "./Detail";
import SiteTable, { DealTable } from "./SiteTable";
import { CITY_VIEW, CITIES, compareSites, contactedEarlier, droppedAt, heldOutside, inStage, listedEarlier, nearestDepot, type PipeId, type StageId } from "@/lib/filter";
import type { AppData, DealFeature, DealProps, SiteFeature, SiteProps } from "@/lib/types";

const MapView = dynamic(() => import("./MapView"), { ssr: false });

const PIPE_STEPS: { id: PipeId; label: string }[] = [
  { id: "sourced", label: "Sourced" },
  { id: "desk", label: "Desk screen" },
  { id: "contacted", label: "Contacted" },
  { id: "later", label: "Later stages" },
  { id: "dropped", label: "Dropped" },
];

const STEPS: { id: StageId; label: string }[] = [
  { id: "universe", label: "Universe" },
  { id: "unique", label: "Unique" },
  { id: "in_area", label: "In service area" },
  { id: "land", label: "L10 / L4" },
  { id: "county", label: "County-checked" },
  { id: "cleared", label: "Cleared" },
  { id: "listed", label: "Listed" },
  { id: "contacted", label: "Contacted" },
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
  const [showAreas, setShowAreas] = useState(true);
  const [showDepots, setShowDepots] = useState(true);
  const [showUniverse, setShowUniverse] = useState(true);
  const [showPipeline, setShowPipeline] = useState(true);
  const [showLandLayer, setShowLandLayer] = useState(false);
  const [showDroppedDeals, setShowDroppedDeals] = useState(false);
  const [tableTab, setTableTab] = useState<"universe" | "pipeline" | "land">("universe");

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
  const pipeStage: PipeId = pipeParam && PIPE_STEPS.some((step) => step.id === pipeParam) ? pipeParam : "sourced";

  function write(next: Record<string, string | null>) {
    const url = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(next)) {
      if (!value) url.delete(key);
      else url.set(key, value);
    }
    router.replace(`/?${url.toString()}`, { scroll: false });
  }

  useEffect(() => {
    let cancel = false;
    Promise.all([
      fetch("/api/data/sites"),
      fetch("/api/data/areas"),
      fetch("/api/data/depots"),
      fetch("/api/data/parcels"),
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
  }, []);

  const features = data?.sites.features ?? [];
  const sites = features.map((feature) => feature.properties);

  function passesChips(site: SiteProps, loose: boolean) {
    if (site.city !== city) return false;
    if (query) {
      const blob = `${site.site_id} ${site.name} ${site.address} ${site.apn} ${site.owner}`.toLowerCase();
      if (!blob.includes(query.toLowerCase())) return false;
    }
    if (loose) return true;
    if (landTier !== "any" && site.land_tier !== landTier) return false;
    if (verdict !== "any" && (site.verdict || "none") !== verdict) return false;
    if (listed === "yes" && !site.listed) return false;
    return true;
  }

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
      add(sites.filter((site) => listedEarlier(site) && passesChips(site, true)));
    } else if (extra === "contacted") {
      add(sites.filter((site) => contactedEarlier(site) && passesChips(site, true)));
    } else {
      const pinStage = stage === "universe" ? "unique" : stage;
      add(sites.filter((site) => inStage(site, pinStage) && passesChips(site, false)));
      if (showDropped) add(sites.filter((site) => droppedAt(site, stage) && passesChips(site, true)));
      if (landSites) add(sites.filter((site) => site.land_only && passesChips(site, true)));
    }
    return [...byId.values()].sort(compareSites);
    // passesChips closes over the chip state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [features, stage, city, landTier, verdict, listed, landSites, showDropped, compare, query, extra]);

  const visibleFeatures: SiteFeature[] = visibleSites
    .map((site) => features.find((feature) => feature.properties.site_id === site.site_id))
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
    return true;
  }

  const pipelineDeals = dealRows.filter((deal) => deal.kind === "pipeline" && dealMatches(deal) && (deal.stage_group !== "dropped" || showDroppedDeals || (funnel === "pipeline" && pipeStage === "dropped")));
  const landDeals = dealRows.filter((deal) => deal.kind === "land" && deal.city === city && (!query || `${deal.name} ${deal.address}`.toLowerCase().includes(query.toLowerCase())));
  const drawnDeals: DealFeature[] = [
    ...(showPipeline ? pipelineDeals.filter((deal) => !deal.universe_id) : []),
    ...(showLandLayer ? landDeals : []),
  ]
    .map((deal) => dealFeatures.find((feature) => feature.properties.deal_id === deal.deal_id))
    .filter((feature): feature is DealFeature => Boolean(feature));

  const selectedSite = detail && detail.site_id === selected
    ? detail
    : sites.find((site) => site.site_id === selected) ?? null;
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
    if (step === "universe") {
      const census = data?.funnel.stages.find((item) => item.id === "census");
      return census?.by_city?.[city] ?? census?.total ?? 0;
    }
    return sites.filter((site) => site.city === city && inStage(site, step)).length;
  }

  const heldCount = sites.filter((site) => site.city === city && heldOutside(site)).length;
  const listedEarlierCount = sites.filter((site) => site.city === city && listedEarlier(site)).length;
  const contactedEarlierCount = sites.filter((site) => site.city === city && contactedEarlier(site)).length;

  async function logout() {
    await fetch("/api/logout", { method: "POST" });
    window.location.href = "/login";
  }

  if (error) return <main className="empty">{error}</main>;
  if (!data) return <main className="empty">Loading</main>;

  const focus = CITY_VIEW[city] ?? CITY_VIEW.PHX;
  const dropCount = sites.filter((site) => droppedAt(site, stage) && site.city === city).length;

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
          <button className={funnel === "universe" ? "on" : ""} type="button" onClick={() => { setTableTab("universe"); write({ funnel: null }); }}>Universe funnel</button>
          <button className={funnel === "pipeline" ? "on" : ""} type="button" onClick={() => { setTableTab("pipeline"); write({ funnel: "pipeline" }); }}>Pipeline funnel</button>
        </div>
        <nav className="funnel" aria-label="Funnel">
          {funnel === "universe" ? STEPS.map((step, index) => (
            <Fragment key={step.id}>
              {index === 1 ? (
                <span className="merge">{count("universe").toLocaleString()} records merged into {count("unique").toLocaleString()} sites</span>
              ) : index > 0 ? (
                <span className="chev" aria-hidden="true">›</span>
              ) : null}
              <button className={stage === step.id && !extra ? "on" : ""} type="button" aria-current={stage === step.id && !extra ? "step" : undefined} onClick={() => { setShowDropped(false); write({ stage: step.id === "land" ? null : step.id, extra: null }); }}>
                <span>{step.label}</span>
                <strong>{count(step.id).toLocaleString()}</strong>
              </button>
              {step.id === "land" && heldCount > 0 ? (
                <button className={`aside ${extra === "held" ? "on" : ""}`} type="button" onClick={() => write({ stage: null, extra: extra === "held" ? null : "held" })}>
                  {heldCount} held outside the service area
                </button>
              ) : null}
              {step.id === "listed" && listedEarlierCount > 0 ? (
                <button className={`aside ${extra === "listed" ? "on" : ""}`} type="button" onClick={() => write({ stage: "listed", extra: extra === "listed" ? null : "listed" })}>
                  {listedEarlierCount} more listed among candidates
                </button>
              ) : null}
              {step.id === "contacted" && contactedEarlierCount > 0 ? (
                <button className={`aside ${extra === "contacted" ? "on" : ""}`} type="button" onClick={() => write({ stage: "contacted", extra: extra === "contacted" ? null : "contacted" })}>
                  {contactedEarlierCount} more contacted among candidates
                </button>
              ) : null}
            </Fragment>
          )) : PIPE_STEPS.map((step, index) => (
            <Fragment key={step.id}>
              {index > 0 ? <span className="chev" aria-hidden="true">›</span> : null}
              <button className={pipeStage === step.id ? "on" : ""} type="button" aria-current={pipeStage === step.id ? "step" : undefined} onClick={() => write({ pstage: step.id === "sourced" ? null : step.id })}>
                <span>{step.label}</span>
                <strong>{dealRows.filter((deal) => deal.kind === "pipeline" && deal.city === city && deal.stage_group === step.id).length.toLocaleString()}</strong>
              </button>
            </Fragment>
          ))}
        </nav>
        <div className="chips">
          {["any", "L10", "L4"].map((item) => (
            <button key={item} className={landTier === item ? "on" : ""} type="button" onClick={() => write({ tier: item === "any" ? null : item })}>
              {item === "any" ? "All tiers" : item}
            </button>
          ))}
          {["any", "PASS", "MAYBE", "UNRESOLVED"].map((item) => (
            <button key={item} className={verdict === item ? "on" : ""} type="button" onClick={() => write({ verdict: item === "any" ? null : item })}>
              {item === "any" ? "All verdicts" : item}
            </button>
          ))}
          <button className={listed === "yes" ? "on" : ""} type="button" onClick={() => write({ listed: listed === "yes" ? null : "yes" })}>Listed</button>
          <button className={landSites ? "on" : ""} type="button" onClick={() => write({ land: landSites ? null : "1" })}>Land sites</button>
          <button className={compare ? "on" : ""} type="button" onClick={() => setCompare((value) => !value)}>Compare</button>
          {dropCount > 0 ? (
            <button className={showDropped ? "on" : ""} type="button" onClick={() => setShowDropped((value) => !value)}>
              Dropped {dropCount.toLocaleString()}
            </button>
          ) : null}
          <button className={tableOpen ? "on" : ""} type="button" onClick={() => setTableOpen((value) => !value)}>Table</button>
          <span className="summary-chip">
            {city === "PHX" ? "Phoenix" : city === "LAS" ? "Las Vegas" : "Miami"}
            {`: ${sites.filter((site) => site.city === city && inStage(site, "land")).length} candidates · ${sites.filter((site) => site.city === city && inStage(site, "cleared")).length} cleared · ${dealRows.filter((deal) => deal.kind === "pipeline" && deal.city === city && deal.stage_group !== "dropped").length} deals in pipeline`}
          </span>
        </div>
      </header>
      <div className="map-stage">
        <MapView
          sites={showUniverse ? visibleFeatures : []}
          deals={drawnDeals}
          areas={data.areas.features}
          depots={data.depots.features}
          parcels={data.parcels.features}
          selectedId={selected}
          showAreas={showAreas}
          showDepots={showDepots}
          showSites={showUniverse}
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
              <label><input type="checkbox" checked={showAreas} onChange={(event) => setShowAreas(event.target.checked)} /> Service areas</label>
              <label><input type="checkbox" checked={showDepots} onChange={(event) => setShowDepots(event.target.checked)} /> Depots</label>
              <label><input type="checkbox" checked={showUniverse} onChange={(event) => setShowUniverse(event.target.checked)} /> Universe sites</label>
              <label><input type="checkbox" checked={showPipeline} onChange={(event) => setShowPipeline(event.target.checked)} /> Pipeline deals</label>
              <label><input type="checkbox" checked={showLandLayer} onChange={(event) => setShowLandLayer(event.target.checked)} /> Land Sites</label>
              <label><input type="checkbox" checked={showDroppedDeals} onChange={(event) => setShowDroppedDeals(event.target.checked)} /> Dropped deals</label>
            </>
          ) : null}
        </aside>
        <ul className="legend">
          <li><i className="swatch pass" /> Cleared PASS</li>
          <li><i className="swatch held" /> Held PASS</li>
          <li><i className="swatch maybe" /> MAYBE</li>
          <li><i className="swatch aerial" /> Aerial only, not checked</li>
          <li><i className="swatch open" /> Unresolved</li>
          <li><i className="swatch depot" /> Depot</li>
          <li><i className="swatch sq" style={{ background: "#2458a6" }} /> Sourced deal</li>
          <li><i className="swatch sq" style={{ background: "#c4841d" }} /> Desk screen</li>
          <li><i className="swatch tri" /> Land site</li>
        </ul>
        {selectedDeal ? (
          <DealDetail
            deal={selectedDeal}
            universeName={sites.find((site) => site.site_id === selectedDeal.universe_id)?.name}
            depotMiles={selectedDeal.miles_to_depot}
            onOpenSite={selectedDeal.universe_id ? () => choose(selectedDeal.universe_id) : undefined}
            onClose={() => choose(null)}
          />
        ) : selectedSite ? (
          <Detail
            site={selectedSite}
            depotMiles={(() => {
              const feature = features.find((item) => item.properties.site_id === selectedSite.site_id);
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
