"use client";

import { useEffect, useState } from "react";
import { formatPacific } from "@/lib/actions/time";
import "./queue.css";

export type QueueReason = { at: string; summary: string; type: string };
export type QueueItem = { siteId: string; followed: boolean; reasons: QueueReason[] };

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

const MARKETS = [
  { id: "all", label: "All markets" },
  { id: "PHX", label: "Phoenix" },
  { id: "LAS", label: "Las Vegas" },
  { id: "MIA", label: "Miami" },
];

export function QueueBar({
  count,
  firstTime,
  market,
  stage,
  viable,
  freshOnly,
  flaggedOnly,
  approvalOnly,
  mentionsOnly,
  assignedOnly,
  onFilter,
  onMarkAll,
}: {
  count: number;
  firstTime: boolean;
  market: string;
  stage: string;
  viable: boolean;
  freshOnly: boolean;
  flaggedOnly: boolean;
  approvalOnly: boolean;
  mentionsOnly: boolean;
  assignedOnly: boolean;
  onFilter: (patch: Record<string, string | null>) => void;
  onMarkAll: () => void;
}) {
  const [open, setOpen] = useState(false);
  const active = [
    mentionsOnly ? "Mentions" : "",
    assignedOnly ? "Assigned to me" : "",
    approvalOnly ? "Needs my approval" : "",
    freshOnly ? "New sites" : "",
    viable ? "Active" : "",
    flaggedOnly ? "Flagged to me" : "",
  ].filter(Boolean);
  return (
    <div className="queue-bar" data-testid="queue">
      <button type="button" aria-expanded={open} data-testid="queue-filters" onClick={() => setOpen((value) => !value)}>Filters</button>
      {active.map((label) => <span key={label} className="queue-pill">{label}</span>)}
      {count ? <span className="queue-pill">{count} in queue</span> : null}
      {firstTime && count ? <button type="button" onClick={onMarkAll}>Mark all reviewed</button> : null}
      {open ? (
        <div className="queue-pop" role="dialog" aria-label="Queue filters">
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
      ) : null}
    </div>
  );
}

export function QueueEmpty() {
  return (
    <p className="queue-empty-banner" data-testid="queue-empty">You're all caught up.</p>
  );
}

export function QueueControls({
  item,
  index,
  total,
  onPrev,
  onNext,
  onReviewed,
}: {
  item: QueueItem;
  index: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
  onReviewed: () => void;
}) {
  const [menu, setMenu] = useState(false);
  const [snooze, setSnooze] = useState("");
  const [flagUser, setFlagUser] = useState("");
  const [flagNote, setFlagNote] = useState("");
  const [accounts, setAccounts] = useState<{ id: string; name: string }[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancel = false;
    fetch("/api/actions/accounts").then(async (response) => {
      if (cancel || !response.ok) return;
      setAccounts(((await response.json()) as { accounts: { id: string; name: string }[] }).accounts || []);
    }).catch(() => undefined);
    return () => {
      cancel = true;
    };
  }, []);

  useEffect(() => {
    setMenu(false);
  }, [item.siteId]);

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

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT")) return;
      if (event.key === "j" || event.key === "J") onNext();
      if (event.key === "k" || event.key === "K") onPrev();
      if (event.key === "r" || event.key === "R") onReviewed();
      if (event.key === "c" || event.key === "C") document.querySelector<HTMLTextAreaElement>("[data-testid='note-body']")?.focus();
      if (event.key === "s" || event.key === "S") {
        setMenu(true);
        window.setTimeout(() => document.querySelector<HTMLInputElement>("[data-testid='queue-snooze']")?.focus(), 0);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onNext, onPrev, onReviewed]);

  return (
    <section className="queue-controls" data-testid="queue-controls">
      {item.reasons.length ? (
        <ul className="queue-changes">
          {item.reasons.map((reason) => (
            <li key={`${reason.type}-${reason.at}-${reason.summary}`}>
              {reason.summary.replace(/\.$/, "")}
              <time dateTime={reason.at}>{reasonWhen(reason.at)}</time>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="queue-nav">
        <button type="button" data-testid="queue-more" aria-expanded={menu} aria-haspopup="dialog" onClick={() => setMenu((open) => !open)}>...</button>
        <button type="button" onClick={onPrev}>Previous</button>
        <span data-testid="queue-position">{index + 1} of {total}</span>
        <button type="button" onClick={onNext}>Next</button>
        <button type="button" className="primary" data-testid="queue-reviewed" onClick={onReviewed}>Mark reviewed</button>
      </div>
      {menu ? (
        <div className="queue-menu" data-testid="queue-menu" role="dialog" aria-label="More actions">
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
          {error ? <p className="err" role="alert">{error}</p> : null}
        </div>
      ) : null}
    </section>
  );
}
