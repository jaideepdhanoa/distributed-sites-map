"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Detail from "./Detail";
import SiteTable from "./SiteTable";
import { CITIES, SORT_LABELS, compareSites, matches, type Filters, type StageId } from "@/lib/filter";
import type { AppData, FunnelStage, SiteFeature, SiteProps } from "@/lib/types";

const MapView = dynamic(() => import("./MapView"), { ssr: false });

const STAGES: StageId[] = ["census", "unique", "in_area", "land_tier", "verified", "verdict", "listed", "contacted"];

function listParam(value: string | null, fallback: string[]) {
  if (!value) return fallback;
  return value.split(",").filter(Boolean);
}

export default function Explorer() {
  const params = useSearchParams();
  const router = useRouter();
  const [data, setData] = useState<(AppData & { meta?: { warnings?: string[]; parcel_note?: string; generated_at?: string } }) | null>(null);
  const [detail, setDetail] = useState<SiteProps | null>(null);
  const [me, setMe] = useState<{ u: string; role: string } | null>(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<string | null>(params.get("site"));
  const [showLabels, setShowLabels] = useState(false);
  const [showExpansion, setShowExpansion] = useState(false);
  const [showRings, setShowRings] = useState(false);
  const [inView, setInView] = useState(false);
  const [bounds, setBounds] = useState<{ contains: (lnglat: [number, number]) => boolean } | null>(null);
  const [view, setView] = useState(params.get("view") || "map");

  const filters: Filters = {
    stage: (params.get("stage") as StageId) || "candidates",
    cities: listParam(params.get("cities"), CITIES),
    verdict: params.get("verdict") || "any",
    landTier: params.get("tier") || "any",
    listed: params.get("listed") || "any",
    contacted: params.get("contacted") || "any",
    verification: params.get("verification") || "any",
    query: params.get("q") || "",
    landSites: params.get("land") === "1",
    showHeld: params.get("held") !== "0",
    showStops: params.get("stops") === "1",
  };
  const sort = params.get("sort") || "tier";

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
      fetch("/api/me"),
    ]).then(async ([sitesRes, areasRes, depotsRes, parcelsRes, funnelRes, meRes]) => {
      if (sitesRes.status === 401) {
        window.location.href = "/login";
        return;
      }
      if (!sitesRes.ok || !areasRes.ok || !depotsRes.ok || !parcelsRes.ok || !funnelRes.ok) {
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
          funnel: funnelPayload.funnel,
          meta: funnelPayload.meta,
        });
        setMe(meRes.ok ? await meRes.json() : null);
      }
    });
    return () => { cancel = true; };
  }, []);

  const features = data?.sites.features ?? [];
  const visible = useMemo(() => {
    return features
      .map((feature) => feature.properties)
      .filter((site) => matches(site, filters))
      .filter((site) => {
        if (!inView || !bounds || view !== "table") return true;
        const feature = features.find((item) => item.properties.site_id === site.site_id);
        if (!feature?.geometry) return false;
        const [lon, lat] = feature.geometry.coordinates;
        return bounds.contains([lon, lat]);
      })
      .sort((a, b) => compareSites(a, b, sort));
  }, [features, filters, inView, bounds, view, sort]);

  const visibleFeatures: SiteFeature[] = visible
    .map((site) => features.find((feature) => feature.properties.site_id === site.site_id))
    .filter((feature): feature is SiteFeature => Boolean(feature));
  const selectedSite = detail && detail.site_id === selected
    ? detail
    : features.find((feature) => feature.properties.site_id === selected)?.properties ?? null;

  useEffect(() => {
    if (!selected) return;
    let cancel = false;
    fetch(`/api/data/sites/${encodeURIComponent(selected)}`).then(async (response) => {
      if (!response.ok) return;
      const payload = (await response.json()) as SiteProps;
      if (!cancel) setDetail(payload);
    });
    return () => { cancel = true; };
  }, [selected]);
  const stage = data?.funnel.stages.find((item) => item.id === filters.stage);

  async function logout() {
    await fetch("/api/logout", { method: "POST" });
    window.location.href = "/login";
  }

  function exportCsv() {
    const cols: (keyof SiteProps)[] = ["site_id", "city", "name", "address", "land_tier", "verification", "verdict", "spare_ac_own", "spare_ac_adjoining", "utility_proximity", "tenure", "listed", "contacted", "asking_price_display", "asking_price_source", "pipeline_stage", "owner"];
    const lines = [cols.join(",")].concat(visible.map((site) => cols.map((col) => `"${String(site[col] ?? "").replaceAll('"', '""')}"`).join(",")));
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "sites.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  if (error) return <main className="empty">{error}</main>;
  if (!data) return <main className="empty">Loading sites…</main>;

  return (
    <div className="app">
      <header className="top">
        <h1 className="word">Si<span>tes</span></h1>
        <input className="search" placeholder="Address, APN, owner, id" value={filters.query} onChange={(event) => write({ q: event.target.value || null })} />
        <div className="views">
          {["map", "table", "compare"].map((item) => (
            <button key={item} className={view === item ? "on" : ""} type="button" onClick={() => { setView(item); write({ view: item === "map" ? null : item }); }}>{item}</button>
          ))}
        </div>
        <div className="who">
          <span>{me?.u}</span>
          {me?.role === "admin" ? <a href="/admin">Accounts</a> : null}
          <button className="ghost" type="button" onClick={logout}>Sign out</button>
        </div>
      </header>
      <aside className="rail">
        <div className="stage">
          <button className={`step ${filters.stage === "candidates" ? "on" : ""}`} type="button" onClick={() => write({ stage: null })}>
            <b>Candidates</b>
            <em>In-area L10 and L4, not eliminated</em>
          </button>
          {data.funnel.stages.map((item) => (
            <StageButton key={item.id} stage={item} active={filters.stage === item.id} onClick={() => write({ stage: item.id })} />
          ))}
        </div>
        {stage?.note ? <p className="note">{stage.note}</p> : null}
        {data.meta?.warnings?.slice(0, 2).map((warning) => <p className="note" key={warning}>{warning}</p>)}
        <div className="filters">
          <div className="cities">
            {CITIES.map((city) => (
              <button key={city} className={`chip ${filters.cities.includes(city) ? "on" : ""}`} type="button" onClick={() => {
                const next = filters.cities.includes(city) ? filters.cities.filter((item) => item !== city) : [...filters.cities, city];
                write({ cities: next.length === 3 ? null : next.join(",") });
              }}>{city}</button>
            ))}
          </div>
          <label className="field">Verdict
            <select value={filters.verdict} onChange={(event) => write({ verdict: event.target.value === "any" ? null : event.target.value })}>
              {["any", "PASS", "MAYBE", "FAIL", "NOT_A_WASH", "UNRESOLVED", "none"].map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
          <label className="field">Land tier
            <select value={filters.landTier} onChange={(event) => write({ tier: event.target.value === "any" ? null : event.target.value })}>
              <option value="any">any</option>
              <option value="L10">L10</option>
              <option value="L4">L4</option>
            </select>
          </label>
          <label className="field">Verification
            <select value={filters.verification} onChange={(event) => write({ verification: event.target.value === "any" ? null : event.target.value })}>
              <option value="any">any</option>
              <option value="county-checked">county-checked</option>
              <option value="aerial only, pending verification">aerial only, pending verification</option>
              <option value="not screened">not screened</option>
            </select>
          </label>
          <label className="field">Listed
            <select value={filters.listed} onChange={(event) => write({ listed: event.target.value === "any" ? null : event.target.value })}>
              <option value="any">any</option><option value="yes">listed</option><option value="no">not listed</option>
            </select>
          </label>
          <label className="field">Contacted
            <select value={filters.contacted} onChange={(event) => write({ contacted: event.target.value === "any" ? null : event.target.value })}>
              <option value="any">any</option><option value="yes">contacted</option><option value="no">not contacted</option>
            </select>
          </label>
          <label className="field">Sort — {SORT_LABELS[sort]}
            <select value={sort} onChange={(event) => write({ sort: event.target.value === "tier" ? null : event.target.value })}>
              {Object.entries(SORT_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
          </label>
          <p className="note">No combined score. The order is the signals above, in that sequence. Utility proximity is Strong, then OK, then Weak.</p>
          <label className="check"><input type="checkbox" checked={filters.showHeld} onChange={(event) => write({ held: event.target.checked ? null : "0" })} /> Show held for network expansion</label>
          <label className="check"><input type="checkbox" checked={filters.landSites} onChange={(event) => write({ land: event.target.checked ? "1" : null })} /> Land sites</label>
          <label className="check"><input type="checkbox" checked={filters.showStops} onChange={(event) => write({ stops: event.target.checked ? "1" : null })} /> Show sites that stopped earlier</label>
          <label className="check"><input type="checkbox" checked={showExpansion} onChange={(event) => setShowExpansion(event.target.checked)} /> Expansion horizon layer</label>
          <label className="check"><input type="checkbox" checked={showLabels} onChange={(event) => setShowLabels(event.target.checked)} /> Place names</label>
          <label className="check"><input type="checkbox" checked={showRings} onChange={(event) => setShowRings(event.target.checked)} /> Depot distance rings</label>
          <p className="note">{data.meta?.parcel_note}</p>
          <p className="note">Showing {visible.length.toLocaleString()} sites. Data {data.meta?.generated_at || data.funnel.generated_at}.</p>
          <button className="ghost" type="button" onClick={exportCsv}>Export this view</button>
        </div>
      </aside>
      <main>
        {view === "map" ? (
          <MapView
            sites={visibleFeatures}
            areas={data.areas.features}
            depots={data.depots.features}
            parcels={data.parcels.features}
            selectedId={selected}
            showExpansion={showExpansion}
            showLabels={showLabels}
            showRings={showRings}
            onSelect={(id) => { setSelected(id); write({ site: id }); }}
            onBounds={setBounds}
          />
        ) : null}
        {view === "table" ? (
          <>
            <label className="check" style={{ padding: 8 }}><input type="checkbox" checked={inView} onChange={(event) => setInView(event.target.checked)} /> Limit to the last map view</label>
            <SiteTable rows={visible} selectedId={selected} onSelect={(id) => { setSelected(id); write({ site: id }); setView("map"); }} />
          </>
        ) : null}
        {view === "compare" ? <Compare features={features} onSelect={(id) => { setSelected(id); write({ site: id }); }} /> : null}
      </main>
      <Detail site={selectedSite} />
    </div>
  );
}

function StageButton({ stage, active, onClick }: { stage: FunnelStage; active: boolean; onClick: () => void }) {
  return (
    <button className={`step ${active ? "on" : ""}`} type="button" onClick={onClick}>
      <b>{stage.name}</b>
      {stage.id === "land_tier" && stage.L10 && stage.L4 ? (
        <span className="pair">
          <div><strong>{stage.L10.total}</strong> L10</div>
          <div><strong>{stage.L4.total}</strong> L4</div>
        </span>
      ) : stage.id === "verified" ? (
        <em>{stage.county_checked} county-checked · {stage.pending} pending</em>
      ) : stage.id === "contacted" ? (
        <em>{stage.total} contacted · stage stays visible at zero</em>
      ) : (
        <em>{stage.total.toLocaleString()} {stage.unit}</em>
      )}
    </button>
  );
}

function Compare({ features, onSelect }: { features: SiteFeature[]; onSelect: (id: string) => void }) {
  const rows = features.filter((feature) => feature.properties.verdict_disagreement || feature.properties.acreage_note || feature.properties.scale_note);
  return (
    <div className="compare">
      <h2>Where reviews differ</h2>
      <p className="note">{rows.length} sites. Adjoining-only land is MAYBE on the shared scale even when an earlier tier called it a pass.</p>
      {rows.map((feature) => {
        const site = feature.properties;
        return (
          <article key={site.site_id}>
            <button className="ghost" type="button" onClick={() => onSelect(site.site_id)}><strong>{site.site_id}</strong> {site.name}</button>
            <div className="kv">
              <span>Our call</span><div>{site.verdict} {site.reconciliation_tier}</div>
              <span>Other review</span><div>{site.muse_verdict || "—"}</div>
              <span>Own / adjoining</span><div>{site.spare_ac_own ?? "—"} / {site.spare_ac_adjoining ?? "—"}</div>
            </div>
            {site.scale_note ? <p className="note">{site.scale_note}</p> : null}
            {site.acreage_note ? <p className="note">{site.acreage_note}</p> : null}
            {site.evidence ? <p>{site.evidence}</p> : null}
          </article>
        );
      })}
    </div>
  );
}
