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
  } | null;
};

function reasonWhen(at: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(at)) {
    const [year, month, day] = at.split("-").map(Number);
    return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, day)));
  }
  return formatPacific(at);
}

const STAGES = [
  { id: "any", label: "Any stage" },
  { id: "sourced", label: "Sourced" },
  { id: "desk", label: "Desk screen" },
  { id: "contacted", label: "Contacted" },
  { id: "later", label: "Later stages" },
  { id: "dropped", label: "Dropped" },
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
}) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [firstTime, setFirstTime] = useState(false);
  const [index, setIndex] = useState(0);
  const [error, setError] = useState("");
  const [snooze, setSnooze] = useState("");
  const [flagUser, setFlagUser] = useState("");
  const [flagNote, setFlagNote] = useState("");
  const [accounts, setAccounts] = useState<{ id: string; name: string }[]>([]);
  const [touchX, setTouchX] = useState<number | null>(null);
  const [tick, setTick] = useState(0);

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

  const item = items?.[index] || null;

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
    window.dispatchEvent(new Event("queue-refresh"));
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT")) return;
      const last = Math.max((items?.length || 1) - 1, 0);
      if (event.key === "j" || event.key === "J") setIndex((current) => Math.min(current + 1, last));
      if (event.key === "k" || event.key === "K") setIndex((current) => Math.max(current - 1, 0));
      if ((event.key === "r" || event.key === "R") && item) void act("/api/queue", { siteId: item.siteId });
      if (event.key === "c" || event.key === "C") document.querySelector<HTMLTextAreaElement>("[data-testid='note-body']")?.focus();
      if (event.key === "s" || event.key === "S") document.querySelector<HTMLInputElement>("[data-testid='queue-snooze']")?.focus();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [items, item]);

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

  return (
    <section
      className="queue"
      data-testid="queue"
      onTouchStart={(event) => setTouchX(event.changedTouches[0]?.clientX ?? null)}
      onTouchEnd={(event) => {
        if (touchX == null) return;
        const delta = (event.changedTouches[0]?.clientX ?? touchX) - touchX;
        const last = Math.max((items?.length || 1) - 1, 0);
        if (delta < -60) setIndex((current) => Math.min(current + 1, last));
        if (delta > 60) setIndex((current) => Math.max(current - 1, 0));
        setTouchX(null);
      }}
    >
      <div className="queue-filters">
        <label>Market
          <select aria-label="Queue market" value={market || "all"} onChange={(event) => onFilter({ qmarket: event.target.value })}>
            <option value="all">All markets</option>
            <option value="PHX">Phoenix</option>
            <option value="LAS">Las Vegas</option>
            <option value="MIA">Miami</option>
          </select>
        </label>
        <label>Stage
          <select aria-label="Queue stage" value={stage || "any"} onChange={(event) => onFilter({ qstage: event.target.value })}>
            {STAGES.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
          </select>
        </label>
        <label className="act-check"><input type="checkbox" checked={viable} onChange={(event) => onFilter({ qviable: event.target.checked ? null : "0" })} /> Active only</label>
        <label className="act-check"><input type="checkbox" checked={freshOnly} onChange={(event) => onFilter({ qnew: event.target.checked ? "1" : null })} /> New sites only</label>
        <label className="act-check"><input type="checkbox" checked={flaggedOnly} onChange={(event) => onFilter({ qflag: event.target.checked ? "1" : null })} /> Flagged to me</label>
        <label className="act-check"><input type="checkbox" checked={mentionsOnly} onChange={(event) => onFilter({ qmention: event.target.checked ? "1" : null })} /> Mentions</label>
        <label className="act-check"><input type="checkbox" checked={assignedOnly} onChange={(event) => onFilter({ qassign: event.target.checked ? "1" : null })} /> Assigned to me</label>
        <label className="act-check"><input type="checkbox" checked={approvalOnly} onChange={(event) => onFilter({ qapprove: event.target.checked ? "1" : null })} /> Needs my approval</label>
      </div>
      {items === null ? <p className="note">Loading the queue.</p> : null}
      {items && items.length === 0 ? <p className="queue-empty" data-testid="queue-empty">You're all caught up.</p> : null}
      {firstTime && items && items.length ? (
        <p className="note">
          These active pipeline sites are new until you review them.
          <button type="button" onClick={() => void act("/api/queue", { all: true, ...filters })}>Mark all reviewed</button>
        </p>
      ) : null}
      {item ? (
        <article className="queue-card" data-testid="queue-card">
          <p className="note">{index + 1} of {items?.length}</p>
          <h2>{item.snapshot?.name || item.snapshot?.address || item.siteId}</h2>
          <p className="note">{item.siteId}{item.snapshot?.address ? ` · ${item.snapshot.address}` : ""}</p>
          <h3>What changed since you last looked</h3>
          <ul className="act-list">
            {item.reasons.map((reason) => (
              <li key={`${reason.type}-${reason.at}-${reason.summary}`}>
                <p>{reason.summary}</p>
                <p className="note">{reasonWhen(reason.at)}</p>
              </li>
            ))}
          </ul>
          {item.snapshot ? (
            <div className="kv">
              <span>Asking price</span>
              <div>{item.snapshot.askingPrice || "—"}{item.snapshot.askingSource ? ` · ${item.snapshot.askingSource}` : ""}</div>
              <span>Lead source</span><div>{item.snapshot.leadSource || "—"}</div>
              <span>Verdict</span><div>{item.snapshot.verdict ? plainVerdict(item.snapshot.verdict) : "—"}</div>
              <span>Stage</span><div>{item.snapshot.stage || "—"}</div>
              <span>Latest activity</span><div>{item.snapshot.activity || "No activity on file."}</div>
              <span>Materials</span>
              <div>
                {item.snapshot.materials.length ? item.snapshot.materials.map((entry) => `${entry.label} (${entry.count})`).join(", ") : "No materials on file."}
                {item.snapshot.folderUrl ? <> · <a href={item.snapshot.folderUrl} target="_blank" rel="noopener noreferrer">Open site folder</a></> : null}
              </div>
              <span>Open threads</span><div>{item.snapshot.openThreads}</div>
              <span>Next step</span>
              <div>{item.snapshot.nextStep ? `${item.snapshot.nextStep.title}${item.snapshot.nextStep.date ? ` · ${item.snapshot.nextStep.date}` : ""}` : "No approved next step."}</div>
            </div>
          ) : null}
          {item.snapshot?.assignments.length ? (
            <div data-testid="queue-assignments">
              <h3>Assigned to you</h3>
              <ul className="act-list">
                {item.snapshot.assignments.map((assignment) => (
                  <li key={assignment.id}>
                    <p>{assignment.title}{assignment.date ? ` · ${assignment.date}` : ""} · {assignment.status === "approved" ? "Approved" : "Open"}</p>
                    <button type="button" data-testid="queue-done" onClick={() => void act(`/api/actions/suggestions/${assignment.id}/done`, {})}>Done</button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="act-row">
            <button type="button" data-testid="queue-reviewed" onClick={() => void act("/api/queue", { siteId: item.siteId })}>Mark reviewed</button>
            <button type="button" onClick={() => setIndex((current) => Math.max(current - 1, 0))}>Previous</button>
            <button type="button" onClick={() => setIndex((current) => Math.min(current + 1, (items?.length || 1) - 1))}>Next</button>
            <button type="button" onClick={() => void act("/api/queue/follow", { siteId: item.siteId, follow: !item.followed })}>{item.followed ? "Unfollow" : "Follow"}</button>
          </div>
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
          {error ? <p className="err" role="alert">{error}</p> : null}
          <RecordActions kind="deal" id={item.siteId} />
        </article>
      ) : null}
      <p className="note">J and K move. R marks reviewed. C comments. S snoozes.</p>
    </section>
  );
}
