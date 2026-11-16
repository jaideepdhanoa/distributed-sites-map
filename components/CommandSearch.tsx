"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type Hit = { id: string; title: string; path: string; url: string };
type Groups = { sites: Hit[]; brokers: Hit[]; conversations: Hit[] };

const EMPTY: Groups = { sites: [], brokers: [], conversations: [] };

export default function CommandSearch({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [groups, setGroups] = useState<Groups>(EMPTY);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => input.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const needle = query.trim();
    if (needle.length < 2) {
      setGroups(EMPTY);
      return;
    }
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(needle)}`, { signal: ctrl.signal })
        .then((response) => (response.ok ? response.json() : null))
        .then((body: { groups?: Groups } | null) => {
          setGroups(body?.groups || EMPTY);
        })
        .catch(() => undefined);
    }, 160);
    return () => {
      ctrl.abort();
      window.clearTimeout(timer);
    };
  }, [open, query]);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;
  const sections = [
    ["Sites", groups.sites],
    ["Brokers", groups.brokers],
    ["Conversations", groups.conversations],
  ] as const;
  return createPortal(
    <>
    <button type="button" className="backdrop" aria-label="Close search" onClick={onClose} />
    <div className="command-search" role="dialog" aria-label="Search everything" data-testid="command-search">
      <header className="command-head">
        <p className="eyebrow">Search</p>
        <button type="button" className="close" aria-label="Close search" onClick={onClose}><span aria-hidden="true">×</span></button>
      </header>
      <input
        ref={input}
        className="search"
        aria-label="Search everything"
        placeholder="Sites, brokers, conversations"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {sections.map(([label, hits]) => (
        <section key={label} data-testid={`command-group-${label.toLowerCase()}`}>
          <p className="eyebrow">{label}</p>
          {hits.length ? hits.map((hit) => (
            <a key={`${label}-${hit.id}`} className="menu-item" href={hit.path || hit.url}>
              <span className="hit-title">{hit.title}</span>
            </a>
          )) : <p className="layer-meta">No matches.</p>}
        </section>
      ))}
    </div>
    </>,
    document.body,
  );
}
