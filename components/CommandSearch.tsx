"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { PaletteGroups } from "@/lib/search/palette";

type Groups = PaletteGroups;

const EMPTY: Groups = { sites: [], brokers: [], conversations: [] };

function count(groups: Groups) {
  return groups.sites.length + groups.brokers.length + groups.conversations.length;
}

export default function CommandSearch({
  open,
  onClose,
  fallback,
}: {
  open: boolean;
  onClose: () => void;
  fallback?: (query: string) => Groups;
}) {
  const [query, setQuery] = useState("");
  const [groups, setGroups] = useState<Groups>(EMPTY);
  const input = useRef<HTMLInputElement>(null);
  const fallbackRef = useRef(fallback);
  fallbackRef.current = fallback;

  useEffect(() => {
    if (open) setQuery("");
  }, [open]);

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
    const local = fallbackRef.current?.(needle) || EMPTY;
    setGroups(local);
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(needle)}`, { signal: ctrl.signal })
        .then((response) => (response.ok ? response.json() : null))
        .then((body: { mode?: string; groups?: Groups } | null) => {
          if (ctrl.signal.aborted) return;
          const remote = body?.groups || EMPTY;
          if (body?.mode === "index" && count(remote) > 0) setGroups(remote);
          else setGroups(fallbackRef.current?.(needle) || EMPTY);
        })
        .catch(() => {
          if (ctrl.signal.aborted) return;
          setGroups(fallbackRef.current?.(needle) || EMPTY);
        });
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
  const any = count(groups);
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
      {query.trim().length >= 2 && any === 0 ? <p className="layer-meta" data-testid="command-empty">No matches.</p> : null}
      {sections.map(([label, hits]) => hits.length ? (
        <section key={label} data-testid={`command-group-${label.toLowerCase()}`}>
          <p className="eyebrow">{label}</p>
          {hits.map((item) => (
            <a key={`${label}-${item.id}`} className="menu-item" href={item.path || item.url} onClick={onClose}>
              <span className="hit-title">{item.title}</span>
            </a>
          ))}
        </section>
      ) : null)}
    </div>
    </>,
    document.body,
  );
}
