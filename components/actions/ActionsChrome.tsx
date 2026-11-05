"use client";

import { useEffect, useState } from "react";
import "./actions.css";
import { canReview, openPanel, useActionStatus, usePanel } from "./panel";

type Suggestion = {
  id: string;
  targetKind: string;
  targetId: string;
  field: string;
  proposedValue: string;
  reason: string;
  status: string;
  authorId: string;
  createdAt: string;
};

type View = { id: string; name: string; query: string; scope: "personal" | "team"; ownerId: string };

const FILTERS = ["open", "accepted", "rejected", "applied", "all"] as const;

export function ActionsMenuButtons({ close }: { close: () => void }) {
  const status = useActionStatus();
  if (!status.enabled) return null;
  return (
    <>
      <button type="button" onClick={() => { openPanel("suggestions"); close(); }}>Suggestions</button>
      <button type="button" onClick={() => { openPanel("views"); close(); }}>Saved views</button>
    </>
  );
}

export function ActionsDialogs() {
  const panel = usePanel();
  const status = useActionStatus();
  if (!status.enabled || !panel) return null;
  return panel === "suggestions" ? <SuggestionsDialog /> : <ViewsDialog />;
}

function SuggestionsDialog() {
  const status = useActionStatus();
  const [rows, setRows] = useState<Suggestion[]>([]);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("open");
  const [error, setError] = useState("");
  const [audit, setAudit] = useState<{ id: string; at: string; actorId: string; action: string; targetId: string | null }[]>([]);

  async function load() {
    const response = await fetch("/api/actions/suggestions");
    if (!response.ok) return;
    setRows(((await response.json()) as { suggestions: Suggestion[] }).suggestions || []);
  }

  useEffect(() => {
    let cancel = false;
    fetch("/api/actions/suggestions").then(async (response) => {
      if (!response.ok || cancel) return;
      setRows(((await response.json()) as { suggestions: Suggestion[] }).suggestions || []);
    }).catch(() => undefined);
    if (canReview(status.actionRole)) {
      fetch("/api/actions/audit").then(async (response) => {
        if (!response.ok || cancel) return;
        setAudit(((await response.json()) as { entries: typeof audit }).entries || []);
      }).catch(() => undefined);
    }
    return () => {
      cancel = true;
    };
  }, [status.actionRole]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") openPanel(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const openProposals = rows.filter((row) => row.field === "proposed_next_step" && row.status === "open").length;
  const shown = filter === "all" ? rows : rows.filter((row) => row.status === filter);

  async function decide(id: string, next: "accepted" | "rejected") {
    setError("");
    const response = await fetch(`/api/actions/suggestions/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) {
      setError(payload.error || "That decision was not saved.");
      return;
    }
    await load();
  }

  return (
    <div className="act-layer">
      <button className="backdrop" type="button" aria-label="Close suggestions" onClick={() => openPanel(null)} />
      <section className="act-dialog" role="dialog" aria-modal="true" aria-labelledby="suggestions-title" data-testid="suggestions-panel">
        <button className="close" type="button" onClick={() => openPanel(null)}>Close</button>
        <h2 id="suggestions-title">Suggestions{openProposals ? ` · ${openProposals} open proposals` : ""}</h2>
        <p className="note">Accepting a row does not change the map. Apply it in the workbook. When a later sync matches, the row is marked applied.</p>
        <div className="act-row">
          {FILTERS.map((item) => (
            <button key={item} type="button" className={filter === item ? "on" : ""} onClick={() => setFilter(item)}>{item}</button>
          ))}
          <a href="/api/actions/suggestions/export">Download CSV</a>
          <a href="/api/actions/suggestions/export?kind=next">Approved next steps</a>
        </div>
        {error ? <p className="err" role="alert">{error}</p> : null}
        {shown.length ? (
          <ul className="act-list">
            {shown.map((row) => (
              <li key={row.id}>
                <p><strong>{row.targetId}</strong> · {row.field} · {row.proposedValue} <span className="badge pending">{row.status}</span></p>
                <p>{row.reason}</p>
                <p className="note">{row.authorId} · {row.createdAt.slice(0, 16).replace("T", " ")}</p>
                {canReview(status.actionRole) && row.status === "open" ? (
                  <div className="act-row">
                    <button type="button" onClick={() => void decide(row.id, "accepted")}>Accept</button>
                    <button type="button" onClick={() => void decide(row.id, "rejected")}>Reject</button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="note">Nothing in this filter.</p>
        )}
        {canReview(status.actionRole) ? (
          <>
            <h3>Audit log</h3>
            {audit.length ? (
              <ul className="act-list">
                {audit.slice(0, 12).map((entry) => (
                  <li key={entry.id}>
                    <p>{entry.action}{entry.targetId ? ` · ${entry.targetId}` : ""}</p>
                    <p className="note">{entry.actorId} · {entry.at.slice(0, 16).replace("T", " ")}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="note">No writes yet.</p>
            )}
          </>
        ) : null}
      </section>
    </div>
  );
}

function ViewsDialog() {
  const status = useActionStatus();
  const [views, setViews] = useState<View[]>([]);
  const [name, setName] = useState("");
  const [team, setTeam] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function load() {
    const response = await fetch("/api/actions/views");
    if (!response.ok) return;
    setViews(((await response.json()) as { views: View[] }).views || []);
  }

  useEffect(() => {
    let cancel = false;
    fetch("/api/actions/views").then(async (response) => {
      if (!response.ok || cancel) return;
      setViews(((await response.json()) as { views: View[] }).views || []);
    }).catch(() => undefined);
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") openPanel(null);
    }
    window.addEventListener("keydown", onKey);
    return () => {
      cancel = true;
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <div className="act-layer">
      <button className="backdrop" type="button" aria-label="Close saved views" onClick={() => openPanel(null)} />
      <section className="act-dialog" role="dialog" aria-modal="true" aria-labelledby="views-title" data-testid="views-panel">
        <button className="close" type="button" onClick={() => openPanel(null)}>Close</button>
        <h2 id="views-title">Saved views</h2>
        <p className="note">A saved view stores this screen’s link. It does not copy site data.</p>
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            setPending(true);
            setError("");
            const response = await fetch("/api/actions/views", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ name, query: window.location.search, scope: team ? "team" : "personal" }),
            });
            const payload = (await response.json().catch(() => ({}))) as { error?: string };
            setPending(false);
            if (!response.ok) {
              setError(payload.error || "That view was not saved.");
              return;
            }
            setName("");
            setTeam(false);
            await load();
          }}
        >
          <label>
            Name
            <input data-testid="view-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={80} />
          </label>
          {canReview(status.actionRole) ? (
            <label className="act-check">
              <input type="checkbox" checked={team} onChange={(event) => setTeam(event.target.checked)} />
              Share with the team
            </label>
          ) : null}
          <button type="submit" disabled={pending}>Save this view</button>
        </form>
        {error ? <p className="err" role="alert">{error}</p> : null}
        {views.length ? (
          <ul className="act-list">
            {views.map((view) => (
              <li key={view.id}>
                <p><strong>{view.name}</strong> {view.scope === "team" ? <span className="badge checked">Team</span> : null}</p>
                <div className="act-row">
                  <button type="button" onClick={() => { window.location.assign(view.query ? `/?${view.query}` : "/"); }}>Open</button>
                  <button
                    type="button"
                    onClick={async () => {
                      const response = await fetch(`/api/actions/views/${view.id}`, { method: "DELETE" });
                      if (!response.ok) {
                        const payload = (await response.json().catch(() => ({}))) as { error?: string };
                        setError(payload.error || "That view was not removed.");
                        return;
                      }
                      await load();
                    }}
                  >
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="note">No saved views yet.</p>
        )}
      </section>
    </div>
  );
}
