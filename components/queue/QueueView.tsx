"use client";

import { useEffect, useState, type ReactNode } from "react";
import { formatPacific } from "@/lib/actions/time";
import "./queue.css";

export type QueueReason = { at: string; summary: string; type: string };

export type FeedSite = {
  siteId: string;
  name: string;
  city: string;
  lng: number | null;
  lat: number | null;
  followed: boolean;
  reasons: QueueReason[];
  status: "open" | "reviewed" | "snoozed";
  previous: string | null;
};

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

export function marketLabel(code: string): string {
  return MARKETS.find((item) => item.id === code)?.label || "All markets";
}

export function chipLabel(type: string): string {
  if (type === "new_site") return "New site";
  if (type === "note" || type === "reply") return "New note";
  if (type === "mention") return "Mentioned you";
  if (type === "assignment" || type === "next_proposed" || type === "next_accepted") return "Assigned";
  if (type === "flag") return "Flagged";
  if (type === "stage") return "Stage";
  if (type === "verdict") return "Verdict";
  if (type === "price") return "Price";
  if (type === "activity") return "Activity";
  if (type === "materials") return "Materials";
  return "Update";
}

function reasonWhen(at: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(at)) {
    const [year, month, day] = at.split("-").map(Number);
    return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, day)));
  }
  return formatPacific(at);
}

function chips(reasons: QueueReason[]) {
  const seen = new Set<string>();
  const out: { label: string; at: string }[] = [];
  for (const reason of reasons) {
    const label = chipLabel(reason.type);
    if (seen.has(label)) continue;
    seen.add(label);
    out.push({ label, at: reason.at });
  }
  return out.slice(0, 3);
}

export function WhatChanged({ reasons }: { reasons: QueueReason[] }) {
  if (!reasons.length) return null;
  return (
    <ul className="queue-changes">
      {reasons.map((reason) => (
        <li key={`${reason.type}-${reason.at}-${reason.summary}`}>
          {chipLabel(reason.type) === "Update" ? reason.summary.replace(/\.$/, "") : chipLabel(reason.type)}
          <time dateTime={reason.at}>{reasonWhen(reason.at)}</time>
        </li>
      ))}
    </ul>
  );
}

export function ReviewBar({
  index,
  total,
  reviewed,
  summary,
  onPrev,
  onNext,
  onReviewed,
  onExit,
  onOpenFeed,
  onSnooze,
  onNotFit,
  siteId,
  followed,
  filters,
}: {
  index: number;
  total: number;
  reviewed: number;
  summary: string;
  onPrev: () => void;
  onNext: () => void;
  onReviewed: () => void;
  onExit: () => void;
  onOpenFeed: () => void;
  onSnooze: () => void;
  onNotFit?: () => void;
  siteId: string;
  followed: boolean;
  filters: ReactNode;
}) {
  const [menu, setMenu] = useState<null | "snooze" | "more">(null);
  const width = total ? Math.min(100, (reviewed / total) * 100) : 0;
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT")) return;
      if (event.key === "j" || event.key === "J") onNext();
      if (event.key === "k" || event.key === "K") onPrev();
      if (event.key === "r" || event.key === "R") onReviewed();
      if (event.key === "s" || event.key === "S") {
        setMenu("snooze");
        window.setTimeout(() => document.querySelector<HTMLInputElement>("[data-testid='queue-snooze']")?.focus(), 0);
      }
      if (event.key === "f" || event.key === "F") {
        setMenu("more");
        window.setTimeout(() => document.querySelector<HTMLSelectElement>("[aria-label='Flag for']")?.focus(), 0);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onNext, onPrev, onReviewed]);
  return (
    <div className="review-bar" data-testid="review-bar" aria-label={summary}>
      <button type="button" className="review-count" data-testid="review-position" onClick={onOpenFeed}>
        <span className="review-kicker">Reviewing</span>
        {total ? `${index + 1} of ${total}` : "0"}
      </button>
      <div className="review-meter" aria-hidden="true"><span style={{ width: `${width}%` }} /></div>
      <div className="review-summary">{filters}</div>
      <button type="button" className="review-step" aria-label="Previous" onClick={onPrev}>Previous</button>
      <button type="button" className="review-step" aria-label="Next" onClick={onNext}>Next</button>
      <button type="button" className="primary" data-testid="queue-reviewed" onClick={onReviewed}>Mark reviewed</button>
      <div className="review-verbs" role="group" aria-label="Review actions">
        <button type="button" onClick={() => { setMenu(null); window.dispatchEvent(new CustomEvent("sites-open-next-step", { detail: "stage_move" })); }}>Advance</button>
        <button type="button" onClick={() => { setMenu(null); window.dispatchEvent(new CustomEvent("sites-open-next-step", { detail: "knock_off" })); }}>Drop with a reason</button>
        <button type="button" onClick={() => { setMenu(null); window.dispatchEvent(new CustomEvent("sites-open-next-step", { detail: "mark_duplicate" })); }}>Mark duplicate</button>
        <button type="button" aria-expanded={menu === "snooze"} onClick={() => setMenu((value) => value === "snooze" ? null : "snooze")}>Snooze until a package arrives</button>
        {onNotFit ? <button type="button" onClick={onNotFit}>Not a fit</button> : null}
      </div>
      <button type="button" data-testid="queue-more" aria-expanded={menu === "more"} aria-label="More actions" onClick={() => setMenu((value) => value === "more" ? null : "more")}>...</button>
      <span className="review-hint">J K move · R reviewed · S snooze · F flag</span>
      <button type="button" className="review-exit" onClick={onExit}>Exit review</button>
      {menu ? <ReviewMenu mode={menu} siteId={siteId} followed={followed} onClose={() => setMenu(null)} onSnooze={onSnooze} /> : null}
    </div>
  );
}

function ReviewMenu({ mode, siteId, followed, onClose, onSnooze }: { mode: "snooze" | "more"; siteId: string; followed: boolean; onClose: () => void; onSnooze: () => void }) {
  const [snooze, setSnooze] = useState("");
  const [packageReason, setPackageReason] = useState("");
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
    return () => { cancel = true; };
  }, []);
  async function act(path: string, body: unknown) {
    setError("");
    const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) {
      setError(payload.error || "That could not be saved.");
      return;
    }
    if (path.endsWith("/snooze")) onSnooze();
    onClose();
  }
  return (
    <div className="review-menu" data-testid="queue-menu" role="dialog" aria-label={mode === "snooze" ? "Snooze" : "More actions"}>
      {mode === "snooze" ? (
        <form onSubmit={(event) => { event.preventDefault(); if (!packageReason) return; void act("/api/queue/snooze", { siteId, until: snooze, reason: packageReason }); }}>
          <p className="note">Snooze until a package arrives. This does not change Stage.</p>
          <label>Package status
            <select aria-label="Package status" value={packageReason} onChange={(event) => setPackageReason(event.target.value)} required>
              <option value="">Choose a package reason</option>
              <option value="Package not received">Package not received</option>
              <option value="Package requested">Package requested</option>
              <option value="Package partial">Package partial</option>
            </select>
          </label>
          <label>Snooze until
            <input data-testid="queue-snooze" type="date" value={snooze} onChange={(event) => setSnooze(event.target.value)} required />
          </label>
          <button type="submit">Snooze until a package arrives</button>
        </form>
      ) : null}
      {mode === "more" ? <form onSubmit={(event) => { event.preventDefault(); void act("/api/queue/flag", { siteId, toUser: flagUser, note: flagNote }); }}>
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
      </form> : null}
      {mode === "more" ? <button type="button" onClick={() => void act("/api/queue/follow", { siteId, follow: !followed })}>
        {followed ? "Unfollow" : "Follow"}
      </button> : null}
      {error ? <p className="err">{error}</p> : null}
    </div>
  );
}

export function FilterPopover({
  summary,
  market,
  stage,
  viable,
  freshOnly,
  flaggedOnly,
  approvalOnly,
  mentionsOnly,
  assignedOnly,
  onFilter,
}: {
  summary: string;
  market: string;
  stage: string;
  viable: boolean;
  freshOnly: boolean;
  flaggedOnly: boolean;
  approvalOnly: boolean;
  mentionsOnly: boolean;
  assignedOnly: boolean;
  onFilter: (patch: Record<string, string | null>) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <span className="review-filters">
      <button type="button" data-testid="queue-filters" aria-expanded={open} onClick={() => setOpen((value) => !value)}>{summary}</button>
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
    </span>
  );
}

export function ReviewRail({
  sites,
  currentId,
  onPick,
}: {
  sites: FeedSite[];
  currentId: string;
  onPick: (index: number) => void;
}) {
  return (
    <aside className="review-rail" data-testid="review-rail">
      {sites.map((site, index) => (
        <button
          key={site.siteId}
          type="button"
          className={`${site.siteId === currentId ? "on" : ""} ${site.status === "reviewed" ? "done" : ""}`}
          onClick={() => onPick(index)}
        >
          <strong>{site.status === "reviewed" ? "✓ " : `${index + 1}. `}{site.name}</strong>
          <span>{marketLabel(site.city)}</span>
          <span className="review-row-chips">
            {chips(site.reasons).map((chip) => <em key={chip.label}>{chip.label}</em>)}
            {site.reasons[0] ? <time>{reasonWhen(site.reasons[0].at)}</time> : null}
          </span>
        </button>
      ))}
    </aside>
  );
}

export function ReviewFeedSheet({
  sites,
  currentId,
  onPick,
  onClose,
}: {
  sites: FeedSite[];
  currentId: string;
  onPick: (index: number) => void;
  onClose: () => void;
}) {
  return (
    <div className="review-sheet" data-testid="review-feed" role="dialog" aria-label="Review list">
      <div className="review-sheet-head">
        <h2>Review</h2>
        <button type="button" onClick={onClose}>Close</button>
      </div>
      {sites.map((site, index) => (
        <button
          key={site.siteId}
          type="button"
          className={site.siteId === currentId ? "on" : ""}
          onClick={() => { onPick(index); onClose(); }}
        >
          <strong>{index + 1}. {site.name}</strong>
          <span>{marketLabel(site.city)} · {chips(site.reasons).map((chip) => chip.label).join(", ")}</span>
        </button>
      ))}
    </div>
  );
}
