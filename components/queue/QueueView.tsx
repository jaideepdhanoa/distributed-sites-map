"use client";

import { useEffect, useState } from "react";
import { formatPacific } from "@/lib/actions/time";
import { RecordActions } from "@/components/actions/RecordActions";
import { plainVerdict } from "@/lib/labels";
import "./queue.css";

type Reason = { at: string; summary: string; type: string };
type Assignment = { id: string; title: string; date: string; status: string };
type Item = {
  siteId: string;
  reasons: Reason[];
  followed: boolean;
  snapshot: {
    name: string;
    address: string;
    city: string;
    stage: string;
    verdict: string;
    askingPrice: string;
    askingSource: string;
    leadSource: string;
    activity: string;
    materials: { label: string; count: number; latest: string }[];
    folderUrl: string;
    openThreads: number;
    nextStep: { title: string; date: string } | null;
    assignments: Assignment[];
    lng: number | null;
    lat: number | null;
  } | null;
};

function reasonWhen(at: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(at)) {
    const [year, month, day] = at.split("-").map(Number);
    return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, day)));
  }
  return formatPacific(at);
}

function tileUrl(lng: number, lat: number): string {
  const zoom = 16;
  const size = 2 ** zoom;
  const x = Math.floor(((lng + 180) / 360) * size);
  const rad = (lat * Math.PI) / 180;
  const y = Math.floor((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2 * size);
  return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${zoom}/${y}/${x}`;
}

const STAGES = [
  { id: "any", label: "Any stage" },
  { id: "sourced", label: "Sourced" },
  { id: "desk", label: "Desk screen" },
  { id: "contacted", label: "Contacted" },
  { id: "later", label: "Later stages" },
  { id: "dropped", label: "Dropped" },
];

const MARKETS = [
  { id: "all", label: "All markets" },
  { id: "PHX", label: "Phoenix" },
  { id: "LAS", label: "Las Vegas" },
  { id: "MIA", label: "Miami" },
];

export default function QueueView({
  market,
  stage,
  viable,
  freshOnly,
  flaggedOnly,
  approvalOnly,
  mentionsOnly,
  assignedOnly,
  onCount,
  onFilter,
  onMap,
  onList,
  onOpenMap,
}: {
  market: string;
  stage: string;
  viable: boolean;
  freshOnly: boolean;
  flaggedOnly: boolean;
  approvalOnly: boolean;
  mentionsOnly: boolean;
  assignedOnly: boolean;
  onCount: (count: number) => void;
  onFilter: (patch: Record<string, string | null>) => void;
  onMap: () => void;
  onList: () => void;
  onOpenMap: (siteId: string) => void;
}) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [firstTime, setFirstTime] = useState(false);
  const [index, setIndex] = useState(0);
  const [error, setError] = useState("");
  const [menu, setMenu] = useState(false);
  const [snooze, setSnooze] = useState("");
  const [flagUser, setFlagUser] = useState("");
  const [flagNote, setFlagNote] = useState("");
  const [accounts, setAccounts] = useState<{ id: string; name: string }[]>([]);
  const [touchX, setTouchX] = useState<number | null>(null);
  const [tick, setTick] = useState(0);
  const [thumbFailed, setThumbFailed] = useState(false);

  const query = new URLSearchParams({
    market: market || "all",
    stage: stage || "any",
    viable: viable ? "1" : "0",
    fresh: freshOnly ? "1" : "0",
    flagged: flaggedOnly ? "1" : "0",
    approve: approvalOnly ? "1" : "0",
    mentions: mentionsOnly ? "1" : "0",
    assigned: assignedOnly ? "1" : "0",
  });
  const queryText = query.toString();

  useEffect(() => {
    const onRefresh = () => setTick((value) => value + 1);
    window.addEventListener("queue-refresh", onRefresh);
    return () => window.removeEventListener("queue-refresh", onRefresh);
  }, []);

  useEffect(() => {
    let cancel = false;
    fetch(`/api/queue?${queryText}`).then(async (response) => {
      if (cancel || !response.ok) return;
      const payload = (await response.json()) as { firstTime: boolean; items: Item[] };
      setFirstTime(payload.firstTime);
      setItems(payload.items);
      onCount(payload.items.length);
      setIndex((current) => Math.min(current, Math.max(payload.items.length - 1, 0)));
    }).catch(() => undefined);
    fetch("/api/actions/accounts").then(async (response) => {
      if (cancel || !response.ok) return;
      setAccounts(((await response.json()) as { accounts: { id: string; name: string }[] }).accounts || []);
    }).catch(() => undefined);
    return () => {
      cancel = true;
    };
  }, [queryText, tick]);

  useEffect(() => {
    setMenu(false);
    setThumbFailed(false);
  }, [index, queryText]);

  const item = items?.[index] || null;
  const total = items?.length || 0;

  async function act(path: string, body: unknown) {
    setError("");
    const response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) {
      setError(payload.error || "That could not be saved.");
      return;
    }
    setMenu(false);
    window.dispatchEvent(new Event("queue-refresh"));
  }

  function move(delta: number) {
    setIndex((current) => Math.min(Math.max(current + delta, 0), Math.max(total - 1, 0)));
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT")) return;
      if (event.key === "j" || event.key === "J") move(1);
      if (event.key === "k" || event.key === "K") move(-1);
      if ((event.key === "r" || event.key === "R") && item) void act("/api/queue", { siteId: item.siteId });
      if (event.key === "c" || event.key === "C") document.querySelector<HTMLTextAreaElement>("[data-testid='note-body']")?.focus();
      if (event.key === "s" || event.key === "S") {
        setMenu(true);
        window.setTimeout(() => document.querySelector<HTMLInputElement>("[data-testid='queue-snooze']")?.focus(), 0);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [items, item, total]);

  const filters = {
    market,
    stage,
    viable,
    fresh: freshOnly,
    flagged: flaggedOnly,
    approve: approvalOnly,
    mentions: mentionsOnly,
    assigned: assignedOnly,
  };
  const snap = item?.snapshot;
  const facts = snap ? [
    snap.askingPrice ? { label: "Asking price", value: `${snap.askingPrice}${snap.askingSource ? ` · ${snap.askingSource}` : ""}` } : null,
    snap.leadSource ? { label: "Lead source", value: snap.leadSource } : null,
    snap.verdict ? { label: "Verdict", value: plainVerdict(snap.verdict) } : null,
    snap.stage ? { label: "Stage", value: snap.stage } : null,
    snap.activity ? { label: "Latest activity", value: snap.activity } : null,
    snap.materials.length ? { label: "Materials", value: snap.materials.map((entry) => `${entry.label} (${entry.count})`).join(", ") } : null,
    snap.openThreads ? { label: "Open threads", value: String(snap.openThreads) } : null,
  ].filter((row): row is { label: string; value: string } => Boolean(row)) : [];

  return (
    <div className="queue-scrim" data-testid="queue">
      <section
        className="queue-panel"
        onTouchStart={(event) => setTouchX(event.changedTouches[0]?.clientX ?? null)}
        onTouchEnd={(event) => {
          if (touchX == null) return;
          const delta = (event.changedTouches[0]?.clientX ?? touchX) - touchX;
          if (delta < -60) move(1);
          if (delta > 60) move(-1);
          setTouchX(null);
        }}
      >
        <header className="queue-top">
          <div className="queue-switch" role="group" aria-label="Which view">
            <button type="button" onClick={onMap}>Map</button>
            <button type="button" onClick={onList}>List</button>
            <button type="button" className="on" aria-current="page">
              Queue{total ? <span className="count-badge" data-testid="queue-count">{total}</span> : null}
            </button>
          </div>
          <div className="queue-filters">
            <button type="button" className={mentionsOnly ? "on" : ""} onClick={() => onFilter({ qmention: mentionsOnly ? null : "1" })}>Mentions</button>
            <button type="button" className={assignedOnly ? "on" : ""} onClick={() => onFilter({ qassign: assignedOnly ? null : "1" })}>Assigned to me</button>
            <button type="button" className={approvalOnly ? "on" : ""} onClick={() => onFilter({ qapprove: approvalOnly ? null : "1" })}>Needs my approval</button>
            <button type="button" className={freshOnly ? "on" : ""} onClick={() => onFilter({ qnew: freshOnly ? null : "1" })}>New sites</button>
            <button type="button" className={viable ? "on" : ""} onClick={() => onFilter({ qviable: viable ? "0" : null })}>Active</button>
            <button type="button" className={flaggedOnly ? "on" : ""} onClick={() => onFilter({ qflag: flaggedOnly ? null : "1" })}>Flagged to me</button>
            <select aria-label="Queue market" value={market || "all"} onChange={(event) => onFilter({ qmarket: event.target.value })}>
              {MARKETS.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
            </select>
            <select aria-label="Queue stage" value={stage || "any"} onChange={(event) => onFilter({ qstage: event.target.value })}>
              {STAGES.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
            </select>
          </div>
        </header>
        <div className="queue-body">
          {items === null ? <p className="queue-muted">Loading the queue.</p> : null}
          {items && items.length === 0 ? (
            <>
              <p className="queue-empty" data-testid="queue-empty">You're all caught up.</p>
              <p className="queue-muted">New notes, stage changes, and mentions will show up here.</p>
            </>
          ) : null}
          {firstTime && items && items.length ? (
            <p className="queue-banner">
              These active pipeline sites are new until you review them.
              <button type="button" onClick={() => void act("/api/queue", { all: true, ...filters })}>Mark all reviewed</button>
            </p>
          ) : null}
          {item ? (
            <article className="queue-card" data-testid="queue-card">
              <div className="queue-progress" aria-label={`${index + 1} of ${total}`}>
                <div className="queue-meter"><span style={{ width: `${total ? ((index + 1) / total) * 100 : 0}%` }} /></div>
                <p>{index + 1} of {total}</p>
              </div>
              <h2>{snap?.name || snap?.address || item.siteId}</h2>
              <p className="queue-id">{item.siteId}{snap?.address ? ` · ${snap.address}` : ""}</p>
              <ul className="queue-changes">
                {item.reasons.map((reason) => (
                  <li key={`${reason.type}-${reason.at}-${reason.summary}`}>
                    {reason.summary.replace(/\.$/, "")}
                    <time dateTime={reason.at}>{reasonWhen(reason.at)}</time>
                  </li>
                ))}
              </ul>
              {error ? <p className="err" role="alert">{error}</p> : null}
              <RecordActions kind="deal" id={item.siteId} variant="queue" />
              <div className="queue-place">
                <div className="queue-thumb">
                  {snap?.lng != null && snap.lat != null && !thumbFailed ? (
                    <img src={tileUrl(snap.lng, snap.lat)} alt="" onError={() => setThumbFailed(true)} />
                  ) : (
                    <span className="queue-pin" />
                  )}
                </div>
                <button type="button" className="text-link" onClick={() => onOpenMap(item.siteId)}>Open on map</button>
              </div>
              {facts.length ? (
                <div className="queue-facts">
                  {facts.map((fact) => (
                    <div key={fact.label}>
                      <span>{fact.label}</span>
                      <strong>
                        {fact.value}
                        {fact.label === "Materials" && snap?.folderUrl ? <> · <a href={snap.folderUrl} target="_blank" rel="noopener noreferrer">Open site folder</a></> : null}
                      </strong>
                    </div>
                  ))}
                </div>
              ) : null}
            </article>
          ) : null}
        </div>
        {item ? (
          <footer className="queue-foot">
            <button type="button" data-testid="queue-more" aria-expanded={menu} aria-haspopup="dialog" onClick={() => setMenu((open) => !open)}>...</button>
            <button type="button" onClick={() => move(-1)}>Previous</button>
            <button type="button" onClick={() => move(1)}>Next</button>
            <span className="queue-keys">J and K move. R reviewed. C comment. S snooze.</span>
            <button type="button" className="primary" data-testid="queue-reviewed" onClick={() => void act("/api/queue", { siteId: item.siteId })}>Mark reviewed</button>
          </footer>
        ) : null}
        {menu && item ? (
          <div className="queue-menu" data-testid="queue-menu" role="dialog" aria-label="More actions">
            <h3>More actions</h3>
            <button type="button" onClick={() => void act("/api/queue/follow", { siteId: item.siteId, follow: !item.followed })}>{item.followed ? "Unfollow" : "Follow"}</button>
            <form onSubmit={(event) => { event.preventDefault(); void act("/api/queue/snooze", { siteId: item.siteId, until: snooze }); }}>
              <label>Snooze until
                <input data-testid="queue-snooze" type="date" value={snooze} onChange={(event) => setSnooze(event.target.value)} />
              </label>
              <button type="submit">Snooze</button>
            </form>
            <form onSubmit={(event) => { event.preventDefault(); void act("/api/queue/flag", { siteId: item.siteId, toUser: flagUser, note: flagNote }); setFlagNote(""); }}>
              <label>Flag for
                <select aria-label="Flag for" value={flagUser} onChange={(event) => setFlagUser(event.target.value)}>
                  <option value="">Choose an account</option>
                  {accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
                </select>
              </label>
              <label>Note
                <input data-testid="queue-flag-note" value={flagNote} onChange={(event) => setFlagNote(event.target.value)} maxLength={200} />
              </label>
              <button type="submit">Flag</button>
            </form>
          </div>
        ) : null}
      </section>
    </div>
  );
}
