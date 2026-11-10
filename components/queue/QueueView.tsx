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
  needsApproval?: boolean;
  mentioned?: boolean;
  assigned?: boolean;
  reasons: QueueReason[];
  status: "open" | "reviewed" | "snoozed";
  previous: string | null;
};

function reviewGroups(sites: FeedSite[]) {
  const claimed = new Set<string>();
  const take = (label: string, testId: string, match: (site: FeedSite) => boolean) => {
    const rows = sites.flatMap((site, index) => {
      if (claimed.has(site.siteId) || !match(site)) return [];
      claimed.add(site.siteId);
      return [{ site, index }];
    });
    return { label, testId, rows };
  };
  return {
    groups: [
      take("Needs my approval", "review-approvals", (site) => Boolean(site.needsApproval)),
      take("Mentions", "review-mentions", (site) => Boolean(site.mentioned)),
      take("Assigned", "review-assigned", (site) => Boolean(site.assigned)),
    ],
    rest: sites.flatMap((site, index) => (claimed.has(site.siteId) ? [] : [{ site, index }])),
  };
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

export function marketLabel(code: string): string {
  return MARKETS.find((item) => item.id === code)?.label || "All markets";
}

export function chipLabel(type: string): string {
  if (type === "new_site") return "New site";
  if (type === "note" || type === "reply") return "New note";
  if (type === "mention") return "Mentioned you";
  if (type === "document_request") return "Approval";
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
      <div className="review-nav">
        <button type="button" className="review-step" aria-label="Previous" onClick={onPrev}>Previous</button>
        <button type="button" className="review-step" aria-label="Next" onClick={onNext}>Next</button>
      </div>
      <button type="button" className="primary" data-testid="queue-reviewed" onClick={onReviewed}>
        <span className="review-long">Mark reviewed</span>
        <span className="review-short">Mark reviewed</span>
      </button>
      <button type="button" className="review-more" data-testid="queue-more" aria-expanded={menu != null} aria-label="More actions" onClick={() => setMenu((value) => value === "more" ? null : "more")}>
        <span className="review-long">Actions</span>
        <span className="review-short">Actions</span>
      </button>
      <button type="button" className="review-exit" onClick={onExit}>
        <span className="review-long">Exit review</span>
        <span className="review-short">Exit</span>
      </button>
      {menu ? <ReviewMenu mode={menu} siteId={siteId} followed={followed} onClose={() => setMenu(null)} onShowSnooze={() => setMenu("snooze")} onSnooze={onSnooze} /> : null}
    </div>
  );
}

function ReviewMenu({ mode, siteId, followed, onClose, onShowSnooze, onSnooze }: { mode: "snooze" | "more"; siteId: string; followed: boolean; onClose: () => void; onShowSnooze: () => void; onSnooze: () => void }) {
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
            <select aria-label="Package status" value={packageReason} onChange={(event) => setPackageReason(event.target.value)} required className="secondary">
              <option value="">Choose a package reason</option>
              <option value="Package not received">Package not received</option>
              <option value="Package requested">Package requested</option>
              <option value="Package partial">Package partial</option>
            </select>
          </label>
          <label>Snooze until
            <input data-testid="queue-snooze" type="date" value={snooze} onChange={(event) => setSnooze(event.target.value)} required />
          </label>
          <button type="submit" className="menu-item">Snooze until a package arrives</button>
        </form>
      ) : null}
      {mode === "more" ? (
        <div className="review-menu-actions" role="group" aria-label="Review actions">
          <button type="button" onClick={() => { onClose(); window.dispatchEvent(new CustomEvent("sites-open-next-step", { detail: "stage_move" })); }} className="menu-item">Advance</button>
          <button type="button" onClick={() => { onClose(); window.dispatchEvent(new CustomEvent("sites-open-next-step", { detail: "knock_off" })); }} className="menu-item">Drop with a reason</button>
          <button type="button" onClick={() => { onClose(); window.dispatchEvent(new CustomEvent("sites-open-next-step", { detail: "mark_duplicate" })); }} className="menu-item">Mark duplicate</button>
          <button type="button" onClick={onShowSnooze} className="menu-item">Snooze until a package arrives</button>
          <p className="note">J K move · R reviewed · S snooze · F flag</p>
        </div>
      ) : null}
      {mode === "more" ? <form onSubmit={(event) => { event.preventDefault(); void act("/api/queue/flag", { siteId, toUser: flagUser, note: flagNote }); }}>
        <label>Flag for
          <select aria-label="Flag for" value={flagUser} onChange={(event) => setFlagUser(event.target.value)} className="secondary">
            <option value="">Choose an account</option>
            {accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
          </select>
        </label>
        <label>Note
          <input className="field" data-testid="queue-flag-note" value={flagNote} onChange={(event) => setFlagNote(event.target.value)} maxLength={200} />
        </label>
        <button type="submit" className="menu-item">Flag</button>
      </form> : null}
      {mode === "more" ? <button type="button" onClick={() => void act("/api/queue/follow", { siteId, follow: !followed })} className="menu-item">
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
      <button type="button" data-testid="queue-filters" aria-expanded={open} onClick={() => setOpen((value) => !value)} className="menu-item">{summary}</button>
      {open ? (
        <div className="queue-pop" role="dialog" aria-label="Queue filters">
          <button type="button" className={approvalOnly ? "chip on" : "chip"} onClick={() => onFilter({ qapprove: approvalOnly ? null : "1" })}>Needs my approval</button>
          <button type="button" className={mentionsOnly ? "chip on" : "chip"} onClick={() => onFilter({ qmention: mentionsOnly ? null : "1" })}>Mentions</button>
          <button type="button" className={assignedOnly ? "chip on" : "chip"} onClick={() => onFilter({ qassign: assignedOnly ? null : "1" })}>Assigned to me</button>
          <button type="button" className={freshOnly ? "chip on" : "chip"} onClick={() => onFilter({ qnew: freshOnly ? null : "1" })}>New sites</button>
          <button type="button" className={viable ? "chip on" : "chip"} onClick={() => onFilter({ qviable: viable ? "0" : null })}>Active</button>
          <button type="button" className={flaggedOnly ? "chip on" : "chip"} onClick={() => onFilter({ qflag: flaggedOnly ? null : "1" })}>Flagged to me</button>
          <select aria-label="Queue market" value={market || "all"} onChange={(event) => onFilter({ qmarket: event.target.value })} className="secondary">
            {MARKETS.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
          </select>
          <select aria-label="Queue stage" value={stage || "any"} onChange={(event) => onFilter({ qstage: event.target.value })} className="secondary">
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
  const { groups, rest } = reviewGroups(sites);
  const row = (site: FeedSite, index: number) => (
    <button
      key={site.siteId}
      type="button"
      className={`review-row ${site.siteId === currentId ? "on" : ""} ${site.status === "reviewed" ? "done" : ""}`}
      onClick={() => onPick(index)}
    >
      <strong>{site.status === "open" ? <i className="queue-dot" aria-hidden="true" /> : null}{site.status === "reviewed" ? "✓ " : `${index + 1}. `}{site.name}</strong>
      <span>{marketLabel(site.city)}</span>
      <span className="review-row-chips">
        {chips(site.reasons).map((chip) => <em key={chip.label}>{chip.label}</em>)}
        {site.reasons[0] ? <time>{reasonWhen(site.reasons[0].at)}</time> : null}
      </span>
    </button>
  );
  return (
    <aside className="review-rail" data-testid="review-rail" aria-label="Review inbox">
      {groups.map((group) => (
        <section key={group.testId} data-testid={group.testId}>
          <h2>{group.label}</h2>
          {group.rows.length ? group.rows.map(({ site, index }) => row(site, index)) : <p className="review-empty">None</p>}
        </section>
      ))}
      {rest.length ? (
        <section data-testid="review-other">
          <h2>Also in review</h2>
          {rest.map(({ site, index }) => row(site, index))}
        </section>
      ) : null}
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
        <button type="button" className="close" aria-label="Close review list" onClick={onClose}><span aria-hidden="true">×</span></button>
      </div>
      {(() => {
        const { groups, rest } = reviewGroups(sites);
        const row = (site: FeedSite, index: number) => (
          <button
            key={site.siteId}
            type="button"
            className={`review-row ${site.siteId === currentId ? "on" : ""}`}
            onClick={() => { onPick(index); onClose(); }}
          >
            <strong>{site.status === "open" ? <i className="queue-dot" aria-hidden="true" /> : null}{index + 1}. {site.name}</strong>
            <span>{marketLabel(site.city)} · {chips(site.reasons).map((chip) => chip.label).join(", ")}</span>
          </button>
        );
        return (
          <>
            {groups.map((group) => (
              <section key={group.testId} data-testid={`${group.testId}-sheet`}>
                <h3>{group.label}</h3>
                {group.rows.length ? group.rows.map(({ site, index }) => row(site, index)) : <p className="review-empty">None</p>}
              </section>
            ))}
            {rest.length ? (
              <section data-testid="review-other-sheet">
                <h3>Also in review</h3>
                {rest.map(({ site, index }) => row(site, index))}
              </section>
            ) : null}
          </>
        );
      })()}
    </div>
  );
}
