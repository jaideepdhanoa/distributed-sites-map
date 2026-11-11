"use client";

import { useEffect, useMemo, useState } from "react";
import {
  OPEN_LOOP_FILTERS,
  PARKED_BADGE,
  visibleLoops,
  type DerivedLoops,
  type LoopFilters,
  type OpenLoop,
} from "@/lib/openLoops";

type Payload = {
  source?: string;
  as_of?: string;
  label?: string;
  loops?: OpenLoop[];
  parked?: OpenLoop[];
  error?: string;
};

export default function OpenLoops({
  onOpen,
  onClose,
}: {
  onOpen: (id: string) => void;
  onClose: () => void;
}) {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [failed, setFailed] = useState("");
  const [filters, setFilters] = useState<LoopFilters>(OPEN_LOOP_FILTERS);

  useEffect(() => {
    let cancel = false;
    fetch("/api/data/open-loops").then(async (response) => {
      const body = (await response.json().catch(() => ({}))) as Payload;
      if (cancel) return;
      if (!response.ok) {
        setFailed(body.error || "The open loops could not be loaded.");
        return;
      }
      setPayload(body);
    }).catch(() => {
      if (!cancel) setFailed("The open loops could not be loaded.");
    });
    return () => {
      cancel = true;
    };
  }, []);

  const derived = useMemo<DerivedLoops>(() => ({
    loops: payload?.loops || [],
    parked: payload?.parked || [],
  }), [payload]);
  const rows = visibleLoops(derived, filters);
  const markets = useMemo(() => {
    const found = new Set<string>();
    for (const row of [...derived.loops, ...derived.parked]) {
      for (const market of row.markets) found.add(market);
    }
    return [...found].sort();
  }, [derived]);

  function setFilter<K extends keyof LoopFilters>(key: K, value: LoopFilters[K]) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  return (
    <aside className="nda-pane" data-testid="open-loops" aria-label="Open loops">
      <div className="layers-bar nda-bar">
        <p className="eyebrow">Open loops</p>
        <button type="button" className="close" aria-label="Close open loops" onClick={onClose}><span aria-hidden="true">×</span></button>
      </div>
      <div className="nda-scroll">
        {payload?.label ? <p className="note">{payload.label}</p> : null}
        {failed ? <p className="note">{failed}</p> : null}
        {!payload && !failed ? <p className="note">Loading</p> : null}
        <div className="nda-filters">
          <select className="secondary" aria-label="Court" value={filters.court} onChange={(event) => setFilter("court", event.target.value as LoopFilters["court"])}>
            <option value="all">All courts</option>
            <option value="us">Us</option>
            <option value="them">Them</option>
            <option value="none">No court</option>
          </select>
          <select className="secondary" aria-label="Class" value={filters.loopClass} onChange={(event) => setFilter("loopClass", event.target.value as LoopFilters["loopClass"])}>
            <option value="all">All classes</option>
            <option value="NDA">NDA</option>
            <option value="Site">Site</option>
          </select>
          <select className="secondary" aria-label="Market" value={filters.market} onChange={(event) => setFilter("market", event.target.value)}>
            <option value="all">All markets</option>
            {markets.map((market) => <option key={market} value={market}>{market}</option>)}
          </select>
          <select className="secondary" aria-label="Age" value={filters.age} onChange={(event) => setFilter("age", event.target.value as LoopFilters["age"])}>
            <option value="all">Any age</option>
            <option value="0-7">0–7 days</option>
            <option value="8-14">8–14 days</option>
            <option value="15+">15+ days</option>
          </select>
          <select className="secondary" aria-label="Owner" value={filters.owner} onChange={(event) => setFilter("owner", event.target.value as LoopFilters["owner"])}>
            <option value="all">All owners</option>
            <option value="Brief">Brief</option>
            <option value="Chase check">Chase check</option>
            <option value="Panel only">Panel only</option>
          </select>
          <label className="loop-filter">
            <input className="check" type="checkbox" checked={filters.showParked} onChange={(event) => setFilter("showParked", event.target.checked)} />
            Show parked
          </label>
        </div>
        {payload && !failed ? <p className="note">{rows.length} {rows.length === 1 ? "loop" : "loops"}</p> : null}
        {payload && !failed && rows.length === 0 ? <p className="note">No open loops.</p> : null}
        <ul className="nda-list">
          {rows.map((row) => (
            <li key={`${row.parked ? "parked" : "open"}-${row.id}`} className="nda-row" data-testid={`loop-${row.id}`} data-court={row.court} data-days={row.days} data-owner={row.owner} data-class={row.loop_class}>
              {row.loop_class === "Site" ? (
                <h3>
                  <button type="button" className="text-link" onClick={() => onOpen(row.id)}>{row.id}</button>
                  {row.label ? ` · ${row.label}` : ""}
                </h3>
              ) : (
                <h3>{row.id}{row.party ? ` · ${row.party}` : ""}</h3>
              )}
              <p className="nda-court"><span>{row.loop_class}</span>{row.court}</p>
              {row.loop_class === "Site" ? <p>{[row.market, row.stage].filter(Boolean).join(" · ")}</p> : null}
              <p>{row.days}d · {row.owner}{row.brief_flagged ? " · In brief" : ""}</p>
              <p>{row.loop_class === "NDA" ? "Gates" : "Blocker"}: {row.detail || "—"}</p>
              {row.next_step ? <p>{row.next_step}</p> : null}
              {row.parked ? <p>{PARKED_BADGE}</p> : null}
              {row.folded_site_ids.length ? (
                <div className="nda-sites">
                  {row.folded_site_ids.map((id) => (
                    <button key={id} type="button" className="text-link" onClick={() => onOpen(id)}>{id}</button>
                  ))}
                </div>
              ) : null}
              {row.site_note ? <p>{row.site_note}</p> : null}
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}
